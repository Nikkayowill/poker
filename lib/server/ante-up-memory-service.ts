import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpMemoryFlipProblem,
  anteUpMemoryPayout,
  flipAnteUpMemoryTile,
  resignAnteUpMemory,
  startAnteUpMemory,
  toAnteUpMemorySnapshot,
  type AnteUpMemoryAttempt,
  type AnteUpMemorySnapshot,
} from "@/lib/arcade/ante-up-memory";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ActiveAnteUpAttemptExists,
  advanceAnteUpAttempt,
  countWageredAttemptsSince,
  createAnteUpAttempt,
  getActiveAnteUpAttempt,
  getAnteUpAttemptById,
  type StoredAnteUpAttempt,
} from "./ante-up-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { applyAchievementEvent } from "./achievement-store";
import { applyMissionEvent } from "./mission-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between an Ante Up: Memory Match request and the wallet.
 *
 * Same shape, same three ordering rules, same "the payout is settled, not
 * stored" note as ante-up-word-stack-service.ts -- see that file's header.
 * The one thing unique to this service: a flip that exceeds
 * ANTE_UP_MEMORY_MAX_TURNS (lib/arcade/ante-up-memory.ts) settles as a loss,
 * not a win -- Memory has no natural loss condition otherwise, so that cap is
 * the entire reason wagering on it is possible at all.
 */

export class AnteUpMemoryRequestError extends ArcadeRequestError<AnteUpMemorySnapshot, never> {
  readonly name = "AnteUpMemoryRequestError";
}

/** This game's id in ante_up_attempts -- see lib/server/ante-up-store.ts. */
const GAME = "memory-match";

/** How many wagered attempts a player may open in a rolling day, at this game. Free practice is uncapped. */
export const ANTE_UP_MEMORY_DAILY_WAGERED_LIMIT = 10;

function snapshot(stored: StoredAnteUpAttempt<AnteUpMemoryAttempt>): AnteUpMemorySnapshot {
  return toAnteUpMemorySnapshot(stored.state, { id: stored.id, version: stored.version });
}

/** Never throws -- see ante-up-service.ts's payOutWin for why. */
async function payOutWin(profileId: string, attempt: Pick<AnteUpMemoryAttempt, "wager" | "board">): Promise<void> {
  const payout = anteUpMemoryPayout(attempt);
  if (payout <= 0) return;
  try {
    await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("ante-up-memory.payout_credit_failed", { profileId, payout, error });
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
}

/** The caller's live attempt, or null. */
export async function readAnteUpMemory(
  token: string,
): Promise<{ attempt: AnteUpMemorySnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<AnteUpMemoryAttempt>(profile.id, GAME);
  return { attempt: stored ? snapshot(stored) : null, profile };
}

/** Opens a fresh attempt, escrowing the wager. Rule 1: the Gold leaves before the row exists. */
export async function openAnteUpMemory(
  token: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpMemorySnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpMemoryRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpMemoryRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= ANTE_UP_MEMORY_DAILY_WAGERED_LIMIT) {
      throw new AnteUpMemoryRequestError(
        `You've wagered Ante Up ${ANTE_UP_MEMORY_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new AnteUpMemoryRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  // A fresh layout, never the shared daily one. node:crypto's randomInt, same
  // as the daily service's own deal.
  const state = startAnteUpMemory(randomInt, wagerInput, now);

  let stored: StoredAnteUpAttempt<AnteUpMemoryAttempt>;
  try {
    stored = await createAnteUpAttempt({
      profileId: profile.id,
      game: GAME,
      tier: null,
      wager: wagerInput,
      multiplier: 1, // placeholder -- the real payout is skill-scored at settlement, see this file's header.
      state,
    });
  } catch (error) {
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof ActiveAnteUpAttemptExists) throw new AnteUpMemoryRequestError(error.message, 409);
    throw error;
  }

  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, now).catch(() => null);

  return { attempt: snapshot(stored), profile: debited };
}

/** Turns one tile over, and settles the attempt if it finished (a clear, or a turn-cap forfeit). */
export async function flipAnteUpMemory(
  token: string,
  input: { version: number; index: number },
  now = new Date(),
): Promise<{ attempt: AnteUpMemorySnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpMemoryAttempt>(profile.id, GAME);
  if (!current) throw new AnteUpMemoryRequestError("Start an attempt first.", 404);

  if (current.version !== input.version) {
    throw new AnteUpMemoryRequestError("That board moved on.", 409, { round: snapshot(current) });
  }

  const problem = anteUpMemoryFlipProblem(current.state, input.index);
  if (problem) {
    throw new AnteUpMemoryRequestError(
      problem === "finished" ? "This attempt is already over." : "That card is not face down.",
      409,
      { round: snapshot(current) },
    );
  }

  const next = flipAnteUpMemoryTile(current.state, input.index, now);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    const live = (await getAnteUpAttemptById<AnteUpMemoryAttempt>(current.id)) ?? current;
    throw new AnteUpMemoryRequestError("That board moved on.", 409, { round: snapshot(live) });
  }

  if (stored.state.status === "won") {
    // No leaderboard write here, deliberately: solo Ante Up games don't get a
    // board (see lib/leaderboard/contract.ts's header for the rule). A clear
    // still feeds missions, achievements and the payout below -- it just
    // isn't ranked against anyone.
    await payOutWin(profile.id, stored.state);
  }

  return { attempt: snapshot(stored), profile };
}

/** Gives up early. The wager is already spent -- see the ordering rules above. */
export async function resignAnteUpMemoryAttempt(
  token: string,
): Promise<{ attempt: AnteUpMemorySnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpMemoryAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpMemory(current.state);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ??
    (await getAnteUpAttemptById<AnteUpMemoryAttempt>(current.id)) ??
    current;
  return { attempt: snapshot(stored), profile };
}

/** Maps a thrown error to the response every Ante Up: Memory route sends. */
export function toAnteUpMemoryErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpConnectionsGuessProblem,
  anteUpConnectionsPayout,
  playAnteUpConnectionsGuess,
  resignAnteUpConnections,
  startAnteUpConnections,
  toAnteUpConnectionsSnapshot,
  type AnteUpConnectionsAttempt,
  type AnteUpConnectionsSnapshot,
} from "@/lib/arcade/ante-up-connections";
import { CONNECTIONS_PUZZLES } from "@/lib/arcade/puzzles/connections-puzzles";
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
 * Everything between an Ante Up: Connections request and the wallet.
 *
 * Same shape, same three ordering rules, same "the payout is settled, not
 * stored" note as ante-up-word-stack-service.ts -- see that file's header.
 */

export class AnteUpConnectionsRequestError extends ArcadeRequestError<AnteUpConnectionsSnapshot, never> {
  readonly name = "AnteUpConnectionsRequestError";
}

/** This game's id in ante_up_attempts -- see lib/server/ante-up-store.ts. */
const GAME = "connections";

/** How many wagered attempts a player may open in a rolling day, at this game. Free practice is uncapped. */
export const ANTE_UP_CONNECTIONS_DAILY_WAGERED_LIMIT = 10;

function snapshot(stored: StoredAnteUpAttempt<AnteUpConnectionsAttempt>): AnteUpConnectionsSnapshot {
  return toAnteUpConnectionsSnapshot(stored.state, { id: stored.id, version: stored.version });
}

/** Never throws -- see ante-up-service.ts's payOutWin for why. */
async function payOutWin(
  profileId: string,
  attempt: Pick<AnteUpConnectionsAttempt, "wager" | "puzzle">,
): Promise<void> {
  const payout = anteUpConnectionsPayout(attempt);
  if (payout <= 0) return;
  try {
    await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("ante-up-connections.payout_credit_failed", { profileId, payout, error });
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
}

/** The caller's live attempt, or null. */
export async function readAnteUpConnections(
  token: string,
): Promise<{ attempt: AnteUpConnectionsSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<AnteUpConnectionsAttempt>(profile.id, GAME);
  return { attempt: stored ? snapshot(stored) : null, profile };
}

/** Opens a fresh attempt, escrowing the wager. Rule 1: the Gold leaves before the row exists. */
export async function openAnteUpConnections(
  token: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpConnectionsSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpConnectionsRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpConnectionsRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= ANTE_UP_CONNECTIONS_DAILY_WAGERED_LIMIT) {
      throw new AnteUpConnectionsRequestError(
        `You've wagered Ante Up ${ANTE_UP_CONNECTIONS_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new AnteUpConnectionsRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  // A fresh grid, never the shared daily one. node:crypto's randomInt for the
  // pick (real randomness) and for the shuffle, same as the daily service.
  const puzzle = CONNECTIONS_PUZZLES[randomInt(0, CONNECTIONS_PUZZLES.length)];
  const state = startAnteUpConnections(puzzle, randomInt, wagerInput, now);

  let stored: StoredAnteUpAttempt<AnteUpConnectionsAttempt>;
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
    if (error instanceof ActiveAnteUpAttemptExists) throw new AnteUpConnectionsRequestError(error.message, 409);
    throw error;
  }

  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, now).catch(() => null);

  return { attempt: snapshot(stored), profile: debited };
}

/** Plays one selection of four words, and settles the attempt if it finished. */
export async function playAnteUpConnections(
  token: string,
  input: { version: number; selection: string[] },
): Promise<{ attempt: AnteUpConnectionsSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpConnectionsAttempt>(profile.id, GAME);
  if (!current) throw new AnteUpConnectionsRequestError("Start an attempt first.", 404);

  if (current.version !== input.version) {
    throw new AnteUpConnectionsRequestError("That board moved on.", 409, { round: snapshot(current) });
  }

  const problem = anteUpConnectionsGuessProblem(current.state, input.selection);
  if (problem === "finished") {
    throw new AnteUpConnectionsRequestError("This attempt is already over.", 409, { round: snapshot(current) });
  }
  if (problem === "repeat") {
    throw new AnteUpConnectionsRequestError("You have already tried that group.", 400, { round: snapshot(current) });
  }
  if (problem) {
    throw new AnteUpConnectionsRequestError("Pick four words that are still on the board.", 400, {
      round: snapshot(current),
    });
  }

  const next = playAnteUpConnectionsGuess(current.state, input.selection);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    const live = (await getAnteUpAttemptById<AnteUpConnectionsAttempt>(current.id)) ?? current;
    throw new AnteUpConnectionsRequestError("That board moved on.", 409, { round: snapshot(live) });
  }

  if (stored.state.status === "won") await payOutWin(profile.id, stored.state);

  return { attempt: snapshot(stored), profile };
}

/** Gives up early. The wager is already spent -- see the ordering rules above. */
export async function resignAnteUpConnectionsAttempt(
  token: string,
): Promise<{ attempt: AnteUpConnectionsSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpConnectionsAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpConnections(current.state);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ??
    (await getAnteUpAttemptById<AnteUpConnectionsAttempt>(current.id)) ??
    current;
  return { attempt: snapshot(stored), profile };
}

/** Maps a thrown error to the response every Ante Up: Connections route sends. */
export function toAnteUpConnectionsErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

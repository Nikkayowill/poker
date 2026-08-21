import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpWordStackGuessProblem,
  anteUpWordStackPayout,
  playAnteUpWordStackGuess,
  resignAnteUpWordStack,
  startAnteUpWordStack,
  toAnteUpWordStackSnapshot,
  type AnteUpWordStackAttempt,
  type AnteUpWordStackSnapshot,
} from "@/lib/arcade/ante-up-word-stack";
import { WORD_STACK_ANSWERS } from "@/lib/arcade/puzzles/word-stack-answers";
import { isAllowedWordStackGuess } from "@/lib/arcade/puzzles/word-stack-dictionary";
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
 * Everything between an Ante Up: Word Stack request and the wallet.
 *
 * Same shape and the same three ordering rules as ante-up-service.ts (Sudoku)
 * -- restated here rather than referenced, the same "restate, don't couple"
 * convention every money-ordering file in this app follows:
 *
 *   1. The wager leaves the wallet before the attempt exists. A row that
 *      fails to persist refunds.
 *   2. A payout is credited only after the version-guarded settle write is
 *      confirmed. advanceAnteUpAttempt returns null on a lost race, and null
 *      must never pay.
 *   3. Settlement is a single credit of the payout, never a second debit.
 *
 * One real difference from Sudoku: the payout multiplier is not fixed at
 * open. Word Stack has no difficulty choice, so how much a win pays is
 * decided at settlement, off how many guesses it took -- see
 * anteUpWordStackPayout. The stored `multiplier` column is therefore a
 * placeholder (1), not the truth; toAnteUpWordStackSnapshot computes the real
 * payout from the round every time.
 */

export class AnteUpWordStackRequestError extends ArcadeRequestError<AnteUpWordStackSnapshot, never> {
  readonly name = "AnteUpWordStackRequestError";
}

/** This game's id in ante_up_attempts -- see lib/server/ante-up-store.ts. */
const GAME = "word-stack";

/** How many wagered attempts a player may open in a rolling day, at this game. Free practice is uncapped. */
export const ANTE_UP_WORD_STACK_DAILY_WAGERED_LIMIT = 10;

function snapshot(stored: StoredAnteUpAttempt<AnteUpWordStackAttempt>): AnteUpWordStackSnapshot {
  return toAnteUpWordStackSnapshot(stored.state, { id: stored.id, version: stored.version });
}

/** Never throws -- see ante-up-service.ts's payOutWin for why. */
async function payOutWin(
  profileId: string,
  attempt: Pick<AnteUpWordStackAttempt, "wager" | "word">,
): Promise<void> {
  const payout = anteUpWordStackPayout(attempt);
  if (payout <= 0) return;
  try {
    await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("ante-up-word-stack.payout_credit_failed", { profileId, payout, error });
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
}

/** The caller's live attempt, or null. */
export async function readAnteUpWordStack(
  token: string,
): Promise<{ attempt: AnteUpWordStackSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<AnteUpWordStackAttempt>(profile.id, GAME);
  return { attempt: stored ? snapshot(stored) : null, profile };
}

/** Opens a fresh attempt, escrowing the wager. Rule 1: the Gold leaves before the row exists. */
export async function openAnteUpWordStack(
  token: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpWordStackSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpWordStackRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpWordStackRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= ANTE_UP_WORD_STACK_DAILY_WAGERED_LIMIT) {
      throw new AnteUpWordStackRequestError(
        `You've wagered Ante Up ${ANTE_UP_WORD_STACK_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error.
  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new AnteUpWordStackRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  // A fresh word, never the shared daily one -- node:crypto's randomInt, same
  // as every other real-randomness draw in this app (see connections'
  // shuffle and Memory's deal).
  const answer = WORD_STACK_ANSWERS[randomInt(0, WORD_STACK_ANSWERS.length)];
  const state = startAnteUpWordStack(answer, wagerInput, now);

  let stored: StoredAnteUpAttempt<AnteUpWordStackAttempt>;
  try {
    stored = await createAnteUpAttempt({
      profileId: profile.id,
      game: GAME,
      tier: null,
      wager: wagerInput,
      multiplier: 1, // placeholder -- see this file's header for why the real payout is settled, not stored.
      state,
    });
  } catch (error) {
    // The attempt never came into existence, so the player must not have paid for it.
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof ActiveAnteUpAttemptExists) throw new AnteUpWordStackRequestError(error.message, 409);
    throw error;
  }

  // Only a real wager earns XP -- nothing was risked on a free attempt.
  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, now).catch(() => null);

  return { attempt: snapshot(stored), profile: debited };
}

/** Plays one guess, and settles the attempt if it finished. */
export async function playAnteUpWordStack(
  token: string,
  input: { version: number; guess: string },
): Promise<{ attempt: AnteUpWordStackSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpWordStackAttempt>(profile.id, GAME);
  if (!current) throw new AnteUpWordStackRequestError("Start an attempt first.", 404);

  if (current.version !== input.version) {
    throw new AnteUpWordStackRequestError("That board moved on.", 409, { round: snapshot(current) });
  }

  const problem = anteUpWordStackGuessProblem(current.state, input.guess);
  if (problem === "finished") {
    throw new AnteUpWordStackRequestError("This attempt is already over.", 409, { round: snapshot(current) });
  }
  if (problem) {
    throw new AnteUpWordStackRequestError("A guess is five letters.", 400, { round: snapshot(current) });
  }

  // Same reasoning word-stack-service.ts gives: the dictionary is
  // server-only, so the check lives here, not in the engine. A non-word costs
  // no guess and the board is returned untouched.
  if (!isAllowedWordStackGuess(input.guess)) {
    throw new AnteUpWordStackRequestError("Not in the word list.", 400, { round: snapshot(current) });
  }

  const next = playAnteUpWordStackGuess(current.state, input.guess);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    // Rule 2: a lost race did not happen.
    const live = (await getAnteUpAttemptById<AnteUpWordStackAttempt>(current.id)) ?? current;
    throw new AnteUpWordStackRequestError("That board moved on.", 409, { round: snapshot(live) });
  }

  if (stored.state.status === "won") await payOutWin(profile.id, stored.state);

  return { attempt: snapshot(stored), profile };
}

/** Gives up early. The wager is already spent -- see the ordering rules above. */
export async function resignAnteUpWordStackAttempt(
  token: string,
): Promise<{ attempt: AnteUpWordStackSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpWordStackAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpWordStack(current.state);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ??
    (await getAnteUpAttemptById<AnteUpWordStackAttempt>(current.id)) ??
    current;
  return { attempt: snapshot(stored), profile };
}

/** Maps a thrown error to the response every Ante Up: Word Stack route sends. */
export function toAnteUpWordStackErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

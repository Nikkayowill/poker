import "server-only";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  ANTE_UP_TIERS,
  MIN_ANTE_UP_WAGER,
  anteUpFillProblem,
  anteUpPayout,
  fillAnteUpCell,
  resignAnteUpAttempt,
  startAnteUpAttempt,
  tickAnteUpAttempt,
  toAnteUpSnapshot,
  type AnteUpAttempt,
  type AnteUpSnapshot,
} from "@/lib/arcade/ante-up";
import { isSudokuDifficulty, type SudokuDifficulty } from "@/lib/arcade/puzzles/sudoku";
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
 * Everything between an Ante Up request and the wallet.
 *
 * ## The ordering rules
 *
 * A solo wager has no counterparty to conserve Gold against -- a win pays
 * more than was staked, out of the same faucet a level-up or a streak grant
 * already draws from, not off another player's loss. The discipline that
 * matters here is the same discipline every other staked service in this app
 * restates at its own top, because breaking it is a silent money bug either
 * way:
 *
 *   1. **The wager leaves the wallet before the attempt exists.** A row that
 *      fails to persist refunds. The reverse order would let a player start
 *      an attempt that never charged them.
 *   2. **A payout is credited only after the version-guarded settle write is
 *      confirmed.** `advanceAnteUpAttempt` returns null when it loses that
 *      race, and null must never pay -- the writer that wins the race is the
 *      one that pays.
 *   3. **Settlement is a single credit of the payout, never a second debit.**
 *      The wager already left in rule 1; a win credits `wager * multiplier`
 *      and a loss or timeout credits nothing, because the wager is already
 *      spent.
 *
 * There is no rule 4 (escrow released exactly once) the way the duel
 * challenge store needs one -- there is no second party who might never show
 * up to accept a stake held on their behalf.
 */

/** Refuses an Ante Up request in a way the player can act on. */
export class AnteUpRequestError extends ArcadeRequestError<AnteUpSnapshot, never> {
  readonly name = "AnteUpRequestError";
}

/**
 * How many wagered attempts a player may open in a rolling day.
 *
 * Free (wager 0) practice is uncapped. This exists because a player skilled
 * enough to reliably beat Expert inside five minutes could otherwise farm
 * 10x off the house indefinitely -- a starting number, easy to retune here.
 */
export const ANTE_UP_DAILY_WAGERED_LIMIT = 10;

function parseDifficulty(value: string): SudokuDifficulty {
  if (!isSudokuDifficulty(value)) throw new AnteUpRequestError("Not a real difficulty.", 400);
  return value;
}

function snapshot(stored: StoredAnteUpAttempt, now: Date): AnteUpSnapshot {
  return toAnteUpSnapshot(stored.state, { id: stored.id, version: stored.version }, now);
}

/**
 * Pays out a win. Never throws -- the attempt is already durably settled by
 * the time this runs, so a credit failure must not turn a finished attempt
 * into an error response and cost a player their result on top of their
 * Gold. Logged loudly instead, same reasoning as pvp-match-service.ts's
 * payOutMatch.
 */
async function payOutWin(profileId: string, attempt: AnteUpAttempt): Promise<void> {
  const payout = anteUpPayout(attempt);
  if (payout <= 0) return;
  try {
    await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("ante-up.payout_credit_failed", { profileId, payout, error });
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
}

/** Settles an attempt whose clock has run out, and reads back the truth either way. */
async function settleIfExpired(
  profile: PlayerProfile,
  stored: StoredAnteUpAttempt,
  now: Date,
): Promise<StoredAnteUpAttempt> {
  const ticked = tickAnteUpAttempt(stored.state, now);
  if (ticked === null) return stored;

  const advanced = await advanceAnteUpAttempt(stored, ticked);
  // Rule 2: a lost race did not happen -- somebody else's read already
  // settled (and, on a win, paid) this same attempt.
  return advanced ?? (await getAnteUpAttemptById(stored.id)) ?? stored;
}

/** The caller's live attempt, or null. Ticks the clock first, same as readDuelMatch. */
export async function readAnteUpAttempt(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt(profile.id);
  if (!stored) return { attempt: null, profile };

  const settled = await settleIfExpired(profile, stored, now);
  return { attempt: snapshot(settled, now), profile };
}

/**
 * Opens a fresh attempt, escrowing the wager.
 *
 * Rule 1: the Gold leaves before the row exists, and a row that fails to
 * persist refunds.
 */
export async function openAnteUpAttempt(
  token: string,
  difficultyInput: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpSnapshot; profile: PlayerProfile }> {
  const difficulty = parseDifficulty(difficultyInput);
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, sinceYesterday);
    if (wageredToday >= ANTE_UP_DAILY_WAGERED_LIMIT) {
      throw new AnteUpRequestError(
        `You've wagered Ante Up ${ANTE_UP_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new AnteUpRequestError(
      `You need ${wagerInput.toLocaleString()} Gold to wager this.`,
      400,
    );
  }

  const state = startAnteUpAttempt(difficulty, wagerInput, randomUUID(), now);

  let stored: StoredAnteUpAttempt;
  try {
    stored = await createAnteUpAttempt({ profileId: profile.id, state });
  } catch (error) {
    // The attempt never came into existence, so the player must not have
    // paid for it.
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof ActiveAnteUpAttemptExists) {
      throw new AnteUpRequestError(error.message, 409);
    }
    throw error;
  }

  // Only a real wager earns XP, same reasoning acceptDuelChallenge gives for
  // both players: nothing was risked on a free attempt.
  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, now).catch(() => null);

  return { attempt: snapshot(stored, now), profile: debited };
}

/**
 * Writes one digit, and settles the attempt if it finished.
 *
 * `version` pins the fill to the exact board the player was looking at, the
 * same reason playDuelMove requires it.
 */
export async function fillAnteUpAttempt(
  token: string,
  input: { version: number; index: number; value: number },
  now = new Date(),
): Promise<{ attempt: AnteUpSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt(profile.id);
  if (!current) throw new AnteUpRequestError("Start an attempt first.", 404);

  const ticked = tickAnteUpAttempt(current.state, now);
  if (ticked !== null) {
    // The clock already ran out -- settle that before refusing the fill, so
    // the response carries the true (timed-out) state rather than a stale
    // "active" one the player could mistake for still-playable.
    const settled = (await advanceAnteUpAttempt(current, ticked)) ?? await getAnteUpAttemptById(current.id) ?? current;
    throw new AnteUpRequestError("Time's up.", 409, { round: snapshot(settled, now) });
  }

  if (current.version !== input.version) {
    throw new AnteUpRequestError("That board moved on.", 409, { round: snapshot(current, now) });
  }

  const problem = anteUpFillProblem(current.state, input.index, input.value);
  if (problem) {
    throw new AnteUpRequestError(
      problem === "finished" ? "This attempt is already over." : "That cell cannot take a digit.",
      409,
      { round: snapshot(current, now) },
    );
  }

  const { attempt: next, correct } = fillAnteUpCell(current.state, input.index, input.value, now);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    // Rule 2: a lost race did not happen.
    const live = (await getAnteUpAttemptById(current.id)) ?? current;
    throw new AnteUpRequestError("That board moved on.", 409, { round: snapshot(live, now) });
  }

  if (stored.state.status === "won") await payOutWin(profile.id, stored.state);

  if (!correct) {
    // The mistake IS persisted above -- this rejects the digit, not the
    // request, and carries the updated board so the counter moves.
    throw new AnteUpRequestError("Not that one.", 409, { round: snapshot(stored, now) });
  }

  return { attempt: snapshot(stored, now), profile };
}

/** Gives up early. The wager is already spent -- see the ordering rules above. */
export async function resignAnteUp(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt(profile.id);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpAttempt(current.state);
  const stored = (await advanceAnteUpAttempt(current, next)) ?? await getAnteUpAttemptById(current.id) ?? current;
  return { attempt: snapshot(stored, now), profile };
}

/** Maps a thrown error to the response every Ante Up route sends. */
export function toAnteUpErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

export { ANTE_UP_TIERS };

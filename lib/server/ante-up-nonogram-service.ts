import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpNonogramMarkProblem,
  anteUpNonogramPayout,
  markAnteUpNonogramCell,
  resignAnteUpNonogram,
  startAnteUpNonogram,
  tickAnteUpNonogram,
  toAnteUpNonogramSnapshot,
  type AnteUpNonogramAttempt,
  type AnteUpNonogramSnapshot,
} from "@/lib/arcade/ante-up-nonogram";
import { anteUpWagerCeilingProblem } from "@/lib/arcade/ante-up-stakes";
import {
  isNonogramDifficulty,
  type NonogramDifficulty,
  type NonogramMark,
  type NonogramMoveProblem,
} from "@/lib/arcade/puzzles/nonogram";
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
 * Everything between an Ante Up: Nonogram request and the wallet.
 *
 * Same three ordering rules every staked game in this app restates, because
 * breaking one is a silent money bug:
 *
 * 1. The wager leaves the wallet before the attempt row exists; a row that
 *    fails to persist refunds it.
 * 2. A payout is credited only after the version-guarded settlement write comes
 *    back non-null. Null means somebody else already settled (and paid) this
 *    attempt; paying on null is how a double-tap becomes free Gold.
 * 3. Settlement is a single credit. The wager was already spent at step 1, so a
 *    loss credits nothing rather than debiting a second time.
 *
 * Like Minesweeper's service this one carries a clock, so every read and every
 * move settles an expired attempt first; see settleIfExpired and
 * lib/arcade/ante-up-nonogram.ts's header for why a clock exists here.
 */

export class AnteUpNonogramRequestError extends ArcadeRequestError<AnteUpNonogramSnapshot, never> {
  readonly name = "AnteUpNonogramRequestError";
}

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "nonogram";

/** How many wagered attempts a player may open in a rolling day, at this game. Free practice is uncapped. */
export const ANTE_UP_NONOGRAM_DAILY_WAGERED_LIMIT = 10;

/**
 * No leaderboard hook here on purpose: leaderboards are for PvP only, not
 * solo play. A clear feeds missions and achievements through payOutWin and
 * nothing else.
 */

function parseDifficulty(value: string): NonogramDifficulty {
  if (!isNonogramDifficulty(value)) {
    throw new AnteUpNonogramRequestError("Pick a size.", 400);
  }
  return value;
}

function snapshot(
  stored: StoredAnteUpAttempt<AnteUpNonogramAttempt>,
  now: Date,
): AnteUpNonogramSnapshot {
  return toAnteUpNonogramSnapshot(stored.state, { id: stored.id, version: stored.version }, now);
}

/**
 * Never throws. A payout that fails must not also fail the request: the
 * attempt is already settled, and throwing here would show the player a loss
 * on a board they won. Logged loudly instead, same reasoning as payOutMatch.
 */
async function payOutWin(profileId: string, attempt: AnteUpNonogramAttempt): Promise<void> {
  const payout = anteUpNonogramPayout(attempt);
  if (payout > 0) {
    try {
      await creditGoldByProfile(profileId, payout);
    } catch (error) {
      console.error("ante-up-nonogram.payout_credit_failed", { profileId, payout, error });
    }
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
}

/** Settles an attempt whose clock has run out, and reads back the truth either way. */
async function settleIfExpired(
  stored: StoredAnteUpAttempt<AnteUpNonogramAttempt>,
  now: Date,
): Promise<StoredAnteUpAttempt<AnteUpNonogramAttempt>> {
  const ticked = tickAnteUpNonogram(stored.state, now);
  if (ticked === null) return stored;

  const advanced = await advanceAnteUpAttempt(stored, ticked);
  // Rule 2: a lost race did not happen; another read already settled this.
  return advanced ?? (await getAnteUpAttemptById<AnteUpNonogramAttempt>(stored.id)) ?? stored;
}

/** The caller's live attempt, or null. Ticks the clock first. */
export async function readAnteUpNonogram(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<AnteUpNonogramAttempt>(profile.id, GAME);
  if (!stored) return { attempt: null, profile };
  return { attempt: snapshot(await settleIfExpired(stored, now), now), profile };
}

/** Opens a fresh attempt, escrowing the wager. Rule 1: the Gold leaves before the row exists. */
export async function openAnteUpNonogram(
  token: string,
  difficultyInput: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot; profile: PlayerProfile }> {
  const difficulty = parseDifficulty(difficultyInput);
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpNonogramRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpNonogramRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }
  // A bigger stake has to buy a harder board; see lib/arcade/ante-up-stakes.ts.
  const overCeiling = anteUpWagerCeilingProblem(GAME, difficulty, wagerInput);
  if (overCeiling) throw new AnteUpNonogramRequestError(overCeiling, 400);

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= ANTE_UP_NONOGRAM_DAILY_WAGERED_LIMIT) {
      throw new AnteUpNonogramRequestError(
        `You've wagered Ante Up ${ANTE_UP_NONOGRAM_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error.
  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new AnteUpNonogramRequestError(
      `You need ${wagerInput.toLocaleString()} Gold to wager this.`,
      400,
    );
  }

  // node:crypto's randomInt, same source the other Ante Up deals draw from. The
  // seed is stored on the round so its picture is reproducible from its own state.
  const state = startAnteUpNonogram(difficulty, wagerInput, randomInt(2 ** 31), now);

  let stored: StoredAnteUpAttempt<AnteUpNonogramAttempt>;
  try {
    stored = await createAnteUpAttempt({
      profileId: profile.id,
      game: GAME,
      tier: difficulty,
      wager: state.wager,
      multiplier: state.multiplier,
      state,
    });
  } catch (error) {
    // The attempt never came into existence, so the player must not have paid for it.
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof ActiveAnteUpAttemptExists) {
      throw new AnteUpNonogramRequestError(error.message, 409);
    }
    throw error;
  }

  // Only a real wager earns XP; nothing was risked on a free attempt.
  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, now).catch(() => null);

  return { attempt: snapshot(stored, now), profile: debited };
}

function refusal(problem: NonogramMoveProblem): string {
  switch (problem) {
    case "finished":
      return "This attempt is already over.";
    case "already-known":
      return "That square is already settled.";
    case "no-change":
      return "That square already reads that way.";
    default:
      return "That square is not on the board.";
  }
}

/**
 * Marks one square, and settles the attempt if it finished.
 *
 * `version` pins the mark to the exact board the player was looking at, the
 * same reason playDuelMove requires it.
 */
export async function playAnteUpNonogram(
  token: string,
  input: { version: number; index: number; mark: NonogramMark },
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpNonogramAttempt>(profile.id, GAME);
  if (!current) throw new AnteUpNonogramRequestError("Start an attempt first.", 404);

  const ticked = tickAnteUpNonogram(current.state, now);
  if (ticked !== null) {
    // The clock already ran out; settle that before refusing the mark, so the
    // response carries the true (timed-out) state rather than a stale "active"
    // one the player could mistake for still-playable.
    const settled =
      (await advanceAnteUpAttempt(current, ticked)) ??
      (await getAnteUpAttemptById<AnteUpNonogramAttempt>(current.id)) ??
      current;
    throw new AnteUpNonogramRequestError("Time's up.", 409, { round: snapshot(settled, now) });
  }

  if (current.version !== input.version) {
    throw new AnteUpNonogramRequestError("That board moved on.", 409, {
      round: snapshot(current, now),
    });
  }

  const problem = anteUpNonogramMarkProblem(current.state, input.index, input.mark, now);
  if (problem) {
    throw new AnteUpNonogramRequestError(refusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  const next = markAnteUpNonogramCell(current.state, input.index, input.mark, now);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    // Rule 2: a lost race did not happen.
    const live = (await getAnteUpAttemptById<AnteUpNonogramAttempt>(current.id)) ?? current;
    throw new AnteUpNonogramRequestError("That board moved on.", 409, {
      round: snapshot(live, now),
    });
  }

  if (stored.state.status === "won") await payOutWin(profile.id, stored.state);

  return { attempt: snapshot(stored, now), profile };
}

/** Gives up early. The wager is already spent; see the ordering rules above. */
export async function resignAnteUpNonogramAttempt(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpNonogramAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpNonogram(current.state, now);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ??
    (await getAnteUpAttemptById<AnteUpNonogramAttempt>(current.id)) ??
    current;
  return { attempt: snapshot(stored, now), profile };
}

/** Maps a thrown error to the response every Ante Up: Nonogram route sends. */
export function toAnteUpNonogramErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

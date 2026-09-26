import "server-only";
import { randomInt, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpBlockudokuPayout,
  anteUpBlockudokuPlacementProblem,
  isBlockudokuDifficulty,
  placeAnteUpBlockudokuPiece,
  resignAnteUpBlockudoku,
  startAnteUpBlockudoku,
  tickAnteUpBlockudoku,
  toAnteUpBlockudokuSnapshot,
  type AnteUpBlockudokuAttempt,
  type AnteUpBlockudokuSnapshot,
  type BlockudokuDifficulty,
} from "@/lib/arcade/ante-up-blockudoku";
import { anteUpStakeProblem } from "@/lib/arcade/ante-up-stakes";
import type { BlockudokuMoveProblem } from "@/lib/arcade/puzzles/blockudoku";
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
import {
  confirmGoldDebitLedgered,
  creditGoldByProfile,
  creditGoldByProfileLedgered,
  ensureProfile,
  spendStakeLedgered,
} from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between an Ante Up: Blockudoku request and the wallet.
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
 * Same clock as Minesweeper's service: every read and every move settles an
 * expired attempt first. See lib/arcade/ante-up-blockudoku.ts for why the
 * challenge is a target score rather than a cleared board.
 */

export class AnteUpBlockudokuRequestError extends ArcadeRequestError<
  AnteUpBlockudokuSnapshot,
  never
> {
  readonly name = "AnteUpBlockudokuRequestError";
}

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "blockudoku";

/** How many wagered attempts a player may open in a rolling day, at this game. Free practice is uncapped. */
export const ANTE_UP_BLOCKUDOKU_DAILY_WAGERED_LIMIT = 10;

/**
 * No leaderboard hook here on purpose: leaderboards are for PvP only, not
 * solo play. A win feeds missions and achievements through payOutWin and
 * nothing else.
 */

function parseDifficulty(value: string): BlockudokuDifficulty {
  if (!isBlockudokuDifficulty(value)) {
    throw new AnteUpBlockudokuRequestError("Pick a difficulty.", 400);
  }
  return value;
}

function snapshot(
  stored: StoredAnteUpAttempt<AnteUpBlockudokuAttempt>,
  now: Date,
): AnteUpBlockudokuSnapshot {
  return toAnteUpBlockudokuSnapshot(stored.state, { id: stored.id, version: stored.version }, now);
}

/**
 * Never throws. A payout that fails must not also fail the request: the
 * attempt is already settled, and throwing here would show the player a loss
 * on a board they won. Logged loudly instead, same reasoning as payOutMatch.
 *
 * Returns the profile after the credit, or null when nothing was credited,
 * so the response can show the new balance instead of the pre-win one.
 */
async function payOutWin(
  profileId: string,
  attempt: AnteUpBlockudokuAttempt,
): Promise<PlayerProfile | null> {
  const payout = anteUpBlockudokuPayout(attempt);
  let credited: PlayerProfile | null = null;
  if (payout > 0) {
    try {
      credited = await creditGoldByProfile(profileId, payout);
    } catch (error) {
      console.error("ante-up-blockudoku.payout_credit_failed", { profileId, payout, error });
    }
  }
  // Free runs don't count: puzzles_completed pays Gold through achievements,
  // and a free board costs nothing to farm.
  if (attempt.wager > 0) {
    await applyMissionEvent(profileId, { kind: "puzzle_completed" });
    await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
  }
  return credited;
}

/** Settles an attempt whose clock has run out, and reads back the truth either way. */
async function settleIfExpired(
  stored: StoredAnteUpAttempt<AnteUpBlockudokuAttempt>,
  now: Date,
): Promise<StoredAnteUpAttempt<AnteUpBlockudokuAttempt>> {
  const ticked = tickAnteUpBlockudoku(stored.state, now);
  if (ticked === null) return stored;

  const advanced = await advanceAnteUpAttempt(stored, ticked);
  // Rule 2: a lost race did not happen; another read already settled this.
  return advanced ?? (await getAnteUpAttemptById<AnteUpBlockudokuAttempt>(stored.id)) ?? stored;
}

/** The caller's live attempt, or null. Ticks the clock first. */
export async function readAnteUpBlockudoku(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpBlockudokuSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<AnteUpBlockudokuAttempt>(profile.id, GAME);
  if (!stored) return { attempt: null, profile };
  return { attempt: snapshot(await settleIfExpired(stored, now), now), profile };
}

/** Opens a fresh attempt, escrowing the wager. Rule 1: the Gold leaves before the row exists. */
export async function openAnteUpBlockudoku(
  token: string,
  difficultyInput: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpBlockudokuSnapshot; profile: PlayerProfile }> {
  const difficulty = parseDifficulty(difficultyInput);
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpBlockudokuRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpBlockudokuRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }
  // A big stake has to play a hard enough board; see lib/arcade/stake-pressure.ts.
  const stakeProblem = anteUpStakeProblem(GAME, difficulty, wagerInput);
  if (stakeProblem) throw new AnteUpBlockudokuRequestError(stakeProblem, 400);

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= ANTE_UP_BLOCKUDOKU_DAILY_WAGERED_LIMIT) {
      throw new AnteUpBlockudokuRequestError(
        `You've wagered Ante Up ${ANTE_UP_BLOCKUDOKU_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error.
  const wagerCorrelationId = `ante_up_blockudoku_wager:${randomUUID()}`;
  const debited =
    wagerInput > 0
      ? await spendStakeLedgered(profile, wagerInput, wagerCorrelationId, "ante_up_blockudoku_wager")
      : profile;
  if (!debited) {
    throw new AnteUpBlockudokuRequestError(
      `You need ${wagerInput.toLocaleString()} Gold to wager this.`,
      400,
    );
  }

  // Same seed source as the other Ante Up deals. The PRNG state lives on the
  // stored round and never reaches the browser; see blockudoku.ts's header.
  const state = startAnteUpBlockudoku(difficulty, wagerInput, randomInt(2 ** 31), now);

  let stored: StoredAnteUpAttempt<AnteUpBlockudokuAttempt>;
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
    if (wagerInput > 0) {
      await creditGoldByProfileLedgered(
        profile.id,
        wagerInput,
        wagerCorrelationId,
        "ante_up_blockudoku_wager_refund",
      ).catch((refundError) => {
        console.error("ante_up_blockudoku.open_refund_failed", {
          profileId: profile.id,
          wager: wagerInput,
          error: refundError,
        });
      });
    }
    if (error instanceof ActiveAnteUpAttemptExists) {
      throw new AnteUpBlockudokuRequestError(error.message, 409);
    }
    throw error;
  }

  // The attempt exists now, so the reconcile sweep must leave this debit alone.
  if (wagerInput > 0) {
    await confirmGoldDebitLedgered(wagerCorrelationId).catch((confirmError) => {
      console.error("ante_up_blockudoku.open_confirm_failed", {
        profileId: profile.id,
        wagerCorrelationId,
        error: confirmError,
      });
    });
  }

  // Only a real wager earns XP; nothing was risked on a free attempt.
  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, now);

  return { attempt: snapshot(stored, now), profile: debited };
}

function refusal(problem: BlockudokuMoveProblem): string {
  switch (problem) {
    case "finished":
      return "This attempt is already over.";
    case "invalid-slot":
    case "empty-slot":
      return "That piece is already played.";
    case "occupied":
      return "That piece does not fit there.";
    default:
      return "That piece would hang off the board.";
  }
}

/**
 * Places one piece, and settles the attempt if that finished it.
 *
 * `version` pins the placement to the exact board the player was looking at,
 * the same reason playDuelMove requires it. That is also what makes a
 * double-tap safe: the second copy arrives on a stale version and is refused.
 */
export async function placeAnteUpBlockudoku(
  token: string,
  input: { version: number; slot: number; row: number; col: number },
  now = new Date(),
): Promise<{ attempt: AnteUpBlockudokuSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpBlockudokuAttempt>(profile.id, GAME);
  if (!current) throw new AnteUpBlockudokuRequestError("Start an attempt first.", 404);

  const ticked = tickAnteUpBlockudoku(current.state, now);
  if (ticked !== null) {
    // Settle the timeout before refusing, so the response carries the true
    // state rather than a stale "active" the player could mistake for playable.
    const settled =
      (await advanceAnteUpAttempt(current, ticked)) ??
      (await getAnteUpAttemptById<AnteUpBlockudokuAttempt>(current.id)) ??
      current;
    throw new AnteUpBlockudokuRequestError("Time's up.", 409, { round: snapshot(settled, now) });
  }

  if (current.version !== input.version) {
    throw new AnteUpBlockudokuRequestError("That board moved on.", 409, {
      round: snapshot(current, now),
    });
  }

  const problem = anteUpBlockudokuPlacementProblem(
    current.state,
    input.slot,
    input.row,
    input.col,
    now,
  );
  if (problem) {
    throw new AnteUpBlockudokuRequestError(refusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  // Fresh entropy for any refill this placement triggers; see the puzzle file's header.
  const next = placeAnteUpBlockudokuPiece(current.state, input.slot, input.row, input.col, now, randomInt(2 ** 32));
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    // Rule 2: a lost race did not happen.
    const live = (await getAnteUpAttemptById<AnteUpBlockudokuAttempt>(current.id)) ?? current;
    throw new AnteUpBlockudokuRequestError("That board moved on.", 409, {
      round: snapshot(live, now),
    });
  }

  const paid = stored.state.status === "won" ? await payOutWin(profile.id, stored.state) : null;

  return { attempt: snapshot(stored, now), profile: paid ?? profile };
}

/** Gives up early. The wager is already spent; see the ordering rules above. */
export async function resignAnteUpBlockudokuAttempt(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpBlockudokuSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpBlockudokuAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpBlockudoku(current.state, now);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ??
    (await getAnteUpAttemptById<AnteUpBlockudokuAttempt>(current.id)) ??
    current;
  return { attempt: snapshot(stored, now), profile };
}

/** Maps a thrown error to the response every Ante Up: Blockudoku route sends. */
export function toAnteUpBlockudokuErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

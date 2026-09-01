import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpNonogramHintProblem,
  anteUpNonogramMarkProblem,
  anteUpNonogramPayout,
  anteUpNonogramUndoProblem,
  hintAnteUpNonogram,
  markAnteUpNonogramCell,
  resignAnteUpNonogram,
  startAnteUpNonogram,
  strokeAnteUpNonogram,
  tickAnteUpNonogram,
  toAnteUpNonogramSnapshot,
  undoAnteUpNonogram,
  type AnteUpNonogramAttempt,
  type AnteUpNonogramSnapshot,
} from "@/lib/arcade/ante-up-nonogram";
import { anteUpWagerCeilingProblem } from "@/lib/arcade/ante-up-stakes";
import { dealNonogram } from "@/lib/arcade/puzzles/nonogram-deal";
import {
  isNonogramDifficulty,
  type NonogramDifficulty,
  type NonogramHintProblem,
  type NonogramMark,
  type NonogramMoveProblem,
  type NonogramUndoProblem,
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
  options: { autoCross?: boolean } = {},
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
  // seed is stored on the round so its picture is reproducible from its own
  // state. The picture itself is dealt here rather than inside the engine:
  // the library is `server-only` and the engine is client-imported.
  const seed = randomInt(2 ** 31);
  const state = startAnteUpNonogram(
    difficulty,
    wagerInput,
    seed,
    dealNonogram(seed, difficulty),
    now,
    { autoCross: options.autoCross },
  );

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
 * The caller's live attempt at the version they acted on.
 *
 * Every action that changes a board goes through here, so the clock check, the
 * version check and their two different 409s are written once. Both throw with
 * the true board attached: a refused action still has to leave the player
 * looking at what is actually there.
 */
async function requireLiveAttempt(
  profileId: string,
  version: number,
  now: Date,
): Promise<StoredAnteUpAttempt<AnteUpNonogramAttempt>> {
  const current = await getActiveAnteUpAttempt<AnteUpNonogramAttempt>(profileId, GAME);
  if (!current) throw new AnteUpNonogramRequestError("Start an attempt first.", 404);

  const ticked = tickAnteUpNonogram(current.state, now);
  if (ticked !== null) {
    // The clock already ran out; settle that before refusing, so the response
    // carries the true (timed-out) state rather than a stale "active" one the
    // player could mistake for still-playable.
    const settled =
      (await advanceAnteUpAttempt(current, ticked)) ??
      (await getAnteUpAttemptById<AnteUpNonogramAttempt>(current.id)) ??
      current;
    throw new AnteUpNonogramRequestError("Time's up.", 409, { round: snapshot(settled, now) });
  }

  if (current.version !== version) {
    throw new AnteUpNonogramRequestError("That board moved on.", 409, {
      round: snapshot(current, now),
    });
  }

  return current;
}

/**
 * Writes an advanced attempt, and pays it if that advance won the board.
 *
 * Rule 2 of the ordering rules above lives here: a null from
 * `advanceAnteUpAttempt` is a lost race, which means somebody else already
 * settled (and paid) this attempt, so it must not pay again.
 */
async function settle(
  profileId: string,
  current: StoredAnteUpAttempt<AnteUpNonogramAttempt>,
  next: AnteUpNonogramAttempt,
  now: Date,
): Promise<AnteUpNonogramSnapshot> {
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    const live = (await getAnteUpAttemptById<AnteUpNonogramAttempt>(current.id)) ?? current;
    throw new AnteUpNonogramRequestError("That board moved on.", 409, {
      round: snapshot(live, now),
    });
  }

  if (stored.state.status === "won") await payOutWin(profileId, stored.state);
  return snapshot(stored, now);
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
  const current = await requireLiveAttempt(profile.id, input.version, now);

  const problem = anteUpNonogramMarkProblem(current.state, input.index, input.mark, now);
  if (problem) {
    throw new AnteUpNonogramRequestError(refusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  const next = markAnteUpNonogramCell(current.state, input.index, input.mark, now);
  return { attempt: await settle(profile.id, current, next, now), profile };
}

/**
 * Puts a whole dragged stroke down.
 *
 * One request for a drag rather than one per square, which is what makes a
 * 625-square board playable at all -- see markNonogramCells' own note. The
 * version pins the stroke to the board the player was looking at, exactly as a
 * single mark does.
 *
 * A stroke that changes nothing is not written. `markNonogramCells` hands back
 * the same round in that case, and writing it anyway would bump the stored
 * version for no reason and start refusing the player's own next move.
 */
export async function strokeAnteUpNonogramCells(
  token: string,
  input: { version: number; indexes: readonly number[]; mark: NonogramMark },
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await requireLiveAttempt(profile.id, input.version, now);

  const next = strokeAnteUpNonogram(current.state, input.indexes, input.mark, now);
  if (next === current.state) return { attempt: snapshot(current, now), profile };

  return { attempt: await settle(profile.id, current, next, now), profile };
}

function undoRefusal(problem: NonogramUndoProblem): string {
  return problem === "finished" ? "This attempt is already over." : "There is nothing to undo.";
}

/** Takes back the last stroke. Costs nothing and refunds nothing; see undoNonogram. */
export async function undoAnteUpNonogramStroke(
  token: string,
  input: { version: number },
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await requireLiveAttempt(profile.id, input.version, now);

  const problem = anteUpNonogramUndoProblem(current.state, now);
  if (problem) {
    throw new AnteUpNonogramRequestError(undoRefusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  const next = undoAnteUpNonogram(current.state, now);
  return { attempt: await settle(profile.id, current, next, now), profile };
}

function hintRefusal(problem: NonogramHintProblem): string {
  switch (problem) {
    case "finished":
      return "This attempt is already over.";
    case "budget":
      return "A hint costs a mistake, and that is your last one. This one is on you.";
    default:
      return "The picture is already finished.";
  }
}

/**
 * Gives one square of the picture away, for one mistake.
 *
 * Settled through the same path a mark is, because a hint can finish the board
 * and a finished board pays. The price is charged inside the engine; see
 * hintNonogramCell for why it is a mistake rather than a share of the payout.
 */
export async function hintAnteUpNonogramAttempt(
  token: string,
  input: { version: number },
  now = new Date(),
): Promise<{ attempt: AnteUpNonogramSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await requireLiveAttempt(profile.id, input.version, now);

  const problem = anteUpNonogramHintProblem(current.state, now);
  if (problem) {
    throw new AnteUpNonogramRequestError(hintRefusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  const next = hintAnteUpNonogram(current.state, now);
  return { attempt: await settle(profile.id, current, next, now), profile };
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

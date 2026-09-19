import "server-only";
import { randomInt, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  anteUpWordFillInClearProblem,
  anteUpWordFillInPayout,
  anteUpWordFillInPlaceProblem,
  clearAnteUpWordFillInSlot,
  isAnteUpWordFillInTier,
  placeAnteUpWordFillInWord,
  resignAnteUpWordFillIn,
  startAnteUpWordFillIn,
  tickAnteUpWordFillIn,
  toAnteUpWordFillInSnapshot,
  type AnteUpWordFillInAttempt,
  type AnteUpWordFillInSnapshot,
  type AnteUpWordFillInTier,
} from "@/lib/arcade/ante-up-word-fill-in";
import { anteUpWagerCeilingProblem } from "@/lib/arcade/ante-up-stakes";
import type {
  WordFillInClearProblem,
  WordFillInPlaceProblem,
} from "@/lib/arcade/puzzles/word-fill-in";
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
 * Everything between an Ante Up: Word Fill-In request and the wallet.
 *
 * Same three ordering rules every staked game in this app restates:
 *
 * 1. The wager leaves the wallet before the attempt row exists; a row that
 *    fails to persist refunds it.
 * 2. A payout is credited only after the version-guarded settlement write comes
 *    back non-null. Null means somebody else already settled (and paid) this
 *    attempt.
 * 3. Settlement is a single credit. A loss credits nothing.
 *
 * The clock starts on the first word placed, so every read and every move
 * settles an expired attempt first, same as Nonogram and Minesweeper.
 */

export class AnteUpWordFillInRequestError extends ArcadeRequestError<AnteUpWordFillInSnapshot, never> {
  readonly name = "AnteUpWordFillInRequestError";
}

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "word-fill-in";

/** How many wagered attempts a player may open in a rolling day, at this game. Free practice is uncapped. */
export const ANTE_UP_WORD_FILL_IN_DAILY_WAGERED_LIMIT = 10;

function parseTier(value: string): AnteUpWordFillInTier {
  if (!isAnteUpWordFillInTier(value)) {
    throw new AnteUpWordFillInRequestError("Pick a clock.", 400);
  }
  return value;
}

function snapshot(
  stored: StoredAnteUpAttempt<AnteUpWordFillInAttempt>,
  now: Date,
): AnteUpWordFillInSnapshot {
  return toAnteUpWordFillInSnapshot(stored.state, { id: stored.id, version: stored.version }, now);
}

/**
 * Never throws; a failed credit is logged, not shown to the player as a loss.
 * Returns the profile after the credit, or null when nothing was credited, so
 * the response shows the new balance instead of the pre-win one.
 */
async function payOutWin(
  profileId: string,
  attempt: AnteUpWordFillInAttempt,
): Promise<PlayerProfile | null> {
  const payout = anteUpWordFillInPayout(attempt);
  let credited: PlayerProfile | null = null;
  if (payout > 0) {
    try {
      credited = await creditGoldByProfile(profileId, payout);
    } catch (error) {
      console.error("ante-up-word-fill-in.payout_credit_failed", { profileId, payout, error });
    }
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
  return credited;
}

/** Settles an attempt whose clock has run out, and reads back the truth either way. */
async function settleIfExpired(
  stored: StoredAnteUpAttempt<AnteUpWordFillInAttempt>,
  now: Date,
): Promise<StoredAnteUpAttempt<AnteUpWordFillInAttempt>> {
  const ticked = tickAnteUpWordFillIn(stored.state, now);
  if (ticked === null) return stored;

  const advanced = await advanceAnteUpAttempt(stored, ticked);
  return advanced ?? (await getAnteUpAttemptById<AnteUpWordFillInAttempt>(stored.id)) ?? stored;
}

/** The caller's live attempt, or null. Ticks the clock first. */
export async function readAnteUpWordFillIn(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpWordFillInSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<AnteUpWordFillInAttempt>(profile.id, GAME);
  if (!stored) return { attempt: null, profile };
  return { attempt: snapshot(await settleIfExpired(stored, now), now), profile };
}

/** Opens a fresh attempt, escrowing the wager. Rule 1: the Gold leaves before the row exists. */
export async function openAnteUpWordFillIn(
  token: string,
  tierInput: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: AnteUpWordFillInSnapshot; profile: PlayerProfile }> {
  const tier = parseTier(tierInput);
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new AnteUpWordFillInRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new AnteUpWordFillInRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }
  const overCeiling = anteUpWagerCeilingProblem(GAME, tier, wagerInput);
  if (overCeiling) throw new AnteUpWordFillInRequestError(overCeiling, 400);

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= ANTE_UP_WORD_FILL_IN_DAILY_WAGERED_LIMIT) {
      throw new AnteUpWordFillInRequestError(
        `You've wagered Ante Up ${ANTE_UP_WORD_FILL_IN_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error.
  const wagerCorrelationId = `ante_up_word_fill_in_wager:${randomUUID()}`;
  const debited =
    wagerInput > 0
      ? await spendStakeLedgered(profile, wagerInput, wagerCorrelationId, "ante_up_word_fill_in_wager")
      : profile;
  if (!debited) {
    throw new AnteUpWordFillInRequestError(
      `You need ${wagerInput.toLocaleString()} Gold to wager this.`,
      400,
    );
  }

  let stored: StoredAnteUpAttempt<AnteUpWordFillInAttempt>;
  try {
    // Dealt inside the try: a grid that fails to generate must refund too.
    const state = startAnteUpWordFillIn(tier, wagerInput, randomInt(2 ** 31), now);
    stored = await createAnteUpAttempt({
      profileId: profile.id,
      game: GAME,
      tier,
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
        "ante_up_word_fill_in_wager_refund",
      ).catch((refundError) => {
        console.error("ante_up_word_fill_in.open_refund_failed", {
          profileId: profile.id,
          wager: wagerInput,
          error: refundError,
        });
      });
    }
    if (error instanceof ActiveAnteUpAttemptExists) {
      throw new AnteUpWordFillInRequestError(error.message, 409);
    }
    throw error;
  }

  // The attempt exists now, so the reconcile sweep must leave this debit alone.
  if (wagerInput > 0) {
    await confirmGoldDebitLedgered(wagerCorrelationId).catch((confirmError) => {
      console.error("ante_up_word_fill_in.open_confirm_failed", {
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

/**
 * The caller's live attempt at the version they acted on. A refusal carries
 * the true board so the player is never left looking at a stale one.
 */
async function requireLiveAttempt(
  profileId: string,
  version: number,
  now: Date,
): Promise<StoredAnteUpAttempt<AnteUpWordFillInAttempt>> {
  const current = await getActiveAnteUpAttempt<AnteUpWordFillInAttempt>(profileId, GAME);
  if (!current) throw new AnteUpWordFillInRequestError("Start an attempt first.", 404);

  const ticked = tickAnteUpWordFillIn(current.state, now);
  if (ticked !== null) {
    const settled =
      (await advanceAnteUpAttempt(current, ticked)) ??
      (await getAnteUpAttemptById<AnteUpWordFillInAttempt>(current.id)) ??
      current;
    throw new AnteUpWordFillInRequestError("Time's up.", 409, { round: snapshot(settled, now) });
  }

  if (current.version !== version) {
    throw new AnteUpWordFillInRequestError("That grid moved on.", 409, {
      round: snapshot(current, now),
    });
  }

  return current;
}

/** Writes an advanced attempt, and pays it if that write won the grid. Rule 2 lives here. */
async function settle(
  profileId: string,
  current: StoredAnteUpAttempt<AnteUpWordFillInAttempt>,
  next: AnteUpWordFillInAttempt,
  now: Date,
): Promise<{ attempt: AnteUpWordFillInSnapshot; paid: PlayerProfile | null }> {
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    const live = (await getAnteUpAttemptById<AnteUpWordFillInAttempt>(current.id)) ?? current;
    throw new AnteUpWordFillInRequestError("That grid moved on.", 409, {
      round: snapshot(live, now),
    });
  }

  const paid = stored.state.status === "won" ? await payOutWin(profileId, stored.state) : null;
  return { attempt: snapshot(stored, now), paid };
}

function placeRefusal(problem: WordFillInPlaceProblem): string {
  switch (problem) {
    case "finished":
      return "This attempt is already over.";
    case "not-in-list":
      return "That word is not on the list.";
    case "wrong-length":
      return "That word does not fit that slot.";
    case "no-change":
      return "That word is already there.";
    default:
      return "That slot is not on the grid.";
  }
}

function clearRefusal(problem: WordFillInClearProblem): string {
  switch (problem) {
    case "finished":
      return "This attempt is already over.";
    case "already-empty":
      return "That slot is already empty.";
    default:
      return "That slot is not on the grid.";
  }
}

/** Drops a list word into a slot, and settles the attempt if that finished the grid. */
export async function placeAnteUpWordFillIn(
  token: string,
  input: { version: number; slot: number; word: string },
  now = new Date(),
): Promise<{ attempt: AnteUpWordFillInSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await requireLiveAttempt(profile.id, input.version, now);

  const problem = anteUpWordFillInPlaceProblem(current.state, input.slot, input.word, now);
  if (problem) {
    throw new AnteUpWordFillInRequestError(placeRefusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  const next = placeAnteUpWordFillInWord(current.state, input.slot, input.word, now);
  const { attempt, paid } = await settle(profile.id, current, next, now);
  return { attempt, profile: paid ?? profile };
}

/** Empties a slot, keeping crossing letters a filled word still needs. */
export async function clearAnteUpWordFillIn(
  token: string,
  input: { version: number; slot: number },
  now = new Date(),
): Promise<{ attempt: AnteUpWordFillInSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await requireLiveAttempt(profile.id, input.version, now);

  const problem = anteUpWordFillInClearProblem(current.state, input.slot, now);
  if (problem) {
    throw new AnteUpWordFillInRequestError(clearRefusal(problem), 409, {
      round: snapshot(current, now),
    });
  }

  const next = clearAnteUpWordFillInSlot(current.state, input.slot, now);
  const { attempt, paid } = await settle(profile.id, current, next, now);
  return { attempt, profile: paid ?? profile };
}

/** Gives up early. The wager is already spent; see the ordering rules above. */
export async function resignAnteUpWordFillInAttempt(
  token: string,
  now = new Date(),
): Promise<{ attempt: AnteUpWordFillInSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<AnteUpWordFillInAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignAnteUpWordFillIn(current.state, now);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ??
    (await getAnteUpAttemptById<AnteUpWordFillInAttempt>(current.id)) ??
    current;
  return { attempt: snapshot(stored, now), profile };
}

/** Maps a thrown error to the response every Ante Up: Word Fill-In route sends. */
export function toAnteUpWordFillInErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That attempt could not be played.");
}

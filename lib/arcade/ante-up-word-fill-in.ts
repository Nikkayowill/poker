/**
 * Word Fill-In: a solo skill wager, or free practice, any time.
 *
 * Wager Gold, solve a fresh grid inside the tier's clock, cash out a
 * multiple of the wager. Same shape as lib/arcade/ante-up-minesweeper.ts:
 * the multiplier is fixed per tier and copied onto the attempt when it
 * opens, so a player knows exactly what they are playing for before the
 * Gold leaves.
 *
 * There is no wrong move here -- no mine to hit, nothing that ends a round
 * early -- so the clock is the entire risk. Without one, a player could sit
 * on a half-filled grid indefinitely and eventually brute-force every cell
 * by trial and error; the per-tier limit is what keeps a wagered attempt an
 * actual bet instead of free money on a long enough timeline.
 */

import {
  GRID_SIZE,
  clearWordFillInSlot,
  guessWordFillInCell,
  placeWordFillInWord,
  resignWordFillInRound,
  startWordFillInRound,
  wordFillInClearProblem,
  wordFillInElapsedMs,
  wordFillInGuessProblem,
  wordFillInPlaceProblem,
  wordFillInView,
  type WordFillInClearProblem,
  type WordFillInGuessProblem,
  type WordFillInPlaceProblem,
  type WordFillInRound,
  type WordFillInView,
} from "./puzzles/word-fill-in";

/** The floor for a wager. Restated per game; see ante-up-memory.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

export type AnteUpWordFillInTier = "quick" | "marathon";

export interface AnteUpWordFillInTierConfig {
  readonly timeLimitMs: number;
  readonly multiplier: number;
}

/** Starting numbers, not tuned against real solve rates; retune here. */
export const ANTE_UP_WORD_FILL_IN_TIERS: Readonly<Record<AnteUpWordFillInTier, AnteUpWordFillInTierConfig>> = {
  quick: { timeLimitMs: 6 * 60 * 1000, multiplier: 1.4 },
  marathon: { timeLimitMs: 15 * 60 * 1000, multiplier: 2.2 },
};

export function isAnteUpWordFillInTier(value: unknown): value is AnteUpWordFillInTier {
  return value === "quick" || value === "marathon";
}

export type AnteUpWordFillInStatus = "active" | "won" | "lost" | "timed-out";

export interface AnteUpWordFillInAttempt {
  tier: AnteUpWordFillInTier;
  /** Already debited by the time an attempt exists; see the service. */
  wager: number;
  /** Copied from the tier at open, never re-read at settlement. */
  multiplier: number;
  timeLimitMs: number;
  round: WordFillInRound;
  status: AnteUpWordFillInStatus;
  startedAt: string;
}

export function startAnteUpWordFillIn(
  tier: AnteUpWordFillInTier,
  wager: number,
  seed: number,
  now: Date,
): AnteUpWordFillInAttempt {
  const config = ANTE_UP_WORD_FILL_IN_TIERS[tier];
  return {
    tier,
    wager,
    multiplier: config.multiplier,
    timeLimitMs: config.timeLimitMs,
    round: startWordFillInRound(seed),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/**
 * When the clock runs out, or null if it has not started. The clock only
 * runs once the first cell is guessed, so an attempt sitting on an untouched
 * grid has no deadline to miss.
 */
export function anteUpWordFillInDeadline(attempt: AnteUpWordFillInAttempt): number | null {
  if (!attempt.round.startedAt) return null;
  return Date.parse(attempt.round.startedAt) + attempt.timeLimitMs;
}

/**
 * Settles an attempt whose clock has expired. Returns null when nothing
 * changed -- the client polls this while a round is live, and a tick that
 * always returned a new object would bump the stored version on every poll
 * and livelock the optimistic concurrency guard against the player's own
 * moves. Every duel engine and ante-up wager carries the same rule.
 */
export function tickAnteUpWordFillIn(
  attempt: AnteUpWordFillInAttempt,
  now: Date,
): AnteUpWordFillInAttempt | null {
  if (attempt.status !== "active") return null;
  const deadline = anteUpWordFillInDeadline(attempt);
  if (deadline === null || now.getTime() < deadline) return null;
  return {
    ...attempt,
    round: resignWordFillInRound(attempt.round, now),
    status: "timed-out",
  };
}

function guard<TProblem extends string>(
  attempt: AnteUpWordFillInAttempt,
  now: Date,
  problem: TProblem | null,
): TProblem | "finished" | null {
  if (attempt.status !== "active") return "finished";
  const deadline = anteUpWordFillInDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return "finished";
  return problem;
}

export function anteUpWordFillInGuessProblem(
  attempt: AnteUpWordFillInAttempt,
  index: number,
  letter: string,
  now: Date,
): WordFillInGuessProblem | null {
  return guard(attempt, now, wordFillInGuessProblem(attempt.round, index, letter));
}

export function guessAnteUpWordFillInCell(
  attempt: AnteUpWordFillInAttempt,
  index: number,
  letter: string,
  now: Date,
): AnteUpWordFillInAttempt {
  if (anteUpWordFillInGuessProblem(attempt, index, letter, now)) return attempt;
  const round = guessWordFillInCell(attempt.round, index, letter, now);
  if (round.status === "solved") return { ...attempt, round, status: "won" };
  return { ...attempt, round, status: "active" };
}

export function anteUpWordFillInPlaceProblem(
  attempt: AnteUpWordFillInAttempt,
  slotIndex: number,
  word: string,
  now: Date,
): WordFillInPlaceProblem | null {
  return guard(attempt, now, wordFillInPlaceProblem(attempt.round, slotIndex, word));
}

/** Drops a list word into a slot; see placeWordFillInWord. */
export function placeAnteUpWordFillInWord(
  attempt: AnteUpWordFillInAttempt,
  slotIndex: number,
  word: string,
  now: Date,
): AnteUpWordFillInAttempt {
  if (anteUpWordFillInPlaceProblem(attempt, slotIndex, word, now)) return attempt;
  const round = placeWordFillInWord(attempt.round, slotIndex, word, now);
  return { ...attempt, round, status: round.status === "solved" ? "won" : "active" };
}

export function anteUpWordFillInClearProblem(
  attempt: AnteUpWordFillInAttempt,
  slotIndex: number,
  now: Date,
): WordFillInClearProblem | null {
  return guard(attempt, now, wordFillInClearProblem(attempt.round, slotIndex));
}

/** Empties a slot; see clearWordFillInSlot. */
export function clearAnteUpWordFillInSlot(
  attempt: AnteUpWordFillInAttempt,
  slotIndex: number,
  now: Date,
): AnteUpWordFillInAttempt {
  if (anteUpWordFillInClearProblem(attempt, slotIndex, now)) return attempt;
  return { ...attempt, round: clearWordFillInSlot(attempt.round, slotIndex, now) };
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignAnteUpWordFillIn(
  attempt: AnteUpWordFillInAttempt,
  now: Date,
): AnteUpWordFillInAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, round: resignWordFillInRound(attempt.round, now), status: "lost" };
}

/** What a wager win pays. Zero on anything else; a loss or a timeout forfeits the wager. */
export function anteUpWordFillInPayout(
  attempt: Pick<AnteUpWordFillInAttempt, "wager" | "multiplier" | "status">,
): number {
  if (attempt.status !== "won") return 0;
  return Math.round(attempt.wager * attempt.multiplier);
}

export interface AnteUpWordFillInSnapshot {
  id: string;
  version: number;
  tier: AnteUpWordFillInTier;
  wager: number;
  multiplier: number;
  status: AnteUpWordFillInStatus;
  gridSize: number;
  /** Redacted; carries no solution letters while the round is live. */
  board: WordFillInView;
  /**
   * When the clock runs out, or null until the first guess starts it.
   * Absolute rather than a duration on purpose: the client ticks its own
   * countdown once a second, and a relative figure would freeze at whatever
   * the snapshot said when it was built.
   */
  expiresAt: string | null;
  /** Floored at zero. Null until the first guess starts the clock. */
  msRemaining: number | null;
  timeLimitMs: number;
  elapsedMs: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpWordFillInSnapshot(
  attempt: AnteUpWordFillInAttempt,
  meta: { id: string; version: number },
  now: Date,
): AnteUpWordFillInSnapshot {
  const deadline = anteUpWordFillInDeadline(attempt);
  return {
    id: meta.id,
    version: meta.version,
    tier: attempt.tier,
    wager: attempt.wager,
    multiplier: attempt.multiplier,
    status: attempt.status,
    gridSize: GRID_SIZE,
    board: wordFillInView(attempt.round),
    expiresAt: deadline === null ? null : new Date(deadline).toISOString(),
    msRemaining:
      deadline === null
        ? null
        : attempt.status === "active"
          ? Math.max(0, deadline - now.getTime())
          : 0,
    timeLimitMs: attempt.timeLimitMs,
    elapsedMs: wordFillInElapsedMs(attempt.round, now),
    payout: anteUpWordFillInPayout(attempt),
  };
}

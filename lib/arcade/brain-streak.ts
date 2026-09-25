/**
 * Brain Games: the "streak" shape, shared by Sequence Recall, Quick Math
 * Sprint, Pattern Predictor and Trivia Blitz.
 *
 * All four are the same mechanic wearing different content: the server hands
 * back one round at a time, the player answers, and the run ends either on a
 * miss (`survival`: Sequence Recall, Pattern Predictor -- "one slip ends the
 * run") or when a shared clock expires (`sprint`: Quick Math Sprint, Trivia
 * Blitz -- "sixty seconds, as many as you can get"). Score is rounds
 * answered correctly; a wrong answer in `sprint` mode costs nothing but the
 * miss itself, since the clock is the only thing that can end that mode.
 *
 * This is a solo skill wager, same model as every other Ante Up board:
 * wager Gold, beat your own performance, cash out a multiple if you do. See
 * lib/server/ante-up-service.ts's header for the three ordering rules this
 * still has to follow; lib/server/brain-streak-service.ts is where they're
 * enforced.
 *
 * The correct answer to the round in play never reaches the client -- see
 * toBrainStreakSnapshot -- with one deliberate exception: Sequence Recall's
 * "answer" is the very sequence the player is asked to watch and repeat, so
 * showing it isn't a leak, it's the round.
 *
 * This file is shared with the browser, so it holds only the rules, clocks and
 * payout ladders. What each round actually asks (and its answer bank) lives
 * in lib/arcade/brain-streak-rounds.ts, which is server-only.
 */

import type { RandomInt } from "@/lib/game/deck";

export const MIN_ANTE_UP_WAGER = 500;

export type BrainStreakGame =
  | "sequence-recall"
  | "quick-math"
  | "pattern-predictor"
  | "trivia-blitz";

export type BrainStreakMode = "survival" | "sprint";

export interface BrainStreakRound {
  /** Whatever the player needs to see to answer. Safe to reveal in full. */
  prompt: Record<string, unknown>;
  /** Compared case/whitespace-insensitively against the player's answer. */
  answer: string;
}

/** One payout rung: reach at least `min` correct answers, cash out `multiplier`x. */
export interface StreakRung {
  min: number;
  multiplier: number;
}

export interface BrainStreakConfig {
  mode: BrainStreakMode;
  /** Sprint only: how long the whole run lasts. */
  timeLimitMs?: number;
  /**
   * Sprint only: wrong answers a run survives. Unset means misses are free.
   * A true/false sprint needs one, or pressing the same button fast enough
   * clears the ladder on a coin flip.
   */
  maxMisses?: number;
  nextRound: (score: number, randomInt: RandomInt) => BrainStreakRound;
  /**
   * Highest score first. The multiplier for a score is the first rung whose
   * `min` it meets or beats; a score below every rung's `min` pays 0 and the
   * wager is forfeit, same as any other Ante Up loss.
   */
  ladder: readonly StreakRung[];
}

/**
 * Only values the ante_up_attempts.status CHECK accepts. A finished run is
 * "won" when its score reached a paying rung and "lost" when it didn't; see
 * finishedStatus.
 */
export type BrainStreakStatus = "active" | "won" | "lost";

export interface BrainStreakAttempt {
  game: BrainStreakGame;
  wager: number;
  mode: BrainStreakMode;
  /** Copied at open, never re-read -- see ante-up-ladder.ts's header for why. */
  ladder: readonly StreakRung[];
  score: number;
  /** Wrong answers so far. Missing on runs opened before misses were counted. */
  misses?: number;
  /** Copied from the config at open, like `ladder`. Null means misses are free. */
  maxMisses?: number | null;
  round: BrainStreakRound;
  status: BrainStreakStatus;
  startedAt: string;
  expiresAt: string | null;
  finishedAt: string | null;
}

function normalize(answer: string): string {
  return answer.trim().toLowerCase();
}

/** The multiplier `score` has earned. Zero below the lowest rung's floor. */
export function streakMultiplierForScore(ladder: readonly StreakRung[], score: number): number {
  const rung = ladder.find((candidate) => score >= candidate.min);
  return rung?.multiplier ?? 0;
}

function finishedStatus(ladder: readonly StreakRung[], score: number): BrainStreakStatus {
  return streakMultiplierForScore(ladder, score) > 0 ? "won" : "lost";
}

export function startBrainStreakAttempt(
  game: BrainStreakGame,
  config: BrainStreakConfig,
  wager: number,
  randomInt: RandomInt,
  now: Date,
): BrainStreakAttempt {
  return {
    game,
    wager,
    mode: config.mode,
    ladder: config.ladder,
    score: 0,
    misses: 0,
    maxMisses: config.maxMisses ?? null,
    round: config.nextRound(0, randomInt),
    status: "active",
    startedAt: now.toISOString(),
    expiresAt:
      config.mode === "sprint" && config.timeLimitMs
        ? new Date(now.getTime() + config.timeLimitMs).toISOString()
        : null,
    finishedAt: null,
  };
}

/** Ends a sprint run whose clock ran out. Null (no-op) for survival mode or a live clock; see ante-up.ts's tickAnteUpAttempt for the same null-means-unchanged contract. */
export function tickBrainStreakAttempt(attempt: BrainStreakAttempt, now: Date): BrainStreakAttempt | null {
  if (attempt.status !== "active") return null;
  if (!attempt.expiresAt) return null;
  if (now.getTime() < Date.parse(attempt.expiresAt)) return null;
  return { ...attempt, status: finishedStatus(attempt.ladder, attempt.score), finishedAt: attempt.expiresAt };
}

export interface BrainStreakAnswerResult {
  attempt: BrainStreakAttempt;
  correct: boolean;
}

/**
 * Judges the player's answer to the current round. `survival` ends the run
 * on a miss; `sprint` always serves the next round, right or wrong, until
 * the clock (ticked separately) ends it.
 */
export function answerBrainStreakRound(
  attempt: BrainStreakAttempt,
  config: BrainStreakConfig,
  given: string,
  randomInt: RandomInt,
  now: Date,
): BrainStreakAnswerResult {
  if (attempt.status !== "active") return { attempt, correct: false };

  const correct = normalize(given) === normalize(attempt.round.answer);
  if (!correct && config.mode === "survival") {
    return {
      attempt: { ...attempt, status: finishedStatus(attempt.ladder, attempt.score), finishedAt: now.toISOString() },
      correct,
    };
  }

  const score = correct ? attempt.score + 1 : attempt.score;
  const misses = (attempt.misses ?? 0) + (correct ? 0 : 1);
  if (attempt.maxMisses && misses >= attempt.maxMisses) {
    return {
      attempt: { ...attempt, score, misses, status: finishedStatus(attempt.ladder, score), finishedAt: now.toISOString() },
      correct,
    };
  }
  return {
    attempt: { ...attempt, score, misses, round: config.nextRound(score, randomInt) },
    correct,
  };
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignBrainStreakAttempt(attempt: BrainStreakAttempt, now: Date): BrainStreakAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: finishedStatus(attempt.ladder, attempt.score), finishedAt: now.toISOString() };
}

/** What a finished run pays. Zero while still active or below the lowest rung. */
export function brainStreakPayout(attempt: Pick<BrainStreakAttempt, "wager" | "score" | "ladder" | "status">): number {
  if (attempt.status === "active") return 0;
  return Math.round(attempt.wager * streakMultiplierForScore(attempt.ladder, attempt.score));
}

export interface BrainStreakSnapshot {
  id: string;
  game: BrainStreakGame;
  wager: number;
  version: number;
  status: BrainStreakStatus;
  score: number;
  misses: number;
  maxMisses: number | null;
  /** The payout ladder this run was opened with. */
  ladder: readonly StreakRung[];
  /** The live round's prompt, answer withheld (except Sequence Recall's, which IS the prompt; see file header). */
  prompt: Record<string, unknown>;
  startedAt: string;
  expiresAt: string | null;
  msRemaining: number | null;
  payout: number;
}

export function toBrainStreakSnapshot(
  attempt: BrainStreakAttempt,
  meta: { id: string; version: number },
  now: Date,
): BrainStreakSnapshot {
  return {
    id: meta.id,
    game: attempt.game,
    wager: attempt.wager,
    version: meta.version,
    status: attempt.status,
    score: attempt.score,
    misses: attempt.misses ?? 0,
    maxMisses: attempt.maxMisses ?? null,
    ladder: attempt.ladder,
    prompt: attempt.round.prompt,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    msRemaining: attempt.expiresAt ? Math.max(0, Date.parse(attempt.expiresAt) - now.getTime()) : null,
    payout: brainStreakPayout(attempt),
  };
}

/**
 * Each game's clock, miss limit and payout ladder: everything the browser may
 * know before a run starts. Highest rung first. lib/arcade/brain-streak-rounds.ts
 * adds the round generators to make the full server-side configs.
 */
export const BRAIN_STREAK_RULES: Record<BrainStreakGame, Omit<BrainStreakConfig, "nextRound">> = {
  "sequence-recall": {
    mode: "survival",
    ladder: [
      { min: 9, multiplier: 3 },
      { min: 7, multiplier: 2 },
      { min: 5, multiplier: 1.3 },
      { min: 3, multiplier: 0.8 },
    ],
  },
  "quick-math": {
    mode: "sprint",
    timeLimitMs: 60_000,
    ladder: [
      { min: 20, multiplier: 3 },
      { min: 15, multiplier: 2 },
      { min: 10, multiplier: 1.3 },
      { min: 5, multiplier: 0.8 },
    ],
  },
  "pattern-predictor": {
    mode: "survival",
    ladder: [
      { min: 15, multiplier: 4 },
      { min: 10, multiplier: 2.5 },
      { min: 6, multiplier: 1.6 },
      { min: 3, multiplier: 1 },
    ],
  },
  // True/false has a 50% guess floor, so three wrong answers end the run and
  // the ladder starts paying later than the others.
  "trivia-blitz": {
    mode: "sprint",
    timeLimitMs: 45_000,
    maxMisses: 3,
    ladder: [
      { min: 20, multiplier: 2.5 },
      { min: 15, multiplier: 1.8 },
      { min: 10, multiplier: 1.2 },
      { min: 7, multiplier: 0.7 },
    ],
  },
};

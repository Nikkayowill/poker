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
import { stakePressure, type StakePressure } from "@/lib/arcade/stake-pressure";

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
  /** Replaces `maxMisses` in the bands listed. */
  maxMissesByPressure?: Partial<Record<StakePressure, number>>;
  /** Replaces `ladder` in the bands listed, for games where a bigger stake raises the bar. */
  ladderByPressure?: Partial<Record<StakePressure, readonly StreakRung[]>>;
  /**
   * `pressure` is the run's stake band, fixed at open; see stake-pressure.ts.
   * Null for a run opened before bands existed, which keeps the rules it started with.
   */
  nextRound: (score: number, randomInt: RandomInt, pressure: StakePressure | null) => BrainStreakRound;
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
  /** The stake band, fixed at open so a live run never changes. Missing on older runs, which play as band 0. */
  pressure?: StakePressure;
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

/** The miss limit a run opened at `pressure` gets. Null means misses are free. */
export function brainStreakMaxMisses(
  rules: Pick<BrainStreakConfig, "maxMisses" | "maxMissesByPressure">,
  pressure: StakePressure,
): number | null {
  return rules.maxMissesByPressure?.[pressure] ?? rules.maxMisses ?? null;
}

/** The payout ladder a run opened at `pressure` gets. */
export function brainStreakLadder(
  rules: Pick<BrainStreakConfig, "ladder" | "ladderByPressure">,
  pressure: StakePressure,
): readonly StreakRung[] {
  return rules.ladderByPressure?.[pressure] ?? rules.ladder;
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
  const pressure = stakePressure(wager);
  return {
    game,
    wager,
    mode: config.mode,
    ladder: brainStreakLadder(config, pressure),
    score: 0,
    misses: 0,
    maxMisses: brainStreakMaxMisses(config, pressure),
    pressure,
    round: config.nextRound(0, randomInt, pressure),
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
    attempt: { ...attempt, score, misses, round: config.nextRound(score, randomInt, attempt.pressure ?? null) },
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
  /** The stake band this run was opened in. */
  pressure: StakePressure;
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
    pressure: attempt.pressure ?? 0,
    ladder: attempt.ladder,
    prompt: attempt.round.prompt,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    msRemaining: attempt.expiresAt ? Math.max(0, Date.parse(attempt.expiresAt) - now.getTime()) : null,
    payout: brainStreakPayout(attempt),
  };
}

/** Sequence Recall per stake band: how many pads, how long the first sequence is, and how fast it flashes. */
export interface SequenceRecallBand {
  pads: number;
  startLength: number;
  flashMs: number;
  gapMs: number;
}

/**
 * Calibration, share of runs reaching 5 in a row (1.3x). Span model: Corsi block span
 * (9 blocks) adult mean 5.8, SD 1.0; +1 item per halving of choices below 9 pads; -0.8
 * items per halving of flash time below 400ms. A length L is repeated with chance
 * logistic((span - L) / 0.6). 150ms at band 3 would drop +3SD to 52%, so it flashes at 175.
 *
 *   band                      median  +1SD  +2SD  +3SD
 *   0: 4 pads, 400ms, from 2    80%    96%   99%  100%
 *   1: 4 pads, 250ms, from 3    17%    60%   90%   98%
 *   2: 6 pads, 200ms, from 3     2%    22%   67%   92%
 *   3: 6 pads, 175ms, from 4     0%     1%   17%   60%
 */
/** What every run used before stake bands. Runs opened then, and their rounds, keep it. */
export const SEQUENCE_RECALL_LEGACY_BAND: SequenceRecallBand = { pads: 4, startLength: 3, flashMs: 550, gapMs: 200 };

export const SEQUENCE_RECALL_BANDS: Record<StakePressure, SequenceRecallBand> = {
  0: { pads: 4, startLength: 2, flashMs: 400, gapMs: 160 },
  1: { pads: 4, startLength: 3, flashMs: 250, gapMs: 100 },
  2: { pads: 6, startLength: 3, flashMs: 200, gapMs: 80 },
  3: { pads: 6, startLength: 4, flashMs: 175, gapMs: 70 },
};

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
  // Three misses at band 3, so throwing away the two-digit x two-digit problems
  // with a quick wrong answer is not a free skip. See brain-streak-rounds.ts.
  "quick-math": {
    mode: "sprint",
    timeLimitMs: 60_000,
    maxMissesByPressure: { 3: 3 },
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
  //
  // Calibration, share of runs reaching the 1.2x rung. Model: a player knows
  // logistic(0.25 + 0.7z) of the bank outright (median 56%, so ~78% right on
  // true/false) and coin-flips the rest; 2.6s per call at the median, log SD 0.25
  // between players. The bar rises with the stake, since misses alone barely
  // separate a +2SD player from a +3SD one.
  //
  //   band (1.2x at)  median  +1SD  +2SD  +3SD
  //   0 (10)            68%    92%  100%  100%
  //   1 (15)            15%    58%   86%   97%
  //   2 (20)             0%    19%   76%   94%
  //   3 (27)             0%     0%   18%   87%
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
    ladderByPressure: {
      1: [
        { min: 24, multiplier: 2.5 },
        { min: 19, multiplier: 1.8 },
        { min: 15, multiplier: 1.2 },
        { min: 11, multiplier: 0.7 },
      ],
      2: [
        { min: 28, multiplier: 2.5 },
        { min: 24, multiplier: 1.8 },
        { min: 20, multiplier: 1.2 },
        { min: 15, multiplier: 0.7 },
      ],
      3: [
        { min: 33, multiplier: 2.5 },
        { min: 30, multiplier: 1.8 },
        { min: 27, multiplier: 1.2 },
        { min: 22, multiplier: 0.7 },
      ],
    },
  },
};

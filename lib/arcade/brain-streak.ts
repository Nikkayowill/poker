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
  nextRound: (score: number, randomInt: RandomInt) => BrainStreakRound;
  /**
   * Highest score first. The multiplier for a score is the first rung whose
   * `min` it meets or beats; a score below every rung's `min` pays 0 and the
   * wager is forfeit, same as any other Ante Up loss.
   */
  ladder: readonly StreakRung[];
}

export type BrainStreakStatus = "active" | "finished";

export interface BrainStreakAttempt {
  game: BrainStreakGame;
  wager: number;
  mode: BrainStreakMode;
  /** Copied at open, never re-read -- see ante-up-ladder.ts's header for why. */
  ladder: readonly StreakRung[];
  score: number;
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
  return { ...attempt, status: "finished", finishedAt: attempt.expiresAt };
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
    return { attempt: { ...attempt, status: "finished", finishedAt: now.toISOString() }, correct };
  }

  const score = correct ? attempt.score + 1 : attempt.score;
  return {
    attempt: { ...attempt, score, round: config.nextRound(score, randomInt) },
    correct,
  };
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignBrainStreakAttempt(attempt: BrainStreakAttempt, now: Date): BrainStreakAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "finished", finishedAt: now.toISOString() };
}

/** What a finished run pays. Zero while still active or below the lowest rung. */
export function brainStreakPayout(attempt: Pick<BrainStreakAttempt, "wager" | "score" | "ladder" | "status">): number {
  if (attempt.status !== "finished") return 0;
  return Math.round(attempt.wager * streakMultiplierForScore(attempt.ladder, attempt.score));
}

export interface BrainStreakSnapshot {
  id: string;
  game: BrainStreakGame;
  wager: number;
  version: number;
  status: BrainStreakStatus;
  score: number;
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
    prompt: attempt.round.prompt,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    msRemaining: attempt.expiresAt ? Math.max(0, Date.parse(attempt.expiresAt) - now.getTime()) : null,
    payout: brainStreakPayout(attempt),
  };
}

// ---------------------------------------------------------------------------
// Per-game content. Kept in this one file rather than four, since every one
// of them is a content generator plus a ladder, nothing more -- the engine
// above is the only real logic any of them has.
// ---------------------------------------------------------------------------

const SEQUENCE_COLORS = 4;
const SEQUENCE_START_LENGTH = 3;

/** Sequence Recall: watch a growing flash pattern, repeat it back exactly. */
export const SEQUENCE_RECALL_CONFIG: BrainStreakConfig = {
  mode: "survival",
  nextRound: (score, randomInt) => {
    const length = SEQUENCE_START_LENGTH + score;
    const sequence = Array.from({ length }, () => randomInt(SEQUENCE_COLORS));
    return { prompt: { sequence, colors: SEQUENCE_COLORS }, answer: sequence.join(",") };
  },
  ladder: [
    { min: 9, multiplier: 3 },
    { min: 7, multiplier: 2 },
    { min: 5, multiplier: 1.3 },
    { min: 3, multiplier: 0.8 },
  ],
};

const MATH_OPS = ["+", "-", "×"] as const;

/** Quick Math Sprint: sixty seconds, as many right answers as you can get. */
export const QUICK_MATH_CONFIG: BrainStreakConfig = {
  mode: "sprint",
  timeLimitMs: 60_000,
  nextRound: (score, randomInt) => {
    // Numbers grow slowly with score so a long run stays a real test of
    // speed rather than staying trivial the whole sixty seconds.
    const ceiling = 12 + Math.floor(score / 5) * 4;
    const op = MATH_OPS[randomInt(MATH_OPS.length)];
    let a = randomInt(ceiling) + 1;
    let b = randomInt(ceiling) + 1;
    if (op === "-" && b > a) [a, b] = [b, a]; // keep subtraction non-negative
    const result = op === "+" ? a + b : op === "-" ? a - b : a * b;
    return { prompt: { a, b, op }, answer: String(result) };
  },
  ladder: [
    { min: 20, multiplier: 3 },
    { min: 15, multiplier: 2 },
    { min: 10, multiplier: 1.3 },
    { min: 5, multiplier: 0.8 },
  ],
};

type PatternRule = "arithmetic" | "geometric" | "alternating";

function generatePattern(randomInt: RandomInt): { terms: number[]; next: number } {
  const rule: PatternRule = (["arithmetic", "geometric", "alternating"] as const)[randomInt(3)];
  const start = randomInt(9) + 1;
  if (rule === "geometric") {
    const ratio = randomInt(3) + 2;
    const terms = [0, 1, 2, 3].map((i) => start * ratio ** i);
    return { terms, next: start * ratio ** 4 };
  }
  if (rule === "alternating") {
    const stepUp = randomInt(5) + 2;
    const stepDown = randomInt(3) + 1;
    const terms = [start, start + stepUp, start + stepUp - stepDown, start + 2 * stepUp - stepDown];
    return { terms, next: terms[3] + stepUp };
  }
  const step = randomInt(6) + 2;
  const terms = [0, 1, 2, 3].map((i) => start + i * step);
  return { terms, next: start + 4 * step };
}

/** Pattern Predictor: a number sequence hides a rule -- pick what comes next. */
export const PATTERN_PREDICTOR_CONFIG: BrainStreakConfig = {
  mode: "survival",
  nextRound: (_score, randomInt) => {
    const { terms, next } = generatePattern(randomInt);
    const options = new Set<number>([next]);
    while (options.size < 4) {
      const jitter = randomInt(9) - 4;
      options.add(next + (jitter === 0 ? 5 : jitter));
    }
    // A real Fisher-Yates, not a comparator-based shuffle: sort() with a
    // random comparator is both biased (unequal permutation odds) and not
    // guaranteed stable across engines for a comparator that isn't a valid
    // total order.
    const shuffled = [...options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { prompt: { terms, options: shuffled }, answer: String(next) };
  },
  ladder: [
    { min: 15, multiplier: 4 },
    { min: 10, multiplier: 2.5 },
    { min: 6, multiplier: 1.6 },
    { min: 3, multiplier: 1 },
  ],
};

/**
 * General-knowledge statements, deliberately nothing CS/AI/DSA -- this game
 * replaces "Big-O Blitz" with something anyone can play cold. True/false has
 * a 50% guess floor, so its ladder (below) starts profit later than the
 * others.
 */
const TRIVIA_STATEMENTS: readonly { statement: string; answer: boolean }[] = [
  { statement: "The Great Wall of China is visible from the Moon with the naked eye.", answer: false },
  { statement: "Octopuses have three hearts.", answer: true },
  { statement: "The Eiffel Tower is taller than the Statue of Liberty.", answer: true },
  { statement: "Bananas grow on trees.", answer: false },
  { statement: "A group of crows is called a murder.", answer: true },
  { statement: "The human body has 206 bones as an adult.", answer: true },
  { statement: "Mount Everest is the tallest mountain measured from base to peak.", answer: false },
  { statement: "Honey never spoils.", answer: true },
  { statement: "Goldfish have a memory span of only a few seconds.", answer: false },
  { statement: "Australia is both a country and a continent.", answer: true },
  { statement: "The Sahara is the largest desert in the world.", answer: false },
  { statement: "Sharks are mammals.", answer: false },
  { statement: "Venus is the hottest planet in our solar system.", answer: true },
  { statement: "Lightning never strikes the same place twice.", answer: false },
  { statement: "The shortest war in recorded history lasted under an hour.", answer: true },
  { statement: "A day on Venus is longer than a year on Venus.", answer: true },
  { statement: "Penguins live at both the North and South Poles.", answer: false },
  { statement: "The Amazon River is longer than the Nile.", answer: false },
  { statement: "Table salt is a compound of sodium and chlorine.", answer: true },
  { statement: "Humans only use 10% of their brains.", answer: false },
  { statement: "Peanuts are legumes, not nuts.", answer: true },
  { statement: "The Great Barrier Reef is the largest living structure on Earth.", answer: true },
  { statement: "Glass is a slow-moving liquid at room temperature.", answer: false },
  { statement: "Antarctica is the driest continent on Earth.", answer: true },
  { statement: "The inventor of the telephone was Thomas Edison.", answer: false },
  { statement: "A bolt of lightning is hotter than the surface of the Sun.", answer: true },
  { statement: "Koalas are a type of bear.", answer: false },
  { statement: "The currency of Japan is the yuan.", answer: false },
  { statement: "Chess originated in India.", answer: true },
  { statement: "The Statue of Liberty was a gift from France.", answer: true },
];

/** Trivia Blitz: rapid-fire true/false against the clock -- replaces "Big-O Blitz". */
export const TRIVIA_BLITZ_CONFIG: BrainStreakConfig = {
  mode: "sprint",
  timeLimitMs: 45_000,
  nextRound: (_score, randomInt) => {
    const pick = TRIVIA_STATEMENTS[randomInt(TRIVIA_STATEMENTS.length)];
    return { prompt: { statement: pick.statement }, answer: String(pick.answer) };
  },
  ladder: [
    { min: 25, multiplier: 2.5 },
    { min: 20, multiplier: 1.8 },
    { min: 15, multiplier: 1.2 },
    { min: 10, multiplier: 0.7 },
  ],
};

export const BRAIN_STREAK_CONFIGS: Record<BrainStreakGame, BrainStreakConfig> = {
  "sequence-recall": SEQUENCE_RECALL_CONFIG,
  "quick-math": QUICK_MATH_CONFIG,
  "pattern-predictor": PATTERN_PREDICTOR_CONFIG,
  "trivia-blitz": TRIVIA_BLITZ_CONFIG,
};

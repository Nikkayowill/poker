import "server-only";
import type { RandomInt } from "@/lib/game/deck";
import type { StakePressure } from "@/lib/arcade/stake-pressure";
import { TRIVIA_QUESTIONS } from "@/lib/pvp/trivia-questions";
import {
  BRAIN_STREAK_RULES,
  SEQUENCE_RECALL_BANDS,
  SEQUENCE_RECALL_LEGACY_BAND,
  type BrainStreakConfig,
  type BrainStreakGame,
} from "./brain-streak";

/**
 * What each Brain Games streak round asks, and its answer. Server-only so the
 * answer banks never ship to the browser; the rules and ladders the client
 * needs live in lib/arcade/brain-streak.ts.
 *
 * Every generator takes the run's stake pressure. A bigger stake buys harder
 * content (longer sequences, bigger numbers, trickier rules), never worse odds:
 * a player good enough for the top band should still clear it.
 */

/** A whole number from `low` to `high`, both included. */
function between(randomInt: RandomInt, low: number, high: number): number {
  return low + randomInt(high - low + 1);
}

/** Sequence Recall: watch a growing flash pattern, repeat it back exactly. */
export const SEQUENCE_RECALL_CONFIG: BrainStreakConfig = {
  ...BRAIN_STREAK_RULES["sequence-recall"],
  nextRound: (score, randomInt, pressure) => {
    const band = pressure === null ? SEQUENCE_RECALL_LEGACY_BAND : SEQUENCE_RECALL_BANDS[pressure];
    const length = band.startLength + score;
    const sequence = Array.from({ length }, () => randomInt(band.pads));
    return {
      prompt: { sequence, colors: band.pads, flashMs: band.flashMs, gapMs: band.gapMs },
      answer: sequence.join(","),
    };
  },
};

interface MathProblem {
  a: number;
  b: number;
  op: "+" | "-" | "×" | "÷";
}

function solveMath({ a, b, op }: MathProblem): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "×") return a * b;
  return a / b;
}

/** The original sixty-second mix: small operands that grow +4 every 5 correct. */
function classicMathProblem(score: number, randomInt: RandomInt): MathProblem {
  const ceiling = 12 + Math.floor(score / 5) * 4;
  const op = (["+", "-", "×"] as const)[randomInt(3)];
  let a = randomInt(ceiling) + 1;
  let b = randomInt(ceiling) + 1;
  if (op === "-" && b > a) [a, b] = [b, a]; // keep subtraction non-negative
  return { a, b, op };
}

type MathKind = "add32" | "sub32" | "add33" | "sub33" | "mul21s" | "mul21m" | "mul21b" | "mul22" | "dive" | "divh";

/**
 * Which problem shapes each stake band deals, each equally likely.
 *
 * Calibration, share of 60s runs with 10+ right (1.3x). Model: median adult time per
 * problem, solving plus keying, from mental-arithmetic norms (single-digit facts ~1s,
 * two-digit sums with carry 3-4s, two-digit x one-digit 5-8s, two-digit x two-digit
 * 20s+), times exp(-0.4z) for processing speed; error rates 4-25% by type, falling with
 * skill; players skip anything over 3x the usual time while misses allow.
 *
 *   band                                   median  +1SD  +2SD  +3SD
 *   0: classic, operands to 12               100%  100%  100%  100%
 *   1: 3d±2d, 2d×1d, easy division            16%   99%  100%  100%
 *   2: 3d±3d, 2d×1d to 49, hard division       0%    8%   94%  100%
 *   3: 3d-3d, 2d×1d to 99, 2d×2d, hard div     0%    0%   19%   94%
 */
const MATH_KINDS: Record<Exclude<StakePressure, 0>, readonly MathKind[]> = {
  1: ["add32", "sub32", "mul21s", "dive"],
  2: ["add33", "sub33", "mul21m", "divh"],
  3: ["sub33", "mul21b", "mul22", "divh"],
};

/** Harder arithmetic for a bigger stake. Ranges still widen every 5 correct. */
function stakedMathProblem(score: number, randomInt: RandomInt, pressure: Exclude<StakePressure, 0>): MathProblem {
  const grow = Math.floor(score / 5);
  const kinds = MATH_KINDS[pressure];
  const kind = kinds[randomInt(kinds.length)];
  const threeDigit = () => between(randomInt, 100, Math.min(999, 500 + 100 * grow));
  switch (kind) {
    case "add32":
      return { a: threeDigit(), b: between(randomInt, 10, 99), op: "+" };
    case "sub32":
      return { a: threeDigit(), b: between(randomInt, 10, 99), op: "-" };
    case "add33":
      return { a: threeDigit(), b: threeDigit(), op: "+" };
    case "sub33": {
      const [x, y] = [threeDigit(), threeDigit()];
      return { a: Math.max(x, y), b: Math.min(x, y), op: "-" };
    }
    case "mul21s":
      return { a: between(randomInt, 12, Math.min(99, 25 + 5 * grow)), b: between(randomInt, 3, 9), op: "×" };
    case "mul21m":
      return { a: between(randomInt, 12, Math.min(99, 49 + 10 * grow)), b: between(randomInt, 3, 9), op: "×" };
    case "mul21b":
      return { a: between(randomInt, 13, 99), b: between(randomInt, 4, 9), op: "×" };
    case "mul22":
      return {
        a: between(randomInt, 12, Math.min(49, 25 + 3 * grow)),
        b: between(randomInt, 11, Math.min(39, 19 + 2 * grow)),
        op: "×",
      };
    case "dive": {
      const divisor = between(randomInt, 3, 12);
      return { a: divisor * between(randomInt, 4, 15 + 3 * grow), b: divisor, op: "÷" };
    }
    case "divh": {
      const divisor = between(randomInt, 6, 19);
      return { a: divisor * between(randomInt, 11, 30 + 5 * grow), b: divisor, op: "÷" };
    }
  }
}

/** Quick Math Sprint: sixty seconds, as many right answers as you can get. */
export const QUICK_MATH_CONFIG: BrainStreakConfig = {
  ...BRAIN_STREAK_RULES["quick-math"],
  nextRound: (score, randomInt, pressure) => {
    const problem = !pressure ? classicMathProblem(score, randomInt) : stakedMathProblem(score, randomInt, pressure);
    return { prompt: { ...problem }, answer: String(solveMath(problem)) };
  },
};

interface Pattern {
  terms: number[];
  next: number;
}

/**
 * How far along the difficulty ramp a round sits: the score, plus a head start
 * for a bigger stake.
 *
 * Calibration, share of runs reaching 6 in a row (1.6x). Model: Raven's-style 3PL
 * items, guess floor 0.25 (four options), discrimination 1.2, and level L sits at
 * difficulty -2.5 + 0.25L on the z scale (level 0 is easy for nearly everyone,
 * level 20 is a +2.5SD item).
 *
 *   band (head start)  median  +1SD  +2SD  +3SD
 *   0 (0)                87%    98%  100%  100%
 *   1 (6)                15%    70%   95%   99%
 *   2 (10)                1%    15%   70%   95%
 *   3 (14)                0%     1%   15%   70%
 */
const PATTERN_HEAD_START: Record<StakePressure, number> = { 0: 0, 1: 6, 2: 10, 3: 14 };

/** Which rule families unlock at which level. A round draws from its own tier and the one below. */
function patternTier(level: number): 0 | 1 | 2 | 3 {
  if (level < 3) return 0;
  if (level < 6) return 1;
  if (level < 10) return 2;
  return 3;
}

/** Builds `count` terms plus the next one from a rule. */
function unroll(count: number, term: (i: number) => number): Pattern {
  const all = Array.from({ length: count + 1 }, (_, i) => term(i));
  return { terms: all.slice(0, count), next: all[count] };
}

/** Builds terms by repeatedly applying `step` to the previous one (or two). */
function recur(count: number, seeds: number[], step: (prev: number[], i: number) => number): Pattern {
  const all = [...seeds];
  while (all.length < count + 1) all.push(step(all, all.length));
  return { terms: all.slice(0, count), next: all[count] };
}

type PatternMaker = (randomInt: RandomInt, scale: number) => Pattern;

const PATTERN_TIERS: readonly (readonly PatternMaker[])[] = [
  [
    // Adding the same amount.
    (r, s) => {
      const start = between(r, 1, 9 * s);
      const step = between(r, 2, 7 + s);
      return unroll(4, (i) => start + i * step);
    },
    // Multiplying by the same amount.
    (r) => {
      const start = between(r, 1, 9);
      const ratio = between(r, 2, 3);
      return unroll(4, (i) => start * ratio ** i);
    },
    // Up one amount, down another.
    (r, s) => {
      const start = between(r, 1, 9 * s);
      const up = between(r, 2, 6 + s);
      const down = between(r, 1, up - 1);
      return recur(4, [start], (prev, i) => prev[i - 1] + (i % 2 === 1 ? up : -down));
    },
  ],
  [
    // A bigger step, going down.
    (r, s) => {
      const step = between(r, 6, 12 + 3 * s);
      const start = step * 5 + between(r, 10, 40 * s);
      return unroll(5, (i) => start - i * step);
    },
    // Multiplying, with a larger ratio.
    (r, s) => {
      const start = between(r, 2, 5 + s);
      const ratio = between(r, 2, 4);
      return unroll(4, (i) => start * ratio ** i);
    },
    // Squares, shifted.
    (r, s) => {
      const first = between(r, 1, 3 + s);
      const shift = between(r, -3, 5 * s);
      return unroll(5, (i) => (first + i) ** 2 + shift);
    },
    // The gap grows by the same amount each time.
    (r, s) => {
      const start = between(r, 1, 10 * s);
      const firstGap = between(r, 1, 5 + s);
      const growth = between(r, 1, 3 + s);
      return unroll(5, (i) => start + i * firstGap + (growth * i * (i - 1)) / 2);
    },
  ],
  [
    // Triangular numbers, shifted.
    (r, s) => {
      const first = between(r, 1, 3 + 2 * s);
      const shift = between(r, 0, 6 * s);
      return unroll(5, (i) => ((first + i) * (first + i + 1)) / 2 + shift);
    },
    // Each term is the two before it added together.
    (r, s) => {
      const a = between(r, 1, 4 + 2 * s);
      const b = between(r, a + 1, a + 5 + 2 * s);
      return recur(5, [a, b], (prev, i) => prev[i - 1] + prev[i - 2]);
    },
    // Two adding sequences, interleaved.
    (r, s) => {
      const a = between(r, 1, 10 * s);
      const b = between(r, 1, 10 * s);
      const stepA = between(r, 2, 5 + 2 * s);
      let stepB = between(r, 2, 5 + 2 * s);
      if (stepB === stepA) stepB += 3;
      return unroll(6, (i) => (i % 2 === 0 ? a + (i / 2) * stepA : b + ((i - 1) / 2) * stepB));
    },
    // Multiply, then add.
    (r, s) => {
      const times = between(r, 2, 3);
      const plus = between(r, 1, 3 + s) * (r(2) === 0 ? 1 : -1);
      // Starting above |plus| keeps every term positive and growing.
      const start = Math.abs(plus) + between(r, 1, 3 + s);
      return recur(4, [start], (prev, i) => prev[i - 1] * times + plus);
    },
  ],
  [
    // Add one amount, then multiply by another, in turn.
    (r, s) => {
      const start = between(r, 1, 3 + s);
      const plus = between(r, 1, 3 + s);
      const times = between(r, 2, 3);
      return recur(5, [start], (prev, i) => (i % 2 === 1 ? prev[i - 1] + plus : prev[i - 1] * times));
    },
    // An adding sequence interleaved with a multiplying one.
    (r, s) => {
      const a = between(r, 5, 10 * s);
      const step = between(r, 3, 6 + 2 * s);
      const b = between(r, 1, 4);
      const ratio = between(r, 2, 3);
      return unroll(6, (i) => (i % 2 === 0 ? a + (i / 2) * step : b * ratio ** ((i - 1) / 2)));
    },
    // Cubes, shifted.
    (r, s) => {
      const first = between(r, 1, 2 + Math.floor(s / 2));
      const shift = between(r, -5, 4 * s);
      return unroll(5, (i) => (first + i) ** 3 + shift);
    },
    // Multiply, then add, with bigger numbers.
    (r, s) => {
      const times = between(r, 2, 4);
      const plus = between(r, 2, 5 + 2 * s) * (r(2) === 0 ? 1 : -1);
      const start = Math.abs(plus) + between(r, 1, 4 + s);
      return recur(4, [start], (prev, i) => prev[i - 1] * times + plus);
    },
    // The gap itself doubles each time.
    (r, s) => {
      const start = between(r, 1, 10 * s);
      const firstGap = between(r, 1, 3 + s);
      return recur(5, [start], (prev, i) => prev[i - 1] + firstGap * 2 ** (i - 1));
    },
  ],
];

function differences(terms: readonly number[]): number[] {
  return terms.slice(1).map((term, i) => term - terms[i]);
}

function allEqual(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0]);
}

/**
 * What a simpler rule would say comes next, and whether that rule actually
 * fits every term shown. Rules that fit give ambiguous rounds; ones that
 * don't make the most tempting wrong answers.
 */
function rivalPredictions(terms: readonly number[]): { value: number; fits: boolean }[] {
  const n = terms.length;
  const last = terms[n - 1];
  const prev = terms[n - 2];
  const gaps = differences(terms);
  const lastGap = gaps[gaps.length - 1];
  const gapGaps = differences(gaps);
  const rivals: { value: number; fits: boolean }[] = [
    { value: last + lastGap, fits: allEqual(gaps) },
    { value: last + lastGap + (gapGaps[gapGaps.length - 1] ?? 0), fits: allEqual(gapGaps) },
    { value: last + prev, fits: terms.slice(2).every((term, i) => term === terms[i] + terms[i + 1]) },
  ];
  if (prev !== 0 && last % prev === 0) {
    const ratio = last / prev;
    const fits = terms.slice(1).every((term, i) => terms[i] !== 0 && term === terms[i] * ratio);
    rivals.push({ value: last * ratio, fits });
  }
  if (n >= 4) {
    // Read as two interleaved sequences, the next term continues the older strand.
    const strandGap = terms[n - 2] - terms[n - 4];
    const odd = terms.filter((_, i) => i % 2 === n % 2);
    const even = terms.filter((_, i) => i % 2 !== n % 2);
    rivals.push({ value: terms[n - 2] + strandGap, fits: n >= 6 && allEqual(differences(odd)) && allEqual(differences(even)) });
  }
  return rivals;
}

/** True when some simpler rule fits every term but predicts something else. */
export function patternIsAmbiguous(pattern: Pattern): boolean {
  return rivalPredictions(pattern.terms).some((rival) => rival.fits && rival.value !== pattern.next);
}

/**
 * Three wrong options that look right: what rival rules predict first, then
 * near misses of the answer. Never the answer itself, never a repeat.
 */
export function patternDistractors(pattern: Pattern, randomInt: RandomInt): number[] {
  const { terms, next } = pattern;
  const picked = new Set<number>();
  // A negative option among all-positive terms would be an easy one to rule out.
  const floor = Math.min(0, ...terms, next);
  const offer = (value: number) => {
    if (picked.size < 3 && Number.isSafeInteger(value) && value !== next && value >= floor) picked.add(value);
  };
  const rivals = rivalPredictions(terms).map((rival) => rival.value);
  shuffle(rivals, randomInt);
  // At most two from rival rules, so there is always a near miss to rule out as well.
  for (const value of rivals) if (picked.size < 2) offer(value);
  const lastGap = Math.abs(next - terms[terms.length - 1]) || 1;
  const near = [1, -1, 2, -2, lastGap, -lastGap, 10, -10, 3, -3, 4, 5, 6, 7];
  shuffle(near, randomInt);
  for (const offset of near) offer(next + offset);
  return [...picked];
}

/** A real Fisher-Yates. sort() with a random comparator is biased. */
function shuffle<T>(items: T[], randomInt: RandomInt): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function generatePattern(level: number, randomInt: RandomInt): Pattern {
  const tier = patternTier(level);
  const pool = tier === 0 ? PATTERN_TIERS[0] : [...PATTERN_TIERS[tier], ...PATTERN_TIERS[tier - 1]];
  // Numbers keep growing past the last tier, so a long run never flattens out.
  const scale = 1 + Math.floor(level / 5);
  let pattern = pool[randomInt(pool.length)](randomInt, scale);
  for (let tries = 0; patternIsAmbiguous(pattern) && tries < 20; tries++) {
    pattern = pool[randomInt(pool.length)](randomInt, scale);
  }
  return pattern;
}

/** Pattern Predictor: a number sequence hides a rule -- pick what comes next. */
export const PATTERN_PREDICTOR_CONFIG: BrainStreakConfig = {
  ...BRAIN_STREAK_RULES["pattern-predictor"],
  nextRound: (score, randomInt, pressure) => {
    const pattern = generatePattern(score + PATTERN_HEAD_START[pressure ?? 0], randomInt);
    const options = shuffle([pattern.next, ...patternDistractors(pattern, randomInt)], randomInt);
    return { prompt: { terms: pattern.terms, options }, answer: String(pattern.next) };
  },
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

/**
 * Trivia Blitz: rapid-fire true/false against the clock -- replaces "Big-O Blitz".
 *
 * Most rounds come from the duel trivia bank: a question shown with either its
 * right answer or one of its wrong ones, and the player calls it. Thirty
 * statements alone were few enough to memorise, which made a wager a sure thing.
 */
export const TRIVIA_BLITZ_CONFIG: BrainStreakConfig = {
  ...BRAIN_STREAK_RULES["trivia-blitz"],
  nextRound: (_score, randomInt, pressure) => {
    // The short statements are well-known myths a regular soon learns, so
    // wagers of 10k and up draw from the question bank only.
    const skip = !pressure ? 0 : TRIVIA_STATEMENTS.length;
    const index = skip + randomInt(TRIVIA_STATEMENTS.length + TRIVIA_QUESTIONS.length - skip);
    if (index < TRIVIA_STATEMENTS.length) {
      const pick = TRIVIA_STATEMENTS[index];
      return { prompt: { statement: pick.statement }, answer: String(pick.answer) };
    }
    const question = TRIVIA_QUESTIONS[index - TRIVIA_STATEMENTS.length];
    const truthful = randomInt(2) === 0;
    const wrong = [0, 1, 2, 3].filter((choice) => choice !== question.answerIndex);
    const shown = truthful ? question.answerIndex : wrong[randomInt(wrong.length)];
    return {
      prompt: { statement: question.prompt, claim: question.choices[shown] },
      answer: String(truthful),
    };
  },
};

export const BRAIN_STREAK_CONFIGS: Record<BrainStreakGame, BrainStreakConfig> = {
  "sequence-recall": SEQUENCE_RECALL_CONFIG,
  "quick-math": QUICK_MATH_CONFIG,
  "pattern-predictor": PATTERN_PREDICTOR_CONFIG,
  "trivia-blitz": TRIVIA_BLITZ_CONFIG,
};

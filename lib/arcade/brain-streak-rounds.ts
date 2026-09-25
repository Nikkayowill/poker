import "server-only";
import type { RandomInt } from "@/lib/game/deck";
import { TRIVIA_QUESTIONS } from "@/lib/pvp/trivia-questions";
import { BRAIN_STREAK_RULES, type BrainStreakConfig, type BrainStreakGame } from "./brain-streak";

/**
 * What each Brain Games streak round asks, and its answer. Server-only so the
 * answer banks never ship to the browser; the rules and ladders the client
 * needs live in lib/arcade/brain-streak.ts.
 */

const SEQUENCE_COLORS = 4;
const SEQUENCE_START_LENGTH = 3;

/** Sequence Recall: watch a growing flash pattern, repeat it back exactly. */
export const SEQUENCE_RECALL_CONFIG: BrainStreakConfig = {
  ...BRAIN_STREAK_RULES["sequence-recall"],
  nextRound: (score, randomInt) => {
    const length = SEQUENCE_START_LENGTH + score;
    const sequence = Array.from({ length }, () => randomInt(SEQUENCE_COLORS));
    return { prompt: { sequence, colors: SEQUENCE_COLORS }, answer: sequence.join(",") };
  },
};

const MATH_OPS = ["+", "-", "×"] as const;

/** Quick Math Sprint: sixty seconds, as many right answers as you can get. */
export const QUICK_MATH_CONFIG: BrainStreakConfig = {
  ...BRAIN_STREAK_RULES["quick-math"],
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
  ...BRAIN_STREAK_RULES["pattern-predictor"],
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
  nextRound: (_score, randomInt) => {
    const index = randomInt(TRIVIA_STATEMENTS.length + TRIVIA_QUESTIONS.length);
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

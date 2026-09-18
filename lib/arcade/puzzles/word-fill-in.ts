/**
 * Word Fill-In: a crossword-shaped grid, filled from a plain word list with
 * no clues. The only way in is length and intersecting letters, which is
 * also why nothing here can be solved by pasting a clue into a search box.
 *
 * The grid is generated, not guessed at. A template names which cells belong
 * to which word (a "strip": a run of cells, horizontal or vertical, length 3
 * or more), and `fillTemplate` backtracks real words into those strips so
 * every intersection agrees by construction. Unlike
 * lib/arcade/puzzles/minesweeper.ts, there is no separate "is this solvable"
 * pass after the fact -- a template that finishes filling *is* the solved
 * grid, so the search itself is the only validation this needs. Coverage is
 * also guaranteed by construction: an open cell is, by definition, a cell
 * some strip claims, so it can never end up outside every slot with no word
 * to give it a letter.
 *
 * Solution letters must never reach the browser while a round is live; see
 * `wordFillInView`, same rule minesweeper.ts states for mine positions.
 */

import { mulberry32 } from "@/lib/seeded-random";

export const GRID_SIZE = 9;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export type WordFillInRoundStatus = "active" | "solved" | "abandoned";

/** Why a guess cannot be made, or null if it can. */
export type WordFillInGuessProblem = "finished" | "out-of-bounds" | "black-cell" | "invalid-letter";

/* -------------------------------------------------------------- word list */

/**
 * Common, general-audience English words, 3-9 letters, no proper nouns. This
 * is the whole dictionary the generator ever draws from -- bucketed by
 * length below, since every slot only ever needs words of its own length.
 */
const RAW_WORDS: readonly string[] = [
  // 3
  "CAT", "DOG", "SUN", "RUN", "BIG", "RED", "TOP", "BOX", "CUP", "MAP",
  "BAT", "HAT", "PEN", "KEY", "LEG", "ARM", "EAR", "EYE", "JAW", "RIB",
  "TOE", "WEB", "ZOO", "BEE", "ANT", "OWL", "FOX", "COW", "PIG", "HEN",
  // 4
  "TREE", "BIRD", "FISH", "LAKE", "WIND", "RAIN", "SNOW", "STAR", "MOON", "ROCK",
  "SAND", "LEAF", "SEED", "ROOT", "VINE", "WOLF", "BEAR", "DEER", "GOAT", "LAMB",
  "MULE", "HAWK", "CROW", "DUCK", "SWAN", "FROG", "TOAD", "CRAB", "CLAM", "SHIP",
  "BOAT", "CAKE", "SOUP", "RICE", "BEEF", "MILK", "SALT", "BEAN", "CORN", "PEAR",
  "PLUM", "LIME", "MINT", "HERB", "WOOD", "IRON", "GOLD", "COAL", "FIRE",
  // 5
  "APPLE", "GRAPE", "LEMON", "MANGO", "MELON", "PEACH", "OCEAN", "RIVER", "STORM", "CLOUD",
  "EARTH", "PLANT", "GRASS", "STONE", "BRICK", "GLASS", "METAL", "PAPER", "CLOTH", "CHAIR",
  "TABLE", "HOUSE", "WATER", "BREAD", "PASTA", "SUGAR", "SPICE", "TOAST", "JUICE", "CREAM",
  "STEAK", "ONION", "MOUSE", "HORSE", "TIGER", "ZEBRA", "SNAKE", "WHALE", "SHARK", "EAGLE",
  "ROBIN", "TRAIN", "PLANE", "TRUCK", "WHEEL", "ROBOT", "MUSIC", "DANCE", "PAINT", "BRUSH",
  "QUEEN", "CROWN", "SWORD", "FIELD", "BEACH", "RIDGE", "CANOE",
  // 6
  "CHERRY", "FLOWER", "GARLIC", "PENCIL", "KNIGHT", "SHIELD", "FOREST", "VALLEY", "ISLAND", "BRIDGE",
  "CASTLE", "DRAGON", "WIZARD", "GOBLIN", "ANIMAL", "INSECT", "SPIDER", "BEETLE", "RABBIT", "TURTLE",
  "LIZARD", "PYTHON", "FALCON", "PIGEON", "PARROT", "TOUCAN", "SALMON", "GINGER", "PEPPER", "BUTTER",
  "CARROT", "POTATO", "TOMATO", "ORANGE", "BANANA", "WALNUT", "PEANUT",
  // 7
  "DOLPHIN", "PENGUIN", "SPARROW", "REPTILE", "CRICKET", "PANTHER", "LEOPARD", "GIRAFFE", "GORILLA", "HAMSTER",
  "RACCOON", "CHICKEN", "OSTRICH", "PELICAN", "HALIBUT", "LOBSTER", "CABBAGE", "PUMPKIN", "SPINACH", "AVOCADO",
  "APRICOT", "COCONUT", "PRETZEL", "BISCUIT", "POPCORN",
  // 8
  "ELEPHANT", "MACKEREL", "SANDWICH", "DINOSAUR", "ANTELOPE", "MOUNTAIN", "HOSPITAL", "AIRPLANE", "BASEBALL", "FOOTBALL",
  "CAMPFIRE", "SUNSHINE", "SNOWFALL", "DAUGHTER", "BIRTHDAY", "STAIRWAY", "DOORBELL", "KEYBOARD", "NOTEBOOK", "UMBRELLA",
  "MUSHROOM",
  // 9
  "BUTTERFLY", "CROCODILE", "WATERFALL", "RASPBERRY", "BLUEBERRY", "PINEAPPLE", "CHOCOLATE", "VEGETABLE", "TELEPHONE",
  "ADVENTURE", "SUBMARINE", "NEWSPAPER", "DIRECTION",
];

/** Deduplicated and bucketed by length; generation only ever reads this. */
const WORDS_BY_LENGTH: Readonly<Record<number, readonly string[]>> = (() => {
  const seen = new Set<string>();
  const buckets: Record<number, string[]> = {};
  for (const raw of RAW_WORDS) {
    const word = raw.toUpperCase();
    if (seen.has(word)) continue;
    seen.add(word);
    (buckets[word.length] ??= []).push(word);
  }
  return buckets;
})();

/* ------------------------------------------------------------- templates */

interface StripDef {
  orientation: "H" | "V";
  /** Row for a horizontal strip, column for a vertical one. */
  index: number;
  /** Column range for a horizontal strip, row range for a vertical one; inclusive. */
  start: number;
  end: number;
}

interface Template {
  readonly strips: readonly StripDef[];
}

interface Slot {
  /** Row-major cell indices this slot covers, in order. */
  readonly cells: readonly number[];
  readonly length: number;
}

/**
 * Three black-cell layouts, each a lattice of two long spine strips crossing
 * several short strips. Cells belong to a strip because a strip claims them
 * here, not because a scan of the grid found a gap of the right length, so a
 * template can never produce an open cell with nowhere to get a letter from.
 */
const TEMPLATES: readonly Template[] = [
  {
    strips: [
      { orientation: "H", index: 1, start: 0, end: 3 },
      { orientation: "H", index: 1, start: 5, end: 8 },
      { orientation: "H", index: 3, start: 0, end: 2 },
      { orientation: "H", index: 3, start: 4, end: 8 },
      { orientation: "H", index: 5, start: 0, end: 4 },
      { orientation: "H", index: 5, start: 6, end: 8 },
      { orientation: "H", index: 7, start: 0, end: 3 },
      { orientation: "H", index: 7, start: 5, end: 8 },
      { orientation: "V", index: 2, start: 0, end: 8 },
      { orientation: "V", index: 6, start: 0, end: 8 },
    ],
  },
  {
    strips: [
      { orientation: "H", index: 0, start: 0, end: 2 },
      { orientation: "H", index: 0, start: 4, end: 8 },
      { orientation: "H", index: 2, start: 0, end: 4 },
      { orientation: "H", index: 2, start: 6, end: 8 },
      { orientation: "H", index: 4, start: 0, end: 3 },
      { orientation: "H", index: 4, start: 5, end: 8 },
      { orientation: "H", index: 6, start: 0, end: 2 },
      { orientation: "H", index: 6, start: 4, end: 8 },
      { orientation: "H", index: 8, start: 0, end: 4 },
      { orientation: "H", index: 8, start: 6, end: 8 },
      { orientation: "V", index: 3, start: 0, end: 8 },
      { orientation: "V", index: 5, start: 0, end: 8 },
    ],
  },
  {
    strips: [
      { orientation: "H", index: 1, start: 0, end: 3 },
      { orientation: "H", index: 1, start: 5, end: 8 },
      { orientation: "H", index: 4, start: 0, end: 4 },
      { orientation: "H", index: 4, start: 6, end: 8 },
      { orientation: "H", index: 7, start: 0, end: 3 },
      { orientation: "H", index: 7, start: 5, end: 8 },
      { orientation: "V", index: 2, start: 1, end: 7 },
      { orientation: "V", index: 6, start: 1, end: 7 },
    ],
  },
];

export const TEMPLATE_COUNT = TEMPLATES.length;

function slotsForTemplate(template: Template): Slot[] {
  return template.strips.map((strip) => {
    const cells: number[] = [];
    for (let offset = strip.start; offset <= strip.end; offset += 1) {
      const row = strip.orientation === "H" ? strip.index : offset;
      const col = strip.orientation === "H" ? offset : strip.index;
      cells.push(row * GRID_SIZE + col);
    }
    return { cells, length: cells.length };
  });
}

/** '#' for black, '.' for open -- the shape of the grid, no letters yet. */
function patternStringFor(template: Template): string {
  const cells = new Array<string>(CELL_COUNT).fill("#");
  for (const slot of slotsForTemplate(template)) {
    for (const cell of slot.cells) cells[cell] = ".";
  }
  return cells.join("");
}

/** Same shape as the pattern, but open cells start blank rather than unknown. */
function blankGuessesFor(pattern: string): string {
  return pattern
    .split("")
    .map((cell) => (cell === "." ? "_" : "#"))
    .join("");
}

/** Slots placed first, since they are the hardest to satisfy later. */
function orderedSlotIndices(slots: readonly Slot[]): number[] {
  const cellUsage = new Map<number, number>();
  for (const slot of slots) {
    for (const cell of slot.cells) cellUsage.set(cell, (cellUsage.get(cell) ?? 0) + 1);
  }
  const crossingCount = slots.map(
    (slot) => slot.cells.filter((cell) => (cellUsage.get(cell) ?? 0) > 1).length,
  );
  return slots
    .map((_, index) => index)
    .sort((a, b) => crossingCount[b] - crossingCount[a] || slots[b].length - slots[a].length);
}

/**
 * How many backtracking steps to try before giving up on a template. The
 * template/word-list sizes here make failure essentially impossible, but a
 * cap still exists so a pathological seed can never hang the request; see
 * minesweeper.ts's MAX_LAYOUT_ATTEMPTS for the same reasoning.
 */
const MAX_BACKTRACK_STEPS = 20000;

/** Fills every slot with a word, or returns null if it ran out of budget. */
function fillTemplate(template: Template, seed: number): string | null {
  const slots = slotsForTemplate(template);
  const grid = patternStringFor(template).split("");
  const random = mulberry32(seed);
  const usedWords = new Set<string>();
  const order = orderedSlotIndices(slots);
  let steps = 0;

  function candidatesFor(slot: Slot): string[] {
    const pool = WORDS_BY_LENGTH[slot.length] ?? [];
    const matches = pool.filter((word) => {
      if (usedWords.has(word)) return false;
      for (let i = 0; i < slot.length; i += 1) {
        const current = grid[slot.cells[i]];
        if (current !== "." && current !== word[i]) return false;
      }
      return true;
    });
    // Fisher-Yates, seeded, so the same template fills differently per seed.
    for (let i = matches.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = matches[i];
      matches[i] = matches[j];
      matches[j] = tmp;
    }
    return matches;
  }

  function backtrack(position: number): boolean {
    steps += 1;
    if (steps > MAX_BACKTRACK_STEPS) return false;
    if (position >= order.length) return true;

    const slot = slots[order[position]];
    for (const word of candidatesFor(slot)) {
      const previous = slot.cells.map((cell) => grid[cell]);
      for (let i = 0; i < slot.length; i += 1) grid[slot.cells[i]] = word[i];
      usedWords.add(word);

      if (backtrack(position + 1)) return true;

      usedWords.delete(word);
      for (let i = 0; i < slot.length; i += 1) grid[slot.cells[i]] = previous[i];
    }
    return false;
  }

  return backtrack(0) ? grid.join("") : null;
}

function wordsUsed(solution: string, template: Template): string[] {
  return slotsForTemplate(template)
    .map((slot) => slot.cells.map((cell) => solution[cell]).join(""))
    .sort();
}

/* ------------------------------------------------------------------ round */

export interface WordFillInRound {
  seed: number;
  templateIndex: number;
  /** GRID_SIZE * GRID_SIZE characters: '#' black, '.' open. */
  pattern: string;
  /** GRID_SIZE * GRID_SIZE characters: '#' black, A-Z the answer letter. Never sent while active. */
  solution: string;
  /** GRID_SIZE * GRID_SIZE characters: '#' black, '_' blank, else the player's guessed letter. */
  guesses: string;
  /** Every word placed in the grid, sorted, with no positions -- that's the whole "no clue" mechanic. */
  words: string[];
  status: WordFillInRoundStatus;
  moves: number;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * A fresh, fully solved-behind-the-scenes grid. Tries each template in turn
 * (seeded so the choice and the fill are both reproducible); throwing only
 * happens if every template failed, which is a generation-time problem for
 * the caller to retry with a different seed, never a state a player reaches.
 */
export function startWordFillInRound(seed: number): WordFillInRound {
  const normalizedSeed = seed >>> 0;

  for (let offset = 0; offset < TEMPLATES.length; offset += 1) {
    const templateIndex = (normalizedSeed + offset) % TEMPLATES.length;
    const template = TEMPLATES[templateIndex];
    const fillSeed = (normalizedSeed ^ Math.imul(offset + 1, 0x9e3779b9)) >>> 0;
    const solution = fillTemplate(template, fillSeed);
    if (solution === null) continue;

    const pattern = patternStringFor(template);
    return {
      seed: normalizedSeed,
      templateIndex,
      pattern,
      solution,
      guesses: blankGuessesFor(pattern),
      words: wordsUsed(solution, template),
      status: "active",
      moves: 0,
      startedAt: null,
      endedAt: null,
    };
  }

  throw new Error("word fill-in: no template could be filled from the embedded word list");
}

function inBounds(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELL_COUNT;
}

export function wordFillInGuessProblem(
  round: WordFillInRound,
  index: number,
  letter: string,
): WordFillInGuessProblem | null {
  if (round.status !== "active") return "finished";
  if (!inBounds(index)) return "out-of-bounds";
  if (round.pattern[index] === "#") return "black-cell";
  if (typeof letter !== "string" || !/^[A-Za-z]$/.test(letter)) return "invalid-letter";
  return null;
}

export function isWordFillInSolved(pattern: string, guesses: string, solution: string): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === "#") continue;
    if (guesses[i] !== solution[i]) return false;
  }
  return true;
}

/**
 * Guesses one cell. A guess always overwrites whatever was there -- players
 * revise their own work constantly on a puzzle with no clues, so there is no
 * "must be empty" rule to get in the way of that.
 */
export function guessWordFillInCell(
  round: WordFillInRound,
  index: number,
  letter: string,
  now: Date,
): WordFillInRound {
  if (wordFillInGuessProblem(round, index, letter)) return round;

  const upper = letter.toUpperCase();
  const guesses = round.guesses.slice(0, index) + upper + round.guesses.slice(index + 1);
  const solved = isWordFillInSolved(round.pattern, guesses, round.solution);

  return {
    ...round,
    guesses,
    moves: round.moves + 1,
    startedAt: round.startedAt ?? now.toISOString(),
    status: solved ? "solved" : "active",
    endedAt: solved ? now.toISOString() : null,
  };
}

/* ------------------------------------------------------- word placement */

/** Why a word cannot go into a slot, or null if it can. */
export type WordFillInPlaceProblem = "finished" | "no-slot" | "not-in-list" | "wrong-length" | "no-change";

/** Why a slot cannot be cleared, or null if it can. */
export type WordFillInClearProblem = "finished" | "no-slot" | "already-empty";

/**
 * Every slot's cells, in the template's own order. Public: this is the grid's
 * shape, which the player already sees, and a slot index is what the client
 * sends to say where a word goes.
 */
export function wordFillInSlotCells(templateIndex: number): number[][] {
  const template = TEMPLATES[templateIndex];
  if (!template) return [];
  return slotsForTemplate(template).map((slot) => [...slot.cells]);
}

function slotAt(round: WordFillInRound, slotIndex: number): number[] | null {
  if (!Number.isInteger(slotIndex)) return null;
  return wordFillInSlotCells(round.templateIndex)[slotIndex] ?? null;
}

function slotWord(guesses: string, cells: readonly number[]): string {
  return cells.map((cell) => guesses[cell]).join("");
}

function slotFilled(guesses: string, cells: readonly number[]): boolean {
  return cells.every((cell) => /^[A-Z]$/.test(guesses[cell]));
}

/**
 * Solved when every slot spells a list word and the list is used exactly
 * once. Checked against the words rather than the stored solution, so a grid
 * that fits the list another way (two words that swap cleanly) still counts.
 */
export function isWordFillInFilledFromList(round: WordFillInRound, guesses: string): boolean {
  const slots = wordFillInSlotCells(round.templateIndex);
  if (slots.length !== round.words.length) return false;
  if (!slots.every((cells) => slotFilled(guesses, cells))) return false;
  const placed = slots.map((cells) => slotWord(guesses, cells)).sort();
  const wanted = [...round.words].sort();
  return placed.every((word, i) => word === wanted[i]);
}

/** Blanks a slot, except letters a different fully filled slot still uses. */
function clearedGuesses(round: WordFillInRound, guesses: string, slotIndex: number): string {
  const slots = wordFillInSlotCells(round.templateIndex);
  const keep = new Set<number>();
  slots.forEach((cells, index) => {
    if (index !== slotIndex && slotFilled(guesses, cells)) cells.forEach((cell) => keep.add(cell));
  });
  const next = guesses.split("");
  for (const cell of slots[slotIndex] ?? []) {
    if (!keep.has(cell)) next[cell] = "_";
  }
  return next.join("");
}

function withGuesses(round: WordFillInRound, guesses: string, now: Date): WordFillInRound {
  const solved = isWordFillInFilledFromList(round, guesses);
  return {
    ...round,
    guesses,
    moves: round.moves + 1,
    startedAt: round.startedAt ?? now.toISOString(),
    status: solved ? "solved" : "active",
    endedAt: solved ? now.toISOString() : null,
  };
}

export function wordFillInPlaceProblem(
  round: WordFillInRound,
  slotIndex: number,
  word: string,
): WordFillInPlaceProblem | null {
  if (round.status !== "active") return "finished";
  const cells = slotAt(round, slotIndex);
  if (!cells) return "no-slot";
  const upper = typeof word === "string" ? word.toUpperCase() : "";
  if (!round.words.includes(upper)) return "not-in-list";
  if (upper.length !== cells.length) return "wrong-length";
  if (slotWord(round.guesses, cells) === upper) return "no-change";
  return null;
}

/**
 * Drops a list word into a slot, overwriting whatever letters were there,
 * crossings included. A word already spelled out in another slot moves
 * rather than appearing twice.
 */
export function placeWordFillInWord(
  round: WordFillInRound,
  slotIndex: number,
  word: string,
  now: Date,
): WordFillInRound {
  if (wordFillInPlaceProblem(round, slotIndex, word)) return round;
  const upper = word.toUpperCase();
  const slots = wordFillInSlotCells(round.templateIndex);

  let guesses = round.guesses;
  const elsewhere = slots.findIndex(
    (cells, index) => index !== slotIndex && slotWord(guesses, cells) === upper,
  );
  if (elsewhere !== -1) guesses = clearedGuesses(round, guesses, elsewhere);

  const next = guesses.split("");
  slots[slotIndex].forEach((cell, i) => {
    next[cell] = upper[i];
  });
  return withGuesses(round, next.join(""), now);
}

export function wordFillInClearProblem(
  round: WordFillInRound,
  slotIndex: number,
): WordFillInClearProblem | null {
  if (round.status !== "active") return "finished";
  const cells = slotAt(round, slotIndex);
  if (!cells) return "no-slot";
  if (clearedGuesses(round, round.guesses, slotIndex) === round.guesses) return "already-empty";
  return null;
}

/** Empties a slot, keeping any crossing letter another filled slot still needs. */
export function clearWordFillInSlot(round: WordFillInRound, slotIndex: number, now: Date): WordFillInRound {
  if (wordFillInClearProblem(round, slotIndex)) return round;
  return withGuesses(round, clearedGuesses(round, round.guesses, slotIndex), now);
}

/** Gives up. The round ends unsolved, same shape resignMinesweeperRound leaves a board in. */
export function resignWordFillInRound(round: WordFillInRound, now: Date): WordFillInRound {
  if (round.status !== "active") return round;
  return {
    ...round,
    status: "abandoned",
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: now.toISOString(),
  };
}

export interface WordFillInView {
  templateIndex: number;
  pattern: string;
  status: WordFillInRoundStatus;
  guesses: string;
  words: string[];
  /** Each slot's cells, row-major indices; the grid's shape, never its letters. */
  slots: number[][];
  /** Only present once the round is over; null while it is still live. */
  solution: string | null;
  moves: number;
  startedAt: string | null;
  endedAt: string | null;
}

/** The only shape the browser may see. Solution letters wait for the round to end. */
export function wordFillInView(round: WordFillInRound): WordFillInView {
  const over = round.status !== "active";
  return {
    templateIndex: round.templateIndex,
    pattern: round.pattern,
    status: round.status,
    guesses: round.guesses,
    words: round.words,
    slots: wordFillInSlotCells(round.templateIndex),
    solution: over ? round.solution : null,
    moves: round.moves,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
  };
}

/** Milliseconds from the first guess to the last, or to `now` while live. */
export function wordFillInElapsedMs(round: WordFillInRound, now: Date): number {
  if (!round.startedAt) return 0;
  const end = round.endedAt ? Date.parse(round.endedAt) : now.getTime();
  return Math.max(0, end - Date.parse(round.startedAt));
}

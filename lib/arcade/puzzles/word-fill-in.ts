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
import { clearedSlotGuesses, placedSlotGuesses, slotFilled, slotWord } from "./word-fill-in-grid";

/** The regular grid's side. A large grid is LARGE_GRID_SIZE; a round's own size comes from its template. */
export const GRID_SIZE = 9;
export const LARGE_GRID_SIZE = 11;

/** Which pool of templates a round draws from. */
export type WordFillInGridKind = "regular" | "large";

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
  "ACE", "AIR", "APE", "ASH", "AXE", "BAG", "BED", "BUS", "CAN", "CAP",
  "CAR", "DEN", "DEW", "EGG", "ELF", "ELK", "ELM", "EMU", "FAN", "FIG",
  "FIN", "FOG", "GEM", "HAM", "HUT", "ICE", "INK", "JAM", "JAR", "JET",
  "LID", "LOG", "MAT", "MUD", "MUG", "NET", "NUT", "OAK", "OAR", "PAN",
  "PEA", "PIE", "PIN", "POT", "RAT", "SEA", "SKY", "TEA", "TIN", "TOY",
  "TUB", "VAN", "WAX", "YAK", "YAM",
  // 4
  "TREE", "BIRD", "FISH", "LAKE", "WIND", "RAIN", "SNOW", "STAR", "MOON", "ROCK",
  "SAND", "LEAF", "SEED", "ROOT", "VINE", "WOLF", "BEAR", "DEER", "GOAT", "LAMB",
  "MULE", "HAWK", "CROW", "DUCK", "SWAN", "FROG", "TOAD", "CRAB", "CLAM", "SHIP",
  "BOAT", "CAKE", "SOUP", "RICE", "BEEF", "MILK", "SALT", "BEAN", "CORN", "PEAR",
  "PLUM", "LIME", "MINT", "HERB", "WOOD", "IRON", "GOLD", "COAL", "FIRE",
  "BARN", "BELL", "BIKE", "BONE", "BOOK", "BOOT", "BOWL", "CAMP", "CAVE", "COAT",
  "DESK", "DISH", "DOOR", "DRUM", "FARM", "FERN", "FLAG", "FORK", "GATE", "GIFT",
  "HARP", "HILL", "HIVE", "HOOK", "HORN", "KITE", "KNOT", "LAMP", "LOAF", "LOCK",
  "MAZE", "MOSS", "NEST", "OVEN", "PALM", "PARK", "PEAK", "POND", "POOL", "ROAD",
  "ROPE", "ROSE", "SAIL", "SEAL", "SOAP", "SOCK", "TENT", "TIDE", "TOWN", "TUNA",
  "VASE", "WAVE", "WELL", "WING", "YARN",
  // 5
  "APPLE", "GRAPE", "LEMON", "MANGO", "MELON", "PEACH", "OCEAN", "RIVER", "STORM", "CLOUD",
  "EARTH", "PLANT", "GRASS", "STONE", "BRICK", "GLASS", "METAL", "PAPER", "CLOTH", "CHAIR",
  "TABLE", "HOUSE", "WATER", "BREAD", "PASTA", "SUGAR", "SPICE", "TOAST", "JUICE", "CREAM",
  "STEAK", "ONION", "MOUSE", "HORSE", "TIGER", "ZEBRA", "SNAKE", "WHALE", "SHARK", "EAGLE",
  "ROBIN", "TRAIN", "PLANE", "TRUCK", "WHEEL", "ROBOT", "MUSIC", "DANCE", "PAINT", "BRUSH",
  "QUEEN", "CROWN", "SWORD", "FIELD", "BEACH", "RIDGE", "CANOE",
  "ACORN", "ALARM", "ARROW", "BACON", "BADGE", "BENCH", "BERRY", "BLOCK", "CABIN", "CAMEL",
  "CANDY", "CHALK", "CHESS", "CLOCK", "CORAL", "CRANE", "DAISY", "DRESS", "FEAST", "FENCE",
  "FERRY", "FLAME", "FLOUR", "FROST", "GHOST", "GLOVE", "HONEY", "JEWEL", "KOALA", "LLAMA",
  "MAPLE", "MARSH", "MEDAL", "OLIVE", "OTTER", "PANDA", "PIANO", "PIZZA", "PLATE", "QUILT",
  "RADIO", "SALAD", "SCARF", "SHELL", "SHIRT", "SKATE", "SLIDE", "SPOON", "STOOL", "TOWEL",
  "TOWER", "TRAIL", "WAGON", "YACHT",
  // 6
  "CHERRY", "FLOWER", "GARLIC", "PENCIL", "KNIGHT", "SHIELD", "FOREST", "VALLEY", "ISLAND", "BRIDGE",
  "CASTLE", "DRAGON", "WIZARD", "GOBLIN", "ANIMAL", "INSECT", "SPIDER", "BEETLE", "RABBIT", "TURTLE",
  "LIZARD", "PYTHON", "FALCON", "PIGEON", "PARROT", "TOUCAN", "SALMON", "GINGER", "PEPPER", "BUTTER",
  "CARROT", "POTATO", "TOMATO", "ORANGE", "BANANA", "WALNUT", "PEANUT",
  "ANCHOR", "BASKET", "BOTTLE", "BUCKET", "BUTTON", "CANDLE", "CANYON", "CARPET", "CIRCUS", "COOKIE",
  "COTTON", "DONKEY", "GARDEN", "GUITAR", "HAMMER", "HELMET", "JACKET", "JUNGLE", "KETTLE", "KITTEN",
  "LADDER", "MAGNET", "MEADOW", "MIRROR", "MUFFIN", "NAPKIN", "PADDLE", "PEBBLE", "PICNIC", "PILLOW",
  "PLANET", "POCKET", "PUPPET", "ROCKET", "SADDLE", "SHOVEL", "SPONGE", "TICKET", "TUNNEL", "VIOLIN",
  "WINDOW", "WINTER", "ZIPPER",
  // 7
  "DOLPHIN", "PENGUIN", "SPARROW", "REPTILE", "CRICKET", "PANTHER", "LEOPARD", "GIRAFFE", "GORILLA", "HAMSTER",
  "RACCOON", "CHICKEN", "OSTRICH", "PELICAN", "HALIBUT", "LOBSTER", "CABBAGE", "PUMPKIN", "SPINACH", "AVOCADO",
  "APRICOT", "COCONUT", "PRETZEL", "BISCUIT", "POPCORN",
  "BLANKET", "CAPTAIN", "CARAVAN", "CEILING", "CHIMNEY", "COMPASS", "CRYSTAL", "CUPCAKE", "CURTAIN", "DIAMOND",
  "FEATHER", "GLACIER", "HARVEST", "JOURNEY", "KITCHEN", "LANTERN", "LIBRARY", "MONSTER", "OCTOPUS", "ORCHARD",
  "PAINTER", "PYRAMID", "RAINBOW", "SAUSAGE", "SCOOTER", "SHELTER", "TEACHER", "THUNDER", "TRACTOR", "TRUMPET",
  "VOLCANO", "WEATHER", "WHISTLE",
  // 8
  "ELEPHANT", "MACKEREL", "SANDWICH", "DINOSAUR", "ANTELOPE", "MOUNTAIN", "HOSPITAL", "AIRPLANE", "BASEBALL", "FOOTBALL",
  "CAMPFIRE", "SUNSHINE", "SNOWFALL", "DAUGHTER", "BIRTHDAY", "STAIRWAY", "DOORBELL", "KEYBOARD", "NOTEBOOK", "UMBRELLA",
  "MUSHROOM",
  "BACKPACK", "BLIZZARD", "CHAMPION", "COMPUTER", "CUCUMBER", "DOORSTEP", "FIREWORK", "HAYSTACK", "HEDGEHOG", "HOMEWORK",
  "KANGAROO", "LEMONADE", "MEATBALL", "PAINTING", "RAINCOAT", "SEASHELL", "SKELETON", "SNOWBALL", "SQUIRREL", "STARFISH",
  "TOMORROW", "TREASURE", "VACATION", "WOODLAND",
  // 9
  "BUTTERFLY", "CROCODILE", "WATERFALL", "RASPBERRY", "BLUEBERRY", "PINEAPPLE", "CHOCOLATE", "VEGETABLE", "TELEPHONE",
  "ADVENTURE", "SUBMARINE", "NEWSPAPER", "DIRECTION",
  "DRAGONFLY", "JELLYFISH", "SUNFLOWER", "SNOWFLAKE", "HAMBURGER", "SCARECROW", "SPACESHIP", "BUMBLEBEE", "FIREPLACE", "GRASSLAND",
  "LANDSCAPE", "LIGHTNING", "PORCUPINE", "SNOWSTORM", "BOOKSHELF", "CORNFIELD", "HAIRBRUSH", "NIGHTFALL",
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
  readonly size: number;
  readonly strips: readonly StripDef[];
}

interface Slot {
  /** Row-major cell indices this slot covers, in order. */
  readonly cells: readonly number[];
  readonly length: number;
}

/**
 * The regular grids: three black-cell layouts, each a lattice of two long spine strips crossing
 * several short strips. Cells belong to a strip because a strip claims them
 * here, not because a scan of the grid found a gap of the right length, so a
 * template can never produce an open cell with nowhere to get a letter from.
 */
const REGULAR_TEMPLATES: readonly Template[] = [
  {
    size: GRID_SIZE,
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
    size: GRID_SIZE,
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
    size: GRID_SIZE,
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

/**
 * Reads a grid drawn as rows of '.' (open) and '#' (black). Every run of
 * three or more open cells, across or down, is a word. A run of exactly two,
 * or an open cell no word covers, is a drawing mistake and throws at load.
 */
function templateFromRows(rows: readonly string[]): Template {
  const size = rows.length;
  const open = (row: number, col: number) =>
    row >= 0 && row < size && col >= 0 && col < size && rows[row][col] === ".";
  const strips: StripDef[] = [];
  const covered = new Set<number>();
  for (const orientation of ["H", "V"] as const) {
    for (let index = 0; index < size; index += 1) {
      let start = -1;
      for (let offset = 0; offset <= size; offset += 1) {
        const isOpen = orientation === "H" ? open(index, offset) : open(offset, index);
        if (isOpen && start === -1) start = offset;
        if (!isOpen && start !== -1) {
          const length = offset - start;
          if (length === 2) throw new Error(`word fill-in template: two-cell run at ${orientation}${index}:${start}`);
          if (length >= 3) {
            strips.push({ orientation, index, start, end: offset - 1 });
            for (let cell = start; cell < offset; cell += 1) {
              covered.add(orientation === "H" ? index * size + cell : cell * size + index);
            }
          }
          start = -1;
        }
      }
    }
  }
  rows.forEach((line, row) => {
    if (line.length !== size) throw new Error("word fill-in template: rows must be square");
    for (let col = 0; col < size; col += 1) {
      if (open(row, col) && !covered.has(row * size + col)) {
        throw new Error(`word fill-in template: open cell ${row},${col} is in no word`);
      }
    }
  });
  return { size, strips };
}

/** The same drawing turned a quarter turn clockwise. */
function rotated(rows: readonly string[]): string[] {
  const size = rows.length;
  return rows.map((_, row) =>
    Array.from({ length: size }, (_unused, col) => rows[size - 1 - col][row]).join(""),
  );
}

/** The same drawing mirrored left to right. */
function mirrored(rows: readonly string[]): string[] {
  return rows.map((line) => line.split("").reverse().join(""));
}

/**
 * Marathon grids: 11x11 with sixteen words and sixteen crossings, against
 * eight to twelve words on a regular grid. Three or four long down words
 * each cross five across words, so a wrong guess shows up as a clash in
 * several places at once instead of one, and every length comes in groups
 * big enough that a word can't be placed by its length alone.
 */
const LARGE_SPINES: readonly string[] = [
  ".....#.....",
  "#.#######.#",
  ".......#...",
  "#.###.###.#",
  "....#......",
  "#.###.###.#",
  "...#.......",
  "#.###.#####",
  "......#....",
  "#####.###.#",
  "....#......",
];

const LARGE_OFFSET: readonly string[] = [
  "......#....",
  "###.######.",
  "....#......",
  "###.###.##.",
  "#.....#....",
  "###.###.###",
  "......#....",
  ".##.###.###",
  ".....#.....",
  ".######.###",
  "...#.......",
];

const LARGE_TEMPLATES: readonly Template[] = [
  templateFromRows(LARGE_SPINES),
  templateFromRows(LARGE_OFFSET),
  templateFromRows(rotated(rotated(rotated(LARGE_SPINES)))),
  templateFromRows(mirrored(LARGE_OFFSET)),
];

/**
 * Every template, regular first. A round stores its index into this list, so
 * the regular three keep indices 0-2 and rounds stored before large grids
 * existed still find their shape.
 */
const TEMPLATES: readonly Template[] = [...REGULAR_TEMPLATES, ...LARGE_TEMPLATES];

/** How many regular templates there are; regular rounds use indices below this. */
export const TEMPLATE_COUNT = REGULAR_TEMPLATES.length;
export const LARGE_TEMPLATE_COUNT = LARGE_TEMPLATES.length;

function templatePool(kind: WordFillInGridKind): { first: number; count: number } {
  return kind === "large"
    ? { first: REGULAR_TEMPLATES.length, count: LARGE_TEMPLATES.length }
    : { first: 0, count: REGULAR_TEMPLATES.length };
}

/** The side of the grid a template draws. Unknown indices read as regular. */
export function wordFillInTemplateSize(templateIndex: number): number {
  return TEMPLATES[templateIndex]?.size ?? GRID_SIZE;
}

function slotsForTemplate(template: Template): Slot[] {
  return template.strips.map((strip) => {
    const cells: number[] = [];
    for (let offset = strip.start; offset <= strip.end; offset += 1) {
      const row = strip.orientation === "H" ? strip.index : offset;
      const col = strip.orientation === "H" ? offset : strip.index;
      cells.push(row * template.size + col);
    }
    return { cells, length: cells.length };
  });
}

/** '#' for black, '.' for open -- the shape of the grid, no letters yet. */
function patternStringFor(template: Template): string {
  const cells = new Array<string>(template.size * template.size).fill("#");
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

/**
 * How many backtracking steps to try before giving up on a template. Failure
 * is rare with the word list this size, but a cap still exists so a
 * pathological seed can never hang the request; see minesweeper.ts's
 * MAX_LAYOUT_ATTEMPTS for the same reasoning.
 */
const MAX_BACKTRACK_STEPS = 20000;

/**
 * Fills every slot with a word, or returns null if it ran out of budget.
 * Always fills whichever open slot has the fewest words left that fit, and
 * backs off as soon as any slot has none. The large grids need that; a fixed
 * order stalls on their long crossing words.
 */
function fillTemplate(template: Template, seed: number): string | null {
  const slots = slotsForTemplate(template);
  const grid = patternStringFor(template).split("");
  const random = mulberry32(seed);
  const usedWords = new Set<string>();
  const done = slots.map(() => false);
  let steps = 0;

  function fitting(slot: Slot): string[] {
    const pool = WORDS_BY_LENGTH[slot.length] ?? [];
    return pool.filter((word) => {
      if (usedWords.has(word)) return false;
      for (let i = 0; i < slot.length; i += 1) {
        const current = grid[slot.cells[i]];
        if (current !== "." && current !== word[i]) return false;
      }
      return true;
    });
  }

  function backtrack(remaining: number): boolean {
    steps += 1;
    if (steps > MAX_BACKTRACK_STEPS) return false;
    if (remaining === 0) return true;

    let pick = -1;
    let candidates: string[] = [];
    for (let index = 0; index < slots.length; index += 1) {
      if (done[index]) continue;
      const matches = fitting(slots[index]);
      if (matches.length === 0) return false;
      if (pick === -1 || matches.length < candidates.length) {
        pick = index;
        candidates = matches;
      }
    }
    // Fisher-Yates, seeded, so the same template fills differently per seed.
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const slot = slots[pick];
    for (const word of candidates) {
      const previous = slot.cells.map((cell) => grid[cell]);
      for (let i = 0; i < slot.length; i += 1) grid[slot.cells[i]] = word[i];
      usedWords.add(word);
      done[pick] = true;

      if (backtrack(remaining - 1)) return true;

      done[pick] = false;
      usedWords.delete(word);
      for (let i = 0; i < slot.length; i += 1) grid[slot.cells[i]] = previous[i];
    }
    return false;
  }

  return backtrack(slots.length) ? grid.join("") : null;
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
  /** size * size characters (size from the template): '#' black, '.' open. */
  pattern: string;
  /** Same length as the pattern: '#' black, A-Z the answer letter. Never sent while active. */
  solution: string;
  /** Same length as the pattern: '#' black, '_' blank, else the player's guessed letter. */
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
export function startWordFillInRound(seed: number, kind: WordFillInGridKind = "regular"): WordFillInRound {
  const normalizedSeed = seed >>> 0;
  const pool = templatePool(kind);

  for (let offset = 0; offset < pool.count; offset += 1) {
    const templateIndex = pool.first + ((normalizedSeed + offset) % pool.count);
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

function inBounds(round: WordFillInRound, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < round.pattern.length;
}

export function wordFillInGuessProblem(
  round: WordFillInRound,
  index: number,
  letter: string,
): WordFillInGuessProblem | null {
  if (round.status !== "active") return "finished";
  if (!inBounds(round, index)) return "out-of-bounds";
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

function clearedGuesses(round: WordFillInRound, guesses: string, slotIndex: number): string {
  return clearedSlotGuesses(guesses, wordFillInSlotCells(round.templateIndex), slotIndex);
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
  const slots = wordFillInSlotCells(round.templateIndex);
  return withGuesses(round, placedSlotGuesses(round.guesses, slots, slotIndex, word.toUpperCase()), now);
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
  /** The grid's side, from its template. */
  size: number;
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
    size: wordFillInTemplateSize(round.templateIndex),
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

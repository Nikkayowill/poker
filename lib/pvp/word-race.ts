/**
 * Word Race -- the same scrambled word to both players, first to solve it wins
 * the round.
 *
 * Simultaneous, not turn-based: `applyMove` accepts a guess from either seat at
 * any moment, which the contract explicitly allows for and which is why the
 * money layer never asks whose turn it is. There is no turn order here to
 * enforce, only a clock and a lockout.
 *
 * ## Where the secret lives
 *
 * The state holds five solutions from the moment the match is created, because
 * drawing them lazily would mean the seed alone no longer determines the match
 * and a resumed row could not be replayed. Everything below therefore hangs off
 * one rule: `snapshot` is the only thing a browser ever sees, and it emits a
 * round's `word` only once that round has ENDED. Not blanked, not nulled --
 * absent, so a network tab shows no key to be curious about. Rounds that have
 * not started yet do not appear in a snapshot at all, in any form, since a
 * player who knew round four's word would spend round three practising it.
 *
 * That is the same boundary lib/arcade/puzzles/word-stack.ts draws around its
 * answer, and for the same reason: a solution in the payload is not an exotic
 * attack, it is the first thing a curious player tries -- and this one decides
 * a real Gold payout rather than a share grid.
 *
 * ## The clock
 *
 * `tick` owns every deadline. Two players who are both stuck must not stall the
 * match, and two players who have both closed the tab must not leave a row
 * live forever, so a round times out into a push and the series continues on
 * its own. It returns null -- meaning nothing changed -- on every call that
 * does not cross a deadline, which is nearly all of them: the shell polls every
 * two seconds, and a tick that returned a fresh object each time would bump the
 * stored version on every poll and livelock both players' concurrency guard.
 */

import { defineDuelGame, otherSeat, type DuelOutcome, type DuelSeat } from "./match-contract";
import { WORD_RACE_WORDS } from "./word-race-words";
import { WORD_RACE_REVEAL_MS, WORD_RACE_ROUND_MS } from "./word-race-timing";

/* ------------------------------------------------------------- constants */

/**
 * Rounds in the series. Odd on purpose: an even count draws far too often for a
 * game whose whole appeal is that one of you was faster, and a draw refunds
 * both players rather than settling anything. Five is long enough that one
 * lucky read does not decide it and short enough to finish inside a couple of
 * minutes.
 */
export const WORD_RACE_ROUNDS = 5;

/**
 * The two clock constants live in ./word-race-timing and are re-exported here
 * so the engine and its tests keep one import.
 *
 * They are NOT declared in this file because the board needs them and this
 * file imports the (server-only) bank -- pulling it in to read a number would
 * ship all 478 words to the browser, which is a lookup table for the game.
 * See that module's header. A board must import them from there, never from
 * here.
 */
export { WORD_RACE_REVEAL_MS, WORD_RACE_ROUND_MS } from "./word-race-timing";

/**
 * How long a wrong guess costs the guesser.
 *
 * Without it the game is won by whoever can post the most requests per second:
 * a five-letter scramble has 120 arrangements, which a script exhausts in under
 * a second, and typing the answer would then be strictly worse than not
 * reading it. A second and a half is short enough to be a hesitation for a
 * human who mistyped and long enough that brute force cannot outrun thought --
 * 30 seconds buys at most twenty attempts.
 */
export const WORD_RACE_LOCKOUT_MS = 1_500;

/**
 * The beat between rounds, showing the answer and who got there first.
 *
 * This is also the only window in which a solution is allowed out of the
 * server. Without it the next scramble replaces the last one instantly and a
 * player who lost the round never learns what the word was, which reads as the
 * game cheating rather than as losing.
 *
 * Declared in ./word-race-timing and re-exported at the top of this file.
 */

/* ----------------------------------------------------------------- state */

/**
 * One round. `word` is the secret; everything else here is public once the
 * round has opened.
 *
 * Plain numbers and strings throughout -- the whole state round-trips through a
 * jsonb column and structuredClone, so a Map, a Set or an undefined would
 * either fail to store or come back as something subtly different.
 */
export interface WordRaceRound {
  /** The solution, lowercase. Never leaves the server before `endedAt`. */
  word: string;
  /** The same letters, shuffled. Seeded, and never equal to `word`. */
  scramble: string;
  hint: string;
  /** When this round opened, ms since epoch. */
  startedAt: number;
  /** Who solved it, or null for a push. */
  solvedBy: DuelSeat | null;
  /** When it ended -- solved or timed out. Null while it is live. */
  endedAt: number | null;
}

export interface WordRaceState {
  /** All five rounds, drawn from the seed when the match was created. */
  rounds: WordRaceRound[];
  /** Which round is on screen. Never runs past the last one -- see advance(). */
  index: number;
  /**
   * Each seat's guesses THIS round, oldest first, indexed by seat.
   *
   * Bounded without a cap: a seat cannot guess again until its lockout expires,
   * so a 30-second round admits about twenty entries per player.
   */
  guesses: [string[], string[]];
  /** Each seat's lockout expiry in ms since epoch; 0 means free to guess. */
  lockedUntil: [number, number];
  /** Rounds won, indexed by seat. */
  wins: [number, number];
  /** The seat that walked away, if either did. */
  resigned: DuelSeat | null;
  resignedAt: number | null;
}

/** A guess. The only move this game has. */
export interface WordRaceMove {
  guess: string;
}

/* ------------------------------------------------------------------- rng */

/**
 * mulberry32 -- a small seeded PRNG.
 *
 * The point is not statistical quality, it is that nothing here calls
 * Math.random(). The contract's determinism note applies with full force to
 * this game: the words AND their scrambles both come out of the seed, so a
 * match can be replayed from its stored row, a test can pin an exact board, and
 * -- the part that matters for money -- the client is handed no way to work out
 * what is coming.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffles a word's letters.
 *
 * Fisher-Yates, then a rescue: a shuffle is allowed to land back on the word
 * itself, and showing a player the answer already spelled out is not a round.
 * The rescue swaps the first letter with the first one that differs from it,
 * which is guaranteed to produce a different string for any word with at least
 * two distinct letters -- and the bank has no word without.
 */
export function scrambleWord(word: string, random: () => number): string {
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  if (letters.join("") !== word) return letters.join("");

  const different = letters.findIndex((letter) => letter !== letters[0]);
  if (different <= 0) return letters.join("");
  [letters[0], letters[different]] = [letters[different], letters[0]];
  return letters.join("");
}

/* -------------------------------------------------------------- guessing */

/**
 * A guess as the engine compares it.
 *
 * All whitespace goes, not just the ends: a player typing at speed sends
 * " CAT " and sometimes "c at", and losing Gold to a space bar is not the
 * skill this game is testing. Case follows for the same reason.
 */
export function normalizeWordRaceGuess(guess: string): string {
  return guess.replace(/\s+/g, "").toLowerCase();
}

/* ------------------------------------------------------------ the clock */

/** The round on screen. Always a real round -- `index` never runs off the end. */
function currentRound(state: WordRaceState): WordRaceRound {
  return state.rounds[state.index];
}

/** Rounds that have finished, solved or pushed. They run in order, so this counts them. */
function roundsPlayed(state: WordRaceState): number {
  return state.index + (currentRound(state).endedAt === null ? 0 : 1);
}

/**
 * Whether the series can still change hands.
 *
 * The lead being bigger than the number of rounds left is what ends a match at
 * 3-0 rather than playing two rounds nobody can win -- the same courtesy a
 * best-of-five is normally played with, and cheap to get right because both
 * halves are already counted.
 */
export function wordRaceDecided(state: WordRaceState): boolean {
  if (state.resigned !== null) return true;
  const left = state.rounds.length - roundsPlayed(state);
  if (left === 0) return true;
  return Math.abs(state.wins[0] - state.wins[1]) > left;
}

/** A structural copy. Every nested value here is a plain array of primitives. */
function cloneState(state: WordRaceState): WordRaceState {
  return {
    ...state,
    rounds: state.rounds.map((round) => ({ ...round })),
    guesses: [[...state.guesses[0]], [...state.guesses[1]]],
    lockedUntil: [state.lockedUntil[0], state.lockedUntil[1]],
    wins: [state.wins[0], state.wins[1]],
  };
}

/**
 * Applies every deadline that has passed, or returns null if none has.
 *
 * Loops, because a match nobody has read for two minutes has several deadlines
 * behind it and must come back consistent rather than one step further along.
 * Each round's clock starts from the previous round's exact end rather than
 * from `now`, so a slow poll cannot hand the players extra time and a replay
 * from the stored row lands on the same result.
 */
function advance(state: WordRaceState, now: number): WordRaceState | null {
  let next: WordRaceState | null = null;
  // Every pass either times a round out or opens the next one, and there are
  // only so many of each -- the bound is belt and braces against a clock that
  // goes backwards.
  for (let pass = 0; pass < state.rounds.length * 2 + 2; pass += 1) {
    const working = next ?? state;
    if (wordRaceDecided(working)) break;

    const round = currentRound(working);
    if (round.endedAt === null) {
      const deadline = round.startedAt + WORD_RACE_ROUND_MS;
      if (now < deadline) break;
      // A push: the round ends with solvedBy still null and neither score moves.
      next = cloneState(working);
      next.rounds[next.index].endedAt = deadline;
      continue;
    }

    const opensAt = round.endedAt + WORD_RACE_REVEAL_MS;
    if (now < opensAt) break;
    next = cloneState(working);
    next.index += 1;
    next.rounds[next.index].startedAt = opensAt;
    next.guesses = [[], []];
    next.lockedUntil = [0, 0];
  }
  return next;
}

/* --------------------------------------------------------------- viewing */

/** The current round as a viewer may see it. `word` is absent until the reveal. */
export interface WordRaceRoundView {
  /** 1-based, for "Round 2 of 5". */
  number: number;
  scramble: string;
  hint: string;
  /** How many letters the answer has. Redundant with the scramble, and the input uses it. */
  length: number;
  /** "playing" while the clock runs, "reveal" once the round has ended. */
  phase: "playing" | "reveal";
  /** Milliseconds left in the CURRENT phase, derived from `now`. */
  remainingMs: number;
  solvedBy: DuelSeat | null;
  /**
   * The answer.
   *
   * Optional in the type and genuinely ABSENT from the object while the round
   * is live -- not null, not empty. A key that is always present and sometimes
   * filled is an invitation to check whether it is ever filled early; a key
   * that is not there says there is nothing to find.
   */
  word?: string;
}

export interface WordRaceSnapshot {
  totalRounds: number;
  /** Rounds won, indexed by seat, so a board can label either side. */
  wins: [number, number];
  round: WordRaceRoundView;
  /**
   * The viewer's OWN guesses this round, oldest first. Empty for a spectator,
   * who has no own.
   */
  yourGuesses: string[];
  /** Milliseconds until the viewer may guess again; 0 when free. */
  yourLockoutMs: number;
  /**
   * How many guesses the opponent has spent this round -- and nothing about
   * what they were. The count is real tension and leaks nothing: it says
   * somebody is close, not what they typed.
   */
  opponentGuesses: number;
  /** Whether the opponent is serving a lockout right now. Same argument. */
  opponentLocked: boolean;
  /** Finished rounds only, so their words are already public. */
  history: Array<{ number: number; word: string; solvedBy: DuelSeat | null }>;
  finished: boolean;
}

/* ------------------------------------------------------------ the engine */

export const WORD_RACE_DUEL = defineDuelGame<WordRaceState, WordRaceMove, WordRaceSnapshot>({
  id: "word-race",
  label: "Word Race",

  createState(seed, now) {
    const random = mulberry32(seed);
    const rounds: WordRaceRound[] = [];
    const drawn = new Set<number>();

    while (rounds.length < WORD_RACE_ROUNDS) {
      const pick = Math.floor(random() * WORD_RACE_WORDS.length);
      // Distinct words only: the same scramble twice in one match reads as a
      // bug even though it is a fair draw, and the bank is large enough that
      // rejecting a repeat costs nothing.
      if (drawn.has(pick)) continue;
      drawn.add(pick);
      const entry = WORD_RACE_WORDS[pick];
      rounds.push({
        word: entry.word,
        scramble: scrambleWord(entry.word, random),
        hint: entry.hint,
        // Only round one is live at the start; the rest are stamped as they
        // open, from the previous round's end rather than from a wall clock.
        startedAt: rounds.length === 0 ? now : 0,
        solvedBy: null,
        endedAt: null,
      });
    }

    return {
      rounds,
      index: 0,
      guesses: [[], []],
      lockedUntil: [0, 0],
      wins: [0, 0],
      resigned: null,
      resignedAt: null,
    };
  },

  applyMove(state, seat, move, now) {
    // Deadlines first, on the state as stored: a guess that arrives a
    // millisecond after a round timed out must be judged against the round it
    // actually landed in, not the one the row still remembers.
    const current = advance(state, now) ?? state;

    if (wordRaceDecided(current)) return { reject: "This match is over." };

    const round = currentRound(current);
    if (round.endedAt !== null) return { reject: "That round is over -- the next one is coming." };
    if (now < current.lockedUntil[seat]) return { reject: "Wait a moment before guessing again." };

    // Typed as a string and shape-checked by the route, but re-checked here
    // because this is where a claim becomes a state change -- the contract's
    // words, and the reason the engine is the last line rather than the first.
    const guess = normalizeWordRaceGuess(typeof move?.guess === "string" ? move.guess : "");
    // Rejected rather than counted as wrong, and deliberately without a
    // lockout: an empty box or a stray keystroke carries no information about
    // the answer, so charging a second and a half for it would punish a slip
    // rather than brute force.
    if (!/^[a-z]+$/.test(guess)) return { reject: "Letters only." };

    const next = cloneState(current);
    next.guesses[seat] = [...next.guesses[seat], guess];

    if (guess === round.word) {
      next.rounds[next.index].solvedBy = seat;
      next.rounds[next.index].endedAt = now;
      next.wins[seat] += 1;
      return { next };
    }

    // Wrong, and that is all it is -- the round stays open and they may try
    // again. A rearrangement that happens to be another real word is simply
    // wrong too: this engine has no dictionary and inventing one to accept
    // alternates would be a rule nobody could check.
    next.lockedUntil[seat] = now + WORD_RACE_LOCKOUT_MS;
    return { next };
  },

  tick(state, now) {
    return advance(state, now);
  },

  result(state): DuelOutcome | null {
    if (state.resigned !== null) {
      return { winner: otherSeat(state.resigned), reason: "Resigned" };
    }
    if (!wordRaceDecided(state)) return null;

    const [first, second] = state.wins;
    if (first === second) return { winner: null, reason: `${first} - ${second}` };
    const winner: DuelSeat = first > second ? 0 : 1;
    // High first, so the line reads the same way whoever is looking at it.
    const reason = `${Math.max(first, second)} - ${Math.min(first, second)}`;
    return { winner, reason };
  },

  snapshot(state, seat, now) {
    const current = advance(state, now) ?? state;
    const round = currentRound(current);
    const finished = wordRaceDecided(current);
    // The word is disclosed once the round it belongs to has ended, and also
    // once the match is over however it ended -- a resignation freezes a live
    // round, and there is nothing left to protect in a match nobody can play.
    const revealed = round.endedAt !== null || finished;
    const phase: "playing" | "reveal" = round.endedAt === null ? "playing" : "reveal";
    const remainingMs =
      round.endedAt === null
        ? Math.max(0, round.startedAt + WORD_RACE_ROUND_MS - now)
        : Math.max(0, round.endedAt + WORD_RACE_REVEAL_MS - now);

    // A spectator or an unauthenticated read is the MOST restrictive view, not
    // the most permissive: they have no "own" guesses and are told nothing
    // about either player's, which is strictly less than a player sees.
    const other = seat === null ? null : otherSeat(seat);

    return {
      totalRounds: current.rounds.length,
      wins: [current.wins[0], current.wins[1]],
      round: {
        number: current.index + 1,
        scramble: round.scramble,
        hint: round.hint,
        length: round.word.length,
        phase,
        remainingMs,
        solvedBy: round.solvedBy,
        // Spread rather than `word: revealed ? … : undefined`, so the key is
        // absent rather than present-and-empty. undefined does not survive
        // JSON either, which would make the two look the same on the wire and
        // different in a test.
        ...(revealed ? { word: round.word } : {}),
      },
      yourGuesses: seat === null ? [] : [...current.guesses[seat]],
      yourLockoutMs: seat === null ? 0 : Math.max(0, current.lockedUntil[seat] - now),
      opponentGuesses: other === null ? 0 : current.guesses[other].length,
      opponentLocked: other === null ? false : current.lockedUntil[other] > now,
      history: current.rounds
        // Finished rounds only. A round that has not opened is not merely
        // hidden here, it is not in the array at all -- which is the whole
        // reason future words cannot leak through this field.
        .map((entry, position) => ({ entry, position }))
        .filter(({ entry }) => entry.endedAt !== null)
        .map(({ entry, position }) => ({
          number: position + 1,
          word: entry.word,
          solvedBy: entry.solvedBy,
        })),
      finished,
    };
  },

  resign(state, seat, now) {
    // Recorded rather than acted on: result() reads it, and freezing the board
    // where it stands means the reveal shows the round that was interrupted.
    return { ...cloneState(state), resigned: seat, resignedAt: now };
  },
});

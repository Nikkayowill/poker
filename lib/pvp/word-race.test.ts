import { describe, expect, it } from "vitest";
import type { DuelGame, DuelSeat } from "./match-contract";
import {
  WORD_RACE_DUEL,
  WORD_RACE_LOCKOUT_MS,
  WORD_RACE_REVEAL_MS,
  WORD_RACE_ROUNDS,
  WORD_RACE_ROUND_MS,
  normalizeWordRaceGuess,
  scrambleWord,
  wordRaceDecided,
  type WordRaceMove,
  type WordRaceSnapshot,
  type WordRaceState,
} from "./word-race";
import {
  WORD_RACE_MAX_LENGTH,
  WORD_RACE_MIN_LENGTH,
  WORD_RACE_WORDS,
} from "./word-race-words";

/**
 * The registry stores games with their types erased, so the one cast here buys
 * every assertion below its real types back. Confined to this line on purpose:
 * defineDuelGame already checked the engine against the generic interface where
 * it is written, so this restates that shape rather than asserting a new one.
 */
const game = WORD_RACE_DUEL as DuelGame<WordRaceState, WordRaceMove, WordRaceSnapshot>;

const T0 = 1_700_000_000_000;
const SEED = 20260812;

function open(seed = SEED, now = T0): WordRaceState {
  return game.createState(seed, now);
}

/** Applies a move that is expected to be accepted, and fails loudly if it was not. */
function play(state: WordRaceState, seat: DuelSeat, guess: string, now: number): WordRaceState {
  const outcome = game.applyMove(state, seat, { guess }, now);
  if (!("next" in outcome)) throw new Error(`Rejected: ${outcome.reject}`);
  return outcome.next;
}

/** The solution to the round currently on screen -- test-side only, never a snapshot. */
function solution(state: WordRaceState): string {
  return state.rounds[state.index].word;
}

/**
 * Plays the series out with seat 0 solving every round instantly, for however
 * many rounds are asked for. Each round costs one reveal window.
 */
function winRounds(state: WordRaceState, seat: DuelSeat, count: number): { state: WordRaceState; now: number } {
  let current = state;
  let now = T0;
  for (let i = 0; i < count; i += 1) {
    current = play(current, seat, solution(current), now);
    now += WORD_RACE_REVEAL_MS + 1;
    current = game.tick?.(current, now) ?? current;
  }
  return { state: current, now };
}

describe("the word bank", () => {
  it("is big enough that a regular player is still solving rather than recognising", () => {
    expect(WORD_RACE_WORDS.length).toBeGreaterThanOrEqual(250);
  });

  it("holds no duplicate word", () => {
    const words = WORD_RACE_WORDS.map((entry) => entry.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it("is lowercase a-z only", () => {
    const wrong = WORD_RACE_WORDS.filter((entry) => !/^[a-z]+$/.test(entry.word));
    expect(wrong).toEqual([]);
  });

  it("stays inside the tile row's length bounds", () => {
    const wrong = WORD_RACE_WORDS.filter(
      (entry) =>
        entry.word.length < WORD_RACE_MIN_LENGTH || entry.word.length > WORD_RACE_MAX_LENGTH,
    );
    expect(wrong).toEqual([]);
  });

  it("gives every word a clue that does not simply say the word", () => {
    const wrong = WORD_RACE_WORDS.filter(
      (entry) => entry.hint.trim().length === 0 || entry.hint.toLowerCase().includes(entry.word),
    );
    expect(wrong).toEqual([]);
  });

  /**
   * The scramble rescue in scrambleWord can only guarantee a different string
   * when a word has two distinct letters, and this is what keeps that true.
   */
  it("has no word made of a single repeated letter", () => {
    const wrong = WORD_RACE_WORDS.filter((entry) => new Set(entry.word.split("")).size < 2);
    expect(wrong).toEqual([]);
  });

  /**
   * Two entries that are anagrams of each other would be a round the player
   * can lose by typing a word the bank itself calls valid. The engine has no
   * dictionary and cannot accept an alternate, so the bank has to.
   */
  it("holds no two words that are anagrams of one another", () => {
    const byLetters = new Map<string, string[]>();
    WORD_RACE_WORDS.forEach((entry) => {
      const key = entry.word.split("").sort().join("");
      byLetters.set(key, [...(byLetters.get(key) ?? []), entry.word]);
    });
    const collisions = [...byLetters.values()].filter((words) => words.length > 1);
    expect(collisions).toEqual([]);
  });
});

describe("setting a match up", () => {
  it("draws the whole series from the seed and nothing else", () => {
    const a = open(4242);
    const b = open(4242);
    expect(b.rounds).toEqual(a.rounds);
  });

  it("gives different seeds different words", () => {
    const a = open(1).rounds.map((round) => round.word);
    const b = open(2).rounds.map((round) => round.word);
    expect(b).not.toEqual(a);
  });

  it("draws one round per round of the series, with no word repeated", () => {
    const words = open().rounds.map((round) => round.word);
    expect(words).toHaveLength(WORD_RACE_ROUNDS);
    expect(new Set(words).size).toBe(WORD_RACE_ROUNDS);
  });

  it("starts round one on the clock and leaves the rest unstamped", () => {
    const state = open();
    expect(state.rounds[0].startedAt).toBe(T0);
    expect(state.rounds.slice(1).every((round) => round.startedAt === 0)).toBe(true);
  });

  it("scrambles every drawn word into a true rearrangement of itself", () => {
    open().rounds.forEach((round) => {
      expect(round.scramble.split("").sort()).toEqual(round.word.split("").sort());
    });
  });

  it("never shows a scramble that is already the answer", () => {
    // Across the whole bank, not just one seed: the failure is a one-in-n!
    // coincidence per word, which is exactly the kind of thing that ships.
    const random = mulberrySequence(99);
    const spelled = WORD_RACE_WORDS.filter((entry) => scrambleWord(entry.word, random) === entry.word);
    expect(spelled).toEqual([]);
  });

  it("scrambles the same way for the same seed", () => {
    expect(open(777).rounds.map((r) => r.scramble)).toEqual(open(777).rounds.map((r) => r.scramble));
  });
});

/** A throwaway PRNG for the bank-wide scramble sweep above. Any sequence will do. */
function mulberrySequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("guessing", () => {
  it("takes the round for whoever gets there first", () => {
    const state = open();
    const next = play(state, 1, solution(state), T0 + 900);
    expect(next.wins).toEqual([0, 1]);
    expect(next.rounds[0].solvedBy).toBe(1);
    expect(next.rounds[0].endedAt).toBe(T0 + 900);
  });

  it("accepts a guess from either seat at any time", () => {
    const state = open();
    // Seat 1 guesses first and seat 0 second, which a turn-based engine would
    // have refused -- there is no turn order in this game to violate.
    const wrong = play(state, 1, "zzzz", T0 + 100);
    const solved = play(wrong, 0, solution(state), T0 + 200);
    expect(solved.wins).toEqual([1, 0]);
  });

  it("does not end the round on a wrong guess", () => {
    const state = open();
    const next = play(state, 0, "wrongun", T0 + 10);
    expect(next.rounds[0].endedAt).toBeNull();
    expect(next.wins).toEqual([0, 0]);
    expect(next.guesses[0]).toEqual(["wrongun"]);
  });

  it("ignores case and whitespace, so a player typing ' CAT ' has solved CAT", () => {
    const state = open();
    const word = solution(state);
    const next = play(state, 0, `  ${word.toUpperCase()} `, T0 + 50);
    expect(next.rounds[0].solvedBy).toBe(0);
  });

  it("normalizes a guess the same way everywhere", () => {
    expect(normalizeWordRaceGuess("  Ca T\n")).toBe("cat");
  });

  it("locks a seat out after a wrong guess", () => {
    const state = play(open(), 0, "zzzz", T0);
    const tooSoon = game.applyMove(state, 0, { guess: solution(state) }, T0 + WORD_RACE_LOCKOUT_MS - 1);
    expect("reject" in tooSoon).toBe(true);
  });

  it("lets the same seat guess again once the lockout expires", () => {
    const state = play(open(), 0, "zzzz", T0);
    const next = play(state, 0, solution(state), T0 + WORD_RACE_LOCKOUT_MS);
    expect(next.rounds[0].solvedBy).toBe(0);
  });

  it("does not lock the other seat out with one seat's mistake", () => {
    const state = play(open(), 0, "zzzz", T0);
    const next = play(state, 1, solution(state), T0 + 1);
    expect(next.rounds[0].solvedBy).toBe(1);
  });

  it("refuses a guess that is not letters, and charges nothing for it", () => {
    const state = open();
    const outcome = game.applyMove(state, 0, { guess: "   " }, T0);
    expect(outcome).toEqual({ reject: "Letters only." });
  });

  it("refuses a guess during the reveal between rounds", () => {
    const state = play(open(), 0, solution(open()), T0);
    const outcome = game.applyMove(state, 1, { guess: "anything" }, T0 + 10);
    expect("reject" in outcome).toBe(true);
  });

  it("refuses a guess once the match is over", () => {
    const { state, now } = winRounds(open(), 0, 3);
    expect(game.result(state)).not.toBeNull();
    const outcome = game.applyMove(state, 1, { guess: "anything" }, now);
    expect(outcome).toEqual({ reject: "This match is over." });
  });
});

describe("the clock", () => {
  it("returns null from tick when nothing has changed", () => {
    // The shell polls every two seconds; a tick that answered with a fresh
    // object here would bump the stored version on every poll and livelock
    // both players' concurrency guard.
    const state = open();
    expect(game.tick?.(state, T0)).toBeNull();
    expect(game.tick?.(state, T0 + WORD_RACE_ROUND_MS - 1)).toBeNull();
  });

  it("returns null during a reveal that has not finished", () => {
    const state = play(open(), 0, solution(open()), T0);
    expect(game.tick?.(state, T0 + WORD_RACE_REVEAL_MS - 1)).toBeNull();
  });

  it("pushes a round nobody solved", () => {
    const timedOut = game.tick?.(open(), T0 + WORD_RACE_ROUND_MS);
    expect(timedOut?.wins).toEqual([0, 0]);
    expect(timedOut?.rounds[0].solvedBy).toBeNull();
    expect(timedOut?.rounds[0].endedAt).toBe(T0 + WORD_RACE_ROUND_MS);
    expect(timedOut?.index).toBe(0);
  });

  it("opens the next round once the reveal is over", () => {
    const pushed = game.tick?.(open(), T0 + WORD_RACE_ROUND_MS) as WordRaceState;
    const opened = game.tick?.(pushed, T0 + WORD_RACE_ROUND_MS + WORD_RACE_REVEAL_MS);
    expect(opened?.index).toBe(1);
    expect(opened?.rounds[1].startedAt).toBe(T0 + WORD_RACE_ROUND_MS + WORD_RACE_REVEAL_MS);
  });

  it("clears both seats' guesses and lockouts when a round opens", () => {
    const guessed = play(open(), 0, "zzzz", T0);
    const next = game.tick?.(guessed, T0 + WORD_RACE_ROUND_MS + WORD_RACE_REVEAL_MS);
    expect(next?.guesses).toEqual([[], []]);
    expect(next?.lockedUntil).toEqual([0, 0]);
  });

  it("catches up a match nobody has read for minutes rather than advancing one step", () => {
    // Two players who both closed the tab must not leave a live row behind.
    const abandoned = game.tick?.(open(), T0 + 10 * 60_000) as WordRaceState;
    expect(abandoned.wins).toEqual([0, 0]);
    expect(game.result(abandoned)).toEqual({ winner: null, reason: "0 - 0" });
  });

  it("starts each round from the last one's end, not from whenever it was polled", () => {
    // Otherwise a slow poll quietly hands both players extra time, and the
    // same stored row replays to a different result.
    const late = game.tick?.(open(), T0 + WORD_RACE_ROUND_MS + WORD_RACE_REVEAL_MS + 9_000) as WordRaceState;
    expect(late.rounds[1].startedAt).toBe(T0 + WORD_RACE_ROUND_MS + WORD_RACE_REVEAL_MS);
  });
});

describe("deciding the match", () => {
  it("is unfinished while rounds remain", () => {
    expect(game.result(open())).toBeNull();
    expect(wordRaceDecided(open())).toBe(false);
  });

  it("is won by whoever took the most rounds", () => {
    const { state } = winRounds(open(), 1, 3);
    expect(game.result(state)).toEqual({ winner: 1, reason: "3 - 0" });
  });

  it("stops early once the other player cannot catch up", () => {
    // 3-0 in a best of five: two rounds left, a three-round lead, nothing to
    // play for. The state freezes on the deciding round's reveal.
    const { state, now } = winRounds(open(), 0, 3);
    expect(state.index).toBe(2);
    expect(game.tick?.(state, now + 10 * 60_000)).toBeNull();
  });

  it("plays the whole series out when the lead is catchable", () => {
    let state = open();
    let now = T0;
    // 1-1 after two rounds: still three to play, so the match must go on.
    state = play(state, 0, solution(state), now);
    now += WORD_RACE_REVEAL_MS + 1;
    state = game.tick?.(state, now) ?? state;
    state = play(state, 1, solution(state), now);
    now += WORD_RACE_REVEAL_MS + 1;
    state = game.tick?.(state, now) ?? state;
    expect(game.result(state)).toBeNull();
    expect(state.index).toBe(2);
  });

  it("draws when the rounds split evenly, and says so", () => {
    let state = open();
    let now = T0;
    const winners: DuelSeat[] = [0, 1, 0, 1];
    winners.forEach((seat) => {
      state = play(state, seat, solution(state), now);
      now += WORD_RACE_REVEAL_MS + 1;
      state = game.tick?.(state, now) ?? state;
    });
    // Round five is pushed, so nobody moves ahead.
    now += WORD_RACE_ROUND_MS;
    state = game.tick?.(state, now) ?? state;
    expect(game.result(state)).toEqual({ winner: null, reason: "2 - 2" });
  });

  it("hands the match to the other seat on a resignation", () => {
    const resigned = game.resign?.(open(), 0, T0 + 5_000) as WordRaceState;
    expect(game.result(resigned)).toEqual({ winner: 1, reason: "Resigned" });
    expect(resigned.resignedAt).toBe(T0 + 5_000);
  });

  it("leaves a resigned match alone on every later tick", () => {
    const resigned = game.resign?.(open(), 1, T0) as WordRaceState;
    expect(game.tick?.(resigned, T0 + 10 * 60_000)).toBeNull();
  });
});

describe("the snapshot", () => {
  it("never carries the live round's solution", () => {
    const state = open();
    const seats: Array<DuelSeat | null> = [0, 1, null];
    seats.forEach((seat) => {
      const snap = game.snapshot(state, seat, T0 + 1_000);
      // The absence of the key, not merely an unused value -- the standard
      // the rest of this codebase holds redaction to.
      expect("word" in snap.round).toBe(false);
      expect(JSON.stringify(snap)).not.toContain(solution(state));
    });
  });

  it("never carries a future round's word, in any field", () => {
    const state = open();
    const later = state.rounds.slice(1).map((round) => round.word);
    const seats: Array<DuelSeat | null> = [0, 1, null];
    seats.forEach((seat) => {
      const wire = JSON.stringify(game.snapshot(state, seat, T0));
      later.forEach((word) => expect(wire).not.toContain(word));
    });
  });

  it("still hides future words at the last reveal of a finished match", () => {
    const { state, now } = winRounds(open(), 0, 3);
    const wire = JSON.stringify(game.snapshot(state, 0, now));
    // Rounds four and five were drawn at creation and never played.
    state.rounds.slice(3).forEach((round) => expect(wire).not.toContain(round.word));
  });

  it("discloses the solution once the round is over", () => {
    const state = open();
    const word = solution(state);
    const solved = play(state, 0, word, T0 + 500);
    const snap = game.snapshot(solved, 1, T0 + 600);
    expect(snap.round.phase).toBe("reveal");
    expect(snap.round.word).toBe(word);
    expect(snap.round.solvedBy).toBe(0);
  });

  it("discloses the solution when a resignation ends the match mid-round", () => {
    const state = open();
    const resigned = game.resign?.(state, 0, T0 + 200) as WordRaceState;
    expect(game.snapshot(resigned, 1, T0 + 300).round.word).toBe(solution(state));
  });

  it("shows a player their own guesses and not the opponent's", () => {
    let state = open();
    state = play(state, 0, "zzzz", T0);
    state = play(state, 1, "qqqq", T0 + 10);
    const mine = game.snapshot(state, 0, T0 + 20);
    expect(mine.yourGuesses).toEqual(["zzzz"]);
    expect(JSON.stringify(mine)).not.toContain("qqqq");
    expect(mine.opponentGuesses).toBe(1);
    expect(mine.opponentLocked).toBe(true);
  });

  it("reports the viewer's own lockout as time remaining", () => {
    const state = play(open(), 1, "zzzz", T0);
    const snap = game.snapshot(state, 1, T0 + 500);
    expect(snap.yourLockoutMs).toBe(WORD_RACE_LOCKOUT_MS - 500);
    expect(game.snapshot(state, 1, T0 + WORD_RACE_LOCKOUT_MS).yourLockoutMs).toBe(0);
  });

  it("gives a spectator no more than a player gets", () => {
    let state = open();
    state = play(state, 0, "zzzz", T0);
    state = play(state, 1, "qqqq", T0 + 10);
    const watching = game.snapshot(state, null, T0 + 20);
    // Most restrictive, not most permissive: an unknown viewer who defaulted
    // to seeing everything is how a second tab becomes a cheat.
    expect(watching.yourGuesses).toEqual([]);
    expect(watching.yourLockoutMs).toBe(0);
    expect(watching.opponentGuesses).toBe(0);
    expect(watching.opponentLocked).toBe(false);
    expect("word" in watching.round).toBe(false);
    const wire = JSON.stringify(watching);
    expect(wire).not.toContain("zzzz");
    expect(wire).not.toContain("qqqq");
  });

  it("counts the round down from now, without a stored countdown", () => {
    const state = open();
    expect(game.snapshot(state, 0, T0).round.remainingMs).toBe(WORD_RACE_ROUND_MS);
    expect(game.snapshot(state, 0, T0 + 12_000).round.remainingMs).toBe(WORD_RACE_ROUND_MS - 12_000);
    expect(game.snapshot(state, 0, T0 + WORD_RACE_ROUND_MS + 5).round.remainingMs).toBeLessThanOrEqual(
      WORD_RACE_REVEAL_MS,
    );
  });

  it("reports the round number, the series length and both scores", () => {
    const { state, now } = winRounds(open(), 0, 2);
    const snap = game.snapshot(state, 1, now);
    expect(snap.totalRounds).toBe(WORD_RACE_ROUNDS);
    expect(snap.round.number).toBe(3);
    expect(snap.wins).toEqual([2, 0]);
    expect(snap.finished).toBe(false);
  });

  it("lists only finished rounds in the history", () => {
    const { state, now } = winRounds(open(), 0, 2);
    const snap = game.snapshot(state, 0, now);
    expect(snap.history.map((entry) => entry.number)).toEqual([1, 2]);
    expect(snap.history.map((entry) => entry.word)).toEqual([
      state.rounds[0].word,
      state.rounds[1].word,
    ]);
  });

  it("shows the same scramble, length and hint to both seats", () => {
    const state = open();
    const zero = game.snapshot(state, 0, T0).round;
    const one = game.snapshot(state, 1, T0).round;
    expect(one.scramble).toBe(zero.scramble);
    expect(one.hint).toBe(zero.hint);
    expect(one.length).toBe(solution(state).length);
  });

  it("survives the jsonb round trip the state is stored through", () => {
    // No Map, Set, class instance or undefined anywhere in the state: what
    // comes back out of the column has to be what went in.
    const state = play(open(), 0, "zzzz", T0);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(structuredClone(state)).toEqual(state);
  });
});

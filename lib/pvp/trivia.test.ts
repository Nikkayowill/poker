import { describe, expect, it } from "vitest";
import type { DuelGame, DuelSeat } from "./match-contract";
import {
  TRIVIA_CORRECT_POINTS,
  TRIVIA_DUEL,
  TRIVIA_QUESTION_COUNT,
  TRIVIA_QUESTION_MS,
  TRIVIA_REVEAL_MS,
  TRIVIA_SPEED_BONUS,
  triviaAnswerPoints,
  type TriviaSnapshot,
  type TriviaState,
} from "./trivia";
import { TRIVIA_QUESTIONS } from "./trivia-questions";

/**
 * `defineDuelGame` hands back the erased form on purpose -- the registry holds
 * games it cannot name the state of. The types were already checked at the
 * definition, so putting them back here is a cast and not a hole.
 */
const game = TRIVIA_DUEL as unknown as DuelGame<TriviaState, unknown, TriviaSnapshot>;

const T0 = 1_700_000_000_000;

function questionFor(state: TriviaState, index: number) {
  const id = state.questionIds[index];
  const question = TRIVIA_QUESTIONS.find((entry) => entry.id === id);
  if (!question) throw new Error(`Dealt an id the bank does not have: ${id}`);
  return question;
}

/** The right choice for the question at `index`, and one that is not. */
function rightChoice(state: TriviaState, index: number): number {
  return questionFor(state, index).answerIndex;
}
function wrongChoice(state: TriviaState, index: number): number {
  return (questionFor(state, index).answerIndex + 1) % 4;
}

function answer(state: TriviaState, seat: DuelSeat, choice: number, now: number): TriviaState {
  const played = game.applyMove(state, seat, { type: "answer", question: state.index, choice }, now);
  if ("reject" in played) throw new Error(`Rejected: ${played.reject}`);
  return played.next;
}

/**
 * Runs the clock to the end of the current question's reveal and opens the
 * next one. Returns the instant that question opened, so a caller can keep
 * answering "n milliseconds in" without tracking two clocks.
 */
function toNextQuestion(state: TriviaState): { state: TriviaState; now: number } {
  const closesAt = state.revealAt ?? state.openedAt + TRIVIA_QUESTION_MS;
  const next = game.tick?.(state, closesAt + TRIVIA_REVEAL_MS) ?? state;
  return { state: next, now: next.openedAt };
}

/* ------------------------------------------------------------------- bank */

describe("the question bank", () => {
  it("is deep enough that matches do not repeat themselves", () => {
    expect(TRIVIA_QUESTIONS.length).toBeGreaterThanOrEqual(120);
  });

  it("gives every question exactly four choices and an index into them", () => {
    for (const question of TRIVIA_QUESTIONS) {
      expect({ id: question.id, choices: question.choices.length }).toEqual({
        id: question.id,
        choices: 4,
      });
      expect(Number.isInteger(question.answerIndex)).toBe(true);
      expect(question.answerIndex).toBeGreaterThanOrEqual(0);
      expect(question.answerIndex).toBeLessThanOrEqual(3);
    }
  });

  it("has a non-empty prompt and category on every question", () => {
    for (const question of TRIVIA_QUESTIONS) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
      expect(question.category.trim().length).toBeGreaterThan(0);
      for (const choice of question.choices) {
        expect(choice.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate ids", () => {
    const ids = TRIVIA_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never repeats a choice inside one question", () => {
    // Two identical choices means one of them is a right answer marked wrong,
    // which is unwinnable and looks like a bug in the scoring rather than in
    // the data.
    for (const question of TRIVIA_QUESTIONS) {
      const unique = new Set(question.choices.map((choice) => choice.toLowerCase()));
      expect({ id: question.id, unique: unique.size }).toEqual({ id: question.id, unique: 4 });
    }
  });

  it("never asks the same question twice under two ids", () => {
    const prompts = TRIVIA_QUESTIONS.map((question) => question.prompt.toLowerCase());
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("spreads the answer across all four positions", () => {
    // A bank that habitually puts the answer first teaches a player to tap the
    // first button, which beats knowing anything. See the note in
    // trivia-questions.ts.
    const counts = [0, 1, 2, 3].map(
      (position) =>
        TRIVIA_QUESTIONS.filter((question) => question.answerIndex === position).length,
    );
    for (const count of counts) {
      expect(count / TRIVIA_QUESTIONS.length).toBeGreaterThan(0.1);
    }
  });
});

/* -------------------------------------------------------------- constants */

describe("scoring constants", () => {
  it("keeps speed from ever overturning one more correct answer", () => {
    // The guarantee the lobby copy makes: "most right answers takes the pot".
    // Every question's speed bonus put together must still be worth less than
    // a single correct answer.
    expect(TRIVIA_SPEED_BONUS * TRIVIA_QUESTION_COUNT).toBeLessThan(TRIVIA_CORRECT_POINTS);
  });

  it("is decided on an odd number of questions", () => {
    expect(TRIVIA_QUESTION_COUNT % 2).toBe(1);
  });

  it("pays the full bonus instantly and none of it at the buzzer", () => {
    expect(triviaAnswerPoints(0, 0)).toBe(TRIVIA_CORRECT_POINTS + TRIVIA_SPEED_BONUS);
    expect(triviaAnswerPoints(0, TRIVIA_QUESTION_MS)).toBe(TRIVIA_CORRECT_POINTS);
    // Clamped rather than negative: an answer recorded past the buzzer is
    // still a correct answer worth its base.
    expect(triviaAnswerPoints(0, TRIVIA_QUESTION_MS * 3)).toBe(TRIVIA_CORRECT_POINTS);
  });
});

/* ----------------------------------------------------------------- setup */

describe("createState", () => {
  it("deals the same questions in the same order for the same seed", () => {
    const a = game.createState(4242, T0);
    const b = game.createState(4242, T0);
    expect(a.questionIds).toEqual(b.questionIds);
  });

  it("deals a different set for almost every other seed", () => {
    const seeds = Array.from({ length: 60 }, (_, index) => index * 7 + 1);
    const dealt = seeds.map((seed) => game.createState(seed, T0).questionIds.join(","));
    // Not "all differ" -- a shuffle is allowed to collide, and a test that
    // forbids it is a test that will fail one day for no reason.
    expect(new Set(dealt).size).toBeGreaterThan(seeds.length * 0.9);
  });

  it("deals exactly the match length, with no question twice", () => {
    const state = game.createState(99, T0);
    expect(state.questionIds).toHaveLength(TRIVIA_QUESTION_COUNT);
    expect(new Set(state.questionIds).size).toBe(TRIVIA_QUESTION_COUNT);
  });

  it("opens on the first question with both scores at zero", () => {
    const state = game.createState(1, T0);
    expect(state.index).toBe(0);
    expect(state.openedAt).toBe(T0);
    expect(state.revealAt).toBeNull();
    expect(state.scores).toEqual([0, 0]);
    expect(game.result(state)).toBeNull();
  });

  it("stores nothing that a jsonb column would lose", () => {
    // Round-trips through JSON rather than being inspected field by field --
    // a Map, a Set or an undefined would survive structuredClone in one of
    // those checks and not the other.
    const state = game.createState(7, T0);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

/* ----------------------------------------------------------------- moves */

describe("answering", () => {
  it("scores a correct answer and nothing for a wrong one", () => {
    const state = game.createState(11, T0);
    const right = answer(state, 0, rightChoice(state, 0), T0 + 1_000);
    const both = answer(right, 1, wrongChoice(state, 0), T0 + 1_200);

    expect(both.scores[0]).toBeGreaterThanOrEqual(TRIVIA_CORRECT_POINTS);
    expect(both.scores[1]).toBe(0);
  });

  it("pays a faster correct answer more than a slower one", () => {
    const state = game.createState(12, T0);
    const choice = rightChoice(state, 0);
    const quick = answer(state, 0, choice, T0 + 500);
    const slow = answer(quick, 1, choice, T0 + 9_000);

    expect(slow.scores[0]).toBeGreaterThan(slow.scores[1] ?? 0);
    // Both still knew it, so the gap is speed only and stays inside the bonus.
    expect((slow.scores[0] ?? 0) - (slow.scores[1] ?? 0)).toBeLessThanOrEqual(TRIVIA_SPEED_BONUS);
  });

  it("refuses a second answer to the same question", () => {
    const state = game.createState(13, T0);
    const once = answer(state, 0, wrongChoice(state, 0), T0 + 400);
    const again = game.applyMove(
      once,
      0,
      { type: "answer", question: 0, choice: rightChoice(state, 0) },
      T0 + 600,
    );
    // The whole point: without this a player taps all four and always scores.
    expect(again).toEqual({ reject: expect.stringContaining("already answered") });
  });

  it("has no turn order -- either seat may answer first", () => {
    const state = game.createState(14, T0);
    const secondSeatFirst = answer(state, 1, rightChoice(state, 0), T0 + 300);
    expect(secondSeatFirst.scores[1]).toBeGreaterThan(0);
    const firstSeatSecond = answer(secondSeatFirst, 0, rightChoice(state, 0), T0 + 800);
    expect(firstSeatSecond.scores[0]).toBeGreaterThan(0);
  });

  it("closes the question the moment both have answered", () => {
    const state = game.createState(15, T0);
    const one = answer(state, 0, rightChoice(state, 0), T0 + 300);
    expect(one.revealAt).toBeNull();
    const both = answer(one, 1, wrongChoice(state, 0), T0 + 900);
    expect(both.revealAt).toBe(T0 + 900);
  });

  it("refuses an answer once the question has closed", () => {
    const state = game.createState(16, T0);
    const one = answer(state, 0, rightChoice(state, 0), T0 + 300);
    const both = answer(one, 1, wrongChoice(state, 0), T0 + 900);
    const late = game.applyMove(both, 0, { type: "answer", question: 0, choice: 0 }, T0 + 1_000);
    expect(late).toEqual({ reject: expect.any(String) });
  });

  it("refuses an answer aimed at a question that has moved on", () => {
    const state = game.createState(17, T0);
    const stale = game.applyMove(state, 0, { type: "answer", question: 3, choice: 0 }, T0 + 100);
    expect(stale).toEqual({ reject: expect.stringContaining("moved on") });
  });

  it("refuses a move that is not an answer at all", () => {
    const state = game.createState(18, T0);
    for (const bad of [null, "answer", 4, {}, { type: "answer", question: 0 }, { type: "answer", question: 0, choice: 9 }]) {
      expect(game.applyMove(state, 0, bad, T0 + 100)).toEqual({ reject: expect.any(String) });
    }
  });

  it("judges an answer that lands after the buzzer against the closed question", () => {
    const state = game.createState(19, T0);
    const late = game.applyMove(
      state,
      0,
      { type: "answer", question: 0, choice: rightChoice(state, 0) },
      T0 + TRIVIA_QUESTION_MS + 50,
    );
    expect(late).toEqual({ reject: expect.any(String) });
  });
});

/* ------------------------------------------------------------------ tick */

describe("tick", () => {
  it("returns null when nothing has changed", () => {
    // The contract's hard requirement: the shell polls every two seconds, and
    // a fresh object per poll bumps the version and livelocks both players'
    // concurrency guard.
    const state = game.createState(21, T0);
    expect(game.tick?.(state, T0)).toBeNull();
    expect(game.tick?.(state, T0 + 1)).toBeNull();
    expect(game.tick?.(state, T0 + TRIVIA_QUESTION_MS - 1)).toBeNull();
  });

  it("returns null repeatedly while a reveal is still running", () => {
    const state = game.createState(22, T0);
    const one = answer(state, 0, rightChoice(state, 0), T0 + 200);
    const both = answer(one, 1, rightChoice(state, 0), T0 + 400);
    expect(game.tick?.(both, T0 + 400)).toBeNull();
    expect(game.tick?.(both, T0 + 400 + TRIVIA_REVEAL_MS - 1)).toBeNull();
  });

  it("closes a question nobody answered, so one player cannot stall the match", () => {
    const state = game.createState(23, T0);
    const timedOut = game.tick?.(state, T0 + TRIVIA_QUESTION_MS);
    expect(timedOut?.revealAt).toBe(T0 + TRIVIA_QUESTION_MS);
    expect(timedOut?.index).toBe(0);
    expect(timedOut?.scores).toEqual([0, 0]);
  });

  it("opens the next question when the reveal is over", () => {
    const state = game.createState(24, T0);
    const rolled = game.tick?.(state, T0 + TRIVIA_QUESTION_MS + TRIVIA_REVEAL_MS);
    expect(rolled?.index).toBe(1);
    expect(rolled?.openedAt).toBe(T0 + TRIVIA_QUESTION_MS + TRIVIA_REVEAL_MS);
    expect(rolled?.revealAt).toBeNull();
  });

  it("catches up from a long silence rather than parking on one question", () => {
    // Both tabs closed for a minute. Deadlines are computed from the state's
    // own instants, so the result is exactly what ticking on time would give.
    const state = game.createState(25, T0);
    const step = TRIVIA_QUESTION_MS + TRIVIA_REVEAL_MS;
    const later = game.tick?.(state, T0 + step * 3 + 10);
    expect(later?.index).toBe(3);
    expect(later?.openedAt).toBe(T0 + step * 3);
  });

  it("stops at the end of the match and then stays null", () => {
    const state = game.createState(26, T0);
    const step = TRIVIA_QUESTION_MS + TRIVIA_REVEAL_MS;
    const played = game.tick?.(state, T0 + step * 50);
    expect(played?.index).toBe(TRIVIA_QUESTION_COUNT);
    expect(game.tick?.(played as TriviaState, T0 + step * 90)).toBeNull();
  });
});

/* --------------------------------------------------------------- outcomes */

describe("result", () => {
  it("stays null until every question has been played", () => {
    let state = game.createState(31, T0);
    for (let index = 0; index < TRIVIA_QUESTION_COUNT - 1; index += 1) {
      expect(game.result(state)).toBeNull();
      state = toNextQuestion(state).state;
    }
    expect(game.result(state)).toBeNull();
  });

  it("gives the match to whoever scored more", () => {
    let state = game.createState(32, T0);
    let now = state.openedAt;
    for (let index = 0; index < TRIVIA_QUESTION_COUNT; index += 1) {
      state = answer(state, 0, rightChoice(state, index), now + 500);
      state = answer(state, 1, wrongChoice(state, index), now + 700);
      ({ state, now } = toNextQuestion(state));
    }

    const outcome = game.result(state);
    expect(outcome?.winner).toBe(0);
    expect(outcome?.reason).toMatch(/^\d+ - \d+$/);
    expect(state.scores[0]).toBeGreaterThan(state.scores[1] ?? 0);
  });

  it("draws when both players score identically", () => {
    let state = game.createState(33, T0);
    let now = state.openedAt;
    for (let index = 0; index < TRIVIA_QUESTION_COUNT; index += 1) {
      const choice = rightChoice(state, index);
      // Same choice at the same instant, so the speed bonus is identical too.
      state = answer(state, 0, choice, now + 1_000);
      state = answer(state, 1, choice, now + 1_000);
      ({ state, now } = toNextQuestion(state));
    }

    expect(state.scores[0]).toBe(state.scores[1]);
    expect(game.result(state)).toEqual({ winner: null, reason: expect.any(String) });
  });

  it("lets a player who knows one more answer win however slowly they tapped", () => {
    let state = game.createState(34, T0);
    let now = state.openedAt;
    for (let index = 0; index < TRIVIA_QUESTION_COUNT; index += 1) {
      // Seat 0 is right on every question but answers at the buzzer; seat 1
      // is instant, and wrong on exactly one.
      state = answer(state, 0, rightChoice(state, index), now + TRIVIA_QUESTION_MS - 10);
      const seatOne = index === 0 ? wrongChoice(state, index) : rightChoice(state, index);
      state = answer(state, 1, seatOne, now + 1);
      ({ state, now } = toNextQuestion(state));
    }
    expect(game.result(state)?.winner).toBe(0);
  });

  it("hands the match to the other seat on a resignation", () => {
    const state = game.createState(35, T0);
    const quit = game.resign?.(state, 1, T0 + 3_000) ?? state;
    expect(game.result(quit)).toEqual({ winner: 0, reason: "Resigned" });
    // And the board stops taking answers.
    expect(game.applyMove(quit, 0, { type: "answer", question: 0, choice: 0 }, T0 + 3_100)).toEqual(
      { reject: expect.any(String) },
    );
  });
});

/* ------------------------------------------------------------- redaction */

describe("snapshot redaction", () => {
  it("does not carry the answer while the question is open", () => {
    const state = game.createState(41, T0);
    for (const seat of [0, 1, null] as const) {
      const snap = game.snapshot(state, seat, T0 + 500);
      expect(snap.phase).toBe("question");
      expect(snap.question).not.toBeNull();
      // Absent, not null: a null tells a reader the field exists.
      expect("answerIndex" in (snap.question as object)).toBe(false);
    }
  });

  it("discloses the answer only once the reveal has started", () => {
    const state = game.createState(42, T0);
    const one = answer(state, 0, rightChoice(state, 0), T0 + 200);
    const both = answer(one, 1, wrongChoice(state, 0), T0 + 400);
    const snap = game.snapshot(both, 0, T0 + 500);
    expect(snap.phase).toBe("reveal");
    expect(snap.question?.answerIndex).toBe(rightChoice(state, 0));
  });

  it("never carries a question the players have not reached", () => {
    const state = game.createState(43, T0);
    const serialized = JSON.stringify(game.snapshot(state, 0, T0 + 100));
    for (let index = 1; index < TRIVIA_QUESTION_COUNT; index += 1) {
      const future = questionFor(state, index);
      expect(serialized).not.toContain(future.prompt);
      for (const choice of future.choices) {
        expect(serialized).not.toContain(choice);
      }
    }
  });

  it("never carries an answered-but-unrevealed opponent's choice", () => {
    const state = game.createState(44, T0);
    const one = answer(state, 1, rightChoice(state, 0), T0 + 300);
    const snap = game.snapshot(one, 0, T0 + 400);

    expect(snap.phase).toBe("question");
    // That they have answered is published on purpose -- it is the tension,
    // and it says nothing about what they picked.
    expect(snap.seats[1]?.answered).toBe(true);
    expect("choice" in (snap.seats[1] as object)).toBe(false);
    expect("correct" in (snap.seats[1] as object)).toBe(false);
    expect("points" in (snap.seats[1] as object)).toBe(false);
  });

  it("shows a player their own answer back immediately", () => {
    const state = game.createState(45, T0);
    const choice = wrongChoice(state, 0);
    const one = answer(state, 0, choice, T0 + 300);
    const snap = game.snapshot(one, 0, T0 + 400);
    expect(snap.seats[0]?.choice).toBe(choice);
    expect(snap.seats[0]?.correct).toBe(false);
  });

  it("shows a spectator no more than either player can see", () => {
    const state = game.createState(46, T0);
    const one = answer(state, 0, rightChoice(state, 0), T0 + 300);
    const spectator = game.snapshot(one, null, T0 + 400);

    expect(spectator.viewer).toBeNull();
    expect(spectator.seats[0]?.answered).toBe(true);
    // The most restrictive view, not the most permissive: an unknown viewer
    // sees neither seat's choice, where seat 0 would see its own.
    for (const view of spectator.seats) {
      expect("choice" in view).toBe(false);
    }
    expect("answerIndex" in (spectator.question as object)).toBe(false);
  });

  it("does not leak an unanswered question through the history", () => {
    const state = game.createState(47, T0);
    const snap = game.snapshot(state, 0, T0 + 100);
    // History is questions already played out. The open one being in it would
    // report whether the opponent was right before either of them was told.
    expect(snap.history).toEqual([]);
  });

  it("reports both players' answers once the question is revealed", () => {
    const state = game.createState(48, T0);
    const one = answer(state, 0, rightChoice(state, 0), T0 + 200);
    const both = answer(one, 1, wrongChoice(state, 0), T0 + 400);
    const snap = game.snapshot(both, 0, T0 + 500);
    expect(snap.seats[0]?.correct).toBe(true);
    expect(snap.seats[1]?.correct).toBe(false);
    expect(snap.seats[1]?.choice).toBe(wrongChoice(state, 0));
  });
});

/* ------------------------------------------------------------ presentation */

describe("snapshot timing", () => {
  it("counts the question's remaining milliseconds down from now", () => {
    const state = game.createState(51, T0);
    expect(game.snapshot(state, 0, T0).remainingMs).toBe(TRIVIA_QUESTION_MS);
    expect(game.snapshot(state, 0, T0 + 4_000).remainingMs).toBe(TRIVIA_QUESTION_MS - 4_000);
    expect(game.snapshot(state, 0, T0 + 3_000).phaseMs).toBe(TRIVIA_QUESTION_MS);
  });

  it("rolls the board forward on a read even before a tick has been written", () => {
    // A read can beat the tick's write. Showing a question whose clock ran out
    // ten seconds ago is worse than being a version behind.
    const state = game.createState(52, T0);
    const snap = game.snapshot(state, 0, T0 + TRIVIA_QUESTION_MS + TRIVIA_REVEAL_MS + 100);
    expect(snap.questionNumber).toBe(2);
    expect(snap.phase).toBe("question");
  });

  it("reports the match finished with no question left on the board", () => {
    const state = game.createState(53, T0);
    const step = TRIVIA_QUESTION_MS + TRIVIA_REVEAL_MS;
    const done = game.tick?.(state, T0 + step * TRIVIA_QUESTION_COUNT) as TriviaState;
    const snap = game.snapshot(done, 0, T0 + step * TRIVIA_QUESTION_COUNT);
    expect(snap.phase).toBe("done");
    expect(snap.question).toBeNull();
    expect(snap.remainingMs).toBe(0);
    expect(snap.questionNumber).toBe(TRIVIA_QUESTION_COUNT);
    expect(snap.history).toHaveLength(TRIVIA_QUESTION_COUNT);
  });
});

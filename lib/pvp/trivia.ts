import { defineDuelGame, otherSeat, type DuelOutcome, type DuelSeat } from "./match-contract";
import { TRIVIA_QUESTIONS, type TriviaQuestion } from "./trivia-questions";

/**
 * Trivia Showdown -- seven questions, both players, one clock.
 *
 * Simultaneous, not turn-based. The contract says the engine owns turn order,
 * and this one has none: either seat may answer the open question at any
 * moment, and the question closes when both have answered or when its timer
 * runs out, whichever happens first. That is the whole game -- a quiz where
 * you wait for the other player is a quiz, not a race.
 *
 * ## The redaction is the game
 *
 * `snapshot` is the only thing standing between a player and the answer key.
 * The stored state holds seven question ids; the snapshot holds ONE question,
 * with no `answerIndex` key on it at all until that question's reveal window
 * opens. Absent, not null and not merely unrendered: a null tells a reader
 * that the field exists and is worth watching, and a field the UI ignores is
 * a field the network tab does not. lib/pvp/trivia-questions.ts is
 * `server-only` for the other half of the same argument -- hiding the index
 * buys nothing if the client is also holding the table it indexes into.
 *
 * The opponent's chosen answer is redacted on the same schedule. That they
 * have answered is published, deliberately: it leaks no information about
 * WHAT they answered, and watching the other lamp light while you are still
 * reading is most of what makes this tense.
 *
 * ## Why the state is timestamps rather than timers
 *
 * Nothing here runs on a clock of its own. A question opens at an instant and
 * closes at a computed one, so the same state fed the same `now` always yields
 * the same answer -- which is what lets `tick` be idempotent, lets a match
 * survive being read by two servers, and lets the whole thing be tested
 * without faking timers. Everything derived (which question is open, how long
 * is left, whether the match is over) is computed from those instants rather
 * than stored beside them, so there is no second copy to fall out of step.
 */

/* --------------------------------------------------------------- constants */

/**
 * Questions per match.
 *
 * Odd, so a match decided purely on how many each player got right always has
 * a decider -- with an even count the most common good match is a tie, and a
 * tie refunds both stakes, which reads as "nothing happened" after seven
 * questions of tension.
 */
export const TRIVIA_QUESTION_COUNT = 7;

/** How long a question stays open. Long enough to read four choices, short enough to hurt. */
export const TRIVIA_QUESTION_MS = 12_000;

/**
 * The pause after a question closes, before the next one opens.
 *
 * The only moment the answer may be disclosed, and the only moment either
 * player learns what the other picked. Short: it is a beat, not a scoreboard.
 */
export const TRIVIA_REVEAL_MS = 2_500;

/**
 * What a correct answer is worth before speed, and the most speed can add.
 *
 * The ratio is the whole scoring design, not a taste call. Seven questions
 * times a 140-point speed bonus is 980, which is less than one correct answer
 * -- so a player who knows one more answer than their opponent CANNOT be
 * overtaken on speed alone, however fast the other one taps. Speed decides
 * between two players who know the same number, which is what the lobby copy
 * promises ("most right answers takes the pot") and what a race should feel
 * like. Raising TRIVIA_SPEED_BONUS above TRIVIA_CORRECT_POINTS /
 * TRIVIA_QUESTION_COUNT breaks that guarantee silently; a test pins it.
 */
export const TRIVIA_CORRECT_POINTS = 1000;
export const TRIVIA_SPEED_BONUS = 140;

/* ------------------------------------------------------------------- state */

/**
 * One seat's answer to one question.
 *
 * `correct` and `points` are settled at answer time rather than recomputed on
 * read. The question bank is data that can be edited; a match in progress must
 * be scored by the bank it was dealt from, and a state that stores only the
 * choice would silently rescore itself if a question were ever corrected.
 */
export interface TriviaAnswerRecord {
  /** Index into the question's choices, 0-3. */
  choice: number;
  /** When it was locked in, epoch ms. */
  at: number;
  correct: boolean;
  points: number;
}

/**
 * Everything the match is.
 *
 * JSON-serializable throughout -- plain arrays, numbers, strings and null. It
 * round-trips through a jsonb column and through structuredClone, so a Map, a
 * Set or an `undefined` here would come back as something else, or not at all.
 */
export interface TriviaState {
  /** Ids into TRIVIA_QUESTIONS, in play order. Length TRIVIA_QUESTION_COUNT. */
  questionIds: string[];
  /** Which question is open. Equals questionIds.length once the match is played out. */
  index: number;
  /** When the question at `index` opened. */
  openedAt: number;
  /** When it closed, or null while it is still open. The reveal runs from here. */
  revealAt: number | null;
  /** answers[question][seat]. Null where that seat did not answer. */
  answers: (TriviaAnswerRecord | null)[][];
  /** scores[seat]. */
  scores: number[];
  /** The seat that quit, or null. */
  resignedBy: DuelSeat | null;
}

export type TriviaPhase = "question" | "reveal" | "done";

/** What the board sends. Shape-checked here, never trusted from the wire. */
export interface TriviaMove {
  type: "answer";
  /** Which question this answers, 0-based. */
  question: number;
  /** Which choice, 0-3. */
  choice: number;
}

/* --------------------------------------------------------------- snapshot */

/**
 * The open question as a viewer may see it.
 *
 * `answerIndex` is OPTIONAL and is genuinely absent while the question is
 * live. See the header for why absent rather than null.
 */
export interface TriviaQuestionView {
  category: string;
  prompt: string;
  choices: string[];
  /** Present only during the reveal. -1 if the question is no longer in the bank. */
  answerIndex?: number;
}

/**
 * One seat, as this viewer may see it.
 *
 * `answered` is public for both seats at all times. `choice`/`correct`/
 * `points` are the viewer's own, or either seat's once the reveal has started.
 */
export interface TriviaSeatView {
  score: number;
  answered: boolean;
  choice?: number;
  correct?: boolean;
  points?: number;
}

export interface TriviaSnapshot {
  /** Which seat this view was built for. Null for a spectator. */
  viewer: DuelSeat | null;
  total: number;
  /** 1-based, for "3 of 7". Clamped to `total` once the match is played out. */
  questionNumber: number;
  phase: TriviaPhase;
  /** Null once the match is over, or if the open question has left the bank. */
  question: TriviaQuestionView | null;
  /** Milliseconds left in the current phase, from `now`. Zero when done. */
  remainingMs: number;
  /** The full length of the current phase, so a bar can be drawn without a second copy of the constants. */
  phaseMs: number;
  /** Indexed by seat. */
  seats: TriviaSeatView[];
  /** Correctness of every question already played out, oldest first: [seat0, seat1]. */
  history: boolean[][];
}

/* ------------------------------------------------------------------- rng */

/**
 * mulberry32 -- a tiny, well-behaved 32-bit PRNG.
 *
 * The whole reason `createState` takes a seed. Math.random() would make a
 * match impossible to reproduce in a test and, worse, would put the question
 * order outside anything the server can vouch for. Not cryptographic and does
 * not need to be: the server draws the seed from node:crypto and never sends
 * it, so a client has nothing to run this on.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, drawing from `random`. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    // Indices are in range by construction; the guard is for tsc, not for us.
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

/* ----------------------------------------------------------------- lookup */

const BY_ID = new Map(TRIVIA_QUESTIONS.map((question) => [question.id, question]));

/**
 * The question behind an id, or null if the bank no longer has it.
 *
 * Null rather than a throw, for the reason `duelGame` returns null for a
 * retired game: a live match holding an id that has since been edited out is a
 * real state somebody has staked Gold on, and it must render and settle rather
 * than 500. A missing question is unanswerable for BOTH players, so it costs
 * neither of them anything relative to the other.
 */
function questionAt(state: TriviaState, index: number): TriviaQuestion | null {
  const id = state.questionIds[index];
  return id === undefined ? null : BY_ID.get(id) ?? null;
}

/* ---------------------------------------------------------------- scoring */

/**
 * What a correct answer at `at` is worth on a question opened at `openedAt`.
 *
 * Linear in the fraction of the window still unspent, so answering instantly
 * is worth the full bonus and answering as the clock dies is worth none of it.
 * Rounded to an integer because a score is read by a human and summed by a
 * comparison; a float would print 1043.9999999999998 eventually.
 */
export function triviaAnswerPoints(openedAt: number, at: number): number {
  const elapsed = Math.min(Math.max(at - openedAt, 0), TRIVIA_QUESTION_MS);
  const remainingFraction = 1 - elapsed / TRIVIA_QUESTION_MS;
  return TRIVIA_CORRECT_POINTS + Math.round(TRIVIA_SPEED_BONUS * remainingFraction);
}

/* ------------------------------------------------------------------ phase */

export function triviaPhase(state: TriviaState): TriviaPhase {
  if (state.resignedBy !== null) return "done";
  if (state.index >= state.questionIds.length) return "done";
  return state.revealAt === null ? "question" : "reveal";
}

/**
 * Rolls the clock forward, or returns null if nothing was due.
 *
 * Null-on-no-change is the contract's hard requirement and the reason this is
 * one function rather than logic sprinkled through `tick`: the shell polls
 * every two seconds, and a tick that handed back a fresh object each time
 * would bump the stored version on every poll from both players and livelock
 * the optimistic concurrency guard against itself.
 *
 * It loops because a poll can arrive long after several deadlines have passed
 * -- both players closing the tab for a minute must not leave the match parked
 * on question two. Deadlines are computed from the state's own instants, never
 * from `now`, so catching up thirty seconds late produces exactly the state a
 * caller who had ticked on time would hold.
 */
function advanced(state: TriviaState, now: number): TriviaState | null {
  if (triviaPhase(state) === "done") return null;

  let next = state;
  let changed = false;

  for (;;) {
    if (next.revealAt === null) {
      const deadline = next.openedAt + TRIVIA_QUESTION_MS;
      if (now < deadline) break;
      next = { ...next, revealAt: deadline };
      changed = true;
      continue;
    }

    const revealEnds = next.revealAt + TRIVIA_REVEAL_MS;
    if (now < revealEnds) break;

    const index = next.index + 1;
    next = { ...next, index, openedAt: revealEnds, revealAt: null };
    changed = true;
    if (index >= next.questionIds.length) break;
  }

  return changed ? next : null;
}

/* ------------------------------------------------------------------ moves */

/** Narrows whatever the route forwarded. `move` is a claim, not an instruction. */
function readMove(move: unknown): TriviaMove | null {
  if (typeof move !== "object" || move === null) return null;
  const claim = move as Partial<TriviaMove>;
  if (claim.type !== "answer") return null;
  if (!Number.isInteger(claim.question) || !Number.isInteger(claim.choice)) return null;
  const question = claim.question as number;
  const choice = claim.choice as number;
  if (question < 0 || choice < 0 || choice > 3) return null;
  return { type: "answer", question, choice };
}

/* ------------------------------------------------------------- the engine */

export const TRIVIA_DUEL = defineDuelGame<TriviaState, unknown, TriviaSnapshot>({
  id: "trivia",
  label: "Trivia",

  createState(seed, now) {
    const random = mulberry32(seed);
    const picked = shuffled(TRIVIA_QUESTIONS, random).slice(0, TRIVIA_QUESTION_COUNT);
    return {
      questionIds: picked.map((question) => question.id),
      index: 0,
      openedAt: now,
      revealAt: null,
      // Two nulls per question rather than a growing sparse structure, so the
      // shape a jsonb column round-trips is the shape the engine reads back.
      answers: picked.map(() => [null, null]),
      scores: [0, 0],
      resignedBy: null,
    };
  },

  applyMove(state, seat, move, now) {
    // Rolled forward first, for the same reason the service ticks before it
    // applies: an answer that lands a millisecond after the buzzer must be
    // judged against the closed question, not sneak into it.
    const current = advanced(state, now) ?? state;

    const phase = triviaPhase(current);
    if (phase === "done") return { reject: "This match is over." };
    if (phase === "reveal") return { reject: "That question has closed." };

    const claim = readMove(move);
    if (!claim) return { reject: "That is not an answer." };
    // The question index pins the answer to the question the player was
    // actually looking at. Without it, a tap that lands just as the board
    // rolls over would be applied to a question they have not read.
    if (claim.question !== current.index) return { reject: "That question has moved on." };

    const row = current.answers[current.index];
    if (!row) return { reject: "That question has moved on." };
    if (row[seat]) return { reject: "You have already answered this one." };

    const question = questionAt(current, current.index);
    const correct = question !== null && claim.choice === question.answerIndex;
    const points = correct ? triviaAnswerPoints(current.openedAt, now) : 0;

    const nextRow: (TriviaAnswerRecord | null)[] = row.map((existing, entrySeat) =>
      entrySeat === seat ? { choice: claim.choice, at: now, correct, points } : existing,
    );
    const answers = current.answers.map((entry, index) =>
      index === current.index ? nextRow : entry,
    );
    const scores = current.scores.map((score, index) =>
      index === seat ? score + points : score,
    );

    // Both in? The question closes now rather than burning the rest of its
    // window -- nobody is left to answer, and waiting out a dead clock is the
    // slowest part of every quiz game ever built.
    const bothAnswered = nextRow.length === 2 && nextRow.every((entry) => entry !== null);

    return {
      next: {
        ...current,
        answers,
        scores,
        revealAt: bothAnswered ? now : current.revealAt,
      },
    };
  },

  tick(state, now) {
    return advanced(state, now);
  },

  result(state) {
    if (state.resignedBy !== null) {
      return { winner: otherSeat(state.resignedBy), reason: "Resigned" };
    }
    if (state.index < state.questionIds.length) return null;

    const first = state.scores[0] ?? 0;
    const second = state.scores[1] ?? 0;
    // A scoreline, which is the contract's own example of an acceptable
    // reason -- winner first, so the card reads the same way round as the
    // "You win" above it.
    if (first === second) return { winner: null, reason: `${first} - ${second}` };
    const winner: DuelSeat = first > second ? 0 : 1;
    const outcome: DuelOutcome = {
      winner,
      reason: `${Math.max(first, second)} - ${Math.min(first, second)}`,
    };
    return outcome;
  },

  snapshot(state, seat, now) {
    // Advanced here too, and not only in `tick`: a read can land before the
    // tick's write does, and a board showing a question whose clock ran out
    // ten seconds ago is worse than one that is a version behind.
    const current = advanced(state, now) ?? state;
    const phase = triviaPhase(current);
    const revealing = phase === "reveal";
    const total = current.questionIds.length;
    const question = phase === "done" ? null : questionAt(current, current.index);
    const row = current.answers[current.index] ?? [];

    const seats: TriviaSeatView[] = [0, 1].map((index) => {
      const answer = row[index] ?? null;
      const view: TriviaSeatView = {
        score: current.scores[index] ?? 0,
        // Public for both seats on purpose: it says THAT they answered, never
        // what, and the lamp lighting up across the table is the tension.
        answered: answer !== null,
      };
      // The viewer's own answer is theirs to see immediately. The other seat's
      // waits for the reveal -- and a spectator (`seat === null`) matches
      // neither branch, so an unknown viewer is the most restricted, not the
      // least.
      if (answer && (revealing || index === seat)) {
        view.choice = answer.choice;
        view.correct = answer.correct;
        view.points = answer.points;
      }
      return view;
    });

    const view: TriviaQuestionView | null = question
      ? {
          category: question.category,
          prompt: question.prompt,
          choices: [...question.choices],
        }
      : null;
    // Assigned rather than spread in conditionally, so there is exactly one
    // line to read when asking "when can the answer escape". While the
    // question is live the key is not on the object at all.
    if (view && revealing) view.answerIndex = question?.answerIndex ?? -1;

    const remainingMs =
      phase === "done"
        ? 0
        : revealing
          ? Math.max(0, (current.revealAt ?? now) + TRIVIA_REVEAL_MS - now)
          : Math.max(0, current.openedAt + TRIVIA_QUESTION_MS - now);

    return {
      viewer: seat,
      total,
      questionNumber: Math.min(current.index + 1, total),
      phase,
      question: view,
      remainingMs,
      phaseMs: phase === "done" ? 0 : revealing ? TRIVIA_REVEAL_MS : TRIVIA_QUESTION_MS,
      seats,
      // Only questions already played out. The open one is deliberately not
      // here, or the reveal would have leaked a question early.
      history: current.answers
        .slice(0, current.index)
        .map((entry) => [entry[0]?.correct ?? false, entry[1]?.correct ?? false]),
    };
  },

  resign(state, seat) {
    // Recorded rather than acted on: `result` reads it, and leaving the rest
    // of the state alone means a resignation cannot also silently rescore a
    // question that was in flight.
    return { ...state, resignedBy: seat };
  },
});

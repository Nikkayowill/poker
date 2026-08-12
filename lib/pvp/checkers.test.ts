import { describe, expect, it } from "vitest";
import {
  CHECKERS_CLOCK_MS,
  CHECKERS_DUEL,
  CHECKERS_IDLE_PLY_LIMIT,
  CHECKERS_INCREMENT_MS,
  applyCheckersMove,
  checkersResult,
  checkersSnapshot,
  createCheckersState,
  isPlayableSquare,
  legalCheckersMoves,
  openingBoard,
  remainingMs,
  resignCheckers,
  tickCheckers,
  type CheckersState,
} from "./checkers";
import type { DuelSeat } from "./match-contract";

/**
 * The rules, exhaustively -- mandatory capture and jump chains are where a
 * checkers implementation goes wrong, and both are invisible to tsc.
 *
 * Positions are written as eight row strings, row 0 first, so a test reads
 * like the board it describes. Row 0 is seat 1's home row; seat 0 (r/R) moves
 * UP toward it.
 */
const EMPTY = "........";

/**
 * Builds a board from eight row strings, checking the shape as it goes.
 *
 * Throws rather than asserting: these run at module load, outside any test,
 * where a failed expectation has nowhere to be reported.
 */
function rows(...eight: string[]): string {
  if (eight.length !== 8 || eight.some((row) => row.length !== 8)) {
    throw new Error("a board is eight rows of eight");
  }
  return eight.join("");
}

function stateOf(board: string, turn: DuelSeat, patch: Partial<CheckersState> = {}): CheckersState {
  return {
    board,
    turn,
    turnStartedAt: 0,
    clocks: [CHECKERS_CLOCK_MS, CHECKERS_CLOCK_MS],
    idlePlies: 0,
    repetitions: {},
    outcome: null,
    ...patch,
  };
}

/** Unwraps an accepted move, failing loudly rather than returning undefined. */
function played(
  state: CheckersState,
  seat: DuelSeat,
  move: unknown,
  now = 1000,
): CheckersState {
  const result = applyCheckersMove(state, seat, move, now);
  if (!("next" in result)) throw new Error(`expected a legal move, got: ${result.reject}`);
  return result.next;
}

function rejection(state: CheckersState, seat: DuelSeat, move: unknown, now = 1000): string {
  const result = applyCheckersMove(state, seat, move, now);
  if (!("reject" in result)) throw new Error("expected the move to be refused");
  return result.reject;
}

/* ---------------------------------------------------------------- opening */

describe("the opening position", () => {
  it("sets twelve men a side on the dark squares", () => {
    const board = openingBoard();
    expect(board).toHaveLength(64);
    expect([...board].filter((cell) => cell === "r")).toHaveLength(12);
    expect([...board].filter((cell) => cell === "b")).toHaveLength(12);
    for (let square = 0; square < 64; square += 1) {
      if (!isPlayableSquare(square)) expect(board[square]).toBe(".");
    }
  });

  it("puts seat 1 on the top three rows and seat 0 on the bottom three", () => {
    const board = openingBoard();
    expect(board.slice(0, 24)).not.toContain("r");
    expect(board.slice(40)).not.toContain("b");
    expect(board.slice(24, 40)).toBe(EMPTY.repeat(2));
  });

  it("gives seat 0 the move, a full clock each, and seven opening moves", () => {
    const state = createCheckersState(7, 5_000);
    expect(state.turn).toBe(0);
    expect(state.clocks).toEqual([CHECKERS_CLOCK_MS, CHECKERS_CLOCK_MS]);
    expect(state.turnStartedAt).toBe(5_000);
    expect(legalCheckersMoves(state.board, 0)).toHaveLength(7);
  });

  it("ignores the seed -- checkers has no random setup", () => {
    expect(createCheckersState(1, 0).board).toBe(createCheckersState(999_999, 0).board);
  });
});

/* ------------------------------------------------------------ simple moves */

/** One red man in the middle, one black king out of the way in the corner. */
const LONE_MAN = rows(".B......", EMPTY, EMPTY, EMPTY, "...r....", EMPTY, EMPTY, EMPTY);
const LONE_KING = rows(".B......", EMPTY, EMPTY, EMPTY, "...R....", EMPTY, EMPTY, EMPTY);

describe("simple moves", () => {
  it("moves a man one square diagonally forward", () => {
    const next = played(stateOf(LONE_MAN, 0), 0, { from: 35, path: [26] });
    expect(next.board[35]).toBe(".");
    expect(next.board[26]).toBe("r");
    expect(next.turn).toBe(1);
  });

  it("refuses a man moving backwards", () => {
    expect(rejection(stateOf(LONE_MAN, 0), 0, { from: 35, path: [42] }))
      .toBe("That is not a legal move.");
  });

  it("lets a king move backwards", () => {
    const next = played(stateOf(LONE_KING, 0), 0, { from: 35, path: [42] });
    expect(next.board[42]).toBe("R");
  });

  it("refuses a move from the seat that is not to move", () => {
    const state = createCheckersState(0, 0);
    expect(rejection(state, 1, { from: 17, path: [24] })).toBe("It is not your turn.");
    expect(state.board).toBe(openingBoard());
  });

  it("refuses any move once the match is over", () => {
    const state = stateOf(LONE_MAN, 0, { outcome: { winner: 1, reason: "Resigned" } });
    expect(rejection(state, 0, { from: 35, path: [26] })).toBe("This match is already over.");
  });
});

/* ------------------------------------------------------- mandatory capture */

/**
 * Red 35 must jump the black man on 28 and land on 21. The red man on 49 has
 * two quiet moves available and neither of them may be played.
 */
const ONE_JUMP = rows(".B......", EMPTY, EMPTY, "....b...", "...r....", EMPTY, ".r......", EMPTY);

describe("mandatory capture", () => {
  it("generates only jumps when a jump exists", () => {
    const moves = legalCheckersMoves(ONE_JUMP, 0);
    expect(moves).toEqual([{ from: 35, path: [21], captures: [28] }]);
  });

  it("refuses a quiet move by another piece while a jump is available", () => {
    expect(rejection(stateOf(ONE_JUMP, 0), 0, { from: 49, path: [40] }))
      .toBe("A jump is available, so you have to take it.");
  });

  it("refuses the jumping piece's own quiet move too", () => {
    expect(rejection(stateOf(ONE_JUMP, 0), 0, { from: 35, path: [26] }))
      .toBe("A jump is available, so you have to take it.");
  });

  it("takes the jumped piece off the board", () => {
    const next = played(stateOf(ONE_JUMP, 0), 0, { from: 35, path: [21] });
    expect(next.board[35]).toBe(".");
    expect(next.board[28]).toBe(".");
    expect(next.board[21]).toBe("r");
    expect(next.turn).toBe(1);
  });

  it("does not let a man jump backwards", () => {
    // Black sits BEHIND the red man, with an empty square beyond it. An
    // international-draughts man would take it; an English one may not.
    const backward = rows(".B......", EMPTY, EMPTY, EMPTY, "...r....", "..b.....", EMPTY, EMPTY);
    const moves = legalCheckersMoves(backward, 0);
    expect(moves.every((move) => move.captures.length === 0)).toBe(true);
    expect(moves.map((move) => move.path[0]).sort((a, b) => a - b)).toEqual([26, 28]);
  });
});

/* ------------------------------------------------------------- jump chains */

/** Red 42 takes 35 landing on 28, then must take 21 landing on 14. */
const DOUBLE_JUMP = rows(
  ".B......", EMPTY, ".....b..", EMPTY, "...b....", "..r.....", EMPTY, EMPTY,
);

describe("jump chains", () => {
  it("returns the whole chain as one move", () => {
    expect(legalCheckersMoves(DOUBLE_JUMP, 0)).toEqual([
      { from: 42, path: [28, 14], captures: [35, 21] },
    ]);
  });

  it("plays the chain as a single turn", () => {
    const next = played(stateOf(DOUBLE_JUMP, 0), 0, { from: 42, path: [28, 14] });
    expect(next.board[42]).toBe(".");
    expect(next.board[35]).toBe(".");
    expect(next.board[21]).toBe(".");
    expect(next.board[14]).toBe("r");
    expect(next.turn).toBe(1);
  });

  it("refuses a chain that stops early", () => {
    expect(rejection(stateOf(DOUBLE_JUMP, 0), 0, { from: 42, path: [28] }))
      .toBe("Finish the jump -- that piece has to keep taking.");
  });

  it("refuses a chain that invents a leg", () => {
    expect(rejection(stateOf(DOUBLE_JUMP, 0), 0, { from: 42, path: [28, 14, 5] }))
      .toBe("A jump is available, so you have to take it.");
  });

  it("offers both branches when a chain forks, and neither may stop short", () => {
    // Red 42 takes 35 and lands on 28, from where either 19 or 21 can be
    // taken. Two complete turns, and no legal move that ends on 28.
    const fork = rows(
      EMPTY, EMPTY, "...b.b..", EMPTY, "...b....", "..r.....", EMPTY, "B.......",
    );
    expect(legalCheckersMoves(fork, 0)).toEqual([
      { from: 42, path: [28, 10], captures: [35, 19] },
      { from: 42, path: [28, 14], captures: [35, 21] },
    ]);
    expect(rejection(stateOf(fork, 0), 0, { from: 42, path: [28] }))
      .toBe("Finish the jump -- that piece has to keep taking.");
  });
});

/* ---------------------------------------------------------------- crowning */

/**
 * Red 17 takes the man on 10 and lands on 3, the crown row. A king standing on
 * 3 could go on to take 12 and land on 21 -- and must not, because the crown
 * ends the turn.
 */
const CROWNING = rows("........", "..b.b...", ".r......", EMPTY, EMPTY, EMPTY, EMPTY, EMPTY);

describe("crowning", () => {
  it("crowns a man that reaches the far row", () => {
    const quiet = rows(EMPTY, "r.......", EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, "B.......");
    const next = played(stateOf(quiet, 0), 0, { from: 8, path: [1] });
    expect(next.board[1]).toBe("R");
  });

  it("crowns a man that arrives by jumping", () => {
    const next = played(stateOf(CROWNING, 0), 0, { from: 17, path: [3] });
    expect(next.board[3]).toBe("R");
    expect(next.board[10]).toBe(".");
  });

  it("ends the turn on the crown even though the new king could jump again", () => {
    expect(legalCheckersMoves(CROWNING, 0)).toEqual([
      { from: 17, path: [3], captures: [10] },
    ]);
    expect(rejection(stateOf(CROWNING, 0), 0, { from: 17, path: [3, 21] })).toBeTruthy();
    expect(played(stateOf(CROWNING, 0), 0, { from: 17, path: [3] }).turn).toBe(1);
  });

  it("does not stop a piece that was already a king", () => {
    // The same position with a king on 17: there is no crown to earn, so it
    // crosses the far row and keeps taking. This is the contrast that makes
    // the rule above a rule rather than an accident of the board.
    const alreadyKing = rows("........", "..b.b...", ".R......", EMPTY, EMPTY, EMPTY, EMPTY, EMPTY);
    expect(legalCheckersMoves(alreadyKing, 0)).toEqual([
      { from: 17, path: [3, 21], captures: [10, 12] },
    ]);
  });
});

/* ------------------------------------------------------------------- wins */

describe("winning", () => {
  it("wins by taking the last piece", () => {
    const lastPiece = rows(EMPTY, EMPTY, EMPTY, "....b...", "...r....", EMPTY, EMPTY, EMPTY);
    const next = played(stateOf(lastPiece, 0), 0, { from: 35, path: [21] });
    expect(checkersResult(next)).toEqual({ winner: 0, reason: "No pieces left" });
  });

  it("wins by leaving the opponent no legal move", () => {
    // Black's only man sits on 1 with both forward squares blocked, and the
    // square beyond the second blocker occupied so it cannot jump out either.
    const smothered = rows(".b......", "r.r.....", "...r....", EMPTY, EMPTY, "r.......", EMPTY, EMPTY);
    const next = played(stateOf(smothered, 0), 0, { from: 40, path: [33] });
    expect(legalCheckersMoves(next.board, 1)).toEqual([]);
    expect(checkersResult(next)).toEqual({ winner: 0, reason: "No moves left" });
  });

  it("is still playing while both sides have a move", () => {
    expect(checkersResult(createCheckersState(0, 0))).toBeNull();
  });
});

/* ------------------------------------------------------------------ draws */

/** Two kings that cannot touch each other, so nothing irreversible can happen. */
const TWO_KINGS = rows(".B......", EMPTY, EMPTY, EMPTY, "...R....", EMPTY, EMPTY, EMPTY);

describe("draws", () => {
  it("draws after 40 moves each with no capture and no man moved", () => {
    const state = stateOf(TWO_KINGS, 0, { idlePlies: CHECKERS_IDLE_PLY_LIMIT - 1 });
    const next = played(state, 0, { from: 35, path: [42] });
    expect(next.idlePlies).toBe(CHECKERS_IDLE_PLY_LIMIT);
    expect(checkersResult(next)).toEqual({ winner: null, reason: "40-move rule" });
  });

  it("resets the idle counter on a man move and on a capture", () => {
    const manMove = played(stateOf(LONE_MAN, 0, { idlePlies: 12 }), 0, { from: 35, path: [26] });
    expect(manMove.idlePlies).toBe(0);

    const capture = played(stateOf(ONE_JUMP, 0, { idlePlies: 12 }), 0, { from: 35, path: [21] });
    expect(capture.idlePlies).toBe(0);
    // Everything before an irreversible move is unreachable, so the record is
    // emptied and holds only the position the capture itself produced.
    expect(Object.values(capture.repetitions)).toEqual([1]);
  });

  it("draws on the third occurrence of a position", () => {
    // Two kings shuffling: 35 <-> 42 for red, 1 <-> 10 for black. Nothing
    // irreversible can happen, so every position recurs every cycle.
    const cycle: Array<{ seat: DuelSeat; move: { from: number; path: number[] } }> = [
      { seat: 0, move: { from: 35, path: [42] } },
      { seat: 1, move: { from: 1, path: [10] } },
      { seat: 0, move: { from: 42, path: [35] } },
      { seat: 1, move: { from: 10, path: [1] } },
    ];

    let state = stateOf(TWO_KINGS, 0);
    let plies = 0;
    while (state.outcome === null && plies < 40) {
      const step = cycle[plies % cycle.length];
      state = played(state, step.seat, step.move, 1000 + plies);
      plies += 1;
    }
    expect(checkersResult(state)).toEqual({ winner: null, reason: "Threefold repetition" });
    // Nine plies: the position after red's first move recurs on plies 5 and 9.
    expect(plies).toBe(9);
  });

});

/* ------------------------------------------------------------------ clocks */

describe("clocks", () => {
  it("spends only the mover's time", () => {
    const state = stateOf(LONE_MAN, 0, { turnStartedAt: 1_000 });
    expect(remainingMs(state, 0, 4_000)).toBe(CHECKERS_CLOCK_MS - 3_000);
    expect(remainingMs(state, 1, 4_000)).toBe(CHECKERS_CLOCK_MS);
  });

  it("banks the increment when a move is played", () => {
    const state = stateOf(LONE_MAN, 0);
    const next = played(state, 0, { from: 35, path: [26] }, 5_000);
    expect(next.clocks[0]).toBe(CHECKERS_CLOCK_MS - 5_000 + CHECKERS_INCREMENT_MS);
    expect(next.clocks[1]).toBe(CHECKERS_CLOCK_MS);
    expect(next.turnStartedAt).toBe(5_000);
  });

  it("returns null from tick when nothing has changed", () => {
    const state = stateOf(LONE_MAN, 0, { clocks: [10_000, 10_000] });
    expect(tickCheckers(state, 0)).toBeNull();
    expect(tickCheckers(state, 5_000)).toBeNull();
    expect(tickCheckers(state, 9_999)).toBeNull();
  });

  it("returns null from tick on a match that is already over", () => {
    const over = stateOf(LONE_MAN, 0, {
      clocks: [0, 10_000],
      outcome: { winner: 1, reason: "Resigned" },
    });
    expect(tickCheckers(over, 10_000_000)).toBeNull();
  });

  it("drops the flag without either player acting", () => {
    const state = stateOf(LONE_MAN, 0, { clocks: [10_000, 10_000] });
    const flagged = tickCheckers(state, 10_001);
    expect(flagged).not.toBeNull();
    expect(checkersResult(flagged as CheckersState)).toEqual({ winner: 1, reason: "Timeout" });
    expect((flagged as CheckersState).clocks[0]).toBe(0);
  });

  it("settles a move attempted after the flag fell", () => {
    const state = stateOf(LONE_MAN, 0, { clocks: [10_000, 10_000] });
    const next = played(state, 0, { from: 35, path: [26] }, 20_000);
    expect(checkersResult(next)).toEqual({ winner: 1, reason: "Timeout" });
    // The move itself was not played -- the flag ended the match instead.
    expect(next.board[35]).toBe("r");
  });

  it("freezes the clocks once the match is over", () => {
    const state = stateOf(LONE_MAN, 0, { clocks: [10_000, 10_000] });
    const flagged = tickCheckers(state, 10_001) as CheckersState;
    expect(remainingMs(flagged, 0, 999_999)).toBe(0);
    expect(remainingMs(flagged, 1, 999_999)).toBe(10_000);
  });

  it("does not hand the mover time when the clock runs backwards", () => {
    const state = stateOf(LONE_MAN, 0, { turnStartedAt: 10_000 });
    expect(remainingMs(state, 0, 1_000)).toBe(CHECKERS_CLOCK_MS);
  });
});

/* --------------------------------------------------------------- resigning */

describe("resigning", () => {
  it("hands the match to the other seat", () => {
    expect(checkersResult(resignCheckers(stateOf(LONE_MAN, 0), 0, 1_000)))
      .toEqual({ winner: 1, reason: "Resigned" });
    expect(checkersResult(resignCheckers(stateOf(LONE_MAN, 0), 1, 1_000)))
      .toEqual({ winner: 0, reason: "Resigned" });
  });

  it("does not rewrite a match that already ended", () => {
    const over = stateOf(LONE_MAN, 0, { outcome: { winner: 0, reason: "Timeout" } });
    expect(checkersResult(resignCheckers(over, 0, 1_000)))
      .toEqual({ winner: 0, reason: "Timeout" });
  });
});

/* ------------------------------------------------------- untrusted payloads */

describe("a move is a claim, not an instruction", () => {
  const junk: unknown[] = [
    null,
    undefined,
    5,
    "35",
    [35, 26],
    {},
    { from: 35 },
    { from: 35, path: [] },
    { from: 35, path: {} },
    { from: "35", path: [26] },
    { from: 3.5, path: [26] },
    { from: -1, path: [26] },
    { from: 64, path: [26] },
    { from: 35, path: [64] },
    { from: 35, path: ["26"] },
    { from: 35, path: [26, null] },
    { from: 35, path: new Array<number>(13).fill(26) },
  ];

  it.each(junk.map((move, index) => [index, move] as const))(
    "refuses malformed payload %i without throwing",
    (_index, move) => {
      const result = applyCheckersMove(stateOf(LONE_MAN, 0), 0, move, 1_000);
      expect(result).toEqual({ reject: expect.any(String) });
    },
  );
});

/* --------------------------------------------------------------- snapshots */

describe("the snapshot", () => {
  it("shows both seats the same board", () => {
    const state = createCheckersState(0, 0);
    expect(checkersSnapshot(state, 0, 0).board).toBe(checkersSnapshot(state, 1, 0).board);
  });

  it("sends legal moves only to the seat that is to move", () => {
    const state = createCheckersState(0, 0);
    expect(checkersSnapshot(state, 0, 0).legalMoves).toHaveLength(7);
    expect(checkersSnapshot(state, 1, 0).legalMoves).toEqual([]);
    expect(checkersSnapshot(state, null, 0).legalMoves).toEqual([]);
  });

  it("says when a jump is forced", () => {
    expect(checkersSnapshot(stateOf(ONE_JUMP, 0), 0, 0).mustJump).toBe(true);
    expect(checkersSnapshot(createCheckersState(0, 0), 0, 0).mustJump).toBe(false);
  });

  it("reports live clocks and piece counts", () => {
    const state = stateOf(ONE_JUMP, 0, { turnStartedAt: 1_000 });
    const snapshot = checkersSnapshot(state, 0, 4_000);
    expect(snapshot.clocks).toEqual([CHECKERS_CLOCK_MS - 3_000, CHECKERS_CLOCK_MS]);
    expect(snapshot.pieces).toEqual([2, 2]);
  });

  it("offers no moves once the match is over", () => {
    const over = stateOf(ONE_JUMP, 0, { outcome: { winner: 1, reason: "Resigned" } });
    const snapshot = checkersSnapshot(over, 0, 0);
    expect(snapshot.legalMoves).toEqual([]);
    expect(snapshot.mustJump).toBe(false);
    expect(snapshot.outcome).toEqual({ winner: 1, reason: "Resigned" });
  });
});

/* ---------------------------------------------------------- registration */

describe("the registered game", () => {
  it("is wired into the duel contract", () => {
    expect(CHECKERS_DUEL.id).toBe("checkers");
    expect(CHECKERS_DUEL.label).toBe("Checkers");
    expect(typeof CHECKERS_DUEL.tick).toBe("function");
    expect(typeof CHECKERS_DUEL.resign).toBe("function");
  });

  it("survives a JSON round trip, since the state lives in a jsonb column", () => {
    const state = played(stateOf(ONE_JUMP, 0), 0, { from: 35, path: [21] });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(structuredClone(state)).toEqual(state);
  });
});

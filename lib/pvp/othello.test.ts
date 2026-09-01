import { describe, expect, it } from "vitest";
import {
  BOARD_SIDE,
  BOARD_SQUARES,
  OTHELLO_CLOCK_MS,
  OTHELLO_DUEL,
  OTHELLO_INCREMENT_MS,
  applyOthelloMove,
  cellOwner,
  countDiscs,
  createOthelloState,
  finalOutcome,
  flipsFor,
  legalOthelloMoves,
  openingBoard,
  othelloResult,
  othelloSnapshot,
  remainingMs,
  resignOthello,
  tickOthello,
  type OthelloCell,
  type OthelloState,
} from "./othello";
import type { DuelSeat } from "./match-contract";

const T0 = 1_000_000;

function square(row: number, col: number): number {
  return row * BOARD_SIDE + col;
}

/** A board from eight row strings, so a test position reads as the position. */
function board(...rows: string[]): string {
  expect(rows).toHaveLength(BOARD_SIDE);
  for (const row of rows) expect(row).toHaveLength(BOARD_SIDE);
  return rows.join("");
}

function stateOn(position: string, extra: Partial<OthelloState> = {}): OthelloState {
  return { ...createOthelloState(0, T0), board: position, ...extra };
}

/** Plays a move that must be legal, and hands back the next state. */
function play(state: OthelloState, seat: DuelSeat, sq: number, now = T0): OthelloState {
  const result = applyOthelloMove(state, seat, { square: sq }, now);
  if (!("next" in result)) throw new Error(`rejected: ${result.reject}`);
  return result.next;
}

describe("the opening position", () => {
  it("puts four discs in the middle, seat 1 on the main diagonal", () => {
    const opening = openingBoard();
    expect(opening).toHaveLength(BOARD_SQUARES);
    expect(opening[square(3, 3)]).toBe("w");
    expect(opening[square(4, 4)]).toBe("w");
    expect(opening[square(3, 4)]).toBe("b");
    expect(opening[square(4, 3)]).toBe("b");
    expect(countDiscs(opening, 0)).toBe(2);
    expect(countDiscs(opening, 1)).toBe(2);
  });

  it("is not symmetric under a quarter turn, which is what makes it the standard setup", () => {
    // Rotating the position 90 degrees swaps the colours; if this ever passes
    // as equal, the two discs have been placed on the wrong diagonal.
    const opening = openingBoard();
    const rotated = new Array<OthelloCell>(BOARD_SQUARES).fill(".");
    for (let sq = 0; sq < BOARD_SQUARES; sq += 1) {
      const row = Math.floor(sq / BOARD_SIDE);
      const col = sq % BOARD_SIDE;
      rotated[square(col, BOARD_SIDE - 1 - row)] = opening[sq] as OthelloCell;
    }
    expect(rotated.join("")).not.toBe(opening);
  });

  it("gives seat 0 the move and four openings, as Othello does", () => {
    const state = createOthelloState(0, T0);
    expect(state.turn).toBe(0);
    expect(legalOthelloMoves(state.board, 0).map((move) => move.square).sort((a, b) => a - b))
      .toEqual([square(2, 3), square(3, 2), square(4, 5), square(5, 4)]);
  });
});

describe("legal moves", () => {
  it("counts a square as a move only when it brackets something", () => {
    const state = createOthelloState(0, T0);
    // Empty and adjacent to a disc, but nothing of seat 0's closes the ray.
    expect(flipsFor([...state.board] as OthelloCell[], 0, square(2, 2))).toEqual([]);
    expect(legalOthelloMoves(state.board, 0).some((move) => move.square === square(2, 2))).toBe(false);
  });

  it("never counts an occupied square", () => {
    const state = createOthelloState(0, T0);
    expect(flipsFor([...state.board] as OthelloCell[], 0, square(3, 3))).toEqual([]);
  });

  it("flips every direction a move brackets in, at once", () => {
    // (3,4) is empty, every one of its eight neighbours is seat 1's, and every
    // ray out of it closes on one of seat 0's. All eight lines turn over in the
    // one move, which is the rule a per-direction early return would break.
    const ring = board(
      "........",
      "..b.b.b.",
      "...www..",
      ".bww.wwb",
      "...www..",
      "..b.b.b.",
      "........",
      "........",
    );
    const flips = flipsFor([...ring] as OthelloCell[], 0, square(3, 4));
    // Two apiece along the row, one down each of the other six rays.
    expect(flips).toHaveLength(10);
    for (const neighbour of [
      square(2, 3), square(2, 4), square(2, 5),
      square(3, 3), square(3, 5),
      square(4, 3), square(4, 4), square(4, 5),
    ]) {
      expect(flips).toContain(neighbour);
    }
  });

  it("stops a ray at an empty square rather than jumping it", () => {
    const position = board(
      "........",
      "........",
      "........",
      ".w.wb...",
      "........",
      "........",
      "........",
      "........",
    );
    // Playing (3,0) walks w, then hits an empty square before reaching a b.
    expect(flipsFor([...position] as OthelloCell[], 0, square(3, 0))).toEqual([]);
  });

  it("stops a ray at the edge rather than wrapping to the next row", () => {
    const position = board(
      "........",
      "........",
      "........",
      "......ww",
      "b.......",
      "........",
      "........",
      "........",
    );
    // Walking right from (3,5) runs out of board after two white discs. The
    // only seat 0 disc anywhere is at (4,0), which is where the ray would
    // arrive if columns wrapped into the next row.
    expect(flipsFor([...position] as OthelloCell[], 0, square(3, 5))).toEqual([]);
  });
});

describe("playing a move", () => {
  it("places the disc, turns the bracketed line over, and passes the turn", () => {
    const state = createOthelloState(0, T0);
    const next = play(state, 0, square(2, 3));

    expect(next.board[square(2, 3)]).toBe("b");
    expect(next.board[square(3, 3)]).toBe("b"); // was white, bracketed by (4,3)
    expect(countDiscs(next.board, 0)).toBe(4);
    expect(countDiscs(next.board, 1)).toBe(1);
    expect(next.turn).toBe(1);
    expect(next.passed).toBe(false);
  });

  it("banks the mover's time and adds the increment", () => {
    const state = createOthelloState(0, T0);
    const next = play(state, 0, square(2, 3), T0 + 12_000);
    expect(next.clocks[0]).toBe(OTHELLO_CLOCK_MS - 12_000 + OTHELLO_INCREMENT_MS);
    expect(next.clocks[1]).toBe(OTHELLO_CLOCK_MS);
    expect(next.turnStartedAt).toBe(T0 + 12_000);
  });

  it("refuses a move from the seat that is not to play", () => {
    const state = createOthelloState(0, T0);
    expect(applyOthelloMove(state, 1, { square: square(2, 3) }, T0))
      .toEqual({ reject: "It is not your turn." });
  });

  it("refuses a square that is taken, and says which problem it is", () => {
    const state = createOthelloState(0, T0);
    expect(applyOthelloMove(state, 0, { square: square(3, 3) }, T0))
      .toEqual({ reject: "That square is taken." });
    expect(applyOthelloMove(state, 0, { square: square(0, 0) }, T0))
      .toEqual({ reject: "That square flips nothing, so it is not a move." });
  });

  it("refuses a payload that is not a move at all, rather than throwing", () => {
    const state = createOthelloState(0, T0);
    for (const claim of [null, undefined, 4, "e4", [], {}, { square: -1 }, { square: 64 }, { square: 1.5 }]) {
      expect(applyOthelloMove(state, 0, claim, T0)).toEqual({ reject: "That is not a move." });
    }
  });

  it("refuses any move once the match is over", () => {
    const state = resignOthello(createOthelloState(0, T0), 0, T0);
    expect(applyOthelloMove(state, 1, { square: square(2, 3) }, T0))
      .toEqual({ reject: "This match is already over." });
  });
});

describe("the pass rule", () => {
  it("hands the turn back when the opponent has nothing to play", () => {
    // Seat 0 plays (0,3) and takes the pair to its left. Seat 1 still has the
    // disc at (0,4) but no square anywhere that brackets a black run, so the
    // turn comes straight back to seat 0 -- who does still have (0,5).
    const position = board(
      "bww.w...",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    );
    const state = stateOn(position, { turn: 0 });
    const next = play(state, 0, square(0, 3));

    expect(next.board.slice(0, 5)).toBe("bbbbw");
    expect(legalOthelloMoves(next.board, 1)).toEqual([]);
    expect(legalOthelloMoves(next.board, 0).length).toBeGreaterThan(0);
    expect(next.turn).toBe(0);
    expect(next.passed).toBe(true);
    expect(next.outcome).toBeNull();
  });

  it("ends the match when neither side can move, empty squares or not", () => {
    // Seat 0 takes seat 1's last disc: nobody has a move left, and the board
    // still has 60 empty squares on it.
    const position = board(
      "bw......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    );
    const state = stateOn(position, { turn: 0 });
    const next = play(state, 0, square(0, 2));
    // Seat 0 now has three discs in a row and seat 1 has none, so seat 0's own
    // next move also flips nothing: the match is over on the following play.
    expect(legalOthelloMoves(next.board, 0)).toEqual([]);
    expect(legalOthelloMoves(next.board, 1)).toEqual([]);
  });

  it("settles a wipe-out as its own reason rather than a lopsided score line", () => {
    expect(finalOutcome(board(
      "bbb.....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ))).toEqual({ winner: 0, reason: "Wiped out" });
  });
});

describe("the ending", () => {
  it("scores a finished board by disc count, higher first", () => {
    const position = board(
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "wwwwwwww",
      "wwwwwwww",
      "wwwwwwww",
      "wwwwwwwb",
    );
    expect(finalOutcome(position)).toEqual({ winner: 0, reason: "33 - 31" });
  });

  it("calls an equal board a draw, not a win for either", () => {
    const position = board(
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "wwwwwwww",
      "wwwwwwww",
      "wwwwwwww",
      "wwwwwwww",
    );
    expect(finalOutcome(position)).toEqual({ winner: null, reason: "32 - 32" });
  });

  it("plays a whole game out to a finished board", () => {
    // Both sides play the first legal move they are offered, which is not good
    // Othello but is a complete one: it has to terminate, since every move
    // fills a square, and it has to end with an outcome.
    let state = createOthelloState(0, T0);
    let plies = 0;
    while (state.outcome === null) {
      const moves = legalOthelloMoves(state.board, state.turn);
      expect(moves.length).toBeGreaterThan(0);
      state = play(state, state.turn, moves[0].square, T0 + plies * 100);
      plies += 1;
      expect(plies).toBeLessThanOrEqual(61);
    }
    expect(othelloResult(state)).not.toBeNull();
    expect(countDiscs(state.board, 0) + countDiscs(state.board, 1)).toBeGreaterThan(4);
  });
});

describe("the clock", () => {
  it("only drains for the seat to move, and only while the match is live", () => {
    const state = createOthelloState(0, T0);
    expect(remainingMs(state, 0, T0 + 30_000)).toBe(OTHELLO_CLOCK_MS - 30_000);
    expect(remainingMs(state, 1, T0 + 30_000)).toBe(OTHELLO_CLOCK_MS);

    const over = resignOthello(state, 1, T0 + 30_000);
    expect(remainingMs(over, 0, T0 + 90_000)).toBe(remainingMs(over, 0, T0 + 30_000));
  });

  it("ends the match when a flag falls, and hands the pot to the other seat", () => {
    const state = createOthelloState(0, T0);
    expect(tickOthello(state, T0 + 10_000)).toBeNull();

    const flagged = tickOthello(state, T0 + OTHELLO_CLOCK_MS + 1);
    expect(flagged?.outcome).toEqual({ winner: 1, reason: "Timeout" });
    expect(flagged?.clocks[0]).toBe(0);
  });

  it("returns null when nothing changed, so a poll cannot livelock the version guard", () => {
    const state = createOthelloState(0, T0);
    expect(tickOthello(state, T0)).toBeNull();
    expect(tickOthello(state, T0 + 1000)).toBeNull();
    const over = resignOthello(state, 0, T0);
    expect(tickOthello(over, T0 + OTHELLO_CLOCK_MS * 10)).toBeNull();
  });

  it("settles rather than rejects when a player moves after their own flag fell", () => {
    const state = createOthelloState(0, T0);
    const late = applyOthelloMove(state, 0, { square: square(2, 3) }, T0 + OTHELLO_CLOCK_MS + 5);
    expect("next" in late && late.next.outcome).toEqual({ winner: 1, reason: "Timeout" });
  });
});

describe("resigning", () => {
  it("hands the match to the other seat whatever the score says", () => {
    // Seat 0 is comfortably ahead and quits anyway.
    const position = board(
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbbbbbb",
      "bbbwwwww",
      "........",
      "........",
      "........",
      "........",
    );
    const state = stateOn(position, { turn: 0 });
    expect(resignOthello(state, 0, T0).outcome).toEqual({ winner: 1, reason: "Resigned" });
  });

  it("never rewrites a match that already ended", () => {
    const flagged = tickOthello(createOthelloState(0, T0), T0 + OTHELLO_CLOCK_MS + 1)!;
    expect(resignOthello(flagged, 1, T0 + OTHELLO_CLOCK_MS + 2)).toBe(flagged);
  });
});

describe("the snapshot", () => {
  it("gives the legal-move list only to the seat actually to move", () => {
    const state = createOthelloState(0, T0);
    expect(othelloSnapshot(state, 0, T0).legalMoves).toHaveLength(4);
    expect(othelloSnapshot(state, 1, T0).legalMoves).toEqual([]);
    // The most restrictive view for a viewer whose seat is unknown.
    expect(othelloSnapshot(state, null, T0).legalMoves).toEqual([]);
  });

  it("shows both players the same board and score", () => {
    const state = createOthelloState(0, T0);
    const black = othelloSnapshot(state, 0, T0);
    const white = othelloSnapshot(state, 1, T0);
    expect(black.board).toBe(white.board);
    expect(black.discs).toEqual([2, 2]);
    expect(black.empty).toBe(60);
  });

  it("hands out no moves once the match is over", () => {
    const over = resignOthello(createOthelloState(0, T0), 1, T0);
    expect(othelloSnapshot(over, 0, T0).legalMoves).toEqual([]);
    expect(othelloSnapshot(over, 0, T0).outcome).toEqual({ winner: 0, reason: "Resigned" });
  });
});

describe("the registration", () => {
  it("registers under the id the catalog, the route and the leaderboard all use", () => {
    expect(OTHELLO_DUEL.id).toBe("othello");
    expect(OTHELLO_DUEL.label).toBe("Othello");
  });

  it("supplies every hook the money layer calls", () => {
    expect(typeof OTHELLO_DUEL.createState).toBe("function");
    expect(typeof OTHELLO_DUEL.applyMove).toBe("function");
    expect(typeof OTHELLO_DUEL.tick).toBe("function");
    expect(typeof OTHELLO_DUEL.result).toBe("function");
    expect(typeof OTHELLO_DUEL.snapshot).toBe("function");
    expect(typeof OTHELLO_DUEL.resign).toBe("function");
  });

  it("ignores the seed, since nothing about the setup is random", () => {
    expect(createOthelloState(1, T0).board).toBe(createOthelloState(999_999, T0).board);
  });
});

describe("cell ownership", () => {
  it("maps discs to seats and an empty square to nobody", () => {
    expect(cellOwner("b")).toBe(0);
    expect(cellOwner("w")).toBe(1);
    expect(cellOwner(".")).toBeNull();
  });
});

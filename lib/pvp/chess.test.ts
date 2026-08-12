import { describe, expect, it } from "vitest";
import {
  CHESS_DUEL,
  CLOCK_INCREMENT_MS,
  CLOCK_START_MS,
  applyLegalMove,
  canMate,
  inCheck,
  insufficientMaterial,
  legalMoves,
  positionKey,
  squareIndex,
  squareName,
  startingBoard,
  type ChessMove,
  type ChessPosition,
  type ChessSnapshot,
  type ChessSquare,
  type ChessState,
} from "./chess";
import type { DuelGame, DuelSeat } from "./match-contract";

/**
 * The engine, with its types put back on.
 *
 * `defineDuelGame` erases them so the registry can hold four games in one Map;
 * the checking already happened at the definition site, so re-applying the
 * shape here costs nothing and lets every assertion below be a real type
 * error rather than a runtime surprise.
 */
const chess = CHESS_DUEL as unknown as DuelGame<ChessState, ChessMove, ChessSnapshot>;

/* ------------------------------------------------------------- scaffolding */

/**
 * A state from a FEN string.
 *
 * Test scaffolding, not a feature: castling through check, en passant and the
 * fifty-move rule all need a position that is thirty moves deep, and reaching
 * each one by playing the moves would make the failure message useless.
 */
function fromFen(fen: string, now = 0): ChessState {
  const [placement, side, rights, ep, half, full] = fen.trim().split(/\s+/);
  const board: ChessSquare[] = new Array<ChessSquare>(64).fill("");
  placement.split("/").forEach((row, index) => {
    // FEN starts at rank 8 and this board indexes from rank 1.
    const rank = 7 - index;
    let file = 0;
    for (const char of row) {
      if (char >= "1" && char <= "8") {
        file += Number(char);
        continue;
      }
      board[rank * 8 + file] = char as ChessSquare;
      file += 1;
    }
  });

  const position: ChessPosition = {
    board,
    turn: side === "b" ? 1 : 0,
    castling: {
      whiteKing: rights.includes("K"),
      whiteQueen: rights.includes("Q"),
      blackKing: rights.includes("k"),
      blackQueen: rights.includes("q"),
    },
    enPassant: ep && ep !== "-" ? squareIndex(ep) : null,
    halfmoveClock: Number(half ?? 0),
    fullmoveNumber: Number(full ?? 1),
  };

  return {
    ...position,
    repetition: { [positionKey(position)]: 1 },
    lastMove: null,
    clock: [CLOCK_START_MS, CLOCK_START_MS],
    turnStartedAt: now,
    over: null,
  };
}

function at(state: ChessState, square: string): ChessSquare {
  return state.board[squareIndex(square)];
}

function move(from: string, to: string, promotion?: ChessMove["promotion"]): ChessMove {
  return promotion
    ? { from: squareIndex(from), to: squareIndex(to), promotion }
    : { from: squareIndex(from), to: squareIndex(to) };
}

/** Plays a move that is expected to be accepted, and fails loudly with the rejection if not. */
function play(state: ChessState, from: string, to: string, options: {
  seat?: DuelSeat;
  now?: number;
  promotion?: ChessMove["promotion"];
} = {}): ChessState {
  const seat = options.seat ?? state.turn;
  const result = chess.applyMove(state, seat, move(from, to, options.promotion), options.now ?? 0);
  if ("reject" in result) {
    throw new Error(`${from}${to} was rejected: ${result.reject}`);
  }
  return result.next;
}

/** Plays a whole line of "from-to" pairs, alternating seats from the state itself. */
function line(state: ChessState, ...steps: string[]): ChessState {
  return steps.reduce((current, step) => play(current, step.slice(0, 2), step.slice(2, 4)), state);
}

function reject(state: ChessState, seat: DuelSeat, claim: unknown, now = 0): string {
  const result = chess.applyMove(state, seat, claim as ChessMove, now);
  if (!("reject" in result)) throw new Error("Expected the move to be refused.");
  return result.reject;
}

/**
 * Counts the leaves of the move tree to `depth`.
 *
 * The single most valuable test in this file. Every published perft number is
 * a total over castling, en passant, promotion, pins and check evasion at
 * once, so a rule that is subtly wrong shows up as a wrong count even when
 * every hand-written case still passes -- which is exactly how "castling
 * rights survive their own rook being captured" bugs are found.
 */
function perft(position: ChessPosition, depth: number): number {
  const moves = legalMoves(position);
  if (depth <= 1) return moves.length;
  let total = 0;
  for (const candidate of moves) total += perft(applyLegalMove(position, candidate), depth - 1);
  return total;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/* ---------------------------------------------------------------- opening */

describe("the opening position", () => {
  it("sets white on the bottom two ranks with seat 0 to move", () => {
    const state = chess.createState(12345, 0);
    expect(at(state, "a1")).toBe("R");
    expect(at(state, "e1")).toBe("K");
    expect(at(state, "d1")).toBe("Q");
    expect(at(state, "e2")).toBe("P");
    expect(at(state, "e7")).toBe("p");
    expect(at(state, "e8")).toBe("k");
    expect(at(state, "e4")).toBe("");
    expect(state.turn).toBe(0);
    expect(state.over).toBeNull();
  });

  it("ignores the seed -- chess has no random setup", () => {
    expect(chess.createState(1, 0).board).toEqual(chess.createState(999_999, 0).board);
    expect(chess.createState(7, 0).board).toEqual(startingBoard());
  });

  it("gives both sides a full clock and no result yet", () => {
    const state = chess.createState(0, 1_000);
    expect(state.clock).toEqual([CLOCK_START_MS, CLOCK_START_MS]);
    expect(state.turnStartedAt).toBe(1_000);
    expect(chess.result(state)).toBeNull();
  });

  it("offers twenty legal first moves", () => {
    expect(legalMoves(chess.createState(0, 0))).toHaveLength(20);
  });
});

/* --------------------------------------------------------- perft coverage */

describe("perft", () => {
  it("counts the opening tree", () => {
    const start = fromFen(START_FEN);
    expect(perft(start, 1)).toBe(20);
    expect(perft(start, 2)).toBe(400);
    expect(perft(start, 3)).toBe(8_902);
  });

  it("counts Kiwipete, which is dense in castling and pins", () => {
    const kiwipete = fromFen(
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    );
    expect(perft(kiwipete, 1)).toBe(48);
    expect(perft(kiwipete, 2)).toBe(2_039);
    expect(perft(kiwipete, 3)).toBe(97_862);
  });

  it("counts the en-passant and promotion torture position", () => {
    const tricky = fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
    expect(perft(tricky, 1)).toBe(14);
    expect(perft(tricky, 2)).toBe(191);
    expect(perft(tricky, 3)).toBe(2_812);
    expect(perft(tricky, 4)).toBe(43_238);
  });
});

/* ------------------------------------------------------------ basic moves */

describe("ordinary moves", () => {
  it("accepts a pawn's double push and hands the turn over", () => {
    const state = play(chess.createState(0, 0), "e2", "e4");
    expect(at(state, "e2")).toBe("");
    expect(at(state, "e4")).toBe("P");
    expect(state.turn).toBe(1);
    expect(state.lastMove).toEqual({ from: squareIndex("e2"), to: squareIndex("e4") });
  });

  it("refuses a pawn moving three squares", () => {
    expect(reject(chess.createState(0, 0), 0, move("e2", "e5"))).toMatch(/not legal/i);
  });

  it("refuses a pawn pushing onto an occupied square", () => {
    const blocked = fromFen("rnbqkbnr/pppppppp/8/8/8/4p3/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(reject(blocked, 0, move("e2", "e3"))).toMatch(/not legal/i);
  });

  it("refuses a pawn capturing straight ahead", () => {
    const blocked = fromFen("rnbqkbnr/pppppppp/8/8/8/4p3/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(reject(blocked, 0, move("e2", "e3"))).toMatch(/not legal/i);
  });

  it("accepts a knight's leap over its own pawns", () => {
    const state = play(chess.createState(0, 0), "g1", "f3");
    expect(at(state, "f3")).toBe("N");
    expect(at(state, "g1")).toBe("");
  });

  it("refuses a knight moving like a rook", () => {
    expect(reject(chess.createState(0, 0), 0, move("g1", "g3"))).toMatch(/not legal/i);
  });

  it("refuses a slider asked to jump a piece", () => {
    expect(reject(chess.createState(0, 0), 0, move("a1", "a4"))).toMatch(/not legal/i);
  });

  it("resets the halfmove clock on a pawn move and counts it up otherwise", () => {
    const quiet = play(fromFen("4k3/8/8/8/8/8/4P3/R3K3 w - - 7 20"), "a1", "a2");
    expect(quiet.halfmoveClock).toBe(8);
    const pawn = play(fromFen("4k3/8/8/8/8/8/4P3/R3K3 w - - 7 20"), "e2", "e4");
    expect(pawn.halfmoveClock).toBe(0);
  });
});

/* ------------------------------------------------------------ turn order */

describe("turn order", () => {
  it("refuses a move from the seat that is not to move", () => {
    expect(reject(chess.createState(0, 0), 1, move("e7", "e5"))).toMatch(/not your turn/i);
  });

  it("refuses white a second move in a row", () => {
    const after = play(chess.createState(0, 0), "e2", "e4");
    expect(reject(after, 0, move("d2", "d4"))).toMatch(/not your turn/i);
  });

  it("lets black move once it is black's turn", () => {
    const after = play(play(chess.createState(0, 0), "e2", "e4"), "e7", "e5", { seat: 1 });
    expect(at(after, "e5")).toBe("p");
    expect(after.turn).toBe(0);
  });
});

/* ----------------------------------------------------------- untrusted input */

describe("a move is an untrusted claim", () => {
  const state = chess.createState(0, 0);
  const nonsense: [string, unknown][] = [
    ["null", null],
    ["a string", "e2e4"],
    ["a number", 12],
    ["an empty object", {}],
    ["a missing destination", { from: 12 }],
    ["a fractional square", { from: 12.5, to: 28 }],
    ["a square past the board", { from: 12, to: 64 }],
    ["a negative square", { from: -1, to: 28 }],
    ["a move to its own square", { from: 12, to: 12 }],
    ["a promotion to king", { from: 12, to: 28, promotion: "k" }],
    ["a promotion that is not a string", { from: 12, to: 28, promotion: 5 }],
  ];

  for (const [name, claim] of nonsense) {
    it(`refuses ${name} without throwing`, () => {
      expect(() => chess.applyMove(state, 0, claim as ChessMove, 0)).not.toThrow();
      expect(reject(state, 0, claim)).toBeTruthy();
    });
  }

  it("refuses a move from an empty square", () => {
    expect(reject(state, 0, move("e4", "e5"))).toMatch(/not legal/i);
  });

  it("refuses moving the opponent's piece", () => {
    expect(reject(state, 0, move("e7", "e5"))).toMatch(/not legal/i);
  });
});

/* ------------------------------------------------------------------ check */

describe("leaving your own king in check", () => {
  // The white rook on e2 is pinned to its own king by the black rook on e8:
  // it may slide up and down the e-file but must not step off it.
  const pinned = fromFen("4r3/8/8/8/8/8/4R3/4K3 w - - 0 1");

  it("refuses moving a pinned piece off the pin line", () => {
    expect(reject(pinned, 0, move("e2", "d2"))).toMatch(/not legal/i);
    expect(reject(pinned, 0, move("e2", "a2"))).toMatch(/not legal/i);
  });

  it("allows the pinned piece to move along the pin line", () => {
    expect(at(play(pinned, "e2", "e5"), "e5")).toBe("R");
    expect(at(play(pinned, "e2", "e8"), "e8")).toBe("R");
  });

  it("refuses a king stepping into an attacked square", () => {
    // The rook on d1 owns the whole d-file, so d8 and d7 are out even though
    // the king is not in check where it stands.
    const state = fromFen("4k3/8/8/8/8/8/8/3R3K b - - 0 1");
    expect(inCheck(state.board, "b")).toBe(false);
    expect(reject(state, 1, move("e8", "d8"))).toMatch(/not legal/i);
    expect(reject(state, 1, move("e8", "d7"))).toMatch(/not legal/i);
    expect(at(play(state, "e8", "e7", { seat: 1 }), "e7")).toBe("k");
  });

  it("refuses any move that is not an answer to check", () => {
    // Black is in check from e1. The knight has moves and none of them are
    // legal, because none of them attend to the king.
    const state = fromFen("1n2k3/8/8/8/8/8/8/4R2K b - - 0 1");
    expect(inCheck(state.board, "b")).toBe(true);
    expect(reject(state, 1, move("b8", "c6"))).toMatch(/not legal/i);
    expect(reject(state, 1, move("b8", "a6"))).toMatch(/not legal/i);
    expect(at(play(state, "e8", "d8", { seat: 1 }), "d8")).toBe("k");
  });
});

/* --------------------------------------------------------------- castling */

describe("castling", () => {
  const open = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

  it("moves the king two squares and jumps the rook over it, kingside", () => {
    const state = play(fromFen(open), "e1", "g1");
    expect(at(state, "g1")).toBe("K");
    expect(at(state, "f1")).toBe("R");
    expect(at(state, "h1")).toBe("");
    expect(state.castling.whiteKing).toBe(false);
    expect(state.castling.whiteQueen).toBe(false);
  });

  it("moves the king two squares and jumps the rook over it, queenside", () => {
    const state = play(fromFen(open), "e1", "c1");
    expect(at(state, "c1")).toBe("K");
    expect(at(state, "d1")).toBe("R");
    expect(at(state, "a1")).toBe("");
  });

  it("castles for black too", () => {
    const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
    expect(at(play(state, "e8", "g8", { seat: 1 }), "f8")).toBe("r");
    expect(at(play(state, "e8", "c8", { seat: 1 }), "d8")).toBe("r");
  });

  it("refuses castling out of check", () => {
    // Black rook on e8 attacks the white king where it stands.
    const state = fromFen("4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(reject(state, 0, move("e1", "g1"))).toMatch(/not legal/i);
    expect(reject(state, 0, move("e1", "c1"))).toMatch(/not legal/i);
  });

  it("refuses castling through an attacked square", () => {
    // f1 is covered, so kingside is out; the queenside path is clean.
    const state = fromFen("5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(reject(state, 0, move("e1", "g1"))).toMatch(/not legal/i);
    expect(at(play(state, "e1", "c1"), "c1")).toBe("K");
  });

  it("refuses castling into check", () => {
    const state = fromFen("6r1/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(reject(state, 0, move("e1", "g1"))).toMatch(/not legal/i);
  });

  it("allows queenside castling when only b1 is attacked -- the rook's square need not be safe", () => {
    const state = fromFen("1r6/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(at(play(state, "e1", "c1"), "c1")).toBe("K");
  });

  it("refuses castling with a piece in the way", () => {
    const state = fromFen("r3k2r/8/8/8/8/8/8/RN2K1NR w KQkq - 0 1");
    expect(reject(state, 0, move("e1", "g1"))).toMatch(/not legal/i);
    expect(reject(state, 0, move("e1", "c1"))).toMatch(/not legal/i);
  });

  it("loses both rights the moment the king moves, even if it comes back", () => {
    const walked = line(fromFen(open), "e1f1", "e8f8", "f1e1", "f8e8");
    expect(walked.castling.whiteKing).toBe(false);
    expect(walked.castling.whiteQueen).toBe(false);
    expect(reject(walked, 0, move("e1", "g1"))).toMatch(/not legal/i);
  });

  it("loses one right when that rook moves", () => {
    const moved = play(fromFen(open), "h1", "h2");
    expect(moved.castling.whiteKing).toBe(false);
    expect(moved.castling.whiteQueen).toBe(true);
  });

  it("loses the right when the rook is captured in its own corner", () => {
    // The case a hand-written implementation forgets. Ra1xa8 takes the rook
    // black would have castled queenside with, so that right dies with it --
    // otherwise the king castles with a rook that is not there. The moving
    // rook spends its own right at the same time, and nothing else moves.
    const taken = play(fromFen(open), "a1", "a8");
    expect(taken.castling.blackQueen).toBe(false);
    expect(taken.castling.whiteQueen).toBe(false);
    expect(taken.castling.blackKing).toBe(true);
    expect(taken.castling.whiteKing).toBe(true);
    expect(reject(taken, 1, move("e8", "c8"))).toMatch(/not legal/i);
  });

  it("refuses castling once the right is spent even with the path clear", () => {
    const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
    expect(reject(state, 0, move("e1", "g1"))).toMatch(/not legal/i);
  });
});

/* ------------------------------------------------------------- en passant */

describe("en passant", () => {
  it("records the square only when a pawn is standing beside the pushed one", () => {
    const alone = play(chess.createState(0, 0), "e2", "e4");
    expect(alone.enPassant).toBeNull();

    // The taker has to stand on the rank the pusher LANDS on, beside it -- a
    // pawn one rank further up could never make the capture.
    const beside = fromFen("4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1");
    const pushed = play(beside, "e2", "e4");
    expect(pushed.enPassant).toBe(squareIndex("e3"));
    expect(at(line(pushed, "d4e3"), "e3")).toBe("p");
  });

  it("captures the pawn that stepped past, not the one on the landing square", () => {
    // Black pushes d7-d5 past the white pawn on e5 and White answers exd6:
    // the pawn that comes off is the one on d5, a square the capturing pawn
    // never touches.
    const state = line(fromFen("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1"), "d7d5", "e5d6");
    expect(at(state, "d6")).toBe("P");
    expect(at(state, "d5")).toBe("");
    expect(at(state, "e5")).toBe("");
  });

  it("offers the capture for exactly one move", () => {
    const pushed = play(fromFen("4k3/3p4/8/4P3/8/7K/8/8 b - - 0 1"), "d7", "d5");
    expect(pushed.enPassant).toBe(squareIndex("d6"));
    const waited = line(pushed, "h3h4", "e8d8");
    expect(waited.enPassant).toBeNull();
    expect(reject(waited, 0, move("e5", "d6"))).toMatch(/not legal/i);
  });

  it("resets the halfmove clock -- it is a capture and a pawn move at once", () => {
    const taken = line(fromFen("4k3/3p4/8/4P3/8/8/8/4K3 b - - 9 30"), "d7d5", "e5d6");
    expect(taken.halfmoveClock).toBe(0);
  });
});

/* ------------------------------------------------------------- promotion */

describe("promotion", () => {
  const ready = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";

  it("defaults to a queen when the client names nothing", () => {
    expect(at(play(fromFen(ready), "a7", "a8"), "a8")).toBe("Q");
  });

  it("honours the piece the move carries", () => {
    expect(at(play(fromFen(ready), "a7", "a8", { promotion: "n" }), "a8")).toBe("N");
    expect(at(play(fromFen(ready), "a7", "a8", { promotion: "r" }), "a8")).toBe("R");
    expect(at(play(fromFen(ready), "a7", "a8", { promotion: "b" }), "a8")).toBe("B");
  });

  it("promotes black's pawns to lowercase pieces", () => {
    const state = fromFen("4k3/8/8/8/8/8/7p/4K3 b - - 0 1");
    expect(at(play(state, "h2", "h1", { seat: 1, promotion: "q" }), "h1")).toBe("q");
  });

  it("offers four moves per promotion square, not one", () => {
    const options = legalMoves(fromFen(ready)).filter((candidate) => candidate.from === squareIndex("a7"));
    expect(options.map((candidate) => candidate.promotion).sort()).toEqual(["b", "n", "q", "r"]);
  });

  it("promotes on a capture into the corner as well", () => {
    const state = fromFen("1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    expect(at(play(state, "a7", "b8", { promotion: "q" }), "b8")).toBe("Q");
  });
});

/* -------------------------------------------------------------- endings */

describe("checkmate", () => {
  it("ends the match on fool's mate, with the mating seat as the winner", () => {
    const state = line(chess.createState(0, 0), "f2f3", "e7e5", "g2g4", "d8h4");
    expect(chess.result(state)).toEqual({ winner: 1, reason: "Checkmate" });
    expect(state.over).toEqual({ winner: 1, reason: "Checkmate" });
  });

  it("ends the match on scholar's mate the other way round", () => {
    const state = line(
      chess.createState(0, 0),
      "e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7",
    );
    expect(chess.result(state)).toEqual({ winner: 0, reason: "Checkmate" });
  });

  it("refuses any further move once it is over", () => {
    const state = line(chess.createState(0, 0), "f2f3", "e7e5", "g2g4", "d8h4");
    expect(reject(state, 0, move("g1", "f3"))).toMatch(/already over/i);
  });
});

describe("stalemate", () => {
  it("draws when the side to move has no legal move and is not in check", () => {
    // King h8 boxed in by Qf7 and Kg6, and not itself attacked.
    const state = play(fromFen("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1"), "f1", "f7");
    expect(inCheck(state.board, "b")).toBe(false);
    expect(legalMoves(state)).toHaveLength(0);
    expect(chess.result(state)).toEqual({ winner: null, reason: "Stalemate" });
  });
});

describe("insufficient material", () => {
  it("recognises the dead positions", () => {
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/3BK3 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/3NK3 w - - 0 1").board)).toBe(true);
    // c8 and f1 are both light squares, so these two bishops can never touch
    // and neither side can force anything.
    expect(insufficientMaterial(fromFen("2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1").board)).toBe(true);
  });

  it("does not call a live position dead", () => {
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/7P/4K3 w - - 0 1").board)).toBe(false);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/3RK3 w - - 0 1").board)).toBe(false);
    expect(insufficientMaterial(fromFen("4k3/8/8/8/8/8/8/2NNK3 w - - 0 1").board)).toBe(false);
    // c8 is light and g1 is dark: this pair can mate with help, so it is live.
    expect(insufficientMaterial(fromFen("2b1k3/8/8/8/8/8/8/4K1B1 w - - 0 1").board)).toBe(false);
  });

  it("draws the match the moment the last mating material leaves the board", () => {
    const state = play(fromFen("8/8/8/3k4/1n6/8/3B4/3K4 w - - 0 1"), "d2", "b4");
    expect(chess.result(state)).toEqual({ winner: null, reason: "Insufficient material" });
  });

  it("separates 'can mate at all' from 'can force mate'", () => {
    // Two knights cannot FORCE mate but can certainly deliver one with help,
    // which is the question a flag fall asks.
    expect(canMate(fromFen("4k3/8/8/8/8/8/8/2NNK3 w - - 0 1").board, "w")).toBe(true);
    expect(canMate(fromFen("4k3/8/8/8/8/8/8/3NK3 w - - 0 1").board, "w")).toBe(false);
    expect(canMate(fromFen("4k3/8/8/8/8/8/7P/4K3 w - - 0 1").board, "w")).toBe(true);
    expect(canMate(fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").board, "b")).toBe(false);
  });
});

describe("threefold repetition", () => {
  it("draws when the same position is reached a third time", () => {
    // The knights walk out and back twice, which returns the opening position
    // -- already counted once at creation -- for a second and a third time.
    const state = line(
      chess.createState(0, 0),
      "g1f3", "g8f6", "f3g1", "f6g8",
      "g1f3", "g8f6", "f3g1", "f6g8",
    );
    expect(chess.result(state)).toEqual({ winner: null, reason: "Threefold repetition" });
  });

  it("does not draw on the second occurrence", () => {
    const state = line(chess.createState(0, 0), "g1f3", "g8f6", "f3g1", "f6g8");
    expect(chess.result(state)).toBeNull();
  });

  it("throws the ledger away when a pawn move makes the past unreachable", () => {
    const state = line(chess.createState(0, 0), "g1f3", "g8f6", "e2e4");
    expect(Object.keys(state.repetition)).toHaveLength(1);
    expect(state.halfmoveClock).toBe(0);
  });

  it("counts castling rights as part of the position", () => {
    // Same placement, but white has moved its rook out and back, so the
    // position is genuinely different and must not repeat.
    const first = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const walked = line(first, "h1h2", "h8h7", "h2h1", "h7h8");
    expect(positionKey(walked)).not.toBe(positionKey(first));
  });
});

describe("the fifty-move rule", () => {
  it("draws on the hundredth quiet ply", () => {
    const state = play(fromFen("4k3/8/8/8/8/8/8/R3K3 w - - 99 60"), "a1", "a2");
    expect(state.halfmoveClock).toBe(100);
    expect(chess.result(state)).toEqual({ winner: null, reason: "Fifty-move rule" });
  });

  it("does not draw one ply early", () => {
    const state = play(fromFen("4k3/8/8/8/8/8/8/R3K3 w - - 98 60"), "a1", "a2");
    expect(chess.result(state)).toBeNull();
  });

  it("lets checkmate beat the count -- a mate is a mate on any ply", () => {
    const state = play(fromFen("7k/8/6K1/8/8/8/8/R7 w - - 99 60"), "a1", "a8");
    expect(chess.result(state)).toEqual({ winner: 0, reason: "Checkmate" });
  });
});

/* ---------------------------------------------------------------- clocks */

describe("the clock", () => {
  it("charges the mover for the time they took and pays the increment", () => {
    const state = play(chess.createState(0, 0), "e2", "e4", { now: 10_000 });
    expect(state.clock[0]).toBe(CLOCK_START_MS - 10_000 + CLOCK_INCREMENT_MS);
    expect(state.clock[1]).toBe(CLOCK_START_MS);
    expect(state.turnStartedAt).toBe(10_000);
  });

  it("only runs the clock of the side to move", () => {
    const after = play(chess.createState(0, 0), "e2", "e4", { now: 10_000 });
    const snapshot = chess.snapshot(after, 1, 25_000);
    expect(snapshot.clock[0]).toBe(CLOCK_START_MS - 10_000 + CLOCK_INCREMENT_MS);
    expect(snapshot.clock[1]).toBe(CLOCK_START_MS - 15_000);
  });

  it("never hands time back when `now` runs backwards", () => {
    const state = chess.createState(0, 10_000);
    expect(chess.snapshot(state, 0, 5_000).clock[0]).toBe(CLOCK_START_MS);
  });

  it("flags the side to move once their budget is gone", () => {
    const state = chess.createState(0, 0);
    const flagged = chess.tick?.(state, CLOCK_START_MS + 1) ?? null;
    expect(flagged).not.toBeNull();
    expect(chess.result(flagged as ChessState)).toEqual({ winner: 1, reason: "Timeout" });
    expect((flagged as ChessState).clock[0]).toBe(0);
  });

  it("returns null from tick when nothing has changed", () => {
    const state = chess.createState(0, 0);
    // The common case, and the one that matters: the shell polls every two
    // seconds and a fresh object each time would bump the version on every
    // poll and livelock both players' concurrency guard.
    expect(chess.tick?.(state, 0)).toBeNull();
    expect(chess.tick?.(state, 1_000)).toBeNull();
    expect(chess.tick?.(state, CLOCK_START_MS - 1)).toBeNull();
    expect(chess.tick?.(state, CLOCK_START_MS - 1)).toBeNull();
  });

  it("returns null from tick once the match is already over", () => {
    const mated = line(chess.createState(0, 0), "f2f3", "e7e5", "g2g4", "d8h4");
    expect(chess.tick?.(mated, CLOCK_START_MS * 10)).toBeNull();
  });

  it("draws rather than awards a flag fall when the other side cannot mate", () => {
    // White is out of time, but black has a bare king and could never mate.
    const state = fromFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    const flagged = chess.tick?.(state, CLOCK_START_MS + 1) as ChessState;
    expect(chess.result(flagged)).toEqual({ winner: null, reason: "Insufficient material" });
  });

  it("settles rather than rejects a move made after the flag has already fallen", () => {
    const state = chess.createState(0, 0);
    const result = chess.applyMove(state, 0, move("e2", "e4"), CLOCK_START_MS + 500);
    expect("next" in result).toBe(true);
    expect(chess.result((result as { next: ChessState }).next)).toEqual({
      winner: 1,
      reason: "Timeout",
    });
  });
});

/* -------------------------------------------------------------- snapshot */

describe("the snapshot", () => {
  const state = chess.createState(0, 0);

  it("sends legal moves to the seat to move", () => {
    const view = chess.snapshot(state, 0, 0);
    expect(view.legalMoves).toHaveLength(20);
    expect(view.turn).toBe(0);
  });

  it("withholds legal moves from the seat that is not to move", () => {
    expect(chess.snapshot(state, 1, 0).legalMoves).toBeNull();
  });

  it("withholds legal moves from a spectator", () => {
    expect(chess.snapshot(state, null, 0).legalMoves).toBeNull();
  });

  it("shows both seats the same board -- chess hides nothing", () => {
    expect(chess.snapshot(state, 0, 0).board).toEqual(chess.snapshot(state, 1, 0).board);
  });

  it("stops offering moves once the match is over", () => {
    const mated = line(chess.createState(0, 0), "f2f3", "e7e5", "g2g4", "d8h4");
    expect(chess.snapshot(mated, 0, 0).legalMoves).toBeNull();
    expect(chess.snapshot(mated, 0, 0).over).toEqual({ winner: 1, reason: "Checkmate" });
  });

  it("reports check to whoever is in it", () => {
    const checked = line(chess.createState(0, 0), "e2e4", "e7e5", "f1c4", "f8c5", "c4f7");
    expect(chess.snapshot(checked, 1, 0).check).toBe(true);
    expect(chess.snapshot(chess.createState(0, 0), 0, 0).check).toBe(false);
  });

  it("hands back a copy of the board rather than the stored array", () => {
    const view = chess.snapshot(state, 0, 0);
    view.board[0] = "";
    expect(state.board[0]).toBe("R");
  });
});

/* --------------------------------------------------------------- resign */

describe("resigning", () => {
  it("hands the match to the other seat", () => {
    const state = chess.resign?.(chess.createState(0, 0), 0, 5_000) as ChessState;
    expect(chess.result(state)).toEqual({ winner: 1, reason: "Resigned" });
  });

  it("works for either seat", () => {
    const state = chess.resign?.(chess.createState(0, 0), 1, 5_000) as ChessState;
    expect(chess.result(state)).toEqual({ winner: 0, reason: "Resigned" });
  });

  it("cannot overwrite a result that already exists", () => {
    const mated = line(chess.createState(0, 0), "f2f3", "e7e5", "g2g4", "d8h4");
    const after = chess.resign?.(mated, 1, 9_000) as ChessState;
    expect(chess.result(after)).toEqual({ winner: 1, reason: "Checkmate" });
  });
});

/* ---------------------------------------------------------- serialisation */

describe("the state survives storage", () => {
  it("round-trips through JSON unchanged", () => {
    // jsonb plus structuredClone, per the contract: a Map, a Set or an
    // undefined anywhere in here would come back as something else.
    const played = line(
      chess.createState(0, 0),
      "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6",
    );
    expect(JSON.parse(JSON.stringify(played))).toEqual(played);
  });

  it("holds no undefined values", () => {
    const played = line(chess.createState(0, 0), "e2e4", "d7d5", "e4d5");
    const flat = JSON.stringify(played);
    expect(flat).not.toContain("undefined");
    expect(Object.values(played).every((value) => value !== undefined)).toBe(true);
  });
});

/* -------------------------------------------------------------- notation */

describe("square names", () => {
  it("round-trips", () => {
    for (let square = 0; square < 64; square += 1) {
      expect(squareIndex(squareName(square))).toBe(square);
    }
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
  });

  it("answers -1 for anything that is not a square", () => {
    expect(squareIndex("")).toBe(-1);
    expect(squareIndex("z9")).toBe(-1);
    expect(squareIndex("e")).toBe(-1);
  });
});

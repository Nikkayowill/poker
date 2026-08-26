/**
 * Chess, as a duel.
 *
 * The whole rule set, written here rather than pulled in: a dependency would
 * be the fifth thing in the bundle a board component drags along, and this
 * file has to be reachable by `npm test` anyway (vitest.config.ts collects
 * lib/ and app/), which is where a rules engine's bugs are actually caught.
 * The same argument lib/arcade/blackjack.ts makes about being pure and
 * synchronous applies with more force here: castling through check and en
 * passant are exactly the cases nobody exercises by hand.
 *
 * Pure and synchronous throughout. Nothing reads Date.now(); every time-aware
 * function takes `now`, per the contract's note about a client's clock
 * deciding a real payout.
 *
 * ## Board representation
 *
 * A flat 64-entry array of FEN-style characters (uppercase white, lowercase
 * black, "" empty), indexed a1=0, b1=1 ... h8=63, so `file = i % 8` and
 * `rank = i >> 3` and a white pawn steps +8. Strings and numbers only, because
 * the state round-trips through a jsonb column and structuredClone: no Map,
 * no Set, no class instance, no undefined.
 *
 * ## Seats and colour
 *
 * Seat 0 is white and moves first, which the framework guarantees (the
 * challenger is seat 0). That mapping is stated once, in `seatColor`, so
 * nothing else in the file has to remember which way round it goes.
 */

import { defineDuelGame, otherSeat, remainingTime, type DuelOutcome, type DuelSeat } from "./match-contract";

/* ------------------------------------------------------------------ types */

export type PieceLetter = "P" | "N" | "B" | "R" | "Q" | "K";
export type ChessPiece = PieceLetter | Lowercase<PieceLetter>;
/** A square holds a piece or nothing. "" rather than null so the array is one type. */
export type ChessSquare = ChessPiece | "";
export type PieceColor = "w" | "b";
/** A pawn may become anything but a king or another pawn. */
export type PromotionPiece = "q" | "r" | "b" | "n";

export interface ChessMove {
  /** 0-63, a1=0. */
  from: number;
  to: number;
  /**
   * Only meaningful on a pawn reaching the last rank, and only ever a
   * suggestion: an absent or nonsense value promotes to a queen rather than
   * refusing the move, since a promotion the client forgot to name is still a
   * move the player unambiguously made.
   */
  promotion?: PromotionPiece;
}

export interface CastlingRights {
  whiteKing: boolean;
  whiteQueen: boolean;
  blackKing: boolean;
  blackQueen: boolean;
}

export interface ChessState {
  board: ChessSquare[];
  /** The seat to move. Seat 0 (white) opens. */
  turn: DuelSeat;
  castling: CastlingRights;
  /**
   * The square a pawn may capture onto this move, or null.
   *
   * Set only when an enemy pawn is actually standing beside the double-pushed
   * pawn. That is not an optimisation: the repetition key includes this field,
   * and FIDE only counts an en passant square as part of the position when the
   * capture is genuinely available. Recording it unconditionally would make
   * two identical positions hash differently and silently lose a threefold
   * claim.
   */
  enPassant: number | null;
  /** Plies since the last capture or pawn move. 100 is the fifty-move draw. */
  halfmoveClock: number;
  fullmoveNumber: number;
  /**
   * How many times each position has been reached, keyed by `positionKey`.
   *
   * Cleared whenever `halfmoveClock` resets, because a position before a
   * capture or a pawn move can never occur again, which keeps this object
   * bounded rather than growing for the whole game inside a jsonb column.
   */
  repetition: Record<string, number>;
  /** For the board's "what just happened" highlight. */
  lastMove: { from: number; to: number } | null;
  /** Remaining milliseconds, indexed by seat. */
  clock: [number, number];
  /** When the side to move's clock started running. */
  turnStartedAt: number;
  /** Non-null exactly when the match is finished; `result()` returns it verbatim. */
  over: DuelOutcome | null;
}

/**
 * What a viewer is shown.
 *
 * Chess is a game of perfect information, so both seats see the same board and
 * there is nothing to redact about the position; the contract's header names
 * chess as a game that is symmetric by nature. `legalMoves` is the one asymmetry
 * and it is a convenience, not a secret: it is sent only to the seat to move so
 * the board can highlight without reimplementing the rules, and a spectator
 * (seat null) gets the most restrictive view rather than the most permissive.
 */
export interface ChessSnapshot {
  board: ChessSquare[];
  turn: DuelSeat;
  /** True when the side to move is in check. */
  check: boolean;
  lastMove: { from: number; to: number } | null;
  /** Live remaining milliseconds per seat, derived from `now`. Frozen once over. */
  clock: [number, number];
  /** Every legal move for the seat to move; null for the other seat and for spectators. */
  legalMoves: ChessMove[] | null;
  over: DuelOutcome | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

/* -------------------------------------------------------------- constants */

/**
 * Five minutes each with a three-second increment, standard blitz.
 *
 * Long enough that a real game happens and short enough that a duel holding
 * two players' Gold in escrow resolves in one sitting; the increment exists so
 * a won position cannot be lost purely to the 2s poll interval, which is the
 * one latency this game has that over-the-board chess does not.
 */
export const CLOCK_START_MS = 5 * 60_000;
export const CLOCK_INCREMENT_MS = 3_000;

/** Plies, not moves: fifty moves by each side. */
export const FIFTY_MOVE_PLIES = 100;
export const REPETITION_LIMIT = 3;

const PROMOTION_PIECES: readonly PromotionPiece[] = ["q", "r", "b", "n"];

/** Reasons, as constants: the contract asks for a short fixed line, not composed prose. */
const REASON = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  insufficient: "Insufficient material",
  repetition: "Threefold repetition",
  fiftyMove: "Fifty-move rule",
  timeout: "Timeout",
  resigned: "Resigned",
} as const;

/* ------------------------------------------------------------- geometry */

const KNIGHT_STEPS: readonly (readonly [number, number])[] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const BISHOP_DIRS: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ROOK_DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const KING_STEPS: readonly (readonly [number, number])[] = [...BISHOP_DIRS, ...ROOK_DIRS];

function fileOf(square: number): number {
  return square % 8;
}

function rankOf(square: number): number {
  return (square / 8) | 0;
}

/** The index for a file/rank pair, or -1 off the board. Arithmetic on file and rank rather than
 *  raw index offsets specifically so a knight cannot wrap around an edge. */
function squareAt(file: number, rank: number): number {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return rank * 8 + file;
}

/** The colour of a square that is known to hold a piece. */
function pieceColor(piece: ChessPiece): PieceColor {
  return piece === piece.toUpperCase() ? "w" : "b";
}

/** The kind of a square that is known to hold a piece, case stripped. */
function pieceLetter(piece: ChessPiece): PieceLetter {
  return piece.toUpperCase() as PieceLetter;
}

/** The colour of any square, admitting null for an empty one. */
export function colorOf(square: ChessSquare): PieceColor | null {
  return square === "" ? null : pieceColor(square);
}

/** Seat 0 is white. The one place that mapping is written down. */
export function seatColor(seat: DuelSeat): PieceColor {
  return seat === 0 ? "w" : "b";
}

function pieceFor(color: PieceColor, letter: PieceLetter): ChessPiece {
  return (color === "w" ? letter : letter.toLowerCase()) as ChessPiece;
}

/** 0 or 1, which colour a square is. Only insufficient-material needs it. */
function squareShade(square: number): number {
  return (fileOf(square) + rankOf(square)) % 2;
}

/* ------------------------------------------------------------ the position */

const STARTING_BACK_RANK: readonly PieceLetter[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];

export function startingBoard(): ChessSquare[] {
  const board: ChessSquare[] = new Array<ChessSquare>(64).fill("");
  for (let file = 0; file < 8; file += 1) {
    board[squareAt(file, 0)] = STARTING_BACK_RANK[file];
    board[squareAt(file, 1)] = "P";
    board[squareAt(file, 6)] = "p";
    board[squareAt(file, 7)] = STARTING_BACK_RANK[file].toLowerCase() as ChessPiece;
  }
  return board;
}

/** Everything a position is, with nothing about clocks or who is sitting in which chair. */
export interface ChessPosition {
  board: ChessSquare[];
  turn: DuelSeat;
  castling: CastlingRights;
  enPassant: number | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

/**
 * The identity of a position for repetition purposes.
 *
 * Placement, side to move, castling rights and the en passant square: the
 * four things FIDE counts. Empty squares become "." rather than "" so the
 * placement string cannot be ambiguous: joining "" for empty would make a
 * lone rook and two adjacent rooks the same string.
 */
export function positionKey(position: ChessPosition): string {
  const placement = position.board.map((square) => (square === "" ? "." : square)).join("");
  const rights =
    (position.castling.whiteKing ? "K" : "") +
    (position.castling.whiteQueen ? "Q" : "") +
    (position.castling.blackKing ? "k" : "") +
    (position.castling.blackQueen ? "q" : "");
  return `${placement} ${position.turn} ${rights || "-"} ${position.enPassant ?? "-"}`;
}

/* ----------------------------------------------------------- attack tests */

/**
 * Whether `color` attacks `target`.
 *
 * Scans outward from the target rather than over every enemy piece: the work
 * is bounded by the eight rays and the knight ring instead of by how much
 * material is on the board, and it is the same routine used for check, for
 * castling through check, and for the legality filter.
 */
export function isAttacked(board: readonly ChessSquare[], target: number, color: PieceColor): boolean {
  const file = fileOf(target);
  const rank = rankOf(target);

  // A pawn of `color` attacks this square from one rank behind it, which is
  // why the sign is inverted from the direction pawns move.
  const pawn = pieceFor(color, "P");
  const pawnRank = color === "w" ? rank - 1 : rank + 1;
  for (const step of [-1, 1]) {
    const square = squareAt(file + step, pawnRank);
    if (square >= 0 && board[square] === pawn) return true;
  }

  const knight = pieceFor(color, "N");
  for (const [df, dr] of KNIGHT_STEPS) {
    const square = squareAt(file + df, rank + dr);
    if (square >= 0 && board[square] === knight) return true;
  }

  const king = pieceFor(color, "K");
  for (const [df, dr] of KING_STEPS) {
    const square = squareAt(file + df, rank + dr);
    if (square >= 0 && board[square] === king) return true;
  }

  const queen = pieceFor(color, "Q");
  const rook = pieceFor(color, "R");
  const bishop = pieceFor(color, "B");
  for (const [dirs, slider] of [[ROOK_DIRS, rook], [BISHOP_DIRS, bishop]] as const) {
    for (const [df, dr] of dirs) {
      for (let step = 1; step < 8; step += 1) {
        const square = squareAt(file + df * step, rank + dr * step);
        if (square < 0) break;
        const occupant = board[square];
        if (occupant === "") continue;
        if (occupant === slider || occupant === queen) return true;
        break;
      }
    }
  }

  return false;
}

export function findKing(board: readonly ChessSquare[], color: PieceColor): number {
  const king = pieceFor(color, "K");
  return board.indexOf(king);
}

export function inCheck(board: readonly ChessSquare[], color: PieceColor): boolean {
  const king = findKing(board, color);
  // A position with no king of this colour cannot be in check. Unreachable in
  // a real game; guarded because the move generator is also run over positions
  // assembled by tests.
  if (king < 0) return false;
  return isAttacked(board, king, color === "w" ? "b" : "w");
}

/* ------------------------------------------------------- move generation */

/** Where the king and rooks stand when their castling right is still alive. */
const CASTLE_SQUARES = {
  w: { king: 4, kingRook: 7, queenRook: 0 },
  b: { king: 60, kingRook: 63, queenRook: 56 },
} as const;

function addPawnMoves(position: ChessPosition, from: number, color: PieceColor, out: ChessMove[]): void {
  const { board } = position;
  const forward = color === "w" ? 1 : -1;
  const startRank = color === "w" ? 1 : 6;
  const lastRank = color === "w" ? 7 : 0;
  const file = fileOf(from);
  const rank = rankOf(from);

  const push = (to: number) => {
    if (rankOf(to) === lastRank) {
      for (const promotion of PROMOTION_PIECES) out.push({ from, to, promotion });
    } else {
      out.push({ from, to });
    }
  };

  const oneUp = squareAt(file, rank + forward);
  if (oneUp >= 0 && board[oneUp] === "") {
    push(oneUp);
    // The two-square push is only legal from the pawn's own start rank, and
    // only when the square it passes over is also empty: a pawn does not
    // jump a piece.
    const twoUp = squareAt(file, rank + forward * 2);
    if (rank === startRank && twoUp >= 0 && board[twoUp] === "") out.push({ from, to: twoUp });
  }

  for (const step of [-1, 1]) {
    const to = squareAt(file + step, rank + forward);
    if (to < 0) continue;
    const occupant = board[to];
    if (occupant !== "" && colorOf(occupant) !== color) push(to);
    // En passant: the landing square is empty, so this is the one capture that
    // does not take the piece standing on the destination.
    else if (occupant === "" && to === position.enPassant) out.push({ from, to });
  }
}

function addCastlingMoves(position: ChessPosition, color: PieceColor, out: ChessMove[]): void {
  const { board, castling } = position;
  const home = CASTLE_SQUARES[color];
  const enemy = color === "w" ? "b" : "w";
  const king = pieceFor(color, "K");
  const rook = pieceFor(color, "R");
  if (board[home.king] !== king) return;
  // Castling out of check is forbidden, and it is checked once here rather
  // than per side: the king's own square is the same either way.
  if (isAttacked(board, home.king, enemy)) return;

  const kingSideRight = color === "w" ? castling.whiteKing : castling.blackKing;
  const queenSideRight = color === "w" ? castling.whiteQueen : castling.blackQueen;

  if (kingSideRight && board[home.kingRook] === rook) {
    const through = home.king + 1;
    const landing = home.king + 2;
    // Empty between, and the king may not pass through an attacked square.
    // The landing square's own safety is caught by the legality filter as
    // well, but stating it here keeps the rule in one readable place.
    if (
      board[through] === "" &&
      board[landing] === "" &&
      !isAttacked(board, through, enemy) &&
      !isAttacked(board, landing, enemy)
    ) {
      out.push({ from: home.king, to: landing });
    }
  }

  if (queenSideRight && board[home.queenRook] === rook) {
    const through = home.king - 1;
    const landing = home.king - 2;
    // b1/b8 must be empty too, even though the king never stands on it: the
    // rook passes over it. It does not have to be safe, only vacant.
    const rookPath = home.king - 3;
    if (
      board[through] === "" &&
      board[landing] === "" &&
      board[rookPath] === "" &&
      !isAttacked(board, through, enemy) &&
      !isAttacked(board, landing, enemy)
    ) {
      out.push({ from: home.king, to: landing });
    }
  }
}

/**
 * Every move the pieces could make ignoring whether the king is left hanging.
 *
 * Split from the legal set because the legality test has to make each move to
 * ask the question, and a generator that recursed into itself to answer it
 * would not terminate.
 */
export function pseudoLegalMoves(position: ChessPosition, color: PieceColor): ChessMove[] {
  const out: ChessMove[] = [];
  const { board } = position;

  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (piece === "" || pieceColor(piece) !== color) continue;
    const letter = pieceLetter(piece);
    const file = fileOf(from);
    const rank = rankOf(from);

    if (letter === "P") {
      addPawnMoves(position, from, color, out);
      continue;
    }

    if (letter === "N" || letter === "K") {
      const steps = letter === "N" ? KNIGHT_STEPS : KING_STEPS;
      for (const [df, dr] of steps) {
        const to = squareAt(file + df, rank + dr);
        if (to < 0) continue;
        if (board[to] === "" || colorOf(board[to]) !== color) out.push({ from, to });
      }
      if (letter === "K") addCastlingMoves(position, color, out);
      continue;
    }

    const dirs = letter === "B" ? BISHOP_DIRS : letter === "R" ? ROOK_DIRS : KING_STEPS;
    for (const [df, dr] of dirs) {
      for (let step = 1; step < 8; step += 1) {
        const to = squareAt(file + df * step, rank + dr * step);
        if (to < 0) break;
        const occupant = board[to];
        if (occupant === "") {
          out.push({ from, to });
          continue;
        }
        if (colorOf(occupant) !== color) out.push({ from, to });
        break;
      }
    }
  }

  return out;
}

/**
 * Applies a move to a position without asking whether it is legal.
 *
 * Only ever called on a move this file generated, so it may assume the piece
 * is there and the geometry is sound; that is what lets `applyMove` below
 * validate by matching an untrusted claim against the generated set rather
 * than by re-deriving each rule a second time in a different order.
 *
 * Exported so the tests can walk a move tree (perft) without paying for the
 * clock and turn bookkeeping on every one of a hundred thousand nodes. It is
 * not a safe entry point for a caller holding an untrusted move; that is
 * `applyMove` on the game itself, which validates first.
 */
export function applyLegalMove(position: ChessPosition, move: ChessMove): ChessPosition {
  const board = [...position.board];
  // Only ever called on a move this file generated, so the origin square is
  // occupied by construction; see the note above.
  const piece = board[move.from] as ChessPiece;
  const color = pieceColor(piece);
  const letter = pieceLetter(piece);
  const captured = board[move.to];
  let irreversible = captured !== "" || letter === "P";

  board[move.to] = piece;
  board[move.from] = "";

  if (letter === "P" && move.to === position.enPassant && captured === "") {
    // The captured pawn is beside the landing square, not on it.
    board[move.to + (color === "w" ? -8 : 8)] = "";
    irreversible = true;
  }

  const lastRank = color === "w" ? 7 : 0;
  if (letter === "P" && rankOf(move.to) === lastRank) {
    const promotion = move.promotion ?? "q";
    board[move.to] = pieceFor(color, promotion.toUpperCase() as PieceLetter);
  }

  if (letter === "K" && Math.abs(move.to - move.from) === 2) {
    // The rook jumps the king; which corner it comes from is decided by which
    // way the king went.
    const home = CASTLE_SQUARES[color];
    const kingSide = move.to > move.from;
    const rookFrom = kingSide ? home.kingRook : home.queenRook;
    const rookTo = kingSide ? move.to - 1 : move.to + 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = "";
  }

  const castling: CastlingRights = { ...position.castling };
  if (letter === "K") {
    if (color === "w") {
      castling.whiteKing = false;
      castling.whiteQueen = false;
    } else {
      castling.blackKing = false;
      castling.blackQueen = false;
    }
  }
  // A rook leaving its corner kills that right, and so does a rook being
  // captured in its corner. The second case is the one hand-written
  // implementations forget, and it shows up as a player castling with a rook
  // that is no longer there.
  for (const square of [move.from, move.to]) {
    if (square === CASTLE_SQUARES.w.kingRook) castling.whiteKing = false;
    if (square === CASTLE_SQUARES.w.queenRook) castling.whiteQueen = false;
    if (square === CASTLE_SQUARES.b.kingRook) castling.blackKing = false;
    if (square === CASTLE_SQUARES.b.queenRook) castling.blackQueen = false;
  }

  // See the note on ChessState.enPassant: recorded only when an enemy pawn is
  // actually standing beside the pushed pawn and could take it.
  let enPassant: number | null = null;
  if (letter === "P" && Math.abs(move.to - move.from) === 16) {
    const enemyPawn = pieceFor(color === "w" ? "b" : "w", "P");
    const rank = rankOf(move.to);
    const hasTaker = [-1, 1].some((step) => {
      const beside = squareAt(fileOf(move.to) + step, rank);
      return beside >= 0 && board[beside] === enemyPawn;
    });
    if (hasTaker) enPassant = (move.from + move.to) / 2;
  }

  return {
    board,
    turn: position.turn === 0 ? 1 : 0,
    castling,
    enPassant,
    halfmoveClock: irreversible ? 0 : position.halfmoveClock + 1,
    // Incremented after black moves, which is the move number a scoresheet shows.
    fullmoveNumber: position.turn === 1 ? position.fullmoveNumber + 1 : position.fullmoveNumber,
  };
}

/** Every move the side to move may actually play. */
export function legalMoves(position: ChessPosition): ChessMove[] {
  const color = seatColor(position.turn);
  return pseudoLegalMoves(position, color).filter((move) => {
    const next = applyLegalMove(position, move);
    return !inCheck(next.board, color);
  });
}

/* --------------------------------------------------------------- material */

interface MaterialCount {
  heavy: boolean;
  knights: number;
  /** Square shades the bishops stand on, so a same-colour pair can be told from a real pair. */
  bishopShades: number[];
}

function countMaterial(board: readonly ChessSquare[], color: PieceColor): MaterialCount {
  const count: MaterialCount = { heavy: false, knights: 0, bishopShades: [] };
  for (let square = 0; square < 64; square += 1) {
    const piece = board[square];
    if (piece === "" || pieceColor(piece) !== color) continue;
    const letter = pieceLetter(piece);
    if (letter === "P" || letter === "R" || letter === "Q") count.heavy = true;
    if (letter === "N") count.knights += 1;
    if (letter === "B") count.bishopShades.push(squareShade(square));
  }
  return count;
}

/**
 * Whether `color` could deliver mate at all, even with the opponent helping.
 *
 * This is the FIDE timeout question, which is not "can this side force mate":
 * two knights cannot force mate but can certainly be mated into, so a flag
 * fall against K+N+N is a loss and not a draw. One minor piece against a bare
 * king genuinely cannot mate by any series of legal moves, so that is a draw.
 */
export function canMate(board: readonly ChessSquare[], color: PieceColor): boolean {
  const count = countMaterial(board, color);
  if (count.heavy) return true;
  return count.knights + count.bishopShades.length >= 2;
}

/**
 * The dead positions FIDE draws immediately: K v K, K+minor v K, and bishops
 * of the same square colour on both sides, which can never touch each other
 * and so can never force anything.
 */
export function insufficientMaterial(board: readonly ChessSquare[]): boolean {
  const white = countMaterial(board, "w");
  const black = countMaterial(board, "b");
  if (white.heavy || black.heavy) return false;

  const whiteMinors = white.knights + white.bishopShades.length;
  const blackMinors = black.knights + black.bishopShades.length;
  if (whiteMinors === 0 && blackMinors === 0) return true;
  if (whiteMinors + blackMinors === 1) return true;
  if (
    white.bishopShades.length === 1 &&
    black.bishopShades.length === 1 &&
    white.knights === 0 &&
    black.knights === 0 &&
    white.bishopShades[0] === black.bishopShades[0]
  ) {
    return true;
  }
  return false;
}

/* ----------------------------------------------------------------- clocks */

/**
 * How much of `seat`'s budget is left at `now`.
 *
 * Only the side to move is burning time, and a `now` that lands before
 * `turnStartedAt` (a clock skewed backwards between two writes) is clamped
 * to zero elapsed rather than being allowed to hand somebody time back.
 */
export function remainingClock(state: ChessState, seat: DuelSeat, now: number): number {
  return remainingTime(state.clock[seat], seat, state.turn, state.turnStartedAt, now, state.over !== null);
}

/**
 * The state after `seat`'s flag has fallen.
 *
 * A flag is a loss unless the player who still has time could not mate with
 * what is on the board, in which case it is a draw, the same rule an
 * over-the-board arbiter applies, and why the reason line here reads
 * "Insufficient material" rather than "Timeout".
 */
function flagFallen(state: ChessState, seat: DuelSeat, now: number): ChessState {
  const opponent = otherSeat(seat);
  const clock: [number, number] = [...state.clock];
  clock[seat] = 0;
  return {
    ...state,
    clock,
    turnStartedAt: now,
    over: canMate(state.board, seatColor(opponent))
      ? { winner: opponent, reason: REASON.timeout }
      : { winner: null, reason: REASON.insufficient },
  };
}

/* ------------------------------------------------------------- conclusion */

/**
 * Whether the position that has just been reached ends the match.
 *
 * Order matters: mate and stalemate are checked first because they are
 * absolute, and the fifty-move and repetition draws come after. A position
 * that is both checkmate and the hundredth quiet ply is checkmate.
 */
function conclude(position: ChessPosition, repetitionCount: number): DuelOutcome | null {
  const color = seatColor(position.turn);
  if (legalMoves(position).length === 0) {
    return inCheck(position.board, color)
      ? { winner: otherSeat(position.turn), reason: REASON.checkmate }
      : { winner: null, reason: REASON.stalemate };
  }
  if (insufficientMaterial(position.board)) return { winner: null, reason: REASON.insufficient };
  if (repetitionCount >= REPETITION_LIMIT) return { winner: null, reason: REASON.repetition };
  if (position.halfmoveClock >= FIFTY_MOVE_PLIES) return { winner: null, reason: REASON.fiftyMove };
  return null;
}

/* ------------------------------------------------------- untrusted input */

function isSquareIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 64;
}

/**
 * A move claim, narrowed, or null.
 *
 * The route hands this through as `z.unknown()`, since only the engine knows
 * what a chess move looks like, so every shape check is here, and a wrong
 * shape becomes a rejection rather than a throw that would 500 the route.
 */
function parseMove(claim: unknown): ChessMove | null {
  if (typeof claim !== "object" || claim === null) return null;
  const candidate = claim as { from?: unknown; to?: unknown; promotion?: unknown };
  if (!isSquareIndex(candidate.from) || !isSquareIndex(candidate.to)) return null;
  if (candidate.from === candidate.to) return null;
  const { promotion } = candidate;
  if (promotion === undefined || promotion === null) {
    return { from: candidate.from, to: candidate.to };
  }
  if (typeof promotion !== "string" || !PROMOTION_PIECES.includes(promotion as PromotionPiece)) {
    return null;
  }
  return { from: candidate.from, to: candidate.to, promotion: promotion as PromotionPiece };
}

/**
 * The legal move a claim names, or null.
 *
 * Matching against the generated set is the whole validation: a claim that is
 * not in the list is illegal for whatever reason, including the one nobody
 * writes a branch for, that it leaves the mover's own king in check.
 * Promotion is resolved leniently because four moves share one from/to pair
 * and a client that named none of them still made an unambiguous move.
 */
function matchLegalMove(position: ChessPosition, claim: ChessMove): ChessMove | null {
  const candidates = legalMoves(position).filter(
    (move) => move.from === claim.from && move.to === claim.to,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const wanted = claim.promotion ?? "q";
  return candidates.find((move) => move.promotion === wanted) ?? candidates[0];
}

/* -------------------------------------------------------------- the game */

export const CHESS_DUEL = defineDuelGame<ChessState, ChessMove, ChessSnapshot>({
  id: "chess",
  label: "Chess",

  /**
   * `seed` is ignored: chess has no random setup, both players start from the
   * same position every time, and the contract explicitly names chess as a
   * game that may ignore it. `now` is not ignored; white's clock starts the
   * instant the match row exists.
   */
  createState: (_seed, now) => {
    const board = startingBoard();
    const position: ChessPosition = {
      board,
      turn: 0,
      castling: { whiteKing: true, whiteQueen: true, blackKing: true, blackQueen: true },
      enPassant: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
    };
    return {
      ...position,
      // The opening position counts toward threefold like any other.
      repetition: { [positionKey(position)]: 1 },
      lastMove: null,
      clock: [CLOCK_START_MS, CLOCK_START_MS],
      turnStartedAt: now,
      over: null,
    };
  },

  applyMove: (state, seat, move, now) => {
    if (state.over !== null) return { reject: "This match is already over." };
    if (seat !== state.turn) return { reject: "It is not your turn." };

    const claim = parseMove(move);
    if (claim === null) return { reject: "That is not a move." };

    const legal = matchLegalMove(state, claim);
    if (legal === null) return { reject: "That move is not legal." };

    // The clock is charged before the move is recorded, and a flag that had
    // already fallen settles the match rather than rejecting it: the service
    // ticks before calling this, so the only way to arrive here out of time is
    // a direct call, and answering with a rejection would leave a decided
    // match sitting unfinished waiting for a poll.
    const spent = Math.max(0, now - state.turnStartedAt);
    const left = state.clock[seat] - spent;
    if (left <= 0) return { next: flagFallen(state, seat, now) };

    const position = applyLegalMove(state, legal);
    const key = positionKey(position);
    // A position from before a capture or a pawn move can never recur, so the
    // ledger is thrown away rather than searched forever.
    const repetition: Record<string, number> =
      position.halfmoveClock === 0 ? {} : { ...state.repetition };
    repetition[key] = (repetition[key] ?? 0) + 1;

    const clock: [number, number] = [...state.clock];
    clock[seat] = left + CLOCK_INCREMENT_MS;

    return {
      next: {
        ...position,
        repetition,
        lastMove: { from: legal.from, to: legal.to },
        clock,
        turnStartedAt: now,
        over: conclude(position, repetition[key]),
      },
    };
  },

  /**
   * Null unless a flag has actually fallen.
   *
   * The shell polls every two seconds and the service calls this on every
   * read, so returning a fresh object for anything less than a real state
   * change would bump the version on each poll and livelock both players'
   * optimistic concurrency guard. The contract says so, and it is the one
   * way this file could break a game it has no rules bug in.
   */
  tick: (state, now) => {
    if (state.over !== null) return null;
    if (remainingClock(state, state.turn, now) > 0) return null;
    return flagFallen(state, state.turn, now);
  },

  result: (state) => state.over,

  snapshot: (state, seat, now) => ({
    board: [...state.board],
    turn: state.turn,
    check: inCheck(state.board, seatColor(state.turn)),
    lastMove: state.lastMove,
    clock: [remainingClock(state, 0, now), remainingClock(state, 1, now)],
    // Only the seat to move, and only while there is a move to make. A
    // spectator's null seat gets the restrictive answer, per the contract.
    legalMoves: seat !== null && seat === state.turn && state.over === null ? legalMoves(state) : null,
    over: state.over,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
  }),

  /** Recorded in the state so `result()` reports it from what was durably written. */
  resign: (state, seat, now) => {
    if (state.over !== null) return state;
    return {
      ...state,
      turnStartedAt: now,
      over: { winner: otherSeat(seat), reason: REASON.resigned },
    };
  },
});

/* ------------------------------------------------------------------ notation */

/** "e4" for 28. Used by the board's move list and by test failures, which are
 *  unreadable in raw indices. */
export function squareName(square: number): string {
  return `${"abcdefgh"[fileOf(square)]}${rankOf(square) + 1}`;
}

/** "e2" -> 12. Returns -1 on anything that is not a square. */
export function squareIndex(name: string): number {
  const file = "abcdefgh".indexOf(name[0] ?? "");
  const rank = Number(name[1]) - 1;
  if (file < 0 || !Number.isInteger(rank)) return -1;
  return squareAt(file, rank);
}

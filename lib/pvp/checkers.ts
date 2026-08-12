/**
 * Checkers, as a staked 1v1 duel.
 *
 * ENGLISH DRAUGHTS (American checkers), not international draughts. The
 * difference that matters and that somebody will eventually try to "fix":
 * a king here moves and jumps exactly ONE square diagonally, in either
 * direction. It is not a flying king. Men jump forward only; a man that
 * reaches the far row is crowned and its turn ENDS there, even if the new
 * king could have jumped again. Those three are the English rules and the
 * board, the tests and the reject messages all assume them.
 *
 * Pure and synchronous, like lib/arcade/blackjack.ts: every function takes a
 * state and returns the next one, nothing here reads a clock, a store or a
 * request. `now` is always an argument -- an engine that called Date.now()
 * could not be tested and would let a client's clock decide a real payout.
 *
 * ## The rule everybody gets wrong
 *
 * Capturing is MANDATORY, and that is enforced in MOVE GENERATION rather than
 * checked afterwards: if any piece of the side to move can jump, the generator
 * returns jumps and nothing else. There is therefore no path through this file
 * where a quiet move is "legal but discouraged" -- it is simply absent from
 * the list, so `applyMove`, the snapshot's highlight list and the draw rules
 * all agree about what may be played.
 *
 * A jump chain continues while the same piece can jump again, so ONE MOVE IS A
 * WHOLE TURN: `{ from, path: [landing, landing, ...] }`. Modelling a partial
 * jump as a state would put a half-finished turn in a jsonb column, where a
 * disconnect or a flag fall leaves a position no rule set describes. A chain
 * that stops early is not a move at all, and is rejected as such.
 *
 * ## Seats
 *
 * Seat 0 is RED, sits at the bottom of its own board (rows 5-7 at the start)
 * and moves UP the board toward row 0. Seat 1 is BLACK, starts on rows 0-2 and
 * moves DOWN toward row 7. Seat 0 moves first, which is what the framework
 * guarantees about the challenger.
 */

import {
  defineDuelGame,
  otherSeat,
  type DuelMoveResult,
  type DuelOutcome,
  type DuelSeat,
} from "./match-contract";

/* ------------------------------------------------------------------ shape */

/**
 * One square of the board.
 *
 * A single character per square, so the whole position is a 64-character
 * string: JSON-friendly with no nesting, and -- the reason it is a string
 * rather than an array -- directly usable as the repetition key, which is what
 * makes threefold detection a dictionary lookup instead of a board compare.
 */
export type CheckersCell = "." | "r" | "R" | "b" | "B";

/** A player's claim about what they want to play. Untrusted until checked. */
export interface CheckersMove {
  /** Square the piece starts on, 0-63. */
  from: number;
  /**
   * Every square the piece LANDS on, in order. One entry for a quiet move or
   * a single jump; one per jump for a chain. Never includes `from`.
   */
  path: number[];
}

/** A move the engine generated, so it carries what the move takes with it. */
export interface LegalCheckersMove extends CheckersMove {
  /**
   * Squares of the pieces this move captures, in the order they are jumped.
   * Present so the board can show a player what a chain will cost their
   * opponent without re-deriving the rules client-side.
   */
  captures: number[];
}

export interface CheckersState {
  /** 64 characters, row 0 first. Row 0 is seat 1's home row. */
  board: string;
  /** Whose turn it is. Meaningless once `outcome` is set. */
  turn: DuelSeat;
  /** When the current turn's clock started running, in epoch ms. */
  turnStartedAt: number;
  /**
   * Each seat's banked remaining ms as of `turnStartedAt`. The side to move is
   * spending from theirs right now -- see `remainingMs`, which is the only
   * thing that should ever read this pair directly.
   */
  clocks: [number, number];
  /** Plies since the last capture or man move. Drives the 40-move draw. */
  idlePlies: number;
  /** How often each reachable position has occurred. Cleared by any irreversible move. */
  repetitions: Record<string, number>;
  /** Set once, by whatever ended the match. `result()` is just this field. */
  outcome: DuelOutcome | null;
}

export interface CheckersSnapshot {
  board: string;
  turn: DuelSeat;
  /**
   * What the VIEWER may play right now, empty for anyone who is not the seat
   * to move. Checkers is perfect information, so this is not a redaction of
   * anything secret -- it is there so the board can highlight legal
   * destinations and, crucially, so a forced jump is visible rather than
   * mysterious. A player whose quiet move was refused with no explanation
   * concludes the game is broken.
   */
  legalMoves: LegalCheckersMove[];
  /** True when the side to move has a jump available, so every legal move is one. */
  mustJump: boolean;
  /** Live remaining ms for [seat 0, seat 1], computed against `now`. */
  clocks: [number, number];
  /** Pieces still on the board for [seat 0, seat 1]. */
  pieces: [number, number];
  idlePlies: number;
  outcome: DuelOutcome | null;
}

/* -------------------------------------------------------------- constants */

export const BOARD_SIDE = 8;
export const BOARD_SQUARES = BOARD_SIDE * BOARD_SIDE;

/**
 * Five minutes each with a three-second increment.
 *
 * Long enough that a thought-out endgame is playable, short enough that an
 * opponent who wandered off costs you five minutes and not an afternoon --
 * a staked match that can never end holds both players' Gold hostage. The
 * increment is what stops a won position being lost to the twenty moves it
 * takes to convert it.
 */
export const CHECKERS_CLOCK_MS = 5 * 60 * 1000;
export const CHECKERS_INCREMENT_MS = 3 * 1000;

/**
 * 40 moves by each side with no capture and no man moved is a draw.
 *
 * Counted in plies -- one player's turn -- because that is the unit this
 * engine actually advances in. Only a man moving or a piece being taken can
 * make progress toward an ending; kings shuffling cannot, and two kings that
 * cannot catch each other would otherwise hold a staked pot open forever.
 */
export const CHECKERS_IDLE_PLY_LIMIT = 80;

/** How often a position may recur before the match is drawn. */
export const CHECKERS_REPETITION_LIMIT = 3;

/**
 * A chain cannot take more pieces than the opponent owns, so any claimed path
 * longer than this is malformed rather than merely illegal. Bounds the work a
 * hostile payload can ask for before the rules are consulted at all.
 */
const MAX_PATH_LENGTH = 12;

const DIAGONALS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Reasons, as constants. Fixed strings for a fixed-width result card. */
const REASON_NO_PIECES = "No pieces left";
const REASON_NO_MOVES = "No moves left";
const REASON_TIMEOUT = "Timeout";
const REASON_RESIGNED = "Resigned";
const REASON_IDLE_DRAW = "40-move rule";
const REASON_REPETITION = "Threefold repetition";

/* ------------------------------------------------------------- geometry */

export function rowOf(square: number): number {
  return Math.floor(square / BOARD_SIDE);
}

export function colOf(square: number): number {
  return square % BOARD_SIDE;
}

function squareAt(row: number, col: number): number {
  return row * BOARD_SIDE + col;
}

function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIDE && col >= 0 && col < BOARD_SIDE;
}

/** Play happens on the dark squares only -- the light half is never occupied. */
export function isPlayableSquare(square: number): boolean {
  return (rowOf(square) + colOf(square)) % 2 === 1;
}

/** Which seat owns a cell, or null for an empty square. */
export function cellOwner(cell: CheckersCell): DuelSeat | null {
  if (cell === "r" || cell === "R") return 0;
  if (cell === "b" || cell === "B") return 1;
  return null;
}

export function isKingCell(cell: CheckersCell): boolean {
  return cell === "R" || cell === "B";
}

/** The row a man of this seat is crowned on: seat 0 moves up, seat 1 down. */
function crownRow(seat: DuelSeat): number {
  return seat === 0 ? 0 : BOARD_SIDE - 1;
}

function kingCell(seat: DuelSeat): CheckersCell {
  return seat === 0 ? "R" : "B";
}

function toCells(board: string): CheckersCell[] {
  return board.split("") as CheckersCell[];
}

/**
 * Where a piece may step. A man only ever moves toward the far side; a king
 * takes all four diagonals but still exactly one square -- see the header.
 */
function directionsFor(cell: CheckersCell, seat: DuelSeat): ReadonlyArray<readonly [number, number]> {
  if (isKingCell(cell)) return DIAGONALS;
  return seat === 0 ? [DIAGONALS[0], DIAGONALS[1]] : [DIAGONALS[2], DIAGONALS[3]];
}

/** The opening position: twelve men each, on the dark squares of rows 0-2 and 5-7. */
export function openingBoard(): string {
  const cells = new Array<CheckersCell>(BOARD_SQUARES).fill(".");
  for (let square = 0; square < BOARD_SQUARES; square += 1) {
    if (!isPlayableSquare(square)) continue;
    const row = rowOf(square);
    if (row <= 2) cells[square] = "b";
    else if (row >= 5) cells[square] = "r";
  }
  return cells.join("");
}

/* -------------------------------------------------------- move generation */

/**
 * Every jump chain available to the piece on `origin`, as complete turns.
 *
 * Depth-first over the same piece, backtracking as it goes. Two details are
 * the English rules rather than convenience:
 *
 *   - A jumped piece stays on the board until the whole move is finished. It
 *     is marked taken so it cannot be jumped twice, and because it is still
 *     standing there, a later leg of the chain cannot LAND on its square.
 *   - The moving piece is lifted from `origin` for the duration of the search,
 *     which is what lets a long chain legitimately finish back where it began.
 *
 * A leaf -- a square from which this piece can jump no further -- is a
 * complete turn. Any leaf will do: English draughts does not require taking
 * the longest chain, only that a chain once begun is played out.
 */
function collectJumps(
  cells: CheckersCell[],
  taken: boolean[],
  seat: DuelSeat,
  piece: CheckersCell,
  origin: number,
  at: number,
  path: number[],
  captures: number[],
  out: LegalCheckersMove[],
): void {
  let extended = false;

  for (const [dr, dc] of directionsFor(piece, seat)) {
    const midRow = rowOf(at) + dr;
    const midCol = colOf(at) + dc;
    const landRow = rowOf(at) + dr * 2;
    const landCol = colOf(at) + dc * 2;
    if (!onBoard(landRow, landCol)) continue;

    const mid = squareAt(midRow, midCol);
    const land = squareAt(landRow, landCol);
    if (taken[mid]) continue;
    if (cellOwner(cells[mid]) !== otherSeat(seat)) continue;
    if (cells[land] !== ".") continue;

    taken[mid] = true;
    path.push(land);
    captures.push(mid);

    // Crowning ends the turn on the spot -- the piece becomes a king, and a
    // king it only becomes at the END of the move cannot use its new
    // directions during that same move.
    if (!isKingCell(piece) && landRow === crownRow(seat)) {
      out.push({ from: origin, path: [...path], captures: [...captures] });
    } else {
      collectJumps(cells, taken, seat, piece, origin, land, path, captures, out);
    }

    taken[mid] = false;
    path.pop();
    captures.pop();
    extended = true;
  }

  if (!extended && path.length > 0) {
    out.push({ from: origin, path: [...path], captures: [...captures] });
  }
}

/**
 * Every legal move for a seat, jumps first and jumps only.
 *
 * The mandatory-capture rule lives here and nowhere else: when any jump
 * exists, quiet moves are never generated, so no caller has to remember to
 * check for one. That is the whole reason move generation is the single
 * authority in this file.
 */
export function legalCheckersMoves(board: string, seat: DuelSeat): LegalCheckersMove[] {
  const cells = toCells(board);
  const jumps: LegalCheckersMove[] = [];
  const taken = new Array<boolean>(BOARD_SQUARES).fill(false);

  for (let square = 0; square < BOARD_SQUARES; square += 1) {
    const piece = cells[square];
    if (cellOwner(piece) !== seat) continue;
    cells[square] = ".";
    collectJumps(cells, taken, seat, piece, square, square, [], [], jumps);
    cells[square] = piece;
  }
  if (jumps.length > 0) return jumps;

  const quiet: LegalCheckersMove[] = [];
  for (let square = 0; square < BOARD_SQUARES; square += 1) {
    const piece = cells[square];
    if (cellOwner(piece) !== seat) continue;
    for (const [dr, dc] of directionsFor(piece, seat)) {
      const row = rowOf(square) + dr;
      const col = colOf(square) + dc;
      if (!onBoard(row, col)) continue;
      const target = squareAt(row, col);
      if (cells[target] !== ".") continue;
      quiet.push({ from: square, path: [target], captures: [] });
    }
  }
  return quiet;
}

/** The board after a move the generator produced. Assumes the move is legal. */
function boardAfter(board: string, move: LegalCheckersMove): string {
  const cells = toCells(board);
  const piece = cells[move.from];
  const seat = cellOwner(piece);
  if (seat === null) return board;

  cells[move.from] = ".";
  for (const square of move.captures) cells[square] = ".";

  const land = move.path[move.path.length - 1];
  const crowned = !isKingCell(piece) && rowOf(land) === crownRow(seat);
  cells[land] = crowned ? kingCell(seat) : piece;
  return cells.join("");
}

function countPieces(board: string, seat: DuelSeat): number {
  let count = 0;
  for (const cell of board) {
    if (cellOwner(cell as CheckersCell) === seat) count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ clock */

/**
 * What a seat has left at `now`.
 *
 * Only the side to move is spending, and only while the match is live -- once
 * an outcome is recorded every clock is frozen at whatever the ending banked,
 * so a settled match cannot keep counting down under a result card. `elapsed`
 * is floored at zero because `now` is supplied by the caller and a clock that
 * ran backwards would hand the mover free time.
 */
export function remainingMs(state: CheckersState, seat: DuelSeat, now: number): number {
  if (state.outcome !== null || seat !== state.turn) return state.clocks[seat];
  const elapsed = Math.max(0, now - state.turnStartedAt);
  return Math.max(0, state.clocks[seat] - elapsed);
}

/** The clock pair with the mover's spent time banked, for a state that is ending. */
function bankedClocks(state: CheckersState, now: number): [number, number] {
  const clocks: [number, number] = [state.clocks[0], state.clocks[1]];
  clocks[state.turn] = remainingMs(state, state.turn, now);
  return clocks;
}

/* ---------------------------------------------------------- state changes */

/**
 * The opening position.
 *
 * `seed` is ignored on purpose: checkers has no random setup, and the contract
 * says so. It stays in the signature because the money layer hands every game
 * the same arguments.
 */
export function createCheckersState(_seed: number, now: number): CheckersState {
  return {
    board: openingBoard(),
    turn: 0,
    turnStartedAt: now,
    clocks: [CHECKERS_CLOCK_MS, CHECKERS_CLOCK_MS],
    idlePlies: 0,
    repetitions: {},
    outcome: null,
  };
}

/** How a position is identified for repetition: the pieces plus who is to move. */
function positionKey(board: string, turn: DuelSeat): string {
  return `${board}|${turn}`;
}

/**
 * Reads an untrusted payload as a move, or null if it is not one.
 *
 * The route validates that a `move` field exists and nothing else -- it is
 * `z.unknown()` by design, because only the engine knows what a move is here.
 * Everything below therefore runs on values that may be any shape at all, and
 * a wrong shape must come back as a rejection rather than a thrown 500.
 */
function parseMove(move: unknown): CheckersMove | null {
  if (typeof move !== "object" || move === null || Array.isArray(move)) return null;
  const claim = move as { from?: unknown; path?: unknown };
  if (!isSquare(claim.from)) return null;
  if (!Array.isArray(claim.path)) return null;

  const raw = claim.path as unknown[];
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null;
  const path: number[] = [];
  for (const step of raw) {
    if (!isSquare(step)) return null;
    path.push(step);
  }
  return { from: claim.from, path };
}

function isSquare(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < BOARD_SQUARES;
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((square, index) => square === b[index]);
}

/** True when `prefix` is the start of `path` but not all of it. */
function isStrictPrefix(prefix: number[], path: number[]): boolean {
  return prefix.length < path.length && prefix.every((square, index) => square === path[index]);
}

/**
 * Applies one player's whole turn.
 *
 * Order matters and is the same order the checks would have to be made in any
 * correct implementation: the match must be live, the claim must be a move at
 * all, it must be this seat's turn, the mover's flag must not have fallen, and
 * only then is the move looked up in the generated list. Looking it up is the
 * legality check -- there is no second pass that asks whether a capture was
 * available, because a quiet move is not in the list when one was.
 */
export function applyCheckersMove(
  state: CheckersState,
  seat: DuelSeat,
  move: unknown,
  now: number,
): DuelMoveResult<CheckersState> {
  if (state.outcome !== null) return { reject: "This match is already over." };

  const claim = parseMove(move);
  if (claim === null) return { reject: "That is not a move." };
  if (seat !== state.turn) return { reject: "It is not your turn." };

  // A player who let the clock run out cannot then move. Settling it here
  // rather than only rejecting means the match ends on the attempt instead of
  // waiting for the next poll to notice.
  if (remainingMs(state, seat, now) <= 0) return { next: flagFallen(state, now) };

  const legal = legalCheckersMoves(state.board, seat);
  const played = legal.find(
    (candidate) => candidate.from === claim.from && samePath(candidate.path, claim.path),
  );

  if (!played) {
    // Say WHY, specifically. These two are the rules a player is most likely
    // to be surprised by, and an unexplained refusal reads as a broken game.
    if (legal.some((candidate) => candidate.from === claim.from && isStrictPrefix(claim.path, candidate.path))) {
      return { reject: "Finish the jump -- that piece has to keep taking." };
    }
    if (legal.some((candidate) => candidate.captures.length > 0)) {
      return { reject: "A jump is available, so you have to take it." };
    }
    return { reject: "That is not a legal move." };
  }

  const board = boardAfter(state.board, played);
  const mover = seat;
  const next = otherSeat(seat);

  // Only a capture or a man moving can make progress toward an ending, and
  // either makes every earlier position unreachable -- so the repetition
  // record is cleared at the same moment the idle counter resets, which also
  // keeps that dictionary from growing across a whole game.
  const irreversible = played.captures.length > 0 || !isKingCell(toCells(state.board)[played.from]);
  const idlePlies = irreversible ? 0 : state.idlePlies + 1;
  const repetitions = irreversible ? {} : { ...state.repetitions };
  const key = positionKey(board, next);
  const seen = (repetitions[key] ?? 0) + 1;
  repetitions[key] = seen;

  const clocks: [number, number] = [state.clocks[0], state.clocks[1]];
  clocks[mover] = remainingMs(state, mover, now) + CHECKERS_INCREMENT_MS;

  const settled: CheckersState = {
    board,
    turn: next,
    turnStartedAt: now,
    clocks,
    idlePlies,
    repetitions,
    outcome: null,
  };

  // Winning beats drawing: a move that both stalemates the opponent and trips
  // a draw counter is a win, because the opponent has no move to make with the
  // draw they would otherwise claim.
  if (countPieces(board, next) === 0) {
    settled.outcome = { winner: mover, reason: REASON_NO_PIECES };
  } else if (legalCheckersMoves(board, next).length === 0) {
    settled.outcome = { winner: mover, reason: REASON_NO_MOVES };
  } else if (seen >= CHECKERS_REPETITION_LIMIT) {
    settled.outcome = { winner: null, reason: REASON_REPETITION };
  } else if (idlePlies >= CHECKERS_IDLE_PLY_LIMIT) {
    settled.outcome = { winner: null, reason: REASON_IDLE_DRAW };
  }

  return { next: settled };
}

function flagFallen(state: CheckersState, now: number): CheckersState {
  const clocks = bankedClocks(state, now);
  clocks[state.turn] = 0;
  return {
    ...state,
    clocks,
    outcome: { winner: otherSeat(state.turn), reason: REASON_TIMEOUT },
  };
}

/**
 * The only thing that happens without a move: a flag falling.
 *
 * Returns null in every other case, which is nearly every call -- the shell
 * polls this every two seconds per player, and a tick that handed back a fresh
 * object each time would bump the stored version on every poll and livelock
 * both players against the optimistic concurrency guard. Nothing here is
 * derived from wall time except the comparison itself, so "nothing changed" is
 * cheap to answer honestly.
 */
export function tickCheckers(state: CheckersState, now: number): CheckersState | null {
  if (state.outcome !== null) return null;
  if (remainingMs(state, state.turn, now) > 0) return null;
  return flagFallen(state, now);
}

/** Whatever ended the match, or null while it is still being played. */
export function checkersResult(state: CheckersState): DuelOutcome | null {
  return state.outcome;
}

/**
 * Resigning, recorded in the state rather than inferred by the caller.
 *
 * Already-finished matches are returned untouched: a resignation arriving
 * after a flag fell must not rewrite who won.
 */
export function resignCheckers(state: CheckersState, seat: DuelSeat, now: number): CheckersState {
  if (state.outcome !== null) return state;
  return {
    ...state,
    clocks: bankedClocks(state, now),
    outcome: { winner: otherSeat(seat), reason: REASON_RESIGNED },
  };
}

/**
 * What a viewer sees.
 *
 * Both seats see the same board -- checkers is perfect information and the
 * contract names it as one of the two symmetric games. The only per-viewer
 * part is the legal-move list, which goes to the seat that is actually to move
 * and to nobody else: a spectator or an unauthenticated read (`seat === null`)
 * gets the most restrictive view, per the contract's note that defaulting an
 * unknown viewer to "sees everything" is how a second tab becomes a cheat.
 *
 * Clocks are computed live from `now` rather than echoed, so a player watching
 * their opponent think sees the time actually draining.
 */
export function checkersSnapshot(
  state: CheckersState,
  seat: DuelSeat | null,
  now: number,
): CheckersSnapshot {
  const live = state.outcome === null;
  const moves = live ? legalCheckersMoves(state.board, state.turn) : [];
  const yours = live && seat === state.turn;

  return {
    board: state.board,
    turn: state.turn,
    legalMoves: yours ? moves : [],
    mustJump: moves.some((move) => move.captures.length > 0),
    clocks: [remainingMs(state, 0, now), remainingMs(state, 1, now)],
    pieces: [countPieces(state.board, 0), countPieces(state.board, 1)],
    idlePlies: state.idlePlies,
    outcome: state.outcome,
  };
}

export const CHECKERS_DUEL = defineDuelGame<CheckersState, unknown, CheckersSnapshot>({
  id: "checkers",
  label: "Checkers",
  createState: createCheckersState,
  applyMove: applyCheckersMove,
  tick: tickCheckers,
  result: checkersResult,
  snapshot: checkersSnapshot,
  resign: resignCheckers,
});

/**
 * Othello, as a staked 1v1 duel.
 *
 * Pure and synchronous, like ./checkers.ts: every function takes a state and
 * returns the next one, nothing here reads a clock, a store or a request.
 * `now` is always an argument -- an engine that called Date.now() could not be
 * tested and would let a client's clock decide a real payout.
 *
 * ## Why this game and not Connect Four
 *
 * Both are perfect information with no randomness, which is what a staked
 * skill duel needs. Connect Four is *solved*: the first player wins with
 * perfect play from the opening move, and a player who has memorised that line
 * beats every opponent they get seat 0 against, forever, for real Gold.
 * Othello is not solved, and its opening theory does not collapse into one
 * winning script. That difference is the whole reason this is the fifth duel.
 *
 * ## The two rules people get wrong
 *
 * 1. **A move must flip something.** Dropping a disc on an empty square is not
 *    a move unless it brackets at least one unbroken line of the opponent's
 *    discs between the new disc and one of your own. `legalOthelloMoves` is
 *    the single authority on that, the same way `legalCheckersMoves` is for
 *    the forced jump, so no caller has to check it a second time.
 *
 * 2. **A player with no legal move passes; they do not lose.** The turn goes
 *    back to the opponent, who may well have to hand it straight back. Only
 *    when NEITHER side has a move is the game over -- which is usually a full
 *    board, but not always, and a board with empty squares left on it is a
 *    perfectly ordinary way for Othello to end. `passed` records that it just
 *    happened, so the board can say so rather than leaving a player staring at
 *    a turn indicator that did not move.
 *
 * There is no draw-by-repetition or idle rule here, unlike checkers: every
 * legal move places a disc on an empty square, so the board strictly fills and
 * a game cannot run past 60 moves. It cannot loop, so there is nothing to
 * detect.
 *
 * ## Seats
 *
 * Seat 0 is BLACK and moves first, which is what the framework guarantees
 * about the challenger, and is also Othello's own rule. Seat 1 is WHITE.
 */

import {
  defineDuelGame,
  otherSeat,
  remainingTime,
  type DuelMoveResult,
  type DuelOutcome,
  type DuelSeat,
} from "./match-contract";

/* ------------------------------------------------------------------ shape */

/**
 * One square of the board.
 *
 * A single character per square, so the whole position is a 64-character
 * string: JSON-friendly with no nesting, and cheap to compare. Same encoding
 * choice ./checkers.ts makes, for the same reasons.
 */
export type OthelloCell = "." | "b" | "w";

/** A player's claim about what they want to play. Untrusted until checked. */
export interface OthelloMove {
  /** The empty square to place on, 0-63. */
  square: number;
}

/** A move the engine generated, so it carries what the move takes with it. */
export interface LegalOthelloMove extends OthelloMove {
  /**
   * Squares of the opponent discs this move turns over. Present so the board
   * can show a player what a square is worth before they commit to it, without
   * re-deriving the rules client-side.
   */
  flips: number[];
}

export interface OthelloState {
  /** 64 characters, row 0 first. */
  board: string;
  /** Whose turn it is. Meaningless once `outcome` is set. */
  turn: DuelSeat;
  /** When the current turn's clock started running, in epoch ms. */
  turnStartedAt: number;
  /**
   * Each seat's banked remaining ms as of `turnStartedAt`. The side to move is
   * spending from theirs right now; see `remainingMs`, which is the only thing
   * that should ever read this pair directly.
   */
  clocks: [number, number];
  /**
   * True when the seat now to move got the turn because the OTHER seat had no
   * legal move, rather than because a disc was just played. Presentation only
   * -- no rule reads it -- but without it a passed turn is invisible and looks
   * like the board ignored somebody's move.
   */
  passed: boolean;
  /** Set once, by whatever ended the match. `result()` is just this field. */
  outcome: DuelOutcome | null;
}

export interface OthelloSnapshot {
  board: string;
  turn: DuelSeat;
  /**
   * What the viewer may play right now, empty for anyone who is not the seat
   * to move. Othello is perfect information, so this is not a redaction of
   * anything secret. It is there so the board can show where a disc may go and
   * what it would turn over: a player who cannot see that is reduced to
   * tapping squares until one is accepted.
   */
  legalMoves: LegalOthelloMove[];
  /** Discs on the board for [seat 0, seat 1]. The score, and the win condition. */
  discs: [number, number];
  /** Empty squares left. */
  empty: number;
  /** Live remaining ms for [seat 0, seat 1], computed against `now`. */
  clocks: [number, number];
  /** Whether the seat to move got the turn by the other one passing; see the state. */
  passed: boolean;
  outcome: DuelOutcome | null;
}

/* -------------------------------------------------------------- constants */

export const BOARD_SIDE = 8;
export const BOARD_SQUARES = BOARD_SIDE * BOARD_SIDE;

/**
 * Five minutes each with a three-second increment, matching checkers.
 *
 * Long enough that a real endgame is playable, short enough that an opponent
 * who wandered off costs you five minutes and not an afternoon: a staked match
 * that can never end holds both players' Gold hostage. The increment is what
 * stops a won position being lost to the twenty moves it takes to convert it.
 */
export const OTHELLO_CLOCK_MS = 5 * 60 * 1000;
export const OTHELLO_INCREMENT_MS = 3 * 1000;

/** Reasons, as constants. Fixed strings for a fixed-width result card. */
const REASON_TIMEOUT = "Timeout";
const REASON_RESIGNED = "Resigned";
const REASON_SWEPT = "Wiped out";

/** The eight directions a bracket can run in. */
const RAYS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

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

/** Which seat owns a cell, or null for an empty square. */
export function cellOwner(cell: OthelloCell): DuelSeat | null {
  if (cell === "b") return 0;
  if (cell === "w") return 1;
  return null;
}

export function discOf(seat: DuelSeat): OthelloCell {
  return seat === 0 ? "b" : "w";
}

function toCells(board: string): OthelloCell[] {
  return board.split("") as OthelloCell[];
}

/**
 * The opening position: the four centre squares, seat 1's on the main
 * diagonal. This is the standard Othello setup, and it is not symmetric under
 * a quarter turn, so getting it wrong mirrors every book opening.
 */
export function openingBoard(): string {
  const cells = new Array<OthelloCell>(BOARD_SQUARES).fill(".");
  cells[squareAt(3, 3)] = "w";
  cells[squareAt(4, 4)] = "w";
  cells[squareAt(3, 4)] = "b";
  cells[squareAt(4, 3)] = "b";
  return cells.join("");
}

/* -------------------------------------------------------- move generation */

/**
 * What placing on `square` would turn over for `seat`, empty if nothing.
 *
 * An empty list is exactly "this is not a legal move", which is the rule
 * people get wrong (see the file header), so legality and consequence are one
 * question answered once rather than two that could disagree.
 */
export function flipsFor(cells: readonly OthelloCell[], seat: DuelSeat, square: number): number[] {
  if (cells[square] !== ".") return [];

  const mine = seat;
  const theirs = otherSeat(seat);
  const flips: number[] = [];

  for (const [dr, dc] of RAYS) {
    let row = rowOf(square) + dr;
    let col = colOf(square) + dc;
    const run: number[] = [];

    // Walk the opponent's discs; a ray only counts once it closes on one of
    // ours, so a run that reaches the edge or an empty square flips nothing.
    while (onBoard(row, col) && cellOwner(cells[squareAt(row, col)]) === theirs) {
      run.push(squareAt(row, col));
      row += dr;
      col += dc;
    }
    if (run.length === 0) continue;
    if (!onBoard(row, col)) continue;
    if (cellOwner(cells[squareAt(row, col)]) !== mine) continue;
    flips.push(...run);
  }

  return flips;
}

/** Every legal move for a seat. A square that flips nothing is not one. */
export function legalOthelloMoves(board: string, seat: DuelSeat): LegalOthelloMove[] {
  const cells = toCells(board);
  const moves: LegalOthelloMove[] = [];

  for (let square = 0; square < BOARD_SQUARES; square += 1) {
    if (cells[square] !== ".") continue;
    const flips = flipsFor(cells, seat, square);
    if (flips.length > 0) moves.push({ square, flips });
  }
  return moves;
}

/** The board after a move the generator produced. Assumes the move is legal. */
function boardAfter(board: string, seat: DuelSeat, move: LegalOthelloMove): string {
  const cells = toCells(board);
  cells[move.square] = discOf(seat);
  for (const square of move.flips) cells[square] = discOf(seat);
  return cells.join("");
}

export function countDiscs(board: string, seat: DuelSeat): number {
  let count = 0;
  for (const cell of board) {
    if (cellOwner(cell as OthelloCell) === seat) count += 1;
  }
  return count;
}

function countEmpty(board: string): number {
  let count = 0;
  for (const cell of board) {
    if (cell === ".") count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ clock */

/**
 * What a seat has left at `now`.
 *
 * Only the side to move is spending, and only while the match is live. Once an
 * outcome is recorded every clock is frozen at whatever the ending banked, so
 * a settled match cannot keep counting down under a result card.
 */
export function remainingMs(state: OthelloState, seat: DuelSeat, now: number): number {
  return remainingTime(state.clocks[seat], seat, state.turn, state.turnStartedAt, now, state.outcome !== null);
}

/** The clock pair with the mover's spent time banked, for a state that is ending. */
function bankedClocks(state: OthelloState, now: number): [number, number] {
  const clocks: [number, number] = [state.clocks[0], state.clocks[1]];
  clocks[state.turn] = remainingMs(state, state.turn, now);
  return clocks;
}

/* ---------------------------------------------------------- state changes */

/**
 * The opening position.
 *
 * `seed` is ignored on purpose: Othello has no random setup, and the contract
 * says so. It stays in the signature because the money layer hands every game
 * the same arguments.
 */
export function createOthelloState(_seed: number, now: number): OthelloState {
  return {
    board: openingBoard(),
    turn: 0,
    turnStartedAt: now,
    clocks: [OTHELLO_CLOCK_MS, OTHELLO_CLOCK_MS],
    passed: false,
    outcome: null,
  };
}

/**
 * Who has won a board nobody can move on, by disc count.
 *
 * The reason line is the score itself ("38 - 26"), which is what an Othello
 * player actually wants to see, and is already the short fixed-width shape the
 * contract asks a reason to be.
 */
export function finalOutcome(board: string): DuelOutcome {
  const black = countDiscs(board, 0);
  const white = countDiscs(board, 1);
  // A sweep is worth naming: it is the one ending where the score line alone
  // ("34 - 0") reads like a typo rather than a result.
  if (black === 0 || white === 0) {
    return { winner: black === 0 ? 1 : 0, reason: REASON_SWEPT };
  }
  if (black === white) return { winner: null, reason: `${black} - ${white}` };
  return { winner: black > white ? 0 : 1, reason: `${Math.max(black, white)} - ${Math.min(black, white)}` };
}

/**
 * Reads an untrusted payload as a move, or null if it is not one.
 *
 * The route validates that a `move` field exists and nothing else; it is
 * `z.unknown()` by design, because only the engine knows what a move is here.
 * Everything below therefore runs on values that may be any shape at all, and
 * a wrong shape must come back as a rejection rather than a thrown 500.
 */
function parseMove(move: unknown): OthelloMove | null {
  if (typeof move !== "object" || move === null || Array.isArray(move)) return null;
  const claim = move as { square?: unknown };
  if (!isSquare(claim.square)) return null;
  return { square: claim.square };
}

function isSquare(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < BOARD_SQUARES;
}

/**
 * Applies one player's move.
 *
 * Order matters and is the same order the checks would have to be made in any
 * correct implementation: the match must be live, the claim must be a move at
 * all, it must be this seat's turn, the mover's flag must not have fallen, and
 * only then is the square looked up in the generated list. Looking it up is
 * the legality check; there is no second pass asking whether it flips
 * anything, because a square that flips nothing is not in the list.
 */
export function applyOthelloMove(
  state: OthelloState,
  seat: DuelSeat,
  move: unknown,
  now: number,
): DuelMoveResult<OthelloState> {
  if (state.outcome !== null) return { reject: "This match is already over." };

  const claim = parseMove(move);
  if (claim === null) return { reject: "That is not a move." };
  if (seat !== state.turn) return { reject: "It is not your turn." };

  // A player who let the clock run out cannot then move. Settling it here
  // rather than only rejecting means the match ends on the attempt instead of
  // waiting for the next poll to notice.
  if (remainingMs(state, seat, now) <= 0) return { next: flagFallen(state, now) };

  const legal = legalOthelloMoves(state.board, seat);
  const played = legal.find((candidate) => candidate.square === claim.square);
  if (!played) {
    // Say why, specifically. "Flips nothing" is the rule a new player is most
    // likely to be surprised by, and an unexplained refusal reads as a broken
    // game.
    const cells = toCells(state.board);
    if (cells[claim.square] !== ".") return { reject: "That square is taken." };
    return { reject: "That square flips nothing, so it is not a move." };
  }

  const board = boardAfter(state.board, seat, played);
  const clocks: [number, number] = [state.clocks[0], state.clocks[1]];
  clocks[seat] = remainingMs(state, seat, now) + OTHELLO_INCREMENT_MS;

  // Whose turn it is next is a rule, not a rotation: the opponent moves if
  // they can, the mover moves again if the opponent cannot, and if neither
  // can, the game is over. This is the pass rule, and it lives here rather
  // than in the caller so nobody can skip it.
  const opponent = otherSeat(seat);
  const opponentCanMove = legalOthelloMoves(board, opponent).length > 0;
  const moverCanMove = opponentCanMove ? true : legalOthelloMoves(board, seat).length > 0;

  return {
    next: {
      board,
      turn: opponentCanMove ? opponent : seat,
      turnStartedAt: now,
      clocks,
      passed: !opponentCanMove && moverCanMove,
      outcome: opponentCanMove || moverCanMove ? null : finalOutcome(board),
    },
  };
}

function flagFallen(state: OthelloState, now: number): OthelloState {
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
 * Returns null in every other case, which is nearly every call. The shell
 * polls this every two seconds per player, and a tick that handed back a fresh
 * object each time would bump the stored version on every poll and livelock
 * both players against the optimistic concurrency guard.
 */
export function tickOthello(state: OthelloState, now: number): OthelloState | null {
  if (state.outcome !== null) return null;
  if (remainingMs(state, state.turn, now) > 0) return null;
  return flagFallen(state, now);
}

/** Whatever ended the match, or null while it is still being played. */
export function othelloResult(state: OthelloState): DuelOutcome | null {
  return state.outcome;
}

/**
 * Resigning, recorded in the state rather than inferred by the caller.
 *
 * Already-finished matches are returned untouched: a resignation arriving
 * after a flag fell must not rewrite who won. A resignation is a loss
 * regardless of the disc count -- Othello's score swings wildly right up to
 * the last move, so "I was ahead when I quit" is not a claim on the pot.
 */
export function resignOthello(state: OthelloState, seat: DuelSeat, now: number): OthelloState {
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
 * Both seats see the same board: Othello is perfect information, one of the
 * symmetric games the contract names. The only per-viewer part is the
 * legal-move list, which goes to the seat that is actually to move and to
 * nobody else -- a spectator or an unauthenticated read (`seat === null`) gets
 * the most restrictive view, per the contract's note that defaulting an
 * unknown viewer to "sees everything" is how a second tab becomes a cheat.
 *
 * Clocks are computed live from `now` rather than echoed, so a player watching
 * their opponent think sees the time actually draining.
 */
export function othelloSnapshot(
  state: OthelloState,
  seat: DuelSeat | null,
  now: number,
): OthelloSnapshot {
  const live = state.outcome === null;
  const yours = live && seat === state.turn;

  return {
    board: state.board,
    turn: state.turn,
    legalMoves: yours ? legalOthelloMoves(state.board, state.turn) : [],
    discs: [countDiscs(state.board, 0), countDiscs(state.board, 1)],
    empty: countEmpty(state.board),
    clocks: [remainingMs(state, 0, now), remainingMs(state, 1, now)],
    passed: state.passed,
    outcome: state.outcome,
  };
}

export const OTHELLO_DUEL = defineDuelGame<OthelloState, unknown, OthelloSnapshot>({
  id: "othello",
  label: "Othello",
  createState: createOthelloState,
  applyMove: applyOthelloMove,
  tick: tickOthello,
  result: othelloResult,
  snapshot: othelloSnapshot,
  resign: resignOthello,
});

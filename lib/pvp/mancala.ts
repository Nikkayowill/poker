/**
 * Mancala (standard Kalah), as a staked 1v1 duel.
 *
 * Pure and synchronous, like ./othello.ts: every function takes a state and
 * returns the next one, nothing here reads a clock or a request. There is no
 * clock on this game at all -- see the file's own note on that below.
 *
 * ## Layout
 *
 * Fourteen pits in one array, 0-13. Pits 0-5 are seat 0's row, pit 6 is seat
 * 0's store. Pits 7-12 are seat 1's row, pit 13 is seat 1's store. Sowing
 * always increases the index, wrapping from 13 back to 0, and skips the
 * *opponent's* store -- your own store is a normal stop.
 *
 * ## The two rules a new player forgets
 *
 * 1. **Landing your last seed in your own store earns another turn.** The
 *    turn does not pass; the same seat picks again.
 * 2. **Landing your last seed in an empty pit on your own side captures.**
 *    That seed and everything sitting in the directly opposite pit both go
 *    to your store, emptying both pits. "Empty" means empty the instant
 *    before that seed landed, which matters once a sow is long enough to
 *    lap the board more than once and pass through the same pit twice --
 *    `sowFrom` tracks that directly rather than reading the final count,
 *    which would be wrong for a pit visited more than once in one sow.
 *
 * ## Ending
 *
 * The game ends the moment either side's six pits are all empty. The other
 * side sweeps whatever is left in theirs into their own store, and the
 * higher store wins. That sweep is unconditional and runs after every move,
 * not just the ones that look like they might have emptied a row, because a
 * capture can empty a row exactly as easily as sowing the last pit can.
 *
 * ## Seats
 *
 * Seat 0 moves first, same as every other duel here.
 */

import {
  defineDuelGame,
  otherSeat,
  type DuelMoveResult,
  type DuelOutcome,
  type DuelSeat,
} from "./match-contract";

/* ------------------------------------------------------------------ shape */

/** A player's claim about which pit to sow. Untrusted until checked. */
export interface MancalaMove {
  pit: number;
}

/**
 * What the most recent sow did. No rule reads it; it exists so the board can
 * say "extra turn" or "captured 5" instead of leaving a player to work out
 * why the turn did not pass or why a pit emptied.
 */
export interface MancalaLastMove {
  seat: DuelSeat;
  /** The pit that was sown. */
  pit: number;
  /** Where the last seed landed. */
  lastPit: number;
  /** Seeds taken by a capture (the landing seed plus the opposite pit), or 0. */
  captured: number;
  /** The same seat moves again: the last seed landed in its own store. */
  extraTurn: boolean;
}

export interface MancalaState {
  /** 14 counts: seat 0's six pits, seat 0's store, seat 1's six pits, seat 1's store. */
  pits: number[];
  /** Whose turn it is. Meaningless once `outcome` is set. */
  turn: DuelSeat;
  /** Null before the first move. */
  lastMove: MancalaLastMove | null;
  /** Set once, by whatever ended the match. `mancalaResult` is just this field. */
  outcome: DuelOutcome | null;
}

export interface MancalaSnapshot {
  pits: number[];
  turn: DuelSeat;
  /** Pits the viewer may sow from right now; empty for anyone not to move. */
  legalPits: number[];
  /** [seat 0's store, seat 1's store]. The score, and the win condition. */
  stores: [number, number];
  lastMove: MancalaLastMove | null;
  outcome: DuelOutcome | null;
}

/* -------------------------------------------------------------- constants */

export const PIT_COUNT = 14;
export const SEEDS_PER_PIT = 4;
export const STORE_SEAT0 = 6;
export const STORE_SEAT1 = 13;

/** Each seat's six playing pits, in sow order. */
const SEAT_PITS: Readonly<Record<DuelSeat, readonly number[]>> = {
  0: [0, 1, 2, 3, 4, 5],
  1: [7, 8, 9, 10, 11, 12],
};

const REASON_RESIGNED = "Resigned";

/* ------------------------------------------------------------------ pits */

export function seatPits(seat: DuelSeat): readonly number[] {
  return SEAT_PITS[seat];
}

export function storeOf(seat: DuelSeat): number {
  return seat === 0 ? STORE_SEAT0 : STORE_SEAT1;
}

function opponentStoreOf(seat: DuelSeat): number {
  return storeOf(otherSeat(seat));
}

/** The pit directly across the board from `pit`, on either side. */
export function oppositePit(pit: number): number {
  return 12 - pit;
}

/** The opening position: four seeds in every playing pit, both stores empty. */
export function openingPits(): number[] {
  const pits = new Array<number>(PIT_COUNT).fill(0);
  for (const pit of SEAT_PITS[0]) pits[pit] = SEEDS_PER_PIT;
  for (const pit of SEAT_PITS[1]) pits[pit] = SEEDS_PER_PIT;
  return pits;
}

/** The pits a seat may currently choose from: their own row, non-empty. */
export function legalMancalaPits(pits: readonly number[], seat: DuelSeat): number[] {
  return SEAT_PITS[seat].filter((pit) => pits[pit] > 0);
}

function isSeatEmpty(pits: readonly number[], seat: DuelSeat): boolean {
  return SEAT_PITS[seat].every((pit) => pits[pit] === 0);
}

/* -------------------------------------------------------------- sowing */

/**
 * Picks up every seed in `startPit` and deposits one in each following pit,
 * skipping the sower's opponent's store, wrapping the index at the end of
 * the board.
 *
 * Returns the pit the last seed landed in, and what that pit held *before*
 * that seed was placed -- the only reliable way to tell whether the landing
 * pit was "empty" for the capture rule, since a long sow can lap the board
 * and visit the same pit twice.
 */
function sowFrom(
  pits: number[],
  seat: DuelSeat,
  startPit: number,
): { lastPit: number; lastPitValueBefore: number } {
  let seeds = pits[startPit];
  pits[startPit] = 0;

  const skip = opponentStoreOf(seat);
  let idx = startPit;
  let valueBefore = 0;

  while (seeds > 0) {
    idx = (idx + 1) % PIT_COUNT;
    if (idx === skip) continue;
    valueBefore = pits[idx];
    pits[idx] += 1;
    seeds -= 1;
  }

  return { lastPit: idx, lastPitValueBefore: valueBefore };
}

/**
 * Sweeps a finished game: once either side's row is entirely empty, the
 * other side's remaining seeds go to their own store, both rows end at zero.
 * Runs after every move; whether the game actually ended is the return.
 */
function finalizeIfEnded(pits: number[]): boolean {
  const seat0Empty = isSeatEmpty(pits, 0);
  const seat1Empty = isSeatEmpty(pits, 1);
  if (!seat0Empty && !seat1Empty) return false;

  for (const pit of SEAT_PITS[0]) {
    pits[STORE_SEAT0] += pits[pit];
    pits[pit] = 0;
  }
  for (const pit of SEAT_PITS[1]) {
    pits[STORE_SEAT1] += pits[pit];
    pits[pit] = 0;
  }
  return true;
}

/** Who won by store count, once the game has ended. */
function finalOutcome(pits: readonly number[]): DuelOutcome {
  const seat0 = pits[STORE_SEAT0];
  const seat1 = pits[STORE_SEAT1];
  if (seat0 === seat1) return { winner: null, reason: `${seat0} - ${seat1}` };
  return {
    winner: seat0 > seat1 ? 0 : 1,
    reason: `${Math.max(seat0, seat1)} - ${Math.min(seat0, seat1)}`,
  };
}

/* ---------------------------------------------------------- state changes */

/**
 * The opening position.
 *
 * `seed` is ignored on purpose, the same way `createOthelloState` ignores
 * it: Mancala has no random setup, and the contract hands every game the
 * same arguments regardless.
 */
export function createMancalaState(_seed: number, _now: number): MancalaState {
  return {
    pits: openingPits(),
    turn: 0,
    lastMove: null,
    outcome: null,
  };
}

/**
 * Reads an untrusted payload as a move, or null if it is not one.
 *
 * `move` arrives as `unknown`; only this engine knows what a Mancala move
 * looks like, so shape-checking it is this file's job, not the route's.
 */
function parseMove(move: unknown): MancalaMove | null {
  if (typeof move !== "object" || move === null || Array.isArray(move)) return null;
  const claim = move as { pit?: unknown };
  if (!isPitIndex(claim.pit)) return null;
  return { pit: claim.pit };
}

function isPitIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < PIT_COUNT;
}

/**
 * Applies one player's move: sow, then capture if it earned one, then check
 * whether the board just ended, then decide whose turn is next.
 *
 * Order matters. A capture can only follow a sow that just happened, ending
 * can only be checked once both the sow and any capture are on the board,
 * and whose turn is next depends on whether the game just ended at all --
 * an ended board has no "next turn" to hand anyone.
 */
export function applyMancalaMove(
  state: MancalaState,
  seat: DuelSeat,
  move: unknown,
  _now: number,
): DuelMoveResult<MancalaState> {
  if (state.outcome !== null) return { reject: "This match is already over." };

  const claim = parseMove(move);
  if (claim === null) return { reject: "That is not a move." };
  if (seat !== state.turn) return { reject: "It is not your turn." };
  if (!SEAT_PITS[seat].includes(claim.pit)) return { reject: "That is not one of your pits." };
  if (state.pits[claim.pit] === 0) return { reject: "That pit is empty." };

  const pits = [...state.pits];
  const { lastPit, lastPitValueBefore } = sowFrom(pits, seat, claim.pit);

  let captured = 0;
  if (SEAT_PITS[seat].includes(lastPit) && lastPitValueBefore === 0) {
    const opposite = oppositePit(lastPit);
    if (pits[opposite] > 0) {
      captured = pits[lastPit] + pits[opposite];
      pits[storeOf(seat)] += captured;
      pits[lastPit] = 0;
      pits[opposite] = 0;
    }
  }

  const extraTurn = lastPit === storeOf(seat);
  const ended = finalizeIfEnded(pits);
  const lastMove: MancalaLastMove = {
    seat,
    pit: claim.pit,
    lastPit,
    captured,
    extraTurn: extraTurn && !ended,
  };
  if (ended) {
    return { next: { pits, turn: state.turn, lastMove, outcome: finalOutcome(pits) } };
  }

  const turn = extraTurn ? seat : otherSeat(seat);
  return { next: { pits, turn, lastMove, outcome: null } };
}

/** Whatever ended the match, or null while it is still being played. */
export function mancalaResult(state: MancalaState): DuelOutcome | null {
  return state.outcome;
}

/**
 * Resigning, recorded in the state rather than inferred by the caller.
 *
 * Already-finished matches are returned untouched, and the pits are left as
 * they stood: a resignation is a loss regardless of the store count, so
 * there is nothing to sweep or settle beyond recording who lost.
 */
export function resignMancala(state: MancalaState, seat: DuelSeat, _now: number): MancalaState {
  if (state.outcome !== null) return state;
  return {
    ...state,
    outcome: { winner: otherSeat(seat), reason: REASON_RESIGNED },
  };
}

/**
 * What a viewer sees.
 *
 * Both seats see the same board: Mancala is perfect information, like
 * Othello. The only per-viewer part is which pits are legal to sow, which
 * goes only to the seat actually to move.
 */
export function mancalaSnapshot(
  state: MancalaState,
  seat: DuelSeat | null,
  _now: number,
): MancalaSnapshot {
  const live = state.outcome === null;
  const yours = live && seat !== null && seat === state.turn;

  return {
    pits: state.pits,
    turn: state.turn,
    legalPits: yours ? legalMancalaPits(state.pits, state.turn) : [],
    stores: [state.pits[STORE_SEAT0], state.pits[STORE_SEAT1]],
    lastMove: state.lastMove,
    outcome: state.outcome,
  };
}

export const MANCALA_DUEL = defineDuelGame<MancalaState, unknown, MancalaSnapshot>({
  id: "mancala",
  label: "Mancala",
  createState: createMancalaState,
  applyMove: applyMancalaMove,
  result: mancalaResult,
  snapshot: mancalaSnapshot,
  resign: resignMancala,
});

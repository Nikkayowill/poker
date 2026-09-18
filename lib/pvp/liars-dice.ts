/**
 * Liar's Dice, heads-up, staked. Perfect-information's opposite: the whole
 * game is what each seat cannot see about the other one's hand.
 *
 * Pure and synchronous, like ./othello.ts: every function takes a state and
 * returns the next one. `now` is only here because the contract asks every
 * game for it -- this variant has no clock of its own, so `tick` is simply
 * not implemented (it's optional on DuelGame for exactly this case).
 *
 * ## No wildcards
 *
 * Some tables let 1s count as any face. This table does not: a bid of "three
 * 4s" is judged only against dice actually showing a 4. Simpler to reason
 * about and to test, and it's the variant the brief asked for.
 *
 * ## Escalation
 *
 * A bid must beat the current one on count, or match it and beat it on face.
 * Raising the count is always legal at any face, because a higher count is a
 * bigger claim regardless of which number it names; the face-only escalation
 * only kicks in when the count stays put. The opening bid of a round is
 * unconstrained (there is nothing to escalate over yet) beyond being a
 * plausible claim: a real face, a positive count, and a count no bigger than
 * the dice actually on the table.
 *
 * ## Reveal and reroll
 *
 * A challenge always settles the current bid and always ends the round: the
 * loser sheds one die, and if both seats still have one left, every
 * remaining die on the table is rerolled and the loser of the round opens
 * the next one's bidding -- the standard rule, and the only sensible one,
 * since the loser is the seat who just had the fewest true claims to stand
 * on. `lastReveal` carries what the challenge exposed (both hands, the true
 * count) forward, and it stays there until the next challenge replaces it.
 * Clearing it on the next bid meant a player could miss the showdown if the
 * loser bid before their screen refreshed.
 *
 * ## Elimination
 *
 * A seat that loses its last die loses the match outright, mid-round, before
 * any reroll -- there is nothing left to reroll for them.
 */

import {
  defineDuelGame,
  otherSeat,
  type DuelMoveResult,
  type DuelOutcome,
  type DuelSeat,
} from "./match-contract";
import { mulberry32Step } from "@/lib/seeded-random";

/* ------------------------------------------------------------------ shape */

export const LIARS_DICE_STARTING_DICE = 5;

export interface LiarsDiceBid {
  count: number;
  /** 1-6. */
  faceValue: number;
}

/**
 * What a challenge exposed: both hands as they stood, the bid it was judged
 * against, the true count, and who ended up losing a die over it. Kept
 * around on the state as `lastReveal` so a client can show the previous
 * round's showdown even after fresh, hidden dice have already been rolled
 * for the next one.
 */
export interface LiarsDiceReveal {
  dice: [number[], number[]];
  bid: LiarsDiceBid;
  trueCount: number;
  challenger: DuelSeat;
  loser: DuelSeat;
}

export interface LiarsDiceState {
  /** Active dice values, seats[0] and seats[1]. Length is that seat's dice count. */
  seats: [number[], number[]];
  bid: LiarsDiceBid | null;
  /** Who made `bid`. Null exactly when `bid` is null. */
  bidder: DuelSeat | null;
  turn: DuelSeat;
  /**
   * The mulberry32 accumulator, carried on the state rather than closed over
   * in memory. A match runs an unbounded number of rounds, each needing a
   * fresh reroll, so the generator can't be exhausted up front the way a
   * single fixed-length shuffle's callers do -- same reason
   * lib/cribbage/deck.ts's `rngState` exists.
   */
  rngState: number;
  /**
   * What the most recent challenge exposed, or null before the first one.
   * Kept through the next round's bids so both seats get to see it.
   */
  lastReveal: LiarsDiceReveal | null;
  outcome: DuelOutcome | null;
}

export type LiarsDiceMove =
  | { type: "bid"; count: number; faceValue: number }
  | { type: "challenge" };

/* -------------------------------------------------------------- snapshot */

export interface LiarsDiceSeatView {
  diceCount: number;
  /**
   * The seat's own dice values, or the opponent's once the match is over.
   * Null while it's a live match and this isn't the viewer's own seat --
   * that redaction is the entire game.
   */
  dice: number[] | null;
}

export interface LiarsDiceSnapshot {
  viewer: DuelSeat | null;
  seats: [LiarsDiceSeatView, LiarsDiceSeatView];
  bid: LiarsDiceBid | null;
  bidder: DuelSeat | null;
  turn: DuelSeat;
  lastReveal: LiarsDiceReveal | null;
  outcome: DuelOutcome | null;
}

/* -------------------------------------------------------------- constants */

const REASON_RESIGNED = "Resigned";
const REASON_OUT_OF_DICE = "Out of dice";

/* ------------------------------------------------------------------ dice */

/** One die, drawn from the threaded rng state. Returns the face and the next state. */
function rollDie(rngState: number): [number, number] {
  const [nextState, value] = mulberry32Step(rngState);
  return [Math.floor(value * 6) + 1, nextState];
}

/** `count` fresh dice, threading the rng state through each draw. */
function rollDice(count: number, rngState: number): [number[], number] {
  const dice: number[] = [];
  let state = rngState;
  for (let i = 0; i < count; i += 1) {
    const [face, nextState] = rollDie(state);
    dice.push(face);
    state = nextState;
  }
  return [dice, state];
}

function totalDice(state: Pick<LiarsDiceState, "seats">): number {
  return state.seats[0].length + state.seats[1].length;
}

function countFace(dice: readonly number[], faceValue: number): number {
  let count = 0;
  for (const face of dice) {
    if (face === faceValue) count += 1;
  }
  return count;
}

/* ---------------------------------------------------------- state changes */

export function createLiarsDiceState(seed: number, _now: number): LiarsDiceState {
  const [seatZero, afterZero] = rollDice(LIARS_DICE_STARTING_DICE, seed >>> 0);
  const [seatOne, afterOne] = rollDice(LIARS_DICE_STARTING_DICE, afterZero);
  return {
    seats: [seatZero, seatOne],
    bid: null,
    bidder: null,
    turn: 0,
    rngState: afterOne,
    lastReveal: null,
    outcome: null,
  };
}

/**
 * Whether `next` legally escalates `current`. Null `current` means this is
 * the round's opening bid, which has nothing to escalate over.
 */
export function isLegalEscalation(next: LiarsDiceBid, current: LiarsDiceBid | null): boolean {
  if (current === null) return true;
  if (next.count > current.count) return true;
  return next.count === current.count && next.faceValue > current.faceValue;
}

/**
 * Reads an untrusted payload as a move, or null if it isn't one.
 *
 * `move` arrives shape-checked as `unknown` by the route; only the engine
 * knows what a Liar's Dice move actually is, so every field is re-checked
 * here rather than trusted.
 */
function parseMove(move: unknown): LiarsDiceMove | null {
  if (typeof move !== "object" || move === null || Array.isArray(move)) return null;
  const claim = move as { type?: unknown; count?: unknown; faceValue?: unknown };

  if (claim.type === "challenge") return { type: "challenge" };

  if (claim.type === "bid") {
    if (!Number.isInteger(claim.count) || !Number.isInteger(claim.faceValue)) return null;
    const count = claim.count as number;
    const faceValue = claim.faceValue as number;
    if (count < 1 || faceValue < 1 || faceValue > 6) return null;
    return { type: "bid", count, faceValue };
  }

  return null;
}

/** Removes one die from a seat's hand. Assumes the seat has at least one. */
function removeOneDie(dice: readonly number[]): number[] {
  return dice.slice(0, -1);
}

export function applyLiarsDiceMove(
  state: LiarsDiceState,
  seat: DuelSeat,
  move: unknown,
  now: number,
): DuelMoveResult<LiarsDiceState> {
  if (state.outcome !== null) return { reject: "This match is already over." };
  if (seat !== state.turn) return { reject: "It is not your turn." };

  const claim = parseMove(move);
  if (claim === null) return { reject: "That is not a move." };

  if (claim.type === "bid") {
    if (claim.count > totalDice(state)) {
      return { reject: "There aren't that many dice on the table." };
    }
    const bid: LiarsDiceBid = { count: claim.count, faceValue: claim.faceValue };
    if (!isLegalEscalation(bid, state.bid)) {
      return { reject: "A new bid has to raise the count, or match it and raise the face." };
    }
    return {
      next: {
        ...state,
        bid,
        bidder: seat,
        turn: otherSeat(seat),
        // lastReveal stays until the next challenge replaces it. Clearing it
        // here meant a player whose bid held never saw the showdown when the
        // loser opened the next round before their screen refreshed.
      },
    };
  }

  // claim.type === "challenge"
  if (state.bid === null) return { reject: "There is no bid to challenge." };
  const bid = state.bid;
  const bidder = state.bidder as DuelSeat;

  const trueCount = countFace(state.seats[0], bid.faceValue) + countFace(state.seats[1], bid.faceValue);
  const loser: DuelSeat = trueCount >= bid.count ? seat : bidder;

  const reveal: LiarsDiceReveal = {
    dice: [[...state.seats[0]], [...state.seats[1]]],
    bid,
    trueCount,
    challenger: seat,
    loser,
  };

  const seats: [number[], number[]] = [state.seats[0], state.seats[1]];
  seats[loser] = removeOneDie(seats[loser]);

  if (seats[loser].length === 0) {
    return {
      next: {
        ...state,
        seats,
        bid: null,
        bidder: null,
        lastReveal: reveal,
        outcome: { winner: otherSeat(loser), reason: REASON_OUT_OF_DICE },
      },
    };
  }

  const [seatZero, afterZero] = rollDice(seats[0].length, state.rngState);
  const [seatOne, afterOne] = rollDice(seats[1].length, afterZero);

  return {
    next: {
      ...state,
      seats: [seatZero, seatOne],
      bid: null,
      bidder: null,
      // The loser of the round opens the next one's bidding.
      turn: loser,
      rngState: afterOne,
      lastReveal: reveal,
      outcome: null,
    },
  };
}

/** What ended the match, or null while it is still being played. */
export function liarsDiceResult(state: LiarsDiceState): DuelOutcome | null {
  return state.outcome;
}

/**
 * Resigning, an immediate loss for the resigning seat -- same default every
 * other duel here takes. Already-finished matches are returned untouched, so
 * a resignation arriving after the match ended some other way can't rewrite
 * the winner.
 */
export function resignLiarsDice(state: LiarsDiceState, seat: DuelSeat, _now: number): LiarsDiceState {
  if (state.outcome !== null) return state;
  return { ...state, outcome: { winner: otherSeat(seat), reason: REASON_RESIGNED } };
}

/**
 * What a viewer sees. Dice counts are public in real Liar's Dice -- you can
 * always see how many dice are in front of your opponent, just not their
 * faces -- so both seats' counts are always included. Face values are the
 * redaction boundary: your own hand is always yours to see, the opponent's
 * current hand is hidden until the match is over, and `lastReveal` is
 * already a settled record of a past challenge rather than a live secret, so
 * it goes to both seats unredacted.
 */
export function liarsDiceSnapshot(
  state: LiarsDiceState,
  seat: DuelSeat | null,
  _now: number,
): LiarsDiceSnapshot {
  const over = state.outcome !== null;
  const seatView = (index: DuelSeat): LiarsDiceSeatView => ({
    diceCount: state.seats[index].length,
    dice: index === seat || over ? [...state.seats[index]] : null,
  });

  return {
    viewer: seat,
    seats: [seatView(0), seatView(1)],
    bid: state.bid,
    bidder: state.bidder,
    turn: state.turn,
    lastReveal: state.lastReveal,
    outcome: state.outcome,
  };
}

export const LIARS_DICE_DUEL = defineDuelGame<LiarsDiceState, unknown, LiarsDiceSnapshot>({
  id: "liars-dice",
  label: "Liar's Dice",
  createState: createLiarsDiceState,
  applyMove: applyLiarsDiceMove,
  result: liarsDiceResult,
  snapshot: liarsDiceSnapshot,
  resign: resignLiarsDice,
});

/**
 * Liar's Dice, heads-up, staked. Perfect-information's opposite: the whole
 * game is what each seat cannot see about the other one's hand.
 *
 * Pure and synchronous, like ./othello.ts: every function takes a state and
 * returns the next one. The one exception is the dice themselves, which come
 * from ./secure-random.ts at the moment they are rolled (see "Dice" below).
 *
 * ## Clock
 *
 * Each seat has an Othello-style bank clock that only runs on its own turn.
 * Without one a player who is losing could simply stop bidding, and the other
 * seat's only way out would be to resign and pay them. Running out of time
 * loses the match, the same as a chess flag.
 *
 * ## Dice
 *
 * Every roll is drawn from the CSPRNG when it happens, not from the match
 * seed. The seed is only 31 bits, and a showdown reveals ten dice, which is
 * enough to brute-force it and read the opponent's next hand. `rngState` is
 * left on old stored matches and ignored.
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
  remainingTime,
  type DuelMoveResult,
  type DuelOutcome,
  type DuelSeat,
} from "./match-contract";
import { secureRandomInt, type RandomInt } from "./secure-random";

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
  /** When the current turn's clock started running, in epoch ms. */
  turnStartedAt: number;
  /** Each seat's banked remaining ms as of `turnStartedAt`. Read through `liarsDiceRemainingMs`. */
  clocks: [number, number];
  /** The old seeded-dice accumulator. Only on matches stored before dice moved to the CSPRNG; unused. */
  rngState?: number;
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
  /** Live remaining ms for [seat 0, seat 1], computed against `now`. */
  clocks: [number, number];
  lastReveal: LiarsDiceReveal | null;
  outcome: DuelOutcome | null;
}

/* -------------------------------------------------------------- constants */

/** Five minutes each plus three seconds a move, the same clock Othello and checkers use. */
export const LIARS_DICE_CLOCK_MS = 5 * 60 * 1000;
export const LIARS_DICE_INCREMENT_MS = 3 * 1000;

const REASON_RESIGNED = "Resigned";
const REASON_OUT_OF_DICE = "Out of dice";
const REASON_TIMEOUT = "Timeout";

/* ------------------------------------------------------------------ dice */

/** `count` fresh dice from `randomInt`. */
function rollDice(count: number, randomInt: RandomInt): number[] {
  const dice: number[] = [];
  for (let i = 0; i < count; i += 1) dice.push(randomInt(6) + 1);
  return dice;
}

/* ------------------------------------------------------------------ clock */

/**
 * A stored state with its clock filled in. Matches stored before the clock
 * existed have no `clocks`, and their current turn is treated as starting at
 * `now` with a full bank each.
 */
function withClock(state: LiarsDiceState, now: number): LiarsDiceState {
  const stored = state as Partial<LiarsDiceState>;
  if (Array.isArray(stored.clocks) && typeof stored.turnStartedAt === "number") return state;
  return { ...state, clocks: [LIARS_DICE_CLOCK_MS, LIARS_DICE_CLOCK_MS], turnStartedAt: now };
}

/** What a seat has left at `now`. Frozen once the match is over. */
export function liarsDiceRemainingMs(state: LiarsDiceState, seat: DuelSeat, now: number): number {
  const clocked = withClock(state, now);
  return remainingTime(
    clocked.clocks[seat],
    seat,
    clocked.turn,
    clocked.turnStartedAt,
    now,
    clocked.outcome !== null,
  );
}

function flagFallen(state: LiarsDiceState): LiarsDiceState {
  const clocks: [number, number] = [state.clocks[0], state.clocks[1]];
  clocks[state.turn] = 0;
  return {
    ...state,
    clocks,
    outcome: { winner: otherSeat(state.turn), reason: REASON_TIMEOUT },
  };
}

/**
 * A flag falling, the only thing that happens without a move. Null when
 * nothing changed, which is nearly every poll. A legacy match with no clock
 * gets one here, once.
 */
export function tickLiarsDice(state: LiarsDiceState, now: number): LiarsDiceState | null {
  if (state.outcome !== null) return null;
  const clocked = withClock(state, now);
  if (liarsDiceRemainingMs(clocked, clocked.turn, now) > 0) return clocked === state ? null : clocked;
  return flagFallen(clocked);
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

/**
 * The opening deal. `seed` is ignored: see "Dice" in the header. `randomInt`
 * is only ever passed by a test that wants a fixed hand.
 */
export function createLiarsDiceState(
  _seed: number,
  now: number,
  randomInt: RandomInt = secureRandomInt,
): LiarsDiceState {
  return {
    seats: [rollDice(LIARS_DICE_STARTING_DICE, randomInt), rollDice(LIARS_DICE_STARTING_DICE, randomInt)],
    bid: null,
    bidder: null,
    turn: 0,
    turnStartedAt: now,
    clocks: [LIARS_DICE_CLOCK_MS, LIARS_DICE_CLOCK_MS],
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
  stored: LiarsDiceState,
  seat: DuelSeat,
  move: unknown,
  now: number,
  randomInt: RandomInt = secureRandomInt,
): DuelMoveResult<LiarsDiceState> {
  if (stored.outcome !== null) return { reject: "This match is already over." };
  if (seat !== stored.turn) return { reject: "It is not your turn." };

  const claim = parseMove(move);
  if (claim === null) return { reject: "That is not a move." };

  const state = withClock(stored, now);
  // A player whose flag fell cannot then move; the match ends on the attempt.
  if (liarsDiceRemainingMs(state, seat, now) <= 0) return { next: flagFallen(state) };
  // The mover banks what they had left plus the increment, and the next
  // turn's clock starts now, whoever it belongs to.
  const clocks: [number, number] = [state.clocks[0], state.clocks[1]];
  clocks[seat] = liarsDiceRemainingMs(state, seat, now) + LIARS_DICE_INCREMENT_MS;

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
        turnStartedAt: now,
        clocks,
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
        clocks,
        lastReveal: reveal,
        outcome: { winner: otherSeat(loser), reason: REASON_OUT_OF_DICE },
      },
    };
  }

  // Fresh dice from the CSPRNG, drawn now. Nothing on the state predicts them.
  return {
    next: {
      ...state,
      seats: [rollDice(seats[0].length, randomInt), rollDice(seats[1].length, randomInt)],
      bid: null,
      bidder: null,
      // The loser of the round opens the next one's bidding.
      turn: loser,
      turnStartedAt: now,
      clocks,
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
export function resignLiarsDice(state: LiarsDiceState, seat: DuelSeat, now: number): LiarsDiceState {
  if (state.outcome !== null) return state;
  const clocked = withClock(state, now);
  const clocks: [number, number] = [clocked.clocks[0], clocked.clocks[1]];
  clocks[clocked.turn] = liarsDiceRemainingMs(clocked, clocked.turn, now);
  return { ...clocked, clocks, outcome: { winner: otherSeat(seat), reason: REASON_RESIGNED } };
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
  now: number,
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
    clocks: [liarsDiceRemainingMs(state, 0, now), liarsDiceRemainingMs(state, 1, now)],
    lastReveal: state.lastReveal,
    outcome: state.outcome,
  };
}

export const LIARS_DICE_DUEL = defineDuelGame<LiarsDiceState, unknown, LiarsDiceSnapshot>({
  id: "liars-dice",
  label: "Liar's Dice",
  createState: createLiarsDiceState,
  applyMove: applyLiarsDiceMove,
  tick: tickLiarsDice,
  result: liarsDiceResult,
  snapshot: liarsDiceSnapshot,
  resign: resignLiarsDice,
});

/**
 * Cribbage, as a 3-4 player free-for-all pot: deal, discard to the crib,
 * peg, count, first to 121 takes it all.
 *
 * Pure and synchronous, like lib/pvp/checkers.ts: every function takes a
 * state and returns the next one, nothing here reads a clock, a store or a
 * request. `now` is always an argument. The one exception is the shuffle,
 * which draws from the CSPRNG (see below).
 *
 * ## No separate counting phase
 *
 * Counting has no player decisions in it: once pegging ends there is
 * nothing left to choose, only arithmetic. So there is no "counting" entry
 * in CribbagePhase and no move a player sends to make it happen. The
 * instant the last card is pegged, `concludeHand` runs the whole count
 * (each non-dealer's hand in turn order, then the dealer's hand, then the
 * dealer's crib, each one checked against the shared starter) and either
 * ends the match or deals straight into the next hand's discard phase.
 * `lastHandSummary` on the state is the reveal a client renders for the
 * deal that just finished; it holds every hand and the crib in full, which
 * is fine to make public since that deal is already over.
 *
 * ## Randomness across an unbounded number of deals
 *
 * Every deal is shuffled from lib/pvp/secure-random.ts at the moment it is
 * dealt, not from the match seed. Deals used to come from a mulberry32
 * accumulator carried on the state, and a 31-bit seed can be brute-forced
 * from the hands a count reveals, after which every later hand at the table
 * is known. `rngState` is still on old stored matches and ignored. Tests
 * pass a seeded RandomInt to get a fixed deal.
 *
 * ## Turn clock and forfeits
 *
 * Every decision has CRIBBAGE_TURN_MS to be made: the whole discard, and each
 * pegging play or go. A seat that runs past it forfeits, and so does a seat
 * that resigns. A forfeit ends the table for everyone (see resignCribbage for
 * why nobody plays on), with no winner: the forfeiting seats lose their
 * stakes and everyone else gets theirs back plus an equal share of the
 * forfeited ones. `cribbagePayouts` is that rule. Paying a resignation to the
 * leader instead would let two friends at a three-seat table take a
 * stranger's stake by having one of them quit.
 *
 * ## Seats
 *
 * `playerCount` (3 or 4) is fixed for the life of a match. The dealer
 * rotates one seat clockwise every hand; pegging always leads from the
 * seat to the dealer's left and the dealer pegs last, same as a real
 * table.
 */

import {
  scoreHand,
  scorePeggingPlay,
  heelsBonus,
} from "./scoring";
import { shuffleDeck, standardDeck } from "./deck";
import { secureRandomInt, type RandomInt } from "@/lib/pvp/secure-random";
import { defineCribbageGame, type CribbageMoveResult as GenericMoveResult, type CribbageOutcome } from "./table-contract";
import {
  pointValue,
  type Card,
  type CribbageHandEntry,
  type CribbageHandSummary,
  type CribbagePhase,
  type CribbageSeat,
} from "./types";

export type { CribbageSeat } from "./types";
export type { CribbageOutcome } from "./table-contract";

/** First to reach or pass this, at any point in a deal, wins immediately. */
export const WIN_SCORE = 121;

/** Cards dealt to each seat before discarding, for both 3- and 4-handed tables. */
const CARDS_DEALT_PER_SEAT = 5;

/**
 * How long one decision may take: the discard, or a single pegging play.
 * Generous, since nobody should lose a pot to reading their hand, but short
 * enough that a table cannot be held hostage by someone who walked away.
 */
export const CRIBBAGE_TURN_MS = 2 * 60 * 1000;

const REASON_RESIGNED = "Resigned";
const REASON_TIMEOUT = "Timeout";

export interface CribbageState {
  playerCount: number;
  dealerSeat: CribbageSeat;
  /** 0-indexed, incremented every time a new hand is dealt. */
  handNumber: number;
  phase: CribbagePhase;
  /** The old seeded-deal accumulator. Only on matches stored before deals moved to the CSPRNG; unused. */
  rngState?: number;
  /**
   * When the decision now awaited became due: the deal for the discard, the
   * last play for pegging. See CRIBBAGE_TURN_MS.
   */
  actionStartedAt: number;

  /** Cards each seat still holds. Shrinks to empty over the pegging phase. */
  hands: Card[][];
  /**
   * Each seat's 4-card hand as it stood the instant discarding finished --
   * captured once, because `hands` above empties out during pegging and
   * hand-counting still needs to see what was in it.
   */
  originalHands: Card[][];
  /** This hand's discard per seat; null until submitted, so it also flags who is ready. */
  discarded: (Card | null)[];
  crib: Card[];
  starter: Card | null;
  /** Cards dealt to nobody -- source for the 3-handed burn and the starter cut. */
  deckRemaining: Card[];

  scores: number[];

  /** Turn order for this hand: left of the dealer around to the dealer last. */
  peggingOrder: CribbageSeat[];
  /** Whose turn right now. Null outside the pegging phase. */
  peggingTurn: CribbageSeat | null;
  peggingCount: number;
  /** Cards played since the count last reset (a "go" or a 31) -- what scoring reads. */
  peggingPile: Card[];
  /** The whole pegging phase, oldest first, for the board to render. Never used for scoring. */
  peggingLog: Array<{ seat: CribbageSeat; card: Card }>;
  /** Per seat, sticky within one count cycle: true once they cannot (or chose not to) play. */
  peggingGoneThisCycle: boolean[];
  lastToPlaySeat: CribbageSeat | null;

  /** The most recently completed deal's full reveal. Public from the moment it is set. */
  lastHandSummary: CribbageHandSummary | null;

  winner: CribbageSeat | null;
  winReason: string | null;
  /**
   * Seats that resigned or timed out, ending the table with no winner.
   * Empty on a match that is still going or was won at 121. Absent on
   * matches stored before forfeits existed.
   */
  forfeited?: CribbageSeat[];
}

export type CribbageMoveResult = GenericMoveResult<CribbageState>;

/* ------------------------------------------------------------- dealing --- */

function orderFromLeftOfDealer(dealerSeat: CribbageSeat, playerCount: number): CribbageSeat[] {
  const order: CribbageSeat[] = [];
  for (let i = 1; i <= playerCount; i += 1) order.push((dealerSeat + i) % playerCount);
  return order; // the last entry is always dealerSeat itself: the dealer pegs and counts last.
}

/** A fresh, fully-shuffled deal: 5 cards to every seat, the rest held back for the cut. */
function dealHand(
  playerCount: number,
  dealerSeat: CribbageSeat,
  handNumber: number,
  randomInt: RandomInt,
  now: number,
): CribbageState {
  const deck = shuffleDeck(standardDeck(), randomInt);
  const hands: Card[][] = [];
  let cursor = 0;
  for (let seat = 0; seat < playerCount; seat += 1) {
    hands.push(deck.slice(cursor, cursor + CARDS_DEALT_PER_SEAT));
    cursor += CARDS_DEALT_PER_SEAT;
  }

  return {
    playerCount,
    dealerSeat,
    handNumber,
    phase: "discard",
    actionStartedAt: now,
    hands,
    // A placeholder equal to the fresh deal -- beginPegging() overwrites this
    // with the real post-discard 4-card hands once discarding finishes.
    originalHands: hands.map((hand) => [...hand]),
    discarded: new Array(playerCount).fill(null),
    crib: [],
    starter: null,
    deckRemaining: deck.slice(cursor),
    scores: [],
    peggingOrder: [],
    peggingTurn: null,
    peggingCount: 0,
    peggingPile: [],
    peggingLog: [],
    peggingGoneThisCycle: new Array(playerCount).fill(false),
    lastToPlaySeat: null,
    lastHandSummary: null,
    winner: null,
    winReason: null,
    forfeited: [],
  };
}

/**
 * The opening deal. `seed` is ignored: see the header. `randomInt` is only
 * ever passed by a test that wants a fixed deal.
 */
export function createCribbageState(
  _seed: number,
  now: number,
  playerCount: number,
  randomInt: RandomInt = secureRandomInt,
): CribbageState {
  if (playerCount !== 3 && playerCount !== 4) {
    throw new Error("Cribbage tables are 3 or 4 seats, never more or fewer.");
  }
  const dealt = dealHand(playerCount, 0, 0, randomInt, now);
  return { ...dealt, scores: new Array(playerCount).fill(0) };
}

function cloneState(state: CribbageState): CribbageState {
  return {
    ...state,
    hands: state.hands.map((hand) => [...hand]),
    originalHands: state.originalHands.map((hand) => [...hand]),
    discarded: [...state.discarded],
    crib: [...state.crib],
    deckRemaining: [...state.deckRemaining],
    scores: [...state.scores],
    peggingOrder: [...state.peggingOrder],
    peggingPile: [...state.peggingPile],
    peggingLog: state.peggingLog.map((entry) => ({ ...entry })),
    peggingGoneThisCycle: [...state.peggingGoneThisCycle],
  };
}

/** Ends the deal right here if `seat` just crossed WIN_SCORE, else null. */
function maybeWin(state: CribbageState, seat: CribbageSeat): CribbageState | null {
  if (state.scores[seat] < WIN_SCORE) return null;
  return { ...state, phase: "done", winner: seat, winReason: "121" };
}

/* --------------------------------------------------------------- discard - */

function applyDiscard(state: CribbageState, seat: CribbageSeat, card: Card, now: number): CribbageMoveResult {
  if (state.phase !== "discard") return { reject: "Discarding is not open right now." };
  if (state.discarded[seat] !== null) return { reject: "You already discarded." };

  const hand = state.hands[seat];
  const index = hand.findIndex((held) => held.rank === card.rank && held.suit === card.suit);
  if (index === -1) return { reject: "That card is not in your hand." };

  const next = cloneState(state);
  next.hands[seat] = hand.filter((_held, i) => i !== index);
  next.discarded[seat] = card;

  if (next.discarded.every((entry) => entry !== null)) {
    return { next: beginPegging(next, now) };
  }
  return { next };
}

/**
 * Discarding is done for everyone: sends the crib off to the dealer (with
 * a burn card for a 3-handed table, since 3 discards of 1 each is only 3;
 * see the header), cuts the starter, and scores heels.
 */
function beginPegging(state: CribbageState, _now: number): CribbageState {
  void _now; // kept for a consistent (state, now) shape across every state-transition helper here
  const crib: Card[] = state.discarded.filter((entry): entry is Card => entry !== null);
  const deckRemaining = [...state.deckRemaining];

  // 4 discards of 1 (a 4-handed table) already total 4; a 3-handed table's 3
  // discards need exactly one more, burned face-down from the same shuffled
  // deck the rest of this hand came from.
  const burnCount = 4 - state.playerCount;
  for (let i = 0; i < burnCount; i += 1) {
    const burned = deckRemaining.shift();
    if (burned) crib.push(burned);
  }
  const starter = deckRemaining.shift() ?? null;

  const scores = [...state.scores];
  const heels = starter ? heelsBonus(starter) : 0;
  scores[state.dealerSeat] += heels;

  const peggingOrder = orderFromLeftOfDealer(state.dealerSeat, state.playerCount);

  const next: CribbageState = {
    ...state,
    phase: "pegging",
    crib,
    starter,
    deckRemaining,
    originalHands: state.hands.map((hand) => [...hand]),
    scores,
    peggingOrder,
    peggingTurn: peggingOrder[0],
    peggingCount: 0,
    peggingPile: [],
    peggingLog: [],
    peggingGoneThisCycle: new Array(state.playerCount).fill(false),
    lastToPlaySeat: null,
  };

  // Heels is scored at the cut, before a card is pegged. Honor the same
  // "check every scoring event" rule even here, in case the dealer was
  // already one Jack away from 121.
  const won = maybeWin(next, state.dealerSeat);
  if (!won) return next;

  // maybeWin only sets phase/winner/winReason: it has no way to know this
  // particular win came from heels rather than a pegging play or a count,
  // so lastHandSummary here would otherwise still be whatever the previous
  // deal left behind. Without this, a match that ends on the cut shows the
  // wrong hand's reveal for how it actually ended.
  return {
    ...won,
    lastHandSummary: {
      handNumber: state.handNumber,
      dealerSeat: state.dealerSeat,
      starter: starter as Card,
      heelsPoints: heels,
      entries: [],
    },
  };
}

/* --------------------------------------------------------------- pegging - */

/** The next seat, after `fromSeat`, still holding cards and not stuck this cycle. Null if none. */
function nextEligibleSeat(state: CribbageState, fromSeat: CribbageSeat): CribbageSeat | null {
  const order = state.peggingOrder;
  const startIndex = order.indexOf(fromSeat);
  for (let step = 1; step <= order.length; step += 1) {
    const seat = order[(startIndex + step) % order.length];
    if (state.hands[seat].length > 0 && !state.peggingGoneThisCycle[seat]) return seat;
  }
  return null;
}

/** The next seat after `afterSeat` still holding cards, for a freshly-reset cycle. */
function firstEligibleAfter(state: CribbageState, afterSeat: CribbageSeat): CribbageSeat {
  const order = state.peggingOrder;
  const startIndex = order.indexOf(afterSeat);
  for (let step = 1; step <= order.length; step += 1) {
    const seat = order[(startIndex + step) % order.length];
    if (state.hands[seat].length > 0) return seat;
  }
  // Unreachable in practice: the only caller has already confirmed someone
  // still holds cards before asking who goes next.
  return order[0];
}

/**
 * Resets the count (a go or a 31 both reset it), awards the go point if this
 * reset is one, and either starts the next mini-round or -- once every hand
 * is empty -- runs the automatic count.
 */
function finishCycleAndContinue(
  state: CribbageState,
  resetRecipient: CribbageSeat,
  awardGoPoint: boolean,
  leadFrom: CribbageSeat,
  now: number,
  randomInt: RandomInt,
): CribbageState {
  let scores = state.scores;
  if (awardGoPoint) {
    scores = [...state.scores];
    scores[resetRecipient] += 1;
  }
  const next: CribbageState = {
    ...state,
    scores,
    peggingCount: 0,
    peggingPile: [],
    peggingGoneThisCycle: new Array(state.playerCount).fill(false),
  };

  // A 31 was already scored on the play itself (see scorePeggingPlay) and
  // already win-checked by the caller before this ever runs, so there is
  // nothing new to check for that case; only a just-awarded go point can
  // freshly cross WIN_SCORE here.
  if (awardGoPoint) {
    const won = maybeWin(next, resetRecipient);
    if (won) return won;
  }

  const anyoneHasCards = next.hands.some((hand) => hand.length > 0);
  if (!anyoneHasCards) return concludeHand(next, now, randomInt);

  return { ...next, peggingTurn: firstEligibleAfter(next, leadFrom) };
}

/**
 * What happens after `seat` legally plays a card, once it has already been
 * scored (including any 31 bonus) and win-checked.
 *
 * 31 resets the count immediately, whether or not anyone else still holds
 * a card that would have fit, unlike a go, which only resets once every
 * remaining seat is stuck. Conflating the two was a real bug: it let play
 * continue past 31 as if the count were still live.
 */
function advanceAfterPeg(state: CribbageState, seat: CribbageSeat, now: number, randomInt: RandomInt): CribbageState {
  if (state.peggingCount === 31) return finishCycleAndContinue(state, seat, false, seat, now, randomInt);
  const candidate = nextEligibleSeat(state, seat);
  if (candidate !== null) return { ...state, peggingTurn: candidate };
  return finishCycleAndContinue(state, seat, true, seat, now, randomInt);
}

/**
 * What happens after `seat` says go. The point (if any) goes to whoever
 * last actually played, and so does the lead for the fresh count once a
 * full reset happens: `lastToPlaySeat`, not `seat` (whoever's go call
 * happened to be the one that found nobody left). Real cribbage's rule is
 * "the player who played the last card leads the new count", and
 * `lastToPlaySeat` is that player by definition; `seat` here is merely
 * whichever seat's search ran empty, which needn't be the seat right
 * before them if some other seat further round the table is the one still
 * holding a now-legal card.
 */
function advanceAfterGo(state: CribbageState, seat: CribbageSeat, now: number, randomInt: RandomInt): CribbageState {
  const candidate = nextEligibleSeat(state, seat);
  if (candidate !== null) return { ...state, peggingTurn: candidate };
  const resetRecipient = state.lastToPlaySeat ?? seat;
  return finishCycleAndContinue(state, resetRecipient, true, resetRecipient, now, randomInt);
}

function applyPeg(
  state: CribbageState,
  seat: CribbageSeat,
  card: Card,
  now: number,
  randomInt: RandomInt,
): CribbageMoveResult {
  if (state.phase !== "pegging") return { reject: "Pegging is not open right now." };
  if (state.peggingTurn !== seat) return { reject: "It is not your turn." };

  const hand = state.hands[seat];
  const index = hand.findIndex((held) => held.rank === card.rank && held.suit === card.suit);
  if (index === -1) return { reject: "That card is not in your hand." };

  const value = pointValue(card.rank);
  if (state.peggingCount + value > 31) return { reject: "That card would put the count over 31." };

  const pileBefore = state.peggingPile;
  const next = cloneState(state);
  next.hands[seat] = hand.filter((_held, i) => i !== index);
  next.peggingPile = [...next.peggingPile, card];
  next.peggingLog = [...next.peggingLog, { seat, card }];
  next.peggingCount += value;
  next.lastToPlaySeat = seat;

  const played = scorePeggingPlay(pileBefore, card, next.peggingCount);
  next.scores[seat] += played.total;

  const won = maybeWin(next, seat);
  if (won) return { next: won };

  return { next: advanceAfterPeg(next, seat, now, randomInt) };
}

function applyGo(state: CribbageState, seat: CribbageSeat, now: number, randomInt: RandomInt): CribbageMoveResult {
  if (state.phase !== "pegging") return { reject: "Pegging is not open right now." };
  if (state.peggingTurn !== seat) return { reject: "It is not your turn." };

  const hasPlayable = state.hands[seat].some(
    (card) => pointValue(card.rank) + state.peggingCount <= 31,
  );
  if (hasPlayable) return { reject: "You have a card you can play." };

  const next = cloneState(state);
  next.peggingGoneThisCycle[seat] = true;

  return { next: advanceAfterGo(next, seat, now, randomInt) };
}

/* --------------------------------------------------------------- counting  */

/**
 * Pegging just emptied every hand: score every hand and the crib, in the
 * order a table actually counts them in (each non-dealer starting left of
 * the dealer, then the dealer's own hand, then the dealer's crib last,
 * since the crib is always the dealer's, whoever discarded into it). Stops
 * the instant anyone crosses WIN_SCORE, even mid-count, and otherwise
 * deals straight into the next hand.
 */
function concludeHand(state: CribbageState, now: number, randomInt: RandomInt): CribbageState {
  const starter = state.starter;
  if (!starter) return state; // unreachable: pegging cannot start without a cut starter.

  const order = orderFromLeftOfDealer(state.dealerSeat, state.playerCount);
  const subjects: Array<CribbageSeat | "crib"> = [...order, "crib"];

  const scores = [...state.scores];
  const entries: CribbageHandEntry[] = [];

  for (const subject of subjects) {
    const isCrib = subject === "crib";
    const owner: CribbageSeat = isCrib ? state.dealerSeat : subject;
    const cards = isCrib ? state.crib : state.originalHands[subject as CribbageSeat];
    const { total, breakdown } = scoreHand(cards, starter, isCrib);
    scores[owner] += total;
    entries.push({ subject, owner, cards, breakdown, points: total, runningScoreAfter: scores[owner] });

    if (scores[owner] >= WIN_SCORE) {
      const summary: CribbageHandSummary = {
        handNumber: state.handNumber,
        dealerSeat: state.dealerSeat,
        starter,
        heelsPoints: heelsBonus(starter),
        entries,
      };
      return { ...state, scores, phase: "done", winner: owner, winReason: "121", lastHandSummary: summary };
    }
  }

  const summary: CribbageHandSummary = {
    handNumber: state.handNumber,
    dealerSeat: state.dealerSeat,
    starter,
    heelsPoints: heelsBonus(starter),
    entries,
  };
  const nextDealer = (state.dealerSeat + 1) % state.playerCount;
  // Shuffled now, from the CSPRNG, so nothing on the stored state predicts it.
  const dealt = dealHand(state.playerCount, nextDealer, state.handNumber + 1, randomInt, now);
  return { ...state, ...dealt, scores, lastHandSummary: summary };
}

/* ---------------------------------------------------------------- moves -- */

function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const claim = value as { rank?: unknown; suit?: unknown };
  return (
    typeof claim.rank === "number"
    && Number.isInteger(claim.rank)
    && claim.rank >= 1
    && claim.rank <= 13
    && (claim.suit === "S" || claim.suit === "H" || claim.suit === "D" || claim.suit === "C")
  );
}

/** Reads an untrusted payload as a move, or null. Every card claim is re-checked against the real hand below; this only confirms the shape. */
function parseMove(move: unknown): { type: "discard" | "peg"; card: Card } | { type: "go" } | null {
  if (typeof move !== "object" || move === null) return null;
  const claim = move as { type?: unknown; card?: unknown };
  if (claim.type === "go") return { type: "go" };
  if (claim.type === "discard" && isCard(claim.card)) return { type: "discard", card: claim.card };
  if (claim.type === "peg" && isCard(claim.card)) return { type: "peg", card: claim.card };
  return null;
}

export function applyCribbageMove(
  state: CribbageState,
  seat: CribbageSeat,
  move: unknown,
  now: number,
  randomInt: RandomInt = secureRandomInt,
): CribbageMoveResult {
  if (state.phase === "done") return { reject: "This match is already over." };
  if (seat < 0 || seat >= state.playerCount) return { reject: "That is not your seat." };

  const parsed = parseMove(move);
  if (!parsed) return { reject: "That is not a move." };

  // A seat whose time already ran out cannot move; the table ends on the attempt.
  const timedOut = timedOutState(state, now);
  if (timedOut) return { next: timedOut };

  const result =
    parsed.type === "discard"
      ? applyDiscard(state, seat, parsed.card, now)
      : parsed.type === "peg"
        ? applyPeg(state, seat, parsed.card, now, randomInt)
        : applyGo(state, seat, now, randomInt);
  if ("reject" in result) return result;

  // The clock restarts for every pegging play and for each new phase or
  // deal. A discard that leaves others still to discard does not restart it:
  // the discard is one decision the whole table has the same time for.
  const next = result.next;
  const stillDiscarding = next.phase === "discard" && state.phase === "discard" && next.handNumber === state.handNumber;
  return { next: stillDiscarding ? { ...next, actionStartedAt: actionStart(state, now) } : { ...next, actionStartedAt: now } };
}

/* ----------------------------------------------------------- clock/forfeit */

/** When the current decision became due. A match stored before the clock existed counts from `now`. */
function actionStart(state: CribbageState, now: number): number {
  const stored = (state as Partial<CribbageState>).actionStartedAt;
  return typeof stored === "number" ? stored : now;
}

/** Ms left on the decision now awaited, or null once the match is over. */
export function cribbageTurnRemainingMs(state: CribbageState, now: number): number | null {
  if (state.phase === "done") return null;
  return Math.max(0, actionStart(state, now) + CRIBBAGE_TURN_MS - now);
}

/** Who the table is waiting on: every seat yet to discard, or the seat to peg. */
function stalledSeats(state: CribbageState): CribbageSeat[] {
  if (state.phase === "discard") {
    const seats: CribbageSeat[] = [];
    for (let seat = 0; seat < state.playerCount; seat += 1) {
      if (state.discarded[seat] === null) seats.push(seat);
    }
    return seats;
  }
  if (state.phase === "pegging" && state.peggingTurn !== null) return [state.peggingTurn];
  return [];
}

function forfeit(state: CribbageState, seats: CribbageSeat[], reason: string): CribbageState {
  return { ...state, phase: "done", winner: null, winReason: reason, forfeited: [...seats].sort((a, b) => a - b) };
}

/** The table ended by timeout if the current decision is overdue, else null. */
function timedOutState(state: CribbageState, now: number): CribbageState | null {
  const remaining = cribbageTurnRemainingMs(state, now);
  if (remaining === null || remaining > 0) return null;
  const stalled = stalledSeats(state);
  if (stalled.length === 0) return null;
  return forfeit(state, stalled, REASON_TIMEOUT);
}

/**
 * The turn clock running out, the only thing that happens without a move.
 * Null when nothing changed, which is nearly every poll. A match stored
 * before the clock existed gets one here, once, starting now.
 */
export function tickCribbage(state: CribbageState, now: number): CribbageState | null {
  if (state.phase === "done") return null;
  if (typeof (state as Partial<CribbageState>).actionStartedAt !== "number") {
    return { ...state, actionStartedAt: now };
  }
  return timedOutState(state, now);
}

export function cribbageResult(state: CribbageState): CribbageOutcome | null {
  if (state.phase !== "done") return null;
  const forfeited = state.forfeited ?? [];
  if (forfeited.length > 0) {
    return { winner: null, reason: state.winReason ?? REASON_RESIGNED, forfeited: [...forfeited] };
  }
  if (state.winner === null) return null;
  return { winner: state.winner, reason: state.winReason ?? "121", forfeited: [] };
}

/**
 * What each seat is credited when the table settles, indexed by seat. The
 * only place the split is decided; the service pays exactly this, one credit
 * per seat.
 *
 * A win pays the whole pot to the winner. A forfeit pays nothing to the
 * forfeiting seats and gives every other seat its own stake back plus an
 * equal share of the forfeited stakes, any odd Gold going one each to the
 * lowest seats so the total always equals the pot. If every seat forfeited
 * (the whole table let the discard clock run out) each is refunded its own
 * stake, since nobody played anyone out of anything.
 */
export function cribbagePayouts(outcome: CribbageOutcome, playerCount: number, stake: number): number[] {
  const payouts = new Array<number>(playerCount).fill(0);
  if (outcome.winner !== null && outcome.forfeited.length === 0) {
    payouts[outcome.winner] = stake * playerCount;
    return payouts;
  }

  const lost = new Set(outcome.forfeited);
  const keepers: CribbageSeat[] = [];
  for (let seat = 0; seat < playerCount; seat += 1) {
    if (!lost.has(seat)) keepers.push(seat);
  }
  if (keepers.length === 0) return payouts.fill(stake);

  const forfeitedGold = stake * (playerCount - keepers.length);
  const share = Math.floor(forfeitedGold / keepers.length);
  let oddGold = forfeitedGold - share * keepers.length;
  for (const seat of keepers) {
    payouts[seat] = stake + share + (oddGold > 0 ? 1 : 0);
    if (oddGold > 0) oddGold -= 1;
  }
  return payouts;
}

/**
 * Resigning forfeits the resigner's stake and ends the whole match, not just
 * for the resigning seat. Cribbage has no clean "the rest keep playing" case
 * the way poker folding does: pegging turn order and hand-counting order both
 * depend on every seat, so removing one mid-hand has no well-defined
 * continuation. Nobody wins: the other seats get their stakes back and split
 * the resigner's (see cribbagePayouts). Handing the pot to the leader
 * instead would let a partner at the table resign it to their friend.
 */
export function resignCribbage(state: CribbageState, seat: CribbageSeat, _now: number): CribbageState {
  void _now; // kept for a consistent (state, seat, now) shape across every mutator here
  if (state.phase === "done") return state;
  if (seat < 0 || seat >= state.playerCount) return state;
  return forfeit(state, [seat], REASON_RESIGNED);
}

/* --------------------------------------------------------------- viewing - */

export interface CribbagePeggingView {
  turn: CribbageSeat | null;
  count: number;
  /** Cards played since the count last reset -- already public, it is face up on the table. */
  pile: Card[];
  /** The whole pegging phase so far, oldest first. */
  log: Array<{ seat: CribbageSeat; card: Card }>;
  yourTurn: boolean;
  /** True only when it is the viewer's turn and they hold no legal card. */
  yourGoAvailable: boolean;
}

export interface CribbageOpponentView {
  seat: CribbageSeat;
  cardsInHand: number;
  discarded: boolean;
}

export interface CribbageSnapshot {
  playerCount: number;
  dealerSeat: CribbageSeat;
  handNumber: number;
  phase: CribbagePhase;
  /** Public from the instant it is cut. */
  starter: Card | null;
  scores: number[];
  yourSeat: CribbageSeat | null;
  /** Full detail. Empty for a spectator or an unauthenticated read. */
  yourHand: Card[];
  yourDiscarded: boolean;
  /** Every other seat, redacted to a card count -- see the header for why. */
  opponents: CribbageOpponentView[];
  pegging: CribbagePeggingView | null;
  /** The reveal for the deal that just finished. Fully public -- that deal is over. */
  lastHandSummary: CribbageHandSummary | null;
  /** Ms left for the decision the table is waiting on, or null once over. */
  turnRemainingMs: number | null;
  winner: CribbageSeat | null;
  winReason: string | null;
  /** Seats that resigned or timed out. Empty unless the table ended on a forfeit. */
  forfeited: CribbageSeat[];
}

/**
 * What this viewer may see.
 *
 * `seat` is null for a spectator or an unauthenticated read, which is the
 * most restrictive view here (no own hand, no own-discarded flag) rather
 * than the most permissive one. Every other seat's hand is a count only,
 * exactly like every seat's own current hand is exposed only to itself.
 */
export function cribbageSnapshot(
  state: CribbageState,
  rawSeat: CribbageSeat | null,
  now: number,
): CribbageSnapshot {
  // Defense in depth: a seat outside 0..playerCount-1 should be unreachable
  // (the service looks it up from the actual seat rows), but treating one
  // as "unknown viewer" here (the same most-restrictive default the header
  // above already applies to `null`) turns a would-be crash on
  // `state.hands[seat]` into a safely empty view instead.
  const seat = rawSeat !== null && rawSeat >= 0 && rawSeat < state.playerCount ? rawSeat : null;
  const opponents: CribbageOpponentView[] = [];
  for (let s = 0; s < state.playerCount; s += 1) {
    if (s === seat) continue;
    opponents.push({ seat: s, cardsInHand: state.hands[s].length, discarded: state.discarded[s] !== null });
  }

  const pegging: CribbagePeggingView | null =
    state.phase === "pegging"
      ? {
        turn: state.peggingTurn,
        count: state.peggingCount,
        pile: [...state.peggingPile],
        log: state.peggingLog.map((entry) => ({ ...entry })),
        yourTurn: seat !== null && state.peggingTurn === seat,
        yourGoAvailable:
          seat !== null && state.peggingTurn === seat
            ? !state.hands[seat].some((card) => pointValue(card.rank) + state.peggingCount <= 31)
            : false,
      }
      : null;

  return {
    playerCount: state.playerCount,
    dealerSeat: state.dealerSeat,
    handNumber: state.handNumber,
    phase: state.phase,
    starter: state.starter,
    scores: [...state.scores],
    yourSeat: seat,
    yourHand: seat === null ? [] : [...state.hands[seat]],
    yourDiscarded: seat === null ? false : state.discarded[seat] !== null,
    opponents,
    pegging,
    lastHandSummary: state.lastHandSummary,
    turnRemainingMs: cribbageTurnRemainingMs(state, now),
    winner: state.winner,
    winReason: state.winReason,
    forfeited: [...(state.forfeited ?? [])],
  };
}

export const CRIBBAGE_GAME = defineCribbageGame<CribbageState, unknown, CribbageSnapshot>({
  id: "cribbage",
  label: "Cribbage",
  createState: createCribbageState,
  applyMove: applyCribbageMove,
  tick: tickCribbage,
  result: cribbageResult,
  snapshot: cribbageSnapshot,
  resign: resignCribbage,
});

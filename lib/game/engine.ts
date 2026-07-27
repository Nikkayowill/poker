import { randomInt, randomUUID } from "crypto";
import { compareScores, describeHand, evaluateHand, type HandScore } from "./evaluator";
import type {
  BotPersonality,
  Card,
  GameSnapshot,
  GameState,
  LegalActions,
  PlayerAction,
  Rank,
  Seat,
  Suit,
  Street,
  Winner,
} from "./types";
import type { PlayerProfile } from "@/lib/profile/types";
import { clampBuyIn, TIER_CONFIG, type StakesTier } from "./tiers";

const suits: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const ranks: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const streetOrder: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
type TurnAction = Exclude<
  PlayerAction,
  { type: "next-hand" } | { type: "leave-seat" } | { type: "use-time-card" }
>;
// A table always has SEAT_COUNT total seats; any not claimed by a human are
// bot-controlled. Indexed by seat position, so a vacated seat can always be
// restored to its original bot identity regardless of who claimed it since.
export const SEAT_COUNT = 6;

const botProfiles: Array<{
  name: string;
  initials: string;
  accent: string;
  avatarUrl: null;
  avatarPreset: string;
  personality: BotPersonality;
}> = [
  { name: "Jax", initials: "JX", accent: "#8fd6a8", avatarUrl: null, avatarPreset: "lucky", personality: "ROCK" },
  { name: "Maya", initials: "MA", accent: "#c08dff", avatarUrl: null, avatarPreset: "diamond", personality: "MANIAC" },
  { name: "Theo", initials: "TH", accent: "#ff9e78", avatarUrl: null, avatarPreset: "bolt", personality: "CALLING_STATION" },
  { name: "River", initials: "RV", accent: "#79c9ff", avatarUrl: null, avatarPreset: "river", personality: "ROCK" },
  { name: "Priya", initials: "PR", accent: "#65d6a2", avatarUrl: null, avatarPreset: "ace", personality: "MANIAC" },
  { name: "Wren", initials: "WR", accent: "#f08ca7", avatarUrl: null, avatarPreset: "crown", personality: "CALLING_STATION" },
];

// Humans get a short decision clock plus three optional time-bank cards.
// Bot deadlines are also persisted so polling/realtime can pace decisions
// without trusting a browser timer.
export const TURN_TIMEOUT_MS = 15_000;
export const TIME_CARD_EXTENSION_MS = 20_000;
export const STARTING_TIME_CARDS = 3;
export const BOT_DECISION_MIN_MS = 1_800;
export const BOT_DECISION_MAX_MS = 3_200;

// Excludes visually ambiguous characters (0/O, 1/I/L) from shareable room codes.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function makeDeck(): Card[] {
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [deck[index], deck[swapWith]] = [deck[swapWith], deck[index]];
  }
  return deck;
}

function addLog(state: GameState, text: string, kind: "deal" | "action" | "win" = "action") {
  state.log.unshift({ id: randomUUID(), text, at: new Date().toISOString(), kind });
  state.log = state.log.slice(0, 18);
}

function nextSeat(
  state: GameState,
  from: number,
  predicate: (seat: Seat) => boolean,
): number | null {
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const index = (from + offset) % state.seats.length;
    if (predicate(state.seats[index])) return index;
  }
  return null;
}

function inHand(seat: Seat) {
  return seat.status !== "out";
}

function setCurrentPlayer(state: GameState, index: number | null, now = Date.now()) {
  state.currentPlayer = index;
  if (index === null) {
    state.turnStartedAt = null;
    state.turnDeadlineAt = null;
    return;
  }
  state.turnStartedAt = new Date(now).toISOString();
  const duration = state.seats[index].isHuman
    ? TURN_TIMEOUT_MS
    : randomInt(BOT_DECISION_MIN_MS, BOT_DECISION_MAX_MS + 1);
  state.turnDeadlineAt = new Date(now + duration).toISOString();
}

function canAct(seat: Seat) {
  return seat.status === "active" && seat.stack > 0;
}

function restoreBotControl(seat: Seat) {
  const fallback = botProfiles[seat.position] ?? botProfiles[0];
  seat.isHuman = false;
  seat.ownerToken = null;
  seat.personality = fallback.personality;
  seat.name = fallback.name;
  seat.initials = fallback.initials;
  seat.accent = fallback.accent;
  seat.avatarUrl = fallback.avatarUrl;
  seat.avatarPreset = fallback.avatarPreset;
  seat.timeCardsRemaining = 0;
}

function releaseBustedHumanSeats(state: GameState) {
  state.seats.forEach((seat) => {
    if (!seat.isHuman || seat.stack > 0) return;
    const playerName = seat.name;
    restoreBotControl(seat);
    seat.status = "out";
    addLog(state, `${playerName} is out of chips and leaves the table`);
  });
}

function blindPositions(state: GameState) {
  if (state.seats.filter(inHand).length === 2) {
    // Heads-up: the button also posts the small blind and acts first
    // preflop — the standard heads-up convention, and the reverse of what
    // the general n-player rule below would produce with only two players.
    const small = state.buttonPosition;
    const big = nextSeat(state, small, inHand);
    return { small, big };
  }
  const small = nextSeat(state, state.buttonPosition, inHand);
  const big = small === null ? null : nextSeat(state, small, inHand);
  return { small, big };
}

function commit(seat: Seat, amount: number) {
  const paid = Math.max(0, Math.min(amount, seat.stack));
  seat.stack -= paid;
  seat.streetBet += paid;
  seat.committed += paid;
  if (seat.stack === 0) seat.status = "all-in";
  return paid;
}

function dealToCommunity(state: GameState, count: number) {
  state.deck.pop(); // burn
  for (let index = 0; index < count; index += 1) {
    const card = state.deck.pop();
    if (!card) throw new Error("The deck ran out of cards.");
    state.community.push(card);
  }
}

function setupHand(state: GameState, firstHand = false) {
  if (!firstHand) releaseBustedHumanSeats(state);
  const funded = state.seats.filter((seat) => seat.stack > 0);
  if (funded.length < 2) {
    state.status = "complete";
    state.street = "showdown";
    setCurrentPlayer(state, null);
    state.message = "Not enough players with chips to continue.";
    return;
  }

  if (!firstHand) {
    state.buttonPosition = nextSeat(state, state.buttonPosition, (seat) => seat.stack > 0) ?? 0;
    state.handNumber += 1;
  }
  state.deck = makeDeck();
  state.community = [];
  state.winners = [];
  state.street = "preflop";
  state.status = "playing";
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.pot = 0;
  state.message = "Cards are in the air";

  state.seats.forEach((seat) => {
    seat.status = seat.stack > 0 ? "active" : "out";
    seat.holeCards = [];
    seat.streetBet = 0;
    seat.committed = 0;
    seat.acted = false;
    seat.lastAction = null;
  });

  for (let round = 0; round < 2; round += 1) {
    let cursor = state.buttonPosition;
    for (let dealt = 0; dealt < funded.length; dealt += 1) {
      const position = nextSeat(state, cursor, inHand);
      if (position === null) break;
      const card = state.deck.pop();
      if (!card) throw new Error("The deck ran out of cards.");
      state.seats[position].holeCards.push(card);
      cursor = position;
    }
  }

  const { small, big } = blindPositions(state);
  if (small === null || big === null) throw new Error("Not enough players for blinds.");
  const smallPaid = commit(state.seats[small], state.smallBlind);
  const bigPaid = commit(state.seats[big], state.bigBlind);
  state.seats[small].lastAction = `Small blind · ${smallPaid}`;
  state.seats[big].lastAction = `Big blind · ${bigPaid}`;
  state.currentBet = Math.max(smallPaid, bigPaid);
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  setCurrentPlayer(state, nextSeat(state, big, canAct));
  addLog(state, `Hand ${state.handNumber} dealt · blinds ${state.smallBlind}/${state.bigBlind}`, "deal");
}

export function createGame(
  hostToken: string,
  playerName = "You",
  appearance?: Pick<PlayerProfile, "initials" | "accent" | "avatarUrl" | "avatarPreset">,
  options?: { isPrivate?: boolean; tier?: StakesTier; buyIn?: number },
): GameState {
  const now = new Date().toISOString();
  const tier = options?.tier ?? "micro";
  const config = TIER_CONFIG[tier];
  // Defaults to 1000 (not the tier's own range) so every existing caller
  // that doesn't pass a buyIn -- every test, and any not-yet-updated route --
  // keeps getting exactly the stack size the app has always started with.
  // A real buy-in choice (the new lobby/quick-play flow) always passes one
  // explicitly and gets clamped into the tier's actual bounds.
  const buyIn = options?.buyIn === undefined ? 1000 : clampBuyIn(tier, options.buyIn);
  const seats: Seat[] = [
    {
      id: randomUUID(),
      name: playerName.slice(0, 18) || "You",
      initials: appearance?.initials ?? (playerName || "You").slice(0, 2).toUpperCase(),
      accent: appearance?.accent ?? "#e7c66a",
      avatarUrl: appearance?.avatarUrl ?? null,
      avatarPreset: appearance?.avatarPreset ?? "ace",
      position: 0,
      isHuman: true,
      ownerToken: hostToken,
      personality: null,
      stack: buyIn,
      status: "active",
      holeCards: [],
      streetBet: 0,
      committed: 0,
      acted: false,
      lastAction: null,
      timeCardsRemaining: STARTING_TIME_CARDS,
    },
    ...botProfiles.slice(1).map((bot, index): Seat => ({
      id: randomUUID(),
      ...bot,
      position: index + 1,
      isHuman: false,
      ownerToken: null,
      stack: buyIn,
      status: "active",
      holeCards: [],
      streetBet: 0,
      committed: 0,
      acted: false,
      lastAction: null,
      timeCardsRemaining: 0,
    })),
  ];

  const isPrivate = options?.isPrivate ?? false;
  const state: GameState = {
    id: randomUUID(),
    hostToken,
    isPrivate,
    roomCode: isPrivate ? generateRoomCode() : null,
    tier,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 0,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    currentPlayer: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    pot: 0,
    deck: [],
    community: [],
    seats,
    winners: [],
    log: [],
    message: "",
    createdAt: now,
    updatedAt: now,
  };
  setupHand(state, true);
  return state;
}

/**
 * Seats a player at an open (bot-controlled) seat, converting it to a human
 * seat under their session token. If they already own a seat here (e.g.
 * revisiting a room-code link), returns that seat instead of claiming a new
 * one. A seat a previous occupant busted out of gets a fresh buy-in.
 */
export function claimSeat(
  state: GameState,
  token: string,
  profile: Pick<PlayerProfile, "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset">,
  buyIn?: number,
): { state: GameState; seatIndex: number } {
  const existing = state.seats.findIndex((seat) => seat.ownerToken === token);
  if (existing !== -1) return { state, seatIndex: existing };

  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === null);
  if (seatIndex === -1) throw new Error("This table is full.");

  const seat = state.seats[seatIndex];
  seat.isHuman = true;
  seat.ownerToken = token;
  seat.personality = null;
  seat.name = profile.displayName.slice(0, 18) || "Player";
  seat.initials = profile.initials;
  seat.accent = profile.accent;
  seat.avatarUrl = profile.avatarUrl;
  seat.avatarPreset = profile.avatarPreset;
  seat.timeCardsRemaining = STARTING_TIME_CARDS;
  if (seat.stack === 0) seat.stack = buyIn === undefined ? 1000 : clampBuyIn(state.tier, buyIn);
  if (state.currentPlayer === seatIndex) setCurrentPlayer(state, seatIndex);

  state.version += 1;
  state.updatedAt = new Date().toISOString();
  return { state, seatIndex };
}

/**
 * Gives up a seat, handing control back to a bot under the seat's original
 * identity. If it happens to be this seat's turn right now, the following
 * autoPlayBots() call resolves it automatically, since the seat is no longer
 * human-controlled — no separate "resolve their pending turn" step needed.
 */
export function vacateSeat(state: GameState, token: string): GameState {
  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === token);
  if (seatIndex === -1) throw new Error("You are not seated at this table.");

  const seat = state.seats[seatIndex];
  restoreBotControl(seat);
  if (state.currentPlayer === seatIndex) setCurrentPlayer(state, seatIndex);

  return state;
}

export function getLegalActions(state: GameState, seatIndex: number): LegalActions {
  const seat = state.seats[seatIndex];
  const isTurn = state.status === "playing" && state.currentPlayer === seatIndex && canAct(seat);
  const toCall = Math.max(0, state.currentBet - seat.streetBet);
  const maxRaiseTo = seat.streetBet + seat.stack;
  const minRaiseTo = state.currentBet + state.minRaise;
  return {
    // Folding when a check is available is strategically unusual but legal,
    // and players expect the control to remain available on every street.
    canFold: isTurn,
    canCheck: isTurn && toCall === 0,
    canCall: isTurn && toCall > 0 && seat.stack > 0,
    canRaise: isTurn && maxRaiseTo > state.currentBet && maxRaiseTo >= minRaiseTo,
    canAllIn: isTurn && seat.stack > 0,
    toCall,
    callAmount: Math.min(toCall, seat.stack),
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
  };
}

function bettingComplete(state: GameState) {
  return state.seats.every(
    (seat) =>
      seat.status === "folded" ||
      seat.status === "out" ||
      seat.status === "all-in" ||
      (seat.acted && seat.streetBet === state.currentBet),
  );
}

function remaining(state: GameState) {
  return state.seats.filter((seat) => seat.status !== "folded" && seat.status !== "out");
}

function awardUncontested(state: GameState, seat: Seat) {
  const amount = state.seats.reduce((sum, candidate) => sum + candidate.committed, 0);
  seat.stack += amount;
  state.pot = amount;
  state.winners = [{ seatId: seat.id, name: seat.name, amount, hand: "Uncontested" }];
  state.street = "showdown";
  state.status = "complete";
  setCurrentPlayer(state, null);
  state.message = `${seat.name} wins ${amount}`;
  addLog(state, `${seat.name} wins ${amount} uncontested`, "win");
}

function sidePotWinners(
  eligible: Seat[],
  scores: Map<string, HandScore>,
): Seat[] {
  let best: HandScore | null = null;
  let winners: Seat[] = [];
  eligible.forEach((seat) => {
    const score = scores.get(seat.id)!;
    const comparison = best ? compareScores(score, best) : 1;
    if (comparison > 0) {
      best = score;
      winners = [seat];
    } else if (comparison === 0) winners.push(seat);
  });
  return winners;
}

function showdown(state: GameState) {
  while (state.community.length < 5) {
    dealToCommunity(state, state.community.length === 0 ? 3 : 1);
  }
  const contenders = remaining(state);
  const scores = new Map(
    contenders.map((seat) => [seat.id, evaluateHand([...seat.holeCards, ...state.community])]),
  );
  const levels = [...new Set(state.seats.map((seat) => seat.committed).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  const winnings = new Map<string, number>();

  levels.forEach((level) => {
    const contributors = state.seats.filter((seat) => seat.committed >= level);
    const potAmount = (level - previous) * contributors.length;
    const eligible = contributors.filter((seat) => seat.status !== "folded" && seat.status !== "out");
    if (eligible.length > 0) {
      const winners = sidePotWinners(eligible, scores);
      const share = Math.floor(potAmount / winners.length);
      let remainder = potAmount - share * winners.length;
      const ordered = [...winners].sort(
        (a, b) =>
          ((a.position - state.buttonPosition - 1 + state.seats.length) % state.seats.length) -
          ((b.position - state.buttonPosition - 1 + state.seats.length) % state.seats.length),
      );
      ordered.forEach((winner) => {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        winnings.set(winner.id, (winnings.get(winner.id) ?? 0) + share + extra);
      });
    }
    previous = level;
  });

  const winners: Winner[] = [...winnings.entries()].map(([seatId, amount]) => {
    const seat = state.seats.find((candidate) => candidate.id === seatId)!;
    seat.stack += amount;
    return { seatId, name: seat.name, amount, hand: scores.get(seatId)!.name };
  });
  state.winners = winners.sort((a, b) => b.amount - a.amount);
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  state.street = "showdown";
  state.status = "complete";
  setCurrentPlayer(state, null);
  state.message = winners.map((winner) => `${winner.name} wins ${winner.amount} · ${winner.hand}`).join(" / ");
  addLog(state, state.message, "win");
}

function advanceStreet(state: GameState) {
  const next = streetOrder[streetOrder.indexOf(state.street) + 1];
  if (!next || next === "showdown") {
    showdown(state);
    return;
  }
  state.street = next;
  dealToCommunity(state, next === "flop" ? 3 : 1);
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.seats.forEach((seat) => {
    seat.streetBet = 0;
    seat.acted = false;
    seat.lastAction = null;
  });
  addLog(state, `${next[0].toUpperCase()}${next.slice(1)} dealt`, "deal");

  const first = nextSeat(state, state.buttonPosition, canAct);
  setCurrentPlayer(state, first);
  state.message = `${next[0].toUpperCase()}${next.slice(1)}`;
  if (first === null || state.seats.filter(canAct).length <= 1) {
    advanceStreet(state);
  }
}

function progressAfterAction(state: GameState, actorIndex: number) {
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  const contenders = remaining(state);
  if (contenders.length === 1) {
    awardUncontested(state, contenders[0]);
    return;
  }
  if (bettingComplete(state)) {
    advanceStreet(state);
    return;
  }
  setCurrentPlayer(state, nextSeat(state, actorIndex, canAct));
  if (state.currentPlayer === null) advanceStreet(state);
}

function applyTurnAction(state: GameState, action: TurnAction) {
  const actorIndex = state.currentPlayer;
  if (actorIndex === null) throw new Error("There is no active turn.");
  const seat = state.seats[actorIndex];
  const legal = getLegalActions(state, actorIndex);
  const toCall = legal.toCall;

  if (action.type === "fold") {
    if (!legal.canFold) throw new Error("Folding is not available.");
    seat.status = "folded";
    seat.acted = true;
    seat.lastAction = "Fold";
    addLog(state, `${seat.name} folds`);
  } else if (action.type === "check") {
    if (!legal.canCheck) throw new Error(`There is ${toCall} to call.`);
    seat.acted = true;
    seat.lastAction = "Check";
    addLog(state, `${seat.name} checks`);
  } else if (action.type === "call") {
    if (!legal.canCall) throw new Error("Calling is not available.");
    const paid = commit(seat, toCall);
    seat.acted = true;
    seat.lastAction = paid < toCall ? `All-in · ${paid}` : `Call · ${paid}`;
    addLog(state, `${seat.name} ${paid < toCall ? "is all-in for" : "calls"} ${paid}`);
  } else {
    const raiseTo = action.type === "all-in" ? legal.maxRaiseTo : Math.floor(action.amount);
    if (raiseTo <= state.currentBet) {
      if (action.type === "all-in") {
        const paid = commit(seat, toCall);
        seat.acted = true;
        seat.lastAction = `All-in · ${paid}`;
        addLog(state, `${seat.name} is all-in for ${paid}`);
      } else throw new Error("Raise must exceed the current bet.");
    } else {
      if (raiseTo > legal.maxRaiseTo) throw new Error("That raise exceeds your stack.");
      const raiseSize = raiseTo - state.currentBet;
      const isShortAllIn = raiseTo === legal.maxRaiseTo && raiseSize < state.minRaise;
      if (raiseSize < state.minRaise && !isShortAllIn) {
        throw new Error(`Minimum raise is to ${state.currentBet + state.minRaise}.`);
      }
      commit(seat, raiseTo - seat.streetBet);
      if (!isShortAllIn) {
        state.minRaise = raiseSize;
        state.seats.forEach((candidate) => {
          if (candidate.id !== seat.id && canAct(candidate)) candidate.acted = false;
        });
      }
      state.currentBet = raiseTo;
      seat.acted = true;
      seat.lastAction = seat.status === "all-in" ? `All-in · ${raiseTo}` : `Raise to · ${raiseTo}`;
      addLog(state, `${seat.name} ${seat.status === "all-in" ? "is all-in for" : "raises to"} ${raiseTo}`);
    }
  }
  progressAfterAction(state, actorIndex);
}

// Tuning knobs per personality; all thresholds/rolls follow the same shape
// as the original single-profile heuristic, just widened or narrowed.
const personalityProfiles: Record<
  BotPersonality,
  {
    pressureFactor: number; // fraction of stack that counts as "under pressure"
    pressureFoldRoll: number; // 0-100 chance to fold to pressure without a decent hand
    raiseRoll: number; // 0-100 chance to raise with a decent hand
    raiseWide: boolean; // will also treat a single high card as decent
    raiseSizeBB: number; // raise-to size, in big blinds over the current bet
    looseFoldRoll: number; // 0-100 chance to fold instead of call when calling is optional
  }
> = {
  MANIAC: {
    pressureFactor: 0.55,
    pressureFoldRoll: 30,
    raiseRoll: 65,
    raiseWide: true,
    raiseSizeBB: 4,
    looseFoldRoll: 4,
  },
  ROCK: {
    pressureFactor: 0.18,
    pressureFoldRoll: 85,
    raiseRoll: 25,
    raiseWide: false,
    raiseSizeBB: 2,
    looseFoldRoll: 22,
  },
  CALLING_STATION: {
    pressureFactor: 0.9,
    pressureFoldRoll: 10,
    raiseRoll: 10,
    raiseWide: false,
    raiseSizeBB: 2,
    looseFoldRoll: 3,
  },
};

function chooseBotAction(state: GameState, seatIndex: number): TurnAction {
  const legal = getLegalActions(state, seatIndex);
  const seat = state.seats[seatIndex];
  const profile = personalityProfiles[seat.personality ?? "ROCK"];
  const highRanks = seat.holeCards.filter((card) => ["A", "K", "Q", "J"].includes(card.rank)).length;
  const pair = seat.holeCards[0]?.rank === seat.holeCards[1]?.rank;
  const decent = pair || highRanks === 2 || (profile.raiseWide && highRanks === 1);
  const roll = randomInt(100);
  if (legal.toCall > seat.stack * profile.pressureFactor && !decent && roll < profile.pressureFoldRoll) {
    return { type: "fold" };
  }
  if (legal.canRaise && decent && roll < profile.raiseRoll) {
    const target = Math.min(
      legal.maxRaiseTo,
      Math.max(legal.minRaiseTo, state.currentBet + state.bigBlind * profile.raiseSizeBB),
    );
    return { type: "raise", amount: target };
  }
  if (legal.canCall) return roll < profile.looseFoldRoll && legal.canFold ? { type: "fold" } : { type: "call" };
  return { type: "check" };
}

export function autoPlayBots(state: GameState): GameState {
  let safety = 0;
  while (
    state.status === "playing" &&
    state.currentPlayer !== null &&
    !state.seats[state.currentPlayer].isHuman &&
    safety < 80
  ) {
    const action = chooseBotAction(state, state.currentPlayer);
    applyTurnAction(state, action);
    safety += 1;
  }
  return state;
}

/**
 * Makes aggregates created before turn clocks/time cards forward-compatible.
 * The normalized fields are persisted with the next ordinary state update.
 */
export function normalizeGameState(state: GameState): GameState {
  state.seats.forEach((seat) => {
    if (!Number.isInteger(seat.timeCardsRemaining)) {
      seat.timeCardsRemaining = seat.isHuman ? STARTING_TIME_CARDS : 0;
    }
  });
  if (state.currentPlayer === null || state.status !== "playing") {
    state.turnStartedAt = null;
    state.turnDeadlineAt = null;
    return state;
  }
  const startedAt = Date.parse(state.turnStartedAt ?? "");
  if (!Number.isFinite(startedAt)) {
    setCurrentPlayer(state, state.currentPlayer);
    return state;
  }
  if (!state.turnDeadlineAt || !Number.isFinite(Date.parse(state.turnDeadlineAt))) {
    const duration = state.seats[state.currentPlayer].isHuman
      ? TURN_TIMEOUT_MS
      : BOT_DECISION_MIN_MS;
    state.turnDeadlineAt = new Date(startedAt + duration).toISOString();
  }
  return state;
}

export interface TimedTurnAdvance {
  state: GameState;
  actorSeatId: string | null;
  action: TurnAction | null;
  timedOut: boolean;
}

/**
 * Advances at most one due turn. Humans auto-check when checking is free and
 * otherwise auto-fold. Bots make exactly one decision after their persisted
 * think deadline; the next bot receives a fresh deadline, which creates
 * visible pacing instead of resolving a whole table in one request.
 */
export function advanceTimedTurn(state: GameState, now = Date.now()): TimedTurnAdvance {
  normalizeGameState(state);
  if (state.status !== "playing" || state.currentPlayer === null || !state.turnDeadlineAt) {
    return { state, actorSeatId: null, action: null, timedOut: false };
  }
  if (now < Date.parse(state.turnDeadlineAt)) {
    return { state, actorSeatId: null, action: null, timedOut: false };
  }

  const seatIndex = state.currentPlayer;
  const seat = state.seats[seatIndex];
  const timedOut = seat.isHuman;
  const legal = getLegalActions(state, seatIndex);
  const action: TurnAction = timedOut
    ? legal.canCheck ? { type: "check" } : { type: "fold" }
    : chooseBotAction(state, seatIndex);
  const actorSeatId = seat.id;

  applyTurnAction(state, action);
  if (timedOut) {
    seat.lastAction = action.type === "check" ? "Timed out · Check" : "Timed out · Fold";
    addLog(state, `${seat.name} ran out of time`);
  }
  state.version += 1;
  state.updatedAt = new Date(now).toISOString();
  return { state, actorSeatId, action, timedOut };
}

/** Backwards-compatible helper retained for focused timeout tests. */
export function expireIdleTurn(state: GameState): { state: GameState; expiredSeatIds: string[] } {
  normalizeGameState(state);
  const current = state.currentPlayer === null ? null : state.seats[state.currentPlayer];
  if (!current?.isHuman) return { state, expiredSeatIds: [] };
  const result = advanceTimedTurn(state);
  return {
    state: result.state,
    expiredSeatIds: result.timedOut && result.actorSeatId ? [result.actorSeatId] : [],
  };
}

export function applyPlayerAction(state: GameState, action: PlayerAction, callerToken: string): GameState {
  normalizeGameState(state);
  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === callerToken);
  if (seatIndex === -1) throw new Error("You are not seated at this table.");
  if (action.type === "leave-seat") {
    vacateSeat(state, callerToken);
  } else if (action.type === "use-time-card") {
    if (state.status !== "playing" || state.currentPlayer !== seatIndex) {
      throw new Error("Time cards can only be used on your turn.");
    }
    const seat = state.seats[seatIndex];
    if (seat.timeCardsRemaining <= 0) throw new Error("You have no time cards left.");
    const deadline = Math.max(Date.now(), Date.parse(state.turnDeadlineAt ?? ""));
    seat.timeCardsRemaining -= 1;
    state.turnDeadlineAt = new Date(deadline + TIME_CARD_EXTENSION_MS).toISOString();
    seat.lastAction = `Time card · ${seat.timeCardsRemaining} left`;
    addLog(state, `${seat.name} uses a time card (+20s)`);
  } else if (action.type === "next-hand") {
    if (state.status !== "complete") throw new Error("Finish the current hand first.");
    setupHand(state);
  } else if (action.type === "rebuy") {
    if (state.status !== "complete") throw new Error("You can only rebuy between hands.");
    const seat = state.seats[seatIndex];
    if (seat.stack > 0) throw new Error("Your seat still has chips.");
    // Refill and immediately deal, in one action -- refilling first means
    // setupHand's own releaseBustedHumanSeats (which only reclaims seats
    // still at 0) leaves this seat alone rather than handing it to a bot.
    seat.stack = clampBuyIn(state.tier, action.amount);
    seat.status = "active";
    setupHand(state);
  } else {
    if (state.status !== "playing") throw new Error("This hand is complete.");
    if (state.currentPlayer !== seatIndex) throw new Error("Wait for your turn.");
    applyTurnAction(state, action);
  }
  state.version += 1;
  state.updatedAt = new Date().toISOString();
  return state;
}

export function toSnapshot(state: GameState, callerToken: string): GameSnapshot {
  const mySeatIndex = state.seats.findIndex((seat) => seat.ownerToken === callerToken);
  const publicState = Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== "deck" && key !== "hostToken" && key !== "seats"),
  ) as Omit<GameState, "deck" | "hostToken" | "seats">;
  const { small, big } = blindPositions(state);
  // A hand only reveals cards to the table when 2+ players actually reached
  // showdown. An uncontested win (everyone else folded) lets the winner muck
  // without showing, exactly like a real showdown never happened for anyone
  // who folded earlier — their cards stay hidden from other seats forever.
  const contenders = remaining(state);
  const genuineShowdown = state.street === "showdown" && contenders.length > 1;
  return {
    ...publicState,
    isSeated: mySeatIndex !== -1,
    seats: state.seats.map((seat, index) => {
      const isMine = index === mySeatIndex;
      const revealed = isMine || (genuineShowdown && seat.status !== "folded" && seat.status !== "out");
      const publicSeat = Object.fromEntries(
        Object.entries(seat).filter(([key]) => key !== "ownerToken"),
      ) as Omit<Seat, "ownerToken">;
      return {
        ...publicSeat,
        holeCards: seat.holeCards.map((card) => (revealed ? card : null)),
        handLabel: isMine && seat.holeCards.length > 0
          ? describeHand([...seat.holeCards, ...state.community])
          : null,
        isDealer: seat.position === state.buttonPosition,
        isCurrent: seat.position === state.currentPlayer,
        isSmallBlind: seat.position === small,
        isBigBlind: seat.position === big,
        isMine,
        isOpen: seat.ownerToken === null,
      };
    }),
    legalActions:
      mySeatIndex !== -1 && state.currentPlayer === mySeatIndex ? getLegalActions(state, mySeatIndex) : null,
  };
}

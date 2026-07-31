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
import { avatarCosmetics, DEFAULT_AVATAR_COSMETIC } from "@/lib/cosmetics/catalog";
import { CHEAPEST_TIER, clampBuyIn, isStakesTier, TIER_CONFIG, type StakesTier } from "./tiers";

const suits: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const ranks: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const deckTemplate: Card[] = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
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


/**
 * A bot's face, taken from whatever avatars the catalog currently holds
 * rather than naming ids. Adding or removing artwork changes the cast
 * automatically and can never leave a bot pointing at an item that no
 * longer exists.
 */
function botAvatarFor(position: number): string {
  if (avatarCosmetics.length === 0) return DEFAULT_AVATAR_COSMETIC;
  return avatarCosmetics[position % avatarCosmetics.length].id;
}

// Humans get a short decision clock plus three optional time-bank cards.
// Bot deadlines are also persisted so polling/realtime can pace decisions
// without trusting a browser timer.
export const TURN_TIMEOUT_MS = 15_000;
export const TIME_CARD_EXTENSION_MS = 20_000;
export const STARTING_TIME_CARDS = 3;
export const BOT_DECISION_MIN_MS = 1_200;
export const BOT_DECISION_MAX_MS = 5_200;

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
  const deck = deckTemplate.map((card) => ({ ...card }));
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
  const seat = state.seats[index];
  const botThinkRanges: Record<BotPersonality, [number, number]> = {
    MANIAC: [BOT_DECISION_MIN_MS, 3_600],
    ROCK: [2_100, BOT_DECISION_MAX_MS],
    CALLING_STATION: [1_600, 4_400],
  };
  const [minimum, maximum] = botThinkRanges[seat.personality ?? "ROCK"];
  const duration = seat.isHuman
    ? TURN_TIMEOUT_MS
    : randomInt(minimum, maximum + 1);
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
  seat.avatarCosmetic = botAvatarFor(seat.position);
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
  state.rake = 0;
  state.message = "Cards are in the air";

  state.seats.forEach((seat) => {
    seat.status = seat.stack > 0 ? "active" : "out";
    seat.holeCards = [];
    seat.streetBet = 0;
    seat.committed = 0;
    seat.acted = false;
    seat.actedAtBet = null;
    seat.lastAction = null;
    seat.vpip = false;
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
  // A short-stacked big blind may post less than the blind, but every player
  // with enough chips still faces the full big blind as the minimum bring-in.
  // The short blind's actual contribution remains correct for side pots.
  state.currentBet = state.bigBlind;
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  setCurrentPlayer(state, nextSeat(state, big, canAct));
  addLog(state, `Hand ${state.handNumber} dealt · blinds ${state.smallBlind}/${state.bigBlind}`, "deal");
}

export function createGame(
  hostToken: string,
  playerName = "You",
  appearance?: Pick<PlayerProfile, "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped">,
  options?: { isPrivate?: boolean; tier?: StakesTier; buyIn?: number },
): GameState {
  const now = new Date().toISOString();
  const tier = options?.tier ?? CHEAPEST_TIER;
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
      avatarCosmetic: appearance?.equipped?.avatar ?? DEFAULT_AVATAR_COSMETIC,
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
      actedAtBet: null,
      lastAction: null,
      timeCardsRemaining: STARTING_TIME_CARDS,
      vpip: false,
    },
    ...botProfiles.slice(1).map((bot, index): Seat => ({
      id: randomUUID(),
      ...bot,
      avatarCosmetic: botAvatarFor(index + 1),
      position: index + 1,
      isHuman: false,
      ownerToken: null,
      stack: buyIn,
      status: "active",
      holeCards: [],
      streetBet: 0,
      committed: 0,
      acted: false,
      actedAtBet: null,
      lastAction: null,
      timeCardsRemaining: 0,
      vpip: false,
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
    rake: 0,
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
  profile: Pick<PlayerProfile, "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped">,
  buyIn?: number,
): { state: GameState; seatIndex: number } {
  const existing = state.seats.findIndex((seat) => seat.ownerToken === token);
  if (existing !== -1) return { state, seatIndex: existing };

  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === null);
  if (seatIndex === -1) throw new Error("This table is full.");

  const seat = state.seats[seatIndex];
  const paidBuyIn = buyIn === undefined ? 1000 : clampBuyIn(state.tier, buyIn);
  if (seat.committed > paidBuyIn) {
    throw new Error("Choose a buy-in that covers this seat's committed chips.");
  }
  seat.isHuman = true;
  seat.ownerToken = token;
  seat.personality = null;
  seat.name = profile.displayName.slice(0, 18) || "Player";
  seat.initials = profile.initials;
  seat.accent = profile.accent;
  seat.avatarUrl = profile.avatarUrl;
  seat.avatarPreset = profile.avatarPreset;
  seat.avatarCosmetic = profile.equipped.avatar;
  seat.timeCardsRemaining = STARTING_TIME_CARDS;
  // A claimed seat owns exactly the buy-in the player paid for, including chips
  // this seat already committed before the bot was replaced. Resetting the
  // behind-stack to the full buy-in would mint every posted blind/bet again.
  seat.stack = paidBuyIn - seat.committed;
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
 *
 * Returns the chips the departing player still had in front of them, which
 * the caller cashes back out to Gold. Chips already committed to the current
 * pot are deliberately excluded: once they are in the middle they are
 * contested, exactly as at a real table.
 */
export function vacateSeat(state: GameState, token: string): { state: GameState; cashedOut: number } {
  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === token);
  if (seatIndex === -1) throw new Error("You are not seated at this table.");

  const seat = state.seats[seatIndex];
  const cashedOut = seat.stack;
  restoreBotControl(seat);
  // Those chips leave the table with the player, so the seat must not keep
  // them too -- otherwise every departure would mint the stack a second time.
  // The replacement bot sits down fresh for the table minimum.
  seat.stack = TIER_CONFIG[state.tier].minBuyIn;
  if (state.currentPlayer === seatIndex) setCurrentPlayer(state, seatIndex);

  return { state, cashedOut };
}

export function getLegalActions(state: GameState, seatIndex: number): LegalActions {
  const seat = state.seats[seatIndex];
  const isTurn = state.status === "playing" && state.currentPlayer === seatIndex && canAct(seat);
  const toCall = Math.max(0, state.currentBet - seat.streetBet);
  const maxRaiseTo = seat.streetBet + seat.stack;
  const minRaiseTo = state.currentBet + state.minRaise;
  const raiseReopened = !seat.acted
    || seat.actedAtBet === null
    || state.currentBet - seat.actedAtBet >= state.minRaise;
  const canMakeAggressiveAction = raiseReopened || maxRaiseTo <= state.currentBet;
  return {
    // Folding when a check is available is strategically unusual but legal,
    // and players expect the control to remain available on every street.
    canFold: isTurn,
    canCheck: isTurn && toCall === 0,
    canCall: isTurn && toCall > 0 && seat.stack > 0,
    canRaise: isTurn
      && raiseReopened
      && maxRaiseTo > state.currentBet
      && maxRaiseTo >= minRaiseTo,
    // An all-in button cannot bypass the reopening rule. When action has not
    // reopened, shoving is available only if it is no more than a call.
    canAllIn: isTurn && seat.stack > 0 && canMakeAggressiveAction,
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

/**
 * The house's cut of each pot, and the Gold economy's primary structural
 * sink. Tables are populated by bots, so every pot a human wins from an AI
 * seat would otherwise mint Gold from nothing; rake is the counterweight.
 *
 * Two things hold rake off a pot. The minimum-pot floor keeps the house out
 * of small pots at all. Separately, and regardless of size, nothing is taken
 * from a hand that never saw a flop -- the standard "no flop, no drop" rule,
 * enforced in deductRake below.
 *
 * The floor alone used to be described as covering that, on the reasoning
 * that a preflop steal of the blinds never clears ten big blinds. True of a
 * steal, but not of the hand it was standing in for: at 5/10 an open to 30
 * and a three-bet to 100 leaves a 135 pot, which cleared the floor and got
 * raked. Raising, taking it down uncontested, and still losing chips to the
 * house is the single worst-feeling outcome a poker client can produce.
 */
const RAKE_RATE = 0.04;
const RAKE_CAP_BB = 3;
const RAKE_MIN_POT_BB = 10;

function rakeFor(pot: number, bigBlind: number): number {
  if (pot < bigBlind * RAKE_MIN_POT_BB) return 0;
  return Math.min(Math.floor(pot * RAKE_RATE), bigBlind * RAKE_CAP_BB);
}

/**
 * Removes rake from a hand's winnings in place and returns the amount taken.
 * Split across winners in proportion to what each is owed, so a chopped pot
 * charges both players evenly instead of billing whoever sorts first; the
 * last winner absorbs the rounding remainder so the books always balance.
 */
function deductRake(state: GameState, winnings: Map<string, number>): number {
  // No flop, no drop. Only reachable from awardUncontested: showdown() runs
  // the board out to five cards before it rakes, so a hand that got all-in
  // preflop and was dealt a run-out is still raked -- a flop was dealt, and
  // the house did provide the pot. This guard is for the hand that ended
  // before any board existed at all.
  if (state.community.length === 0) return 0;
  const total = [...winnings.values()].reduce((sum, amount) => sum + amount, 0);
  const rake = rakeFor(total, state.bigBlind);
  if (rake <= 0) return 0;

  const ordered = [...winnings.entries()].sort((a, b) => b[1] - a[1]);
  let outstanding = rake;
  ordered.forEach(([seatId, amount], index) => {
    const isLast = index === ordered.length - 1;
    const share = isLast
      ? Math.min(outstanding, amount)
      : Math.min(outstanding, Math.floor((rake * amount) / total));
    outstanding -= share;
    winnings.set(seatId, amount - share);
  });
  return rake - outstanding;
}

function awardUncontested(state: GameState, seat: Seat) {
  const potTotal = state.seats.reduce((sum, candidate) => sum + candidate.committed, 0);
  const winnings = new Map([[seat.id, potTotal]]);
  state.rake = deductRake(state, winnings);
  const amount = winnings.get(seat.id)!;

  seat.stack += amount;
  state.pot = potTotal;
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

  state.rake = deductRake(state, winnings);

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
    seat.actedAtBet = null;
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

  // VPIP: every path below except fold and check commits chips, and a check
  // preflop only exists when toCall is 0 (nobody raised) -- so "not fold, not
  // check, preflop" already means "chose to put money in beyond the blind."
  if (state.street === "preflop" && action.type !== "fold" && action.type !== "check") {
    seat.vpip = true;
  }

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
    if (action.type === "raise" && !legal.canRaise) {
      throw new Error("Raising is not available.");
    }
    if (action.type === "all-in" && !legal.canAllIn) {
      throw new Error("Going all-in would be an illegal raise.");
    }
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
      const openingBet = state.currentBet === 0;
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
      seat.lastAction = seat.status === "all-in"
        ? `All-in · ${raiseTo}`
        : openingBet ? `Bet · ${raiseTo}` : `Raise to · ${raiseTo}`;
      addLog(
        state,
        `${seat.name} ${
          seat.status === "all-in" ? "is all-in for" : openingBet ? "bets" : "raises to"
        } ${raiseTo}`,
      );
    }
  }
  seat.actedAtBet = state.currentBet;
  progressAfterAction(state, actorIndex);
}

type BotRandom = () => number;

const secureBotRandom: BotRandom = () => randomInt(1_000_000) / 1_000_000;

const personalityProfiles: Record<
  BotPersonality,
  {
    aggression: number;
    callTolerance: number;
    equityAdjustment: number;
    slowPlayFrequency: number;
    postflopBetSizes: number[];
  }
> = {
  MANIAC: {
    aggression: 0.7,
    callTolerance: 0.025,
    equityAdjustment: 0.025,
    slowPlayFrequency: 0.06,
    postflopBetSizes: [0.5, 0.66, 0.75, 1],
  },
  ROCK: {
    aggression: 0.44,
    callTolerance: -0.025,
    equityAdjustment: -0.015,
    slowPlayFrequency: 0.18,
    postflopBetSizes: [0.33, 0.5, 0.66, 0.75],
  },
  CALLING_STATION: {
    aggression: 0.2,
    callTolerance: 0.085,
    equityAdjustment: 0.015,
    slowPlayFrequency: 0.12,
    postflopBetSizes: [0.4, 0.5, 0.66],
  },
};

export type PreflopHandTier = "premium" | "strong" | "playable" | "speculative" | "trash";

const rankOrder: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const premiumPreflopHands = new Set(["AA", "KK", "QQ", "JJ", "AKs", "AKo"]);
const strongPreflopHands = new Set(["TT", "99", "AQs", "AQo", "AJs", "KQs"]);
const playablePreflopHands = new Set([
  "88", "77", "66", "55", "44", "33", "22",
  "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
  "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s", "87s", "76s",
  "AJo", "KQo",
]);
const speculativePreflopHands = new Set([
  "K9s", "Q9s", "J9s", "T8s", "97s", "86s", "75s", "65s", "54s",
  "ATo", "KJo", "QJo", "JTo",
]);

function preflopKey([first, second]: Card[]): string {
  if (!first || !second) return "";
  if (first.rank === second.rank) return `${first.rank}${second.rank}`;
  const [high, low] = rankOrder[first.rank] >= rankOrder[second.rank]
    ? [first, second]
    : [second, first];
  return `${high.rank}${low.rank}${first.suit === second.suit ? "s" : "o"}`;
}

/**
 * A compact six-max starting-hand chart. Sklansky-Chubukov numbers are
 * heads-up open-shove limits rather than a general cash-game opening chart,
 * so the bot uses their core idea (starting-hand discipline) without turning
 * a 100-BB six-max table into push/fold poker.
 */
export function preflopHandTier(holeCards: Card[]): PreflopHandTier {
  const key = preflopKey(holeCards);
  if (premiumPreflopHands.has(key)) return "premium";
  if (strongPreflopHands.has(key)) return "strong";
  if (playablePreflopHands.has(key)) return "playable";
  if (speculativePreflopHands.has(key)) return "speculative";
  return "trash";
}

const cardKey = (card: Card) => `${card.rank}:${card.suit}`;
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const BOT_BLUFF_FREQUENCY = 0.05;

function drawUnknownCard(pool: Card[], random: BotRandom): Card {
  const roll = clampUnit(random());
  const index = Math.min(pool.length - 1, Math.floor(roll * pool.length));
  return pool.splice(index, 1)[0];
}

/**
 * Estimates showdown equity using only information the bot is entitled to:
 * its own cards, the public board, and the number of live opponents. Actual
 * opponent cards and the server's remaining deck are deliberately ignored.
 */
export function estimateBotEquity(
  state: GameState,
  seatIndex: number,
  simulations = 56,
  random: BotRandom = secureBotRandom,
): number {
  const seat = state.seats[seatIndex];
  if (seat.holeCards.length !== 2) return 0;

  const opponents = state.seats.filter(
    (candidate, index) =>
      index !== seatIndex
      && candidate.status !== "folded"
      && candidate.status !== "out",
  ).length;
  if (opponents === 0) return 1;

  const known = new Set([...seat.holeCards, ...state.community].map(cardKey));
  const unknown = deckTemplate.filter((card) => !known.has(cardKey(card)));
  let equity = 0;

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const pool = [...unknown];
    const opponentHands = Array.from({ length: opponents }, () => [
      drawUnknownCard(pool, random),
      drawUnknownCard(pool, random),
    ]);
    const board = [...state.community];
    while (board.length < 5) board.push(drawUnknownCard(pool, random));

    const heroScore = evaluateHand([...seat.holeCards, ...board]);
    let tiedWinners = 1;
    let beaten = false;
    opponentHands.forEach((hand) => {
      const comparison = compareScores(evaluateHand([...hand, ...board]), heroScore);
      if (comparison > 0) beaten = true;
      else if (comparison === 0) tiedWinners += 1;
    });
    if (!beaten) equity += 1 / tiedWinners;
  }

  return equity / Math.max(1, simulations);
}

function positionAdvantage(state: GameState, seatIndex: number): number {
  const order: number[] = [];
  let cursor = state.buttonPosition;
  for (let count = 0; count < state.seats.length; count += 1) {
    const next = nextSeat(
      state,
      cursor,
      (seat) => seat.status !== "folded" && seat.status !== "out",
    );
    if (next === null || order.includes(next)) break;
    order.push(next);
    cursor = next;
  }
  const position = order.indexOf(seatIndex);
  return position < 0 || order.length < 2 ? 0.5 : position / (order.length - 1);
}

function botRaiseTarget(
  state: GameState,
  legal: LegalActions,
  style: (typeof personalityProfiles)[BotPersonality],
  random: BotRandom,
): number {
  let target: number;
  if (state.street === "preflop") {
    const limpers = state.seats.filter(
      (seat) => seat.vpip && seat.streetBet === state.currentBet,
    ).length;
    target = state.currentBet <= state.bigBlind
      ? state.bigBlind * (2.25 + random() * 0.9 + limpers)
      : state.currentBet * (2.35 + random() * 0.75);
  } else {
    const sizes = style.postflopBetSizes;
    const fraction = sizes[Math.min(sizes.length - 1, Math.floor(clampUnit(random()) * sizes.length))];
    const potAfterCall = Math.max(state.bigBlind, state.pot + legal.toCall);
    target = state.currentBet === 0
      ? potAfterCall * fraction
      : state.currentBet + Math.max(state.minRaise, potAfterCall * fraction);
  }

  const rounded = Math.max(
    legal.minRaiseTo,
    Math.round(target / state.bigBlind) * state.bigBlind,
  );
  // Normal bets stop at one pot and deliberately leave at least one big
  // blind behind. Committing the stack is a separate, tightly gated decision
  // below; a rounded raise must never accidentally turn into another shove.
  const potSizedCap = state.currentBet === 0
    ? Math.max(state.bigBlind, state.pot)
    : state.currentBet + state.pot + legal.toCall;
  const nonAllInCap = legal.maxRaiseTo - Math.min(state.bigBlind, legal.maxRaiseTo);
  return Math.min(potSizedCap, nonAllInCap, rounded);
}

/**
 * Mixed, equity-aware bot strategy. The random source is injectable so rule
 * and strategy tests can exercise exact branches without flaky outcomes.
 */
export function chooseBotAction(
  state: GameState,
  seatIndex: number,
  random: BotRandom = secureBotRandom,
): TurnAction {
  const legal = getLegalActions(state, seatIndex);
  const seat = state.seats[seatIndex];
  const style = personalityProfiles[seat.personality ?? "ROCK"];
  const liveOpponents = state.seats.filter(
    (candidate, index) =>
      index !== seatIndex
      && candidate.status !== "folded"
      && candidate.status !== "out",
  );
  const opponents = Math.max(1, liveOpponents.length);
  const allInOpponents = liveOpponents.filter((candidate) => candidate.status === "all-in").length;
  const baselineEquity = 1 / (opponents + 1);
  const rawEquity = estimateBotEquity(state, seatIndex, 56, random);
  const position = positionAdvantage(state, seatIndex);
  const effectiveEquity = clampUnit(
    rawEquity
      + style.equityAdjustment
      + (position - 0.5) * (state.street === "preflop" ? 0.08 : 0.045),
  );
  const potOdds = legal.toCall / Math.max(1, state.pot + legal.toCall);
  const decisionRoll = random();
  const startingTier = preflopHandTier(seat.holeCards);
  const tierStrength: Record<PreflopHandTier, number> = {
    premium: 4,
    strong: 3,
    playable: 2,
    speculative: 1,
    trash: 0,
  };
  const preflopStrength = tierStrength[startingTier];
  const multiwayRiskPremium = Math.min(
    0.24,
    Math.max(0, opponents - 1) * 0.025 + allInOpponents * 0.065,
  );
  const valueRaiseThreshold = Math.max(
    baselineEquity + 0.12 - style.aggression * 0.035,
    potOdds + 0.12 + multiwayRiskPremium,
  );
  const hasValueRaise = effectiveEquity >= valueRaiseThreshold;
  const bluffWindow = position >= 0.58
    && effectiveEquity < baselineEquity + 0.04
    && decisionRoll < BOT_BLUFF_FREQUENCY;
  const potSizedCap = state.currentBet === 0
    ? Math.max(state.bigBlind, state.pot)
    : state.currentBet + state.pot + legal.toCall;
  const nonAllInCap = legal.maxRaiseTo - Math.min(state.bigBlind, legal.maxRaiseTo);
  const shouldRaise = legal.canRaise
    && (hasValueRaise || bluffWindow)
    && legal.minRaiseTo <= Math.min(potSizedCap, nonAllInCap)
    && decisionRoll < Math.min(0.96, style.aggression + Math.max(0, effectiveEquity - baselineEquity));

  if (legal.toCall > 0) {
    // Weak offsuit holdings do not drift into multiway pots because a Monte
    // Carlo roll happened to land high. The one exception is the explicit
    // five-percent bluff gate, and even that raises rather than open-shoves.
    if (
      state.street === "preflop"
      && startingTier === "trash"
      && !bluffWindow
    ) {
      return { type: "fold" };
    }

    const stackInBigBlinds = seat.stack / Math.max(1, state.bigBlind);
    const criticallyShort = stackInBigBlinds < 10;
    const potIsMassive = state.pot >= seat.stack;
    const preflopShove = state.street === "preflop"
      && (
        (criticallyShort && preflopStrength >= (stackInBigBlinds < 6 ? 2 : 3))
        || (potIsMassive && startingTier === "premium")
      );
    const postflopShove = state.street !== "preflop"
      && (
        (
          criticallyShort
          && effectiveEquity >= potOdds + multiwayRiskPremium + 0.18
        )
        || (
          potIsMassive
          && effectiveEquity >= (opponents > 1 ? 0.9 : 0.82)
        )
      );
    if (
      legal.canAllIn
      && (preflopShove || postflopShove)
      && decisionRoll < Math.min(0.9, style.aggression + 0.08)
    ) {
      return { type: "all-in" };
    }
    if (shouldRaise && decisionRoll >= style.slowPlayFrequency) {
      return { type: "raise", amount: botRaiseTarget(state, legal, style, random) };
    }
    if (
      effectiveEquity + style.callTolerance < potOdds + multiwayRiskPremium
      || (
        state.street === "preflop"
        && allInOpponents > 0
        && preflopStrength < (allInOpponents > 1 ? 4 : 3)
      )
    ) {
      return { type: "fold" };
    }
    return legal.canCall ? { type: "call" } : { type: "fold" };
  }

  if (
    state.street === "preflop"
    && startingTier === "trash"
    && !bluffWindow
  ) {
    return legal.canCheck ? { type: "check" } : { type: "fold" };
  }
  if (shouldRaise && decisionRoll >= style.slowPlayFrequency) {
    return { type: "raise", amount: botRaiseTarget(state, legal, style, random) };
  }
  return legal.canCheck ? { type: "check" } : { type: "fold" };
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
  if (!isStakesTier(state.tier)) {
    // Games created before stakes tiers existed (stale in-memory dev state,
    // or Supabase rows persisted before this field was added) have no tier
    // -- fall back to the cheapest tier rather than letting
    // TIER_CONFIG[undefined] crash every reader downstream.
    state.tier = CHEAPEST_TIER;
  }
  // Hands dealt before rake existed carry no rake figure; treat them as unraked.
  if (!Number.isFinite(state.rake)) state.rake = 0;
  state.seats.forEach((seat) => {
    if (!Number.isInteger(seat.timeCardsRemaining)) {
      seat.timeCardsRemaining = seat.isHuman ? STARTING_TIME_CARDS : 0;
    }
    // Tables dealt before avatars existed have seats with no avatar at all,
    // which reaches the renderer as undefined and takes the whole page down.
    // Bots recover their own face by position rather than every seat
    // collapsing to one default, which is most of what makes a table look
    // occupied.
    if (!seat.avatarCosmetic) {
      seat.avatarCosmetic = seat.isHuman ? DEFAULT_AVATAR_COSMETIC : botAvatarFor(seat.position);
    }
    // Hands in flight before VPIP existed have no opinion either way; treat
    // as false rather than let `undefined` leak into a stats comparison.
    seat.vpip = Boolean(seat.vpip);
    if (seat.actedAtBet !== null && !Number.isFinite(seat.actedAtBet)) {
      seat.actedAtBet = seat.acted ? seat.streetBet : null;
    } else if (seat.actedAtBet === undefined) {
      // Forward compatibility for persisted hands created before betting
      // reopening tracked the amount each player had already faced.
      seat.actedAtBet = seat.acted ? seat.streetBet : null;
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

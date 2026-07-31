import type { StakesTier } from "./tiers";

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8"
  | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type SeatStatus = "active" | "folded" | "all-in" | "out";
export type GameStatus = "playing" | "complete";
export type BotPersonality = "MANIAC" | "ROCK" | "CALLING_STATION";

export interface Seat {
  id: string;
  name: string;
  initials: string;
  accent: string;
  avatarUrl: string | null;
  avatarPreset: string;
  /** Equipped avatar cosmetic id, so opponents render the character they bought. */
  avatarCosmetic: string;
  position: number;
  isHuman: boolean;
  /** The session token of the human seated here; null for an open/bot seat. Never sent to clients. */
  ownerToken: string | null;
  personality: BotPersonality | null;
  stack: number;
  status: SeatStatus;
  holeCards: Card[];
  streetBet: number;
  committed: number;
  acted: boolean;
  /**
   * The table bet this seat was facing when it last acted this street.
   * Needed for the no-limit reopening rule: one short all-in does not let a
   * player who already acted raise again, while cumulative short all-ins
   * totaling a full raise do.
   */
  actedAtBet: number | null;
  lastAction: string | null;
  /** Consumable 20-second extensions. Human players receive three when they take a seat. */
  timeCardsRemaining: number;
  /**
   * Turns in a row this seat let the clock resolve for it.
   *
   * Counts only a human's expired clock, and only consecutively: any
   * deliberate action resets it to zero, because a player who is acting is
   * present by definition. Persisted across hands on purpose -- somebody who
   * has walked away misses one turn per hand, so a per-hand counter would
   * never reach a threshold no matter how long they were gone.
   */
  missedTurns: number;
  /**
   * Voluntarily Put In Pot: true once this seat calls, raises or goes all-in
   * preflop of its own choice. Posting a blind does not set it -- that's the
   * whole reason VPIP is worth tracking, since it separates a hand a player
   * chose to play from one they only had chips in because they were the
   * blind. Reset at the start of every hand; read once, at showdown/award,
   * to record that hand's stat and never touched again until the next deal.
   */
  vpip: boolean;
}

export interface Winner {
  seatId: string;
  name: string;
  amount: number;
  hand: string;
  /**
   * The exact five cards that won, so the table can show why.
   *
   * Null unless the hand reached a genuine showdown. An uncontested pot is
   * won without showing anything, and publishing the winner's best five there
   * would expose hole cards that every other player folded without seeing --
   * the same rule the handLabel on a seat follows.
   */
  bestFive: Card[] | null;
}

export interface LogEntry {
  id: string;
  text: string;
  at: string;
  kind: "deal" | "action" | "win";
}

export interface GameState {
  id: string;
  /** Session token of whoever created the table; kept for auditing only, never an authorization check. */
  hostToken: string;
  isPrivate: boolean;
  /** Shareable join code for private tables; null for public (quick-play) tables. */
  roomCode: string | null;
  /** Stakes level; fixes this table's blinds and every seat's buy-in bounds. */
  tier: StakesTier;
  /** Chips removed from the most recent hand's pot as rake; 0 when the pot was too small, or when the hand ended before a flop. */
  rake: number;
  version: number;
  status: GameStatus;
  street: Street;
  handNumber: number;
  buttonPosition: number;
  smallBlind: number;
  bigBlind: number;
  currentPlayer: number | null;
  /** When the current player's turn began. */
  turnStartedAt: string | null;
  /** Server-authored deadline for the current human or bot action. */
  turnDeadlineAt: string | null;
  /**
   * When a completed hand should be replaced by the next one. Null while a
   * hand is in play, and null on a table that cannot continue -- the two
   * cases where nothing should be scheduled at all. Written by the engine
   * and honoured by the same seated-browser clock that resolves turns.
   */
  nextHandAt: string | null;
  currentBet: number;
  minRaise: number;
  pot: number;
  deck: Card[];
  community: Card[];
  seats: Seat[];
  winners: Winner[];
  log: LogEntry[];
  message: string;
  createdAt: string;
  updatedAt: string;
}

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; amount: number }
  | { type: "all-in" }
  | { type: "use-time-card" }
  | { type: "next-hand" }
  | { type: "leave-seat" }
  | { type: "rebuy"; amount: number };

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  canAllIn: boolean;
  toCall: number;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface PublicSeat extends Omit<Seat, "holeCards" | "ownerToken"> {
  holeCards: Array<Card | null>;
  /** Beginner-facing made-hand label, populated only for the requesting player's seat. */
  handLabel: string | null;
  isDealer: boolean;
  isCurrent: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /** Whether the requesting session owns this seat. Never expose the raw ownerToken to any client. */
  isMine: boolean;
  /** True for a bot-controlled seat that any player may claim via quick play or a room code. */
  isOpen: boolean;
}

export interface GameSnapshot
  extends Omit<GameState, "deck" | "hostToken" | "seats"> {
  seats: PublicSeat[];
  legalActions: LegalActions | null;
  /** True when the requesting session owns a seat at this table. */
  isSeated: boolean;
}

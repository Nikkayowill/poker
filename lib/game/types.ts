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
  lastAction: string | null;
  /** Consumable 20-second extensions. Human players receive three when they take a seat. */
  timeCardsRemaining: number;
}

export interface Winner {
  seatId: string;
  name: string;
  amount: number;
  hand: string;
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

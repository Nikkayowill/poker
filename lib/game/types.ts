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

export interface Seat {
  id: string;
  name: string;
  initials: string;
  accent: string;
  avatarUrl: string | null;
  avatarPreset: string;
  position: number;
  isHuman: boolean;
  stack: number;
  status: SeatStatus;
  holeCards: Card[];
  streetBet: number;
  committed: number;
  acted: boolean;
  lastAction: string | null;
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
  ownerToken: string;
  version: number;
  status: GameStatus;
  street: Street;
  handNumber: number;
  buttonPosition: number;
  smallBlind: number;
  bigBlind: number;
  currentPlayer: number | null;
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
  | { type: "next-hand" };

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

export interface PublicSeat extends Omit<Seat, "holeCards"> {
  holeCards: Array<Card | null>;
  isDealer: boolean;
  isCurrent: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
}

export interface GameSnapshot
  extends Omit<GameState, "deck" | "ownerToken" | "seats"> {
  seats: PublicSeat[];
  legalActions: LegalActions | null;
}

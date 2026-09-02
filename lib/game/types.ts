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
/**
 * "complete" is a *between-hands* rest state, not a close: dealNextHandIfDue
 * deals the next hand the moment it sees one. "archived" is the only status
 * that is actually terminal (lib/server/game-store.ts's archiveStaleGames
 * is the one writer), and every place that gates an action on the table
 * being live checks `=== "playing"` positively rather than `!== "complete"`,
 * which is what lets archived slot in as a third status with no change to
 * those guards.
 */
export type GameStatus = "playing" | "complete" | "archived";
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
  /**
   * Equipped card back id, drawn on this seat's hidden cards.
   *
   * Per seat rather than per table, which is not how a real deck works and is
   * deliberate: the catalog sells these as "seen by the whole table, on every
   * hidden hand", and a single shared deck would mean the item is only ever
   * visible to the one person who did not buy it. Six backs at one table is
   * the price of the thing being worth owning.
   */
  cardBackCosmetic: string;
  /**
   * Denomination -> equipped chip-design id, drawn on this seat's own bet and
   * standing-stack chips (never the shared pot mound, which has no single
   * owner). Optional: absent/missing denominations just draw the house
   * default, and bot seats never set this at all -- see
   * `lib/cosmetics/catalog.ts`'s `EquippedCosmetics.chipDesigns`.
   */
  chipDesigns?: Partial<Record<number, string>>;
  /**
   * Shows "Admin" above this seat, the way the dealer carries her own label.
   * Copied from the profile when a human sits and cleared when a bot takes
   * the chair. Optional so tables dealt before it existed stay readable.
   */
  adminBadge?: boolean;
  position: number;
  isHuman: boolean;
  /** The session token of the human seated here; null for an open/bot seat. Never sent to clients. */
  ownerToken: string | null;
  /**
   * The profile id of a *registered* human in this seat, and the only piece of
   * durable identity that leaves the server with a seat.
   *
   * Exists so one player can act on another (adding a friend is the first
   * caller) without the client ever holding `ownerToken`, which is the
   * session itself and would be a full account takeover if it shipped.
   *
   * Null for bots, open seats, and guests. Guests are excluded on purpose
   * rather than incidentally: a guest profile dies with its cookie, so a
   * friend request addressed to one creates a row nobody can ever accept.
   * That mirrors the registered-only gate on `/api/friends`.
   *
   * Persisted rather than resolved on read, for the same reason `botIdentity`
   * is: the read path is `toSnapshot`, which is pure and synchronous, and
   * turning a token into a profile means an `ensureProfile` call that both
   * writes and runs once per seat per fetch.
   *
   * Set once at seat time, so a guest who registers mid-session keeps a null
   * here until they next take a seat.
   */
  profileId: string | null;
  /**
   * Which entry of the bot identity pool this seat is currently wearing.
   *
   * Null on a human seat. Persisted rather than derived, which is the whole
   * point: a bot's face used to be recomputed from `position` on every load,
   * so a rotated identity was silently reverted by the next normalizeGameState;
   * the seat would show a new player for one request and then change back.
   * Tables written before rotation existed carry no value here and are
   * backfilled from `position`, which is the identity they were already
   * showing, so no live table changes its cast on deploy.
   */
  botIdentity: number | null;
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
  /**
   * Turns in a row this seat let the clock resolve for it.
   *
   * Counts only a human's expired clock, and only consecutively: any real
   * action resets it to zero, because a player who is acting is present by
   * definition. Persisted across hands on purpose, since somebody who has
   * walked away misses one turn per hand, so a per-hand counter would never
   * reach a threshold no matter how long they were gone.
   */
  missedTurns: number;
  /**
   * Voluntarily Put In Pot: true once this seat calls, raises or goes all-in
   * preflop of its own choice. Posting a blind does not set it; that's the
   * whole reason VPIP is worth tracking, since it separates a hand a player
   * chose to play from one they only had chips in because they were the
   * blind. Reset at the start of every hand; read once, at showdown/award,
   * to record that hand's stat and never touched again until the next deal.
   */
  vpip: boolean;
  /**
   * ISO timestamp before which an empty bot seat (`stack <= 0`, `!isHuman`)
   * must not be refilled; `null` means immediately eligible.
   *
   * Only ever set by a *healthy* bot voluntarily standing up between hands
   * (see `releaseBustedSeats` in `lib/game/engine.ts`). A bot that busts
   * from losing its stack is refilled the same hand it always was, exactly
   * as a real seat with no bankroll left is removed immediately. This is
   * what staggers a fresh bot's entry rather than an empty seat refilling
   * itself the instant it empties, without inventing a new occupancy state:
   * the seat renders exactly like any other `"out"` seat in the meantime.
   */
  reseatEligibleAt: string | null;
}

/**
 * Present only on a table that ends when the field is down to one funded
 * seat, rather than playing forever with bot backfill; null for every
 * ordinary cash table. Its presence, not a separate mode enum, is what
 * every tournament-aware branch in engine.ts checks.
 *
 * Two formats share this one shape: a 6-max Sit & Go (escalating blinds,
 * winner takes entryFee * 6) and a heads-up match (fixed blinds, no bots at
 * either seat, winner takes entryFee * 2). `format` is what tells them
 * apart -- setupHand only escalates blinds for `"sit_and_go"`, and both
 * `createTournamentGame`/`createHeadsUpGame` set every other field the same
 * way.
 *
 * Every tournament seat gets a real `profileId` unconditionally, guest or
 * not -- see createTournamentGame/createHeadsUpGame's own seat construction.
 * That's a deliberate exception to Seat.profileId's normal "guests are
 * excluded" rule (see that field's own comment): a guest can win either
 * format same as a registered player, and settlement has to be able to
 * credit them regardless.
 */
export interface TournamentState {
  format: "sit_and_go" | "heads_up";
  /** The Gold entry fee every seat paid; also this table's prize pool contribution per seat. */
  entryFee: number;
  /** Every seat's fixed starting stack -- always equal to entryFee, kept separate since they answer different questions. */
  startingStack: number;
  /**
   * Which BLIND_LEVELS entry is active right now. Only meaningful for
   * `"sit_and_go"` -- a heads-up match's blinds never escalate, so this
   * stays 0 for the whole match.
   *
   * Recomputed from handNumber at the top of every setupHand, never
   * incremented on its own, so it can never drift out of sync with the hand
   * it describes -- see lib/game/tournament.ts's blindLevelForHand.
   */
  blindLevel: number;
  /** The hand number on which only one funded seat remained; null while the table is still live. */
  finishedAtHand: number | null;
  /** The winning seat's profile id, set in the same pass that detects finishedAtHand. Null until the table is decided. */
  winnerProfileId: string | null;
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
   * would expose hole cards that every other player folded without seeing,
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
   * hand is in play, and null on a table that cannot continue: the two
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
  /** Non-null exactly for a Sit & Go or heads-up table; see TournamentState. */
  tournament: TournamentState | null;
}

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; amount: number }
  | { type: "all-in" }
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

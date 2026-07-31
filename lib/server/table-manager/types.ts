export type SeatId = 1 | 2 | 3 | 4 | 5 | 6;

export type TablePhase =
  | "WaitingForPlayers"
  | "Dealing"
  | "BettingRounds"
  | "Showdown"
  | "Payout"
  | "Cleanup"
  | "RestartCheck";

export type SeatLifecycleStatus =
  | "EMPTY"
  | "OCCUPIED"
  | "WAITING_FOR_NEXT_HAND"
  | "WAITING_FOR_EVICTION";

export interface PlayerObject {
  kind: "HUMAN";
  playerId: string;
  profileId: string;
  sessionToken: string;
  cashSessionId: string;
  displayName: string;
  sessionStartChips: number;
  currentChips: number;
  handsWonCount: number;
  connected: boolean;
}

export interface BotObject {
  kind: "BOT";
  botId: string;
  displayName: string;
  currentChips: number;
}

/**
 * The lifecycle layout is deliberately separate from cards and betting
 * fields. A seat can wait for cleanup without mutating an in-flight pot.
 */
export interface Seat {
  seatId: SeatId;
  player: PlayerObject | BotObject | null;
  status: SeatLifecycleStatus;
}

export interface QueuedHuman {
  player: PlayerObject;
  requestedAt: number;
  status: "WAITING_FOR_NEXT_HAND";
}

export interface TableTurn {
  seatId: SeatId;
  isHuman: boolean;
  deadlineAt: number;
}

export interface TimedEngineResult<TState> {
  state: TState;
  applied: boolean;
}

export interface TableEnginePort<TState, TAction, TPublicState> {
  isHandActive(state: TState): boolean;
  currentTurn(state: TState): TableTurn | null;
  applyHumanAction(
    state: TState,
    player: PlayerObject,
    action: TAction,
  ): TState;
  applyTimedAction(state: TState, now: number): TimedEngineResult<TState>;
  startNextHand(state: TState, humans: PlayerObject[]): TState;
  seatHuman(
    state: TState,
    seatId: SeatId,
    player: PlayerObject,
    waitForNextHand: boolean,
  ): TState;
  removeHuman(
    state: TState,
    seatId: SeatId,
    player: PlayerObject,
    handActive: boolean,
  ): TState;
  seatBot(state: TState, seatId: SeatId, bot: BotObject): TState;
  removeBot(state: TState, seatId: SeatId, bot: BotObject): TState;
  currentChips(state: TState, seatId: SeatId): number;
  winningSeatIds(state: TState): SeatId[];
  handKey(state: TState): string;
  /**
   * The monotonic version a broadcast announces. Separate from publicState
   * because TableManager is generic over TPublicState and so cannot reach
   * into it for a field; asking the engine keeps the wire envelope typed.
   */
  stateVersion(state: TState): number;
  publicState(state: TState, phase: TablePhase): TPublicState;
}

export interface TableCheckpointPort<TState> {
  schedule(state: TState): void;
  flush(): Promise<void>;
  halt(state: TState): Promise<void>;
  discard(): void;
}

export interface TableRoomEvent<TPublicState> {
  type: "TABLE_STATE_CHANGED" | "TABLE_HALTED";
  tableId: string;
  phase: TablePhase;
  /** Announced on the wire; see lib/game/table-channel.ts for the contract. */
  version: number;
  state: TPublicState | null;
}

export interface TableRoomStream<TPublicState> {
  open(): Promise<void>;
  publish(event: TableRoomEvent<TPublicState>): Promise<void>;
  close(): Promise<void>;
}

export interface SessionSettlement {
  cashSessionId: string;
  currentChips: number;
  handsWonCount: number;
  netEarnings: number;
  multiplier: 1 | 1.1 | 1.25 | 1.5;
  payout: number;
}

export interface SessionSettlementPort {
  settle(player: PlayerObject): Promise<SessionSettlement>;
}

export interface TableLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface TableManagerOptions<TState, TAction, TPublicState> {
  tableId: string;
  initialState: TState;
  seats: Seat[];
  engine: TableEnginePort<TState, TAction, TPublicState>;
  checkpoints: TableCheckpointPort<TState>;
  stream: TableRoomStream<TPublicState>;
  settlements: SessionSettlementPort;
  createBot(seatId: SeatId): BotObject;
  onHalted(tableId: string): void;
  logger?: TableLogger;
  now?: () => number;
  showdownDelayMs?: number;
  payoutDelayMs?: number;
  restartDelayMs?: number;
}

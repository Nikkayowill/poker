import "server-only";
import { TimerRegistry } from "./timer-registry";
import type {
  BotObject,
  PlayerObject,
  QueuedHuman,
  Seat,
  SessionSettlement,
  TableLogger,
  TableManagerOptions,
  TablePhase,
} from "./types";

const MAX_SEATS = 6;
const MAX_TURN_RETRIES = 3;
const TURN_RETRY_MS = 250;

const consoleLogger: TableLogger = {
  info(message, context) {
    console.info(message, context ?? {});
  },
  error(message, error, context) {
    console.error(message, error, context ?? {});
  },
};

function isHuman(player: Seat["player"]): player is PlayerObject {
  return player?.kind === "HUMAN";
}

function isBot(player: Seat["player"]): player is BotObject {
  return player?.kind === "BOT";
}

/**
 * One serialized, event-driven owner for a six-max table.
 *
 * The manager performs no polling. Work happens only because an API/socket
 * event enters a public method or because one owned timeout fires.
 */
export class TableManager<TState, TAction, TPublicState> {
  readonly tableId: string;

  private state: TState;
  private phase: TablePhase = "WaitingForPlayers";
  private readonly seats: Seat[];
  private readonly queue: QueuedHuman[] = [];
  private readonly timers: TimerRegistry;
  private readonly logger: TableLogger;
  private readonly now: () => number;
  private readonly showdownDelayMs: number;
  private readonly payoutDelayMs: number;
  private readonly restartDelayMs: number;
  private eventTail: Promise<void> = Promise.resolve();
  private halted = false;
  private lastCountedHandKey: string | null = null;
  private turnRetryCount = 0;

  constructor(
    private readonly options: TableManagerOptions<TState, TAction, TPublicState>,
  ) {
    this.tableId = options.tableId;
    this.state = options.initialState;
    this.seats = options.seats.map((seat) => ({ ...seat }));
    this.logger = options.logger ?? consoleLogger;
    this.now = options.now ?? Date.now;
    this.showdownDelayMs = options.showdownDelayMs ?? 1_500;
    this.payoutDelayMs = options.payoutDelayMs ?? 1_000;
    this.restartDelayMs = options.restartDelayMs ?? 5_000;
    this.assertSixMaxLayout();
    this.timers = new TimerRegistry((name, error) => {
      this.logger.error("Table timer failed", error, {
        tableId: this.tableId,
        timer: name,
      });
    });
  }

  get currentPhase(): TablePhase {
    return this.phase;
  }

  get isHalted(): boolean {
    return this.halted;
  }

  get activeTimerCount(): number {
    return this.timers.size;
  }

  seatLayout(): Seat[] {
    return this.seats.map((seat) => ({
      ...seat,
      player: seat.player ? { ...seat.player } : null,
    }));
  }

  queuedHumans(): QueuedHuman[] {
    return this.queue.map((entry) => ({
      ...entry,
      player: { ...entry.player },
    }));
  }

  snapshotState(): TState {
    return this.state;
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      this.assertRunning();
      await this.options.stream.open();
      this.syncHumanChips();

      if (this.humans().length === 0) {
        await this.hardCleanup("started without a human");
        return;
      }

      if (this.options.engine.isHandActive(this.state)) {
        await this.transition("BettingRounds", "restored active hand");
        this.scheduleCurrentTurn();
      } else {
        await this.enterRestartCheck("table started between hands");
      }
    });
  }

  handleHumanAction(playerId: string, action: TAction): Promise<TState> {
    return this.enqueue(async () => {
      this.assertRunning();
      const seat = this.findHumanSeat(playerId);
      if (!seat || !isHuman(seat.player)) throw new Error("Player is not seated.");
      if (this.phase !== "BettingRounds") throw new Error("No betting round is active.");

      this.timers.clear("turn");
      this.state = this.options.engine.applyHumanAction(this.state, seat.player, action);
      this.syncHumanChips();
      await this.stateChanged();
      await this.afterEngineEvent("human action");
      return this.state;
    });
  }

  handleHumanJoinRoom(player: PlayerObject): Promise<Seat | QueuedHuman> {
    return this.enqueue(async () => {
      this.assertRunning();
      const existing = this.findHumanSeat(player.playerId);
      if (existing) return { ...existing, player: existing.player ? { ...existing.player } : null };

      const queued = this.queue.find((entry) => entry.player.playerId === player.playerId);
      if (queued) return { ...queued, player: { ...queued.player } };

      const empty = this.seats.find((seat) => seat.status === "EMPTY" && seat.player === null);
      if (empty) {
        const waitForNextHand = this.options.engine.isHandActive(this.state);
        this.state = this.options.engine.seatHuman(
          this.state,
          empty.seatId,
          player,
          waitForNextHand,
        );
        empty.player = player;
        empty.status = waitForNextHand ? "WAITING_FOR_NEXT_HAND" : "OCCUPIED";
        await this.stateChanged();
        return { ...empty, player: { ...player } };
      }

      const botSeat = this.seats.find(
        (seat) => seat.status === "OCCUPIED" && isBot(seat.player),
      );
      if (!botSeat || !isBot(botSeat.player)) throw new Error("This table is full.");

      if (!this.options.engine.isHandActive(this.state)) {
        this.state = this.options.engine.removeBot(this.state, botSeat.seatId, botSeat.player);
        this.state = this.options.engine.seatHuman(
          this.state,
          botSeat.seatId,
          player,
          false,
        );
        botSeat.player = player;
        botSeat.status = "OCCUPIED";
        await this.stateChanged();
        return { ...botSeat, player: { ...player } };
      }

      botSeat.status = "WAITING_FOR_EVICTION";
      const entry: QueuedHuman = {
        player,
        requestedAt: this.now(),
        status: "WAITING_FOR_NEXT_HAND",
      };
      this.queue.push(entry);
      await this.publishState();
      return { ...entry, player: { ...player } };
    });
  }

  handlePlayerDisconnect(playerId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.halted) return;
      const seat = this.findHumanSeat(playerId);
      if (!seat || !isHuman(seat.player)) return;
      seat.player.connected = false;

      const connectedHumans = this.humans().filter((player) => player.connected);
      if (connectedHumans.length === 0) {
        await this.hardCleanup("last human disconnected");
        return;
      }

      await this.handlePlayerLeaveInternal(seat, "player disconnected");
      if (this.options.engine.isHandActive(this.state)) {
        await this.transition("BettingRounds", "disconnected player removed");
        this.scheduleCurrentTurn();
      } else {
        await this.enterRestartCheck("player disconnected");
      }
    });
  }

  handlePlayerLeaveSession(playerId: string): Promise<SessionSettlement> {
    return this.enqueue(async () => {
      this.assertRunning();
      const seat = this.findHumanSeat(playerId);
      if (!seat || !isHuman(seat.player)) throw new Error("Player is not seated.");
      const settlement = await this.settlePlayer(seat.player);
      await this.removeHumanSeat(seat);

      if (this.humans().length === 0) {
        await this.hardCleanup("last human left");
      } else {
        await this.stateChanged();
        if (this.options.engine.isHandActive(this.state)) {
          await this.transition("BettingRounds", "player left active hand");
          this.scheduleCurrentTurn();
        } else {
          await this.enterRestartCheck("player left");
        }
      }
      return settlement;
    });
  }

  destroy(): Promise<void> {
    return this.enqueue(async () => {
      if (this.halted) return;
      await this.hardCleanup("manager destroyed");
    });
  }

  /**
   * Stops only this process's ownership after an optimistic checkpoint
   * conflict. Another manager is authoritative, so this path must not settle
   * players, mutate seats, or publish TABLE_HALTED.
   */
  relinquishOwnership(error: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (this.halted) return;
      this.halted = true;
      this.timers.clearAll();
      this.queue.length = 0;
      this.options.checkpoints.discard();
      this.logger.error("Table manager relinquished ownership", error, {
        tableId: this.tableId,
      });
      try {
        await this.options.stream.close();
      } catch (closeError) {
        this.logger.error("Could not close stream after ownership loss", closeError, {
          tableId: this.tableId,
        });
      } finally {
        this.options.onHalted(this.tableId);
      }
    });
  }

  private enqueue<T>(event: () => Promise<T>): Promise<T> {
    const result = this.eventTail.then(event);
    this.eventTail = result.then(
      () => undefined,
      (error) => {
        this.logger.error("Table event failed", error, { tableId: this.tableId });
      },
    );
    return result;
  }

  private async afterEngineEvent(reason: string): Promise<void> {
    if (this.options.engine.isHandActive(this.state)) {
      if (this.phase !== "BettingRounds") {
        await this.transition("BettingRounds", reason);
      }
      this.scheduleCurrentTurn();
      return;
    }
    await this.enterShowdown(reason);
  }

  private scheduleCurrentTurn(isRetry = false): void {
    if (!isRetry) this.turnRetryCount = 0;
    this.timers.clear("turn");
    const turn = this.options.engine.currentTurn(this.state);
    if (!turn || this.halted) return;
    const delayMs = isRetry ? TURN_RETRY_MS : turn.deadlineAt - this.now();
    this.timers.schedule("turn", delayMs, () =>
      this.enqueue(async () => {
        if (this.halted || this.phase !== "BettingRounds") return;
        const result = this.options.engine.applyTimedAction(this.state, this.now());
        if (!result.applied) {
          if (this.turnRetryCount >= MAX_TURN_RETRIES) {
            this.logger.error(
              "Turn deadline could not be applied after bounded retries",
              new Error("Timed action remained unapplied."),
              {
                tableId: this.tableId,
                seatId: turn.seatId,
                retries: this.turnRetryCount,
              },
            );
            return;
          }
          this.turnRetryCount += 1;
          this.scheduleCurrentTurn(true);
          return;
        }
        this.turnRetryCount = 0;
        this.state = result.state;
        this.syncHumanChips();
        await this.stateChanged();
        await this.afterEngineEvent("turn deadline");
      }),
    );
  }

  private async enterShowdown(reason: string): Promise<void> {
    this.timers.clear("turn");
    this.countHandWinnersOnce();
    await this.transition("Showdown", reason);
    this.timers.schedule("showdown", this.showdownDelayMs, () =>
      this.enqueue(async () => {
        if (this.halted) return;
        await this.transition("Payout", "showdown display completed");
        this.timers.schedule("payout", this.payoutDelayMs, () =>
          this.enqueue(async () => {
            if (this.halted) return;
            await this.transition("Cleanup", "payout display completed");
            await this.executeDeferredBotEvictions();
            await this.enterRestartCheck("cleanup completed");
          }),
        );
      }),
    );
  }

  private async enterRestartCheck(reason: string): Promise<void> {
    if (this.halted) return;
    this.timers.clear("turn");
    await this.transition("RestartCheck", reason);
    await this.evictBustedHumans();

    const fundedHumans = this.humans().filter((player) => player.currentChips > 0);
    if (fundedHumans.length === 0) {
      await this.hardCleanup("restart check found no funded humans");
      return;
    }

    if (fundedHumans.length === 1) await this.fillEmptySeatsWithBots();
    this.timers.schedule("restart", this.restartDelayMs, () =>
      this.enqueue(async () => {
        if (this.halted) return;
        const humans = this.humans().filter((player) => player.currentChips > 0);
        if (humans.length === 0) {
          await this.hardCleanup("restart timer found no funded humans");
          return;
        }
        await this.transition("Dealing", "restart countdown completed");
        this.state = this.options.engine.startNextHand(this.state, humans);
        this.seats.forEach((seat) => {
          if (seat.player) seat.status = "OCCUPIED";
        });
        this.syncHumanChips();
        await this.stateChanged();
        await this.transition("BettingRounds", "cards dealt");
        this.scheduleCurrentTurn();
      }),
    );
  }

  private async executeDeferredBotEvictions(): Promise<void> {
    const waitingBots = this.seats
      .filter((seat) => seat.status === "WAITING_FOR_EVICTION" && isBot(seat.player))
      .sort((left, right) => left.seatId - right.seatId);
    this.queue.sort((left, right) => left.requestedAt - right.requestedAt);
    const waitingHumans = this.queue.splice(0, waitingBots.length);

    for (let index = 0; index < waitingHumans.length; index += 1) {
      const seat = waitingBots[index];
      const queued = waitingHumans[index];
      if (!seat || !queued || !isBot(seat.player)) continue;
      this.state = this.options.engine.removeBot(this.state, seat.seatId, seat.player);
      this.state = this.options.engine.seatHuman(
        this.state,
        seat.seatId,
        queued.player,
        false,
      );
      seat.player = queued.player;
      seat.status = "OCCUPIED";
    }
    if (waitingHumans.length > 0) await this.stateChanged();
  }

  private async fillEmptySeatsWithBots(): Promise<void> {
    let changed = false;
    for (const seat of this.seats) {
      if (seat.player !== null || seat.status !== "EMPTY") continue;
      const bot = this.options.createBot(seat.seatId);
      this.state = this.options.engine.seatBot(this.state, seat.seatId, bot);
      seat.player = bot;
      seat.status = "OCCUPIED";
      changed = true;
    }
    if (changed) await this.stateChanged();
  }

  private async evictBustedHumans(): Promise<void> {
    const bustedSeats = this.seats.filter(
      (seat) => isHuman(seat.player) && seat.player.currentChips <= 0,
    );
    for (const seat of bustedSeats) {
      if (!isHuman(seat.player)) continue;
      const player = seat.player;
      try {
        await this.settlePlayer(player);
      } catch (error) {
        this.logger.error("Could not settle busted player", error, {
          tableId: this.tableId,
          playerId: player.playerId,
          cashSessionId: player.cashSessionId,
        });
      }
      await this.removeHumanSeat(seat);
    }
    if (bustedSeats.length > 0) await this.stateChanged();
  }

  private async handlePlayerLeaveInternal(seat: Seat, reason: string): Promise<void> {
    if (!isHuman(seat.player)) return;
    await this.settlePlayer(seat.player).catch((error) => {
      this.logger.error("Could not settle disconnected player", error, {
        tableId: this.tableId,
        playerId: seat.player && isHuman(seat.player) ? seat.player.playerId : null,
        reason,
      });
    });
    await this.removeHumanSeat(seat);
    await this.stateChanged();
  }

  private async removeHumanSeat(seat: Seat): Promise<void> {
    if (!isHuman(seat.player)) return;
    const player = seat.player;
    this.state = this.options.engine.removeHuman(
      this.state,
      seat.seatId,
      player,
      this.options.engine.isHandActive(this.state),
    );
    seat.player = null;
    seat.status = "EMPTY";
  }

  private async settlePlayer(player: PlayerObject): Promise<SessionSettlement> {
    player.currentChips = this.currentChipsForPlayer(player.playerId);
    try {
      return await this.options.settlements.settle(player);
    } catch (error) {
      this.logger.error("Cash-game session settlement failed", error, {
        tableId: this.tableId,
        playerId: player.playerId,
        cashSessionId: player.cashSessionId,
      });
      throw error;
    }
  }

  private async hardCleanup(reason: string): Promise<void> {
    if (this.halted) return;
    this.halted = true;
    this.timers.clearAll();

    const humans = this.humans();
    const settlements = await Promise.allSettled(
      humans.map((player) => this.settlePlayer(player)),
    );
    settlements.forEach((result, index) => {
      if (result.status === "rejected") {
        this.logger.error("Hard cleanup settlement failed", result.reason, {
          tableId: this.tableId,
          playerId: humans[index]?.playerId,
        });
      }
    });

    for (const seat of this.seats) {
      if (isBot(seat.player)) {
        this.state = this.options.engine.removeBot(this.state, seat.seatId, seat.player);
      } else if (isHuman(seat.player)) {
        this.state = this.options.engine.removeHuman(
          this.state,
          seat.seatId,
          seat.player,
          false,
        );
      }
      seat.player = null;
      seat.status = "EMPTY";
    }
    this.queue.length = 0;

    try {
      await this.options.checkpoints.halt(this.state);
      await this.options.stream.publish({
        type: "TABLE_HALTED",
        tableId: this.tableId,
        phase: "RestartCheck",
        state: null,
      });
    } catch (error) {
      this.logger.error("Could not publish final table cleanup", error, {
        tableId: this.tableId,
        reason,
      });
    } finally {
      this.options.checkpoints.discard();
      await this.options.stream.close().catch((error) => {
        this.logger.error("Could not close table stream", error, {
          tableId: this.tableId,
        });
      });
      this.options.onHalted(this.tableId);
    }
  }

  private syncHumanChips(): void {
    for (const seat of this.seats) {
      if (isHuman(seat.player)) {
        seat.player.currentChips = this.options.engine.currentChips(this.state, seat.seatId);
      }
    }
  }

  private countHandWinnersOnce(): void {
    const handKey = this.options.engine.handKey(this.state);
    if (this.lastCountedHandKey === handKey) return;
    this.lastCountedHandKey = handKey;
    const winners = new Set(this.options.engine.winningSeatIds(this.state));
    for (const seat of this.seats) {
      if (winners.has(seat.seatId) && isHuman(seat.player)) {
        seat.player.handsWonCount += 1;
      }
    }
  }

  private async stateChanged(): Promise<void> {
    this.options.checkpoints.schedule(this.state);
    await this.publishState();
  }

  private async transition(phase: TablePhase, reason: string): Promise<void> {
    this.phase = phase;
    this.logger.info("Table phase transition", {
      tableId: this.tableId,
      phase,
      reason,
    });
    await this.publishState();
  }

  private publishState(): Promise<void> {
    return this.options.stream.publish({
      type: "TABLE_STATE_CHANGED",
      tableId: this.tableId,
      phase: this.phase,
      state: this.options.engine.publicState(this.state, this.phase),
    });
  }

  private humans(): PlayerObject[] {
    return this.seats.flatMap((seat) => isHuman(seat.player) ? [seat.player] : []);
  }

  private findHumanSeat(playerId: string): Seat | undefined {
    return this.seats.find(
      (seat) => isHuman(seat.player) && seat.player.playerId === playerId,
    );
  }

  private currentChipsForPlayer(playerId: string): number {
    const seat = this.findHumanSeat(playerId);
    if (!seat) return 0;
    return this.options.engine.currentChips(this.state, seat.seatId);
  }

  private assertRunning(): void {
    if (this.halted) throw new Error("This table has been halted.");
  }

  private assertSixMaxLayout(): void {
    if (this.seats.length !== MAX_SEATS) {
      throw new Error("A River Room table must contain exactly six seats.");
    }
    const ids = this.seats.map((seat) => seat.seatId);
    if (new Set(ids).size !== MAX_SEATS || ids.some((id) => id < 1 || id > MAX_SEATS)) {
      throw new Error("Seat IDs must be unique integers from 1 through 6.");
    }
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableManager } from "./table-manager";
import type {
  BotObject,
  PlayerObject,
  Seat,
  SeatId,
  TableEnginePort,
  TableManagerOptions,
  TablePhase,
} from "./types";

interface FakeState {
  handActive: boolean;
  hand: number;
  timedActions: number;
  chips: Record<number, number>;
  winners: SeatId[];
  turn: {
    seatId: SeatId;
    deadlineAt: number;
  } | null;
}

type FakeAction = "END_HAND" | "CHECK";

function human(id: string, chips = 1_000): PlayerObject {
  return {
    kind: "HUMAN",
    playerId: id,
    profileId: `profile-${id}`,
    sessionToken: `token-${id}`,
    cashSessionId: `session-${id}`,
    displayName: id,
    sessionStartChips: chips,
    currentChips: chips,
    handsWonCount: 0,
    connected: true,
  };
}

function bot(id: number): BotObject {
  return {
    kind: "BOT",
    botId: `bot-${id}`,
    displayName: `Bot ${id}`,
    currentChips: 1_000,
  };
}

function emptySeats(): Seat[] {
  return ([1, 2, 3, 4, 5, 6] as SeatId[]).map((seatId) => ({
    seatId,
    player: null,
    status: "EMPTY",
  }));
}

function state(handActive = false): FakeState {
  return {
    handActive,
    hand: 1,
    timedActions: 0,
    chips: {},
    winners: [],
    turn: handActive
      ? {
          seatId: 1,
          deadlineAt: Date.now() + 30_000,
        }
      : null,
  };
}

const engine: TableEnginePort<FakeState, FakeAction, FakeState & { phase: TablePhase }> = {
  isHandActive: (value) => value.handActive,
  currentTurn: (value) =>
    value.turn
      ? {
          ...value.turn,
          isHuman: true,
        }
      : null,
  applyHumanAction(value, _player, action) {
    return {
      ...value,
      handActive: action !== "END_HAND",
      turn: action === "END_HAND" ? null : value.turn,
    };
  },
  applyTimedAction(value) {
    return {
      applied: true,
      state: {
        ...value,
        handActive: false,
        timedActions: value.timedActions + 1,
        turn: null,
      },
    };
  },
  startNextHand(value) {
    return {
      ...value,
      handActive: true,
      hand: value.hand + 1,
      turn: {
        seatId: 1,
        deadlineAt: Date.now() + 30_000,
      },
    };
  },
  seatHuman(value, seatId, player) {
    return {
      ...value,
      chips: {
        ...value.chips,
        [seatId]: player.currentChips,
      },
    };
  },
  removeHuman(value, seatId) {
    const chips = { ...value.chips };
    delete chips[seatId];
    return { ...value, chips };
  },
  seatBot(value, seatId, player) {
    return {
      ...value,
      chips: {
        ...value.chips,
        [seatId]: player.currentChips,
      },
    };
  },
  removeBot(value, seatId) {
    const chips = { ...value.chips };
    delete chips[seatId];
    return { ...value, chips };
  },
  currentChips: (value, seatId) => value.chips[seatId] ?? 0,
  winningSeatIds: (value) => value.winners,
  handKey: (value) => String(value.hand),
  stateVersion: (value) => value.hand,
  publicState: (value, phase) => ({ ...value, phase }),
};

function createManager(
  seats: Seat[],
  initialState: FakeState,
  overrides: Partial<
    TableManagerOptions<FakeState, FakeAction, FakeState & { phase: TablePhase }>
  > = {},
) {
  const publish = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const onHalted = vi.fn();
  const settle = vi.fn(async (player: PlayerObject) => ({
    cashSessionId: player.cashSessionId,
    currentChips: player.currentChips,
    handsWonCount: player.handsWonCount,
    netEarnings: player.currentChips - player.sessionStartChips,
    multiplier: 1 as const,
    payout: player.currentChips,
  }));

  const manager = new TableManager({
    tableId: "table-1",
    initialState,
    seats,
    engine,
    checkpoints: {
      schedule: vi.fn(),
      flush: vi.fn(async () => undefined),
      halt: vi.fn(async () => undefined),
      discard: vi.fn(),
    },
    stream: {
      open: vi.fn(async () => undefined),
      publish,
      close,
    },
    settlements: { settle },
    createBot: (seatId) => bot(seatId),
    onHalted,
    showdownDelayMs: 100,
    payoutDelayMs: 100,
    restartDelayMs: 100,
    ...overrides,
  });

  return { manager, close, onHalted, publish, settle };
}

describe("TableManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hard-stops a bot-only table without leaving timers or a stream alive", async () => {
    const seats = emptySeats();
    seats[0] = { seatId: 1, player: bot(1), status: "OCCUPIED" };
    const { manager, close, onHalted } = createManager(seats, state());

    await manager.start();

    expect(manager.isHalted).toBe(true);
    expect(manager.activeTimerCount).toBe(0);
    expect(manager.seatLayout().every((seat) => seat.status === "EMPTY")).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(onHalted).toHaveBeenCalledWith("table-1");
  });

  it("fires one timed action and never creates an interval-driven loop", async () => {
    const seats = emptySeats();
    const player = human("alice");
    seats[0] = { seatId: 1, player, status: "OCCUPIED" };
    seats[1] = { seatId: 2, player: bot(2), status: "OCCUPIED" };
    const initialState = state(true);
    initialState.chips = { 1: 1_000, 2: 1_000 };
    const { manager } = createManager(seats, initialState);

    await manager.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(manager.snapshotState().timedActions).toBe(1);
    expect(manager.currentPhase).toBe("Showdown");
    expect(manager.activeTimerCount).toBe(1);
    await manager.destroy();
    expect(manager.activeTimerCount).toBe(0);
  });

  it("bounds unapplied turn retries and leaves no zero-delay hot loop", async () => {
    const seats = emptySeats();
    const player = human("alice");
    seats[0] = { seatId: 1, player, status: "OCCUPIED" };
    seats[1] = { seatId: 2, player: bot(2), status: "OCCUPIED" };
    const initialState = state(true);
    initialState.chips = { 1: 1_000, 2: 1_000 };
    const applyTimedAction = vi.fn((value: FakeState) => ({
      state: value,
      applied: false,
    }));
    const { manager } = createManager(seats, initialState, {
      engine: { ...engine, applyTimedAction },
    });

    await manager.start();
    await vi.advanceTimersByTimeAsync(30_750);

    expect(applyTimedAction).toHaveBeenCalledTimes(4);
    expect(manager.activeTimerCount).toBe(0);
    await manager.destroy();
  });

  it("defers bot eviction until cleanup when a hand is active", async () => {
    const seats = emptySeats();
    for (let index = 0; index < 5; index += 1) {
      seats[index] = {
        seatId: (index + 1) as SeatId,
        player: human(`human-${index + 1}`),
        status: "OCCUPIED",
      };
    }
    seats[5] = { seatId: 6, player: bot(6), status: "OCCUPIED" };
    const initialState = state(true);
    initialState.chips = { 1: 1_000, 2: 1_000, 3: 1_000, 4: 1_000, 5: 1_000, 6: 1_000 };
    const { manager } = createManager(seats, initialState);

    await manager.start();
    const result = await manager.handleHumanJoinRoom(human("new-human"));

    expect("status" in result && result.status).toBe("WAITING_FOR_NEXT_HAND");
    expect(manager.seatLayout()[5]?.status).toBe("WAITING_FOR_EVICTION");

    await manager.handleHumanAction("human-1", "END_HAND");
    await vi.advanceTimersByTimeAsync(200);

    expect(manager.seatLayout()[5]?.player).toMatchObject({
      kind: "HUMAN",
      playerId: "new-human",
    });
    expect(manager.queuedHumans()).toHaveLength(0);
    await manager.destroy();
  });

  it("fills remaining seats with bots for exactly one funded human", async () => {
    const seats = emptySeats();
    const player = human("solo");
    seats[0] = { seatId: 1, player, status: "OCCUPIED" };
    const initialState = state();
    initialState.chips = { 1: 1_000 };
    const { manager } = createManager(seats, initialState);

    await manager.start();

    expect(manager.currentPhase).toBe("RestartCheck");
    expect(manager.seatLayout().filter((seat) => seat.player?.kind === "BOT")).toHaveLength(5);
    expect(manager.activeTimerCount).toBe(1);
    await manager.destroy();
  });

  it("continues RestartCheck when one busted-player settlement fails", async () => {
    const seats = emptySeats();
    seats[0] = { seatId: 1, player: human("busted", 0), status: "OCCUPIED" };
    seats[1] = { seatId: 2, player: human("funded"), status: "OCCUPIED" };
    const initialState = state();
    initialState.chips = { 1: 0, 2: 1_000 };
    const settle = vi.fn(async (player: PlayerObject) => {
      if (player.playerId === "busted") throw new Error("temporary payout failure");
      return {
        cashSessionId: player.cashSessionId,
        currentChips: player.currentChips,
        handsWonCount: player.handsWonCount,
        netEarnings: 0,
        multiplier: 1 as const,
        payout: player.currentChips,
      };
    });
    const { manager } = createManager(seats, initialState, {
      settlements: { settle },
    });

    await manager.start();

    expect(manager.currentPhase).toBe("RestartCheck");
    expect(manager.activeTimerCount).toBe(1);
    expect(manager.seatLayout().some((seat) => seat.player?.kind === "BOT")).toBe(true);
    await manager.destroy();
  });

  it("relinquishes ownership without settling or mutating player seats", async () => {
    const seats = emptySeats();
    const player = human("owner");
    seats[0] = { seatId: 1, player, status: "OCCUPIED" };
    const initialState = state(true);
    initialState.chips = { 1: 1_000 };
    const { manager, close, onHalted, settle } = createManager(seats, initialState);

    await manager.start();
    const before = manager.snapshotState();
    await manager.relinquishOwnership(new Error("lost checkpoint ownership"));

    expect(manager.isHalted).toBe(true);
    expect(manager.activeTimerCount).toBe(0);
    expect(manager.snapshotState()).toBe(before);
    expect(manager.seatLayout()[0]?.player).toMatchObject({ playerId: "owner" });
    expect(settle).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(onHalted).toHaveBeenCalledWith("table-1");
  });
});

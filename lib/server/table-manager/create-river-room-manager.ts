import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIER_CONFIG } from "@/lib/game/tiers";
import type { GameState, PlayerAction } from "@/lib/game/types";
import type { CashGameSession } from "@/lib/server/cash-game-session-store";
import { cashGameSessionSettlements } from "@/lib/server/cash-game-session-store";
import { TableManager } from "./table-manager";
import { DebouncedTableCheckpoint } from "./debounced-checkpoint";
import {
  riverRoomEngineAdapter,
  type RiverRoomPublicEventState,
} from "./river-room-engine-adapter";
import { createRiverRoomCheckpoint } from "./river-room-checkpoint";
import { NoopRoomStream, SupabaseRoomStream } from "./supabase-room-stream";
import { assertPersistentTableRuntime, type TableRegistry } from "./table-registry";
import type { BotObject, PlayerObject, Seat, SeatId } from "./types";

export interface CreateRiverRoomManagerOptions {
  state: GameState;
  sessions: CashGameSession[];
  registry: TableRegistry;
  supabase?: SupabaseClient | null;
  persistMemoryState?: (state: GameState) => Promise<void>;
  enforcePersistentRuntime?: boolean;
}

function createSeatLayout(
  state: GameState,
  sessions: CashGameSession[],
): Seat[] {
  if (state.seats.length !== 6) {
    throw new Error("A River Room table must have exactly six engine seats.");
  }
  const sessionByToken = new Map(
    sessions.map((session) => [session.sessionToken, session]),
  );
  return state.seats.map((engineSeat, index): Seat => {
    const seatId = (index + 1) as SeatId;
    if (engineSeat.isHuman && engineSeat.ownerToken) {
      const session = sessionByToken.get(engineSeat.ownerToken);
      if (!session) {
        throw new Error(
          `Human seat ${seatId} has no active cash-game accounting session.`,
        );
      }
      const player: PlayerObject = {
        kind: "HUMAN",
        playerId: engineSeat.ownerToken,
        profileId: session.profileId,
        sessionToken: engineSeat.ownerToken,
        cashSessionId: session.id,
        displayName: engineSeat.name,
        sessionStartChips: session.sessionStartChips,
        currentChips: engineSeat.stack,
        handsWonCount: session.handsWonCount,
        connected: true,
      };
      return { seatId, player, status: "OCCUPIED" };
    }
    const player: BotObject = {
      kind: "BOT",
      botId: engineSeat.id,
      displayName: engineSeat.name,
      currentChips: engineSeat.stack,
    };
    return { seatId, player, status: "OCCUPIED" };
  });
}

/**
 * Constructs and registers one table owner. Call this only from the
 * persistent game worker, never from a Next.js/Vercel request handler.
 */
export function createRiverRoomManager(
  options: CreateRiverRoomManagerOptions,
): TableManager<GameState, PlayerAction, RiverRoomPublicEventState> {
  if (options.enforcePersistentRuntime !== false) {
    assertPersistentTableRuntime();
  }
  let manager: TableManager<
    GameState,
    PlayerAction,
    RiverRoomPublicEventState
  > | null = null;
  const checkpoint = options.supabase
    ? createRiverRoomCheckpoint(
        options.supabase,
        options.state.version,
        2_000,
        (error) => {
          void manager?.relinquishOwnership(error);
        },
      )
    : new DebouncedTableCheckpoint<GameState>({
        cloneState: structuredClone,
        write: options.persistMemoryState ?? (async () => undefined),
        onError(error) {
          console.error("table.memory_checkpoint_failed", error);
        },
      });
  const stream = options.supabase
    ? new SupabaseRoomStream<RiverRoomPublicEventState>(
        options.supabase,
        options.state.id,
      )
    : new NoopRoomStream<RiverRoomPublicEventState>();

  manager = new TableManager({
    tableId: options.state.id,
    initialState: options.state,
    seats: createSeatLayout(options.state, options.sessions),
    engine: riverRoomEngineAdapter,
    checkpoints: checkpoint,
    stream,
    settlements: cashGameSessionSettlements,
    createBot(seatId) {
      return {
        kind: "BOT",
        botId: randomUUID(),
        displayName: `River Bot ${seatId}`,
        currentChips: TIER_CONFIG[options.state.tier].minBuyIn,
      };
    },
    onHalted(tableId) {
      options.registry.remove(tableId);
    },
  });
  options.registry.register(manager);
  return manager;
}

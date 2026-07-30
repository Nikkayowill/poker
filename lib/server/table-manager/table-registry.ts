import "server-only";
import type { GameState, PlayerAction } from "@/lib/game/types";
import type { TableManager } from "./table-manager";
import type { RiverRoomPublicEventState } from "./river-room-engine-adapter";

export type RiverRoomTableManager = TableManager<
  GameState,
  PlayerAction,
  RiverRoomPublicEventState
>;

/**
 * Process-local ownership registry for a persistent Node worker. A halted
 * table is deleted immediately, making the manager, bot data, and timer
 * registry unreachable and eligible for garbage collection.
 */
export class TableRegistry {
  private readonly tables = new Map<string, RiverRoomTableManager>();

  register(manager: RiverRoomTableManager): void {
    if (this.tables.has(manager.tableId)) {
      throw new Error(`Table ${manager.tableId} already has an owner.`);
    }
    this.tables.set(manager.tableId, manager);
  }

  get(tableId: string): RiverRoomTableManager | null {
    return this.tables.get(tableId) ?? null;
  }

  remove(tableId: string): void {
    this.tables.delete(tableId);
  }

  get activeTableCount(): number {
    return this.tables.size;
  }
}

/**
 * Vercel serverless/Fluid request handlers can be suspended or replaced
 * between requests. Long-lived table timers must run in a persistent Node
 * process, never inside a Next.js route module.
 */
export function assertPersistentTableRuntime(): void {
  if (process.env.VERCEL) {
    throw new Error(
      "TableManager requires a persistent Node worker; it cannot own timers inside Vercel functions.",
    );
  }
}

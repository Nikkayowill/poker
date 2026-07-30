import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameState } from "@/lib/game/types";
import { DebouncedTableCheckpoint } from "./debounced-checkpoint";

export class CheckpointOwnershipError extends Error {
  override name = "CheckpointOwnershipError";
}

/**
 * Creates a debounced, optimistic writer for one manager-owned aggregate.
 * The expected version moves only after the atomic RPC succeeds.
 */
export function createRiverRoomCheckpoint(
  client: SupabaseClient,
  initialVersion: number,
  delayMs = 2_000,
  onOwnershipLost?: (error: CheckpointOwnershipError) => void,
): DebouncedTableCheckpoint<GameState> {
  let persistedVersion = initialVersion;
  const loseOwnership = (error: CheckpointOwnershipError) => {
    checkpoint.discard();
    onOwnershipLost?.(error);
  };
  const checkpoint = new DebouncedTableCheckpoint<GameState>({
    delayMs,
    cloneState: structuredClone,
    async write(state) {
      if (state.version < persistedVersion) {
        const ownershipError = new CheckpointOwnershipError(
          `Table ${state.id} regressed from persisted version ${persistedVersion} to ${state.version}.`,
        );
        loseOwnership(ownershipError);
        throw ownershipError;
      }
      if (state.version === persistedVersion) return;
      const { error } = await client.rpc("checkpoint_game_state", {
        p_game_id: state.id,
        p_expected_version: persistedVersion,
        p_state: state,
      });
      if (error) {
        if (error.code === "40001") {
          const ownershipError = new CheckpointOwnershipError(
            `Table ${state.id} lost checkpoint ownership at version ${persistedVersion}.`,
          );
          loseOwnership(ownershipError);
          throw ownershipError;
        }
        throw new Error(`Could not checkpoint table ${state.id}: ${error.message}`);
      }
      persistedVersion = state.version;
    },
    onError(error) {
      console.error("table.checkpoint_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  return checkpoint;
}

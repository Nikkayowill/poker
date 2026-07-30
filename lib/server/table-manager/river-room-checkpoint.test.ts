import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/lib/game/engine";
import {
  CheckpointOwnershipError,
  createRiverRoomCheckpoint,
} from "./river-room-checkpoint";

describe("createRiverRoomCheckpoint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances the expected version only after a successful write", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const checkpoint = createRiverRoomCheckpoint(
      { rpc } as unknown as SupabaseClient,
      1,
    );
    const state = createGame(crypto.randomUUID(), "Owner");
    state.version = 3;

    checkpoint.schedule(state);
    await checkpoint.flush();

    expect(rpc).toHaveBeenCalledWith("checkpoint_game_state", {
      p_game_id: state.id,
      p_expected_version: 1,
      p_state: expect.objectContaining({ version: 3 }),
    });
  });

  it("discards the writer and reports optimistic ownership loss", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "40001", message: "conflict" },
    });
    const onOwnershipLost = vi.fn();
    const checkpoint = createRiverRoomCheckpoint(
      { rpc } as unknown as SupabaseClient,
      1,
      2_000,
      onOwnershipLost,
    );
    const state = createGame(crypto.randomUUID(), "Owner");
    state.version = 2;

    checkpoint.schedule(state);
    await expect(checkpoint.flush()).rejects.toBeInstanceOf(
      CheckpointOwnershipError,
    );
    checkpoint.schedule({ ...state, version: 3 });
    await vi.runAllTimersAsync();

    expect(onOwnershipLost).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects a local version regression without issuing an RPC", async () => {
    const rpc = vi.fn();
    const onOwnershipLost = vi.fn();
    const checkpoint = createRiverRoomCheckpoint(
      { rpc } as unknown as SupabaseClient,
      5,
      2_000,
      onOwnershipLost,
    );
    const state = createGame(crypto.randomUUID(), "Owner");
    state.version = 4;

    checkpoint.schedule(state);
    await expect(checkpoint.flush()).rejects.toThrow("regressed");

    expect(rpc).not.toHaveBeenCalled();
    expect(onOwnershipLost).toHaveBeenCalledOnce();
  });
});

import type {
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseRoomStream } from "./supabase-room-stream";

type SubscribeCallback = (
  status: "SUBSCRIBED" | "CHANNEL_ERROR" | "CLOSED",
  error?: Error,
) => void;

function channelWithSubscribe(
  subscribe: (callback: SubscribeCallback) => void,
): RealtimeChannel {
  return {
    subscribe(callback: SubscribeCallback) {
      subscribe(callback);
      return this;
    },
    send: vi.fn(async () => "ok" as RealtimeChannelSendResponse),
  } as unknown as RealtimeChannel;
}

describe("SupabaseRoomStream", () => {
  it("removes a failed channel before allowing a clean retry", async () => {
    const failed = channelWithSubscribe((callback) => {
      callback("CHANNEL_ERROR", new Error("socket failed"));
    });
    const healthy = channelWithSubscribe((callback) => {
      callback("SUBSCRIBED");
    });
    const channel = vi.fn()
      .mockReturnValueOnce(failed)
      .mockReturnValueOnce(healthy);
    const removeChannel = vi.fn(async () => "ok");
    const stream = new SupabaseRoomStream(
      { channel, removeChannel } as unknown as SupabaseClient,
      "table-1",
    );

    await expect(stream.open()).rejects.toThrow("socket failed");
    await stream.open();

    expect(removeChannel).toHaveBeenCalledWith(failed);
    expect(channel).toHaveBeenCalledTimes(2);
  });

  it("reports a close that races with an in-flight open", async () => {
    const subscriber: { current: SubscribeCallback | null } = { current: null };
    const pending = channelWithSubscribe((callback) => {
      subscriber.current = callback;
    });
    const removeChannel = vi.fn(async () => "ok");
    const stream = new SupabaseRoomStream(
      {
        channel: vi.fn(() => pending),
        removeChannel,
      } as unknown as SupabaseClient,
      "table-2",
    );

    const publish = stream.publish({
      type: "TABLE_STATE_CHANGED",
      tableId: "table-2",
      phase: "BettingRounds",
      state: { version: 2 },
    });
    await Promise.resolve();
    await stream.close();
    if (!subscriber.current) throw new Error("Expected a subscription callback.");
    subscriber.current("SUBSCRIBED");

    await expect(publish).rejects.toThrow("closed before publish");
    expect(removeChannel).toHaveBeenCalledWith(pending);
  });
});

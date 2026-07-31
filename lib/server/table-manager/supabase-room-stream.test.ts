import type {
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  TABLE_EVENT_VERSION,
  TABLE_STATE_CHANGED,
  parseTableStateChanged,
} from "@/lib/game/table-channel";
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
  it("publishes the flat envelope the browser parses, on the topic it listens to", async () => {
    const healthy = channelWithSubscribe((callback) => callback("SUBSCRIBED"));
    const channel = vi.fn(() => healthy);
    const stream = new SupabaseRoomStream(
      { channel, removeChannel: vi.fn(async () => "ok") } as unknown as SupabaseClient,
      "table-3",
    );

    await stream.publish({
      type: "TABLE_STATE_CHANGED",
      tableId: "table-3",
      phase: "BettingRounds",
      version: 11,
      state: { version: 11 },
    });

    expect(channel).toHaveBeenCalledWith("table:table-3", expect.anything());
    const sent = vi.mocked(healthy.send).mock.calls[0][0] as {
      event: string;
      payload: unknown;
    };
    expect(sent.event).toBe(TABLE_STATE_CHANGED);
    // Round-tripped through the real parser rather than compared field by
    // field: the point of the contract is that what this sends is what the
    // browser can read, so the browser's reader is the assertion.
    expect(parseTableStateChanged(sent.payload)).toMatchObject({
      v: TABLE_EVENT_VERSION,
      version: 11,
    });
    // Nesting the version under `state` is the shape this replaced; a plain
    // field-by-field check would still pass if it came back.
    expect(sent.payload).not.toHaveProperty("state");
  });

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
      version: 2,
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

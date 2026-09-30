import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { watchInvalidations } from "./watch-invalidations";

type StatusCallback = (status: string) => void;

/**
 * No jsdom in this repo, so `document` and `window` are hand-stubbed with just
 * the listener registry the watcher touches, and the Supabase channel is a
 * chainable fake that lets a test fire pings and status changes.
 */
function setup() {
  const documentListeners = new Map<string, Set<() => void>>();
  const windowListeners = new Map<string, Set<() => void>>();
  const add = (registry: Map<string, Set<() => void>>) => (event: string, handler: () => void) => {
    if (!registry.has(event)) registry.set(event, new Set());
    registry.get(event)!.add(handler);
  };
  const remove = (registry: Map<string, Set<() => void>>) => (event: string, handler: () => void) => {
    registry.get(event)?.delete(handler);
  };
  const doc = {
    hidden: false,
    addEventListener: add(documentListeners),
    removeEventListener: remove(documentListeners),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { addEventListener: add(windowListeners), removeEventListener: remove(windowListeners) });

  let ping: (() => void) | null = null;
  let onStatus: StatusCallback | null = null;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, handler: () => void) => {
      ping = handler;
      return channel;
    }),
    subscribe: vi.fn((callback: StatusCallback) => {
      onStatus = callback;
      return channel;
    }),
  };
  const supabase = {
    channel: vi.fn(() => channel as unknown as RealtimeChannel),
    removeChannel: vi.fn(),
  };

  return {
    supabase,
    channel,
    doc,
    sendPing: () => ping?.(),
    setStatus: (status: string) => onStatus?.(status),
    fire: (registry: "document" | "window", event: string) => {
      const source = registry === "document" ? documentListeners : windowListeners;
      for (const handler of [...(source.get(event) ?? [])]) handler();
    },
    listenerCount: () =>
      [...documentListeners.values(), ...windowListeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchInvalidations", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function start(refresh = vi.fn(async () => {})) {
    const stop = watchInvalidations({
      supabase: env.supabase,
      channelName: "sng:lobby",
      event: "SNG_STATE_CHANGED",
      refresh,
    });
    return { stop, refresh };
  }

  it("listens on the named channel and event", () => {
    start();
    expect(env.supabase.channel).toHaveBeenCalledWith("sng:lobby");
    expect(env.channel.on).toHaveBeenCalledWith("broadcast", { event: "SNG_STATE_CHANGED" }, expect.any(Function));
  });

  it("reads again on a ping", async () => {
    const { refresh } = start();
    env.sendPing();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads each time the channel reports SUBSCRIBED, so a missed gap is closed", async () => {
    const { refresh } = start();
    env.setStatus("CHANNEL_ERROR");
    env.setStatus("SUBSCRIBED");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);

    env.setStatus("TIMED_OUT");
    env.setStatus("SUBSCRIBED");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ignores a ping while the tab is hidden and reads on return", async () => {
    const { refresh } = start();
    env.doc.hidden = true;
    env.sendPing();
    await flush();
    expect(refresh).not.toHaveBeenCalled();

    env.doc.hidden = false;
    env.fire("document", "visibilitychange");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads when the device comes back online", async () => {
    const { refresh } = start();
    env.fire("window", "online");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("queues one more read instead of overlapping a read in flight", async () => {
    let release: () => void = () => {};
    const refresh = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    start(refresh);

    env.sendPing();
    env.sendPing();
    env.sendPing();
    expect(refresh).toHaveBeenCalledTimes(1);

    release();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);

    release();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("removes the channel and every listener when stopped, and stays quiet after", async () => {
    const { stop, refresh } = start();
    stop();
    expect(env.supabase.removeChannel).toHaveBeenCalledTimes(1);
    expect(env.listenerCount()).toBe(0);

    env.sendPing();
    env.setStatus("SUBSCRIBED");
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });
});

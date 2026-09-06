import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WriteBehindCache } from "./write-behind-cache";

describe("WriteBehindCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads back a value instantly, before any flush has run", () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const cache = new WriteBehindCache<string, number>({ flush });

    cache.set("a", 1);

    expect(cache.get("a")).toBe(1);
    expect(flush).not.toHaveBeenCalled();
  });

  it("coalesces a burst of rapid writes to one key into a single flush of the latest value", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const cache = new WriteBehindCache<string, number>({ flush, flushIntervalMs: 3000 });

    cache.set("a", 1);
    cache.set("a", 2);
    cache.set("a", 3);

    await vi.advanceTimersByTimeAsync(3000);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("a", 3);
  });

  it("does not schedule a second timer while one is already pending", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const cache = new WriteBehindCache<string, number>({ flush, flushIntervalMs: 3000 });

    cache.set("a", 1);
    await vi.advanceTimersByTimeAsync(1000);
    cache.set("a", 2); // should NOT push the flush out to 1000+3000ms

    await vi.advanceTimersByTimeAsync(2000);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("a", 2);
  });

  it("flushes independent keys independently, all in the same cycle", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const cache = new WriteBehindCache<string, number>({ flush, flushIntervalMs: 3000 });

    cache.set("a", 1);
    cache.set("b", 2);

    await vi.advanceTimersByTimeAsync(3000);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledWith("a", 1);
    expect(flush).toHaveBeenCalledWith("b", 2);
  });

  it("discard() drops a key from both memory and the dirty set without flushing it", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const cache = new WriteBehindCache<string, number>({ flush, flushIntervalMs: 3000 });

    cache.set("a", 1);
    cache.discard("a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.isDirty("a")).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);

    expect(flush).not.toHaveBeenCalled();
  });

  it("flushNow() bypasses the debounce window and flushes immediately", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const cache = new WriteBehindCache<string, number>({ flush, flushIntervalMs: 3000 });

    cache.set("a", 1);
    await cache.flushNow();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("a", 1);
  });

  it("re-dirties a key that failed to flush and retries it on the next cycle", async () => {
    const flush = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(undefined);
    const onFlushError = vi.fn();
    const cache = new WriteBehindCache<string, number>({ flush, onFlushError, flushIntervalMs: 3000 });

    cache.set("a", 1);
    await vi.advanceTimersByTimeAsync(3000);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(onFlushError).toHaveBeenCalledWith("a", 1, expect.any(Error));
    expect(cache.isDirty("a")).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(cache.isDirty("a")).toBe(false);
  });

  it("flushes the value current at flush time, not the value that was dirty when a concurrent set() landed mid-cycle", async () => {
    let resolveFlush!: () => void;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
    );
    const cache = new WriteBehindCache<string, number>({ flush, flushIntervalMs: 3000 });

    cache.set("a", 1);
    // Kick off the flush cycle without awaiting its completion.
    const cyclePromise = cache.flushNow();
    // While the first flush of "a" is still in flight, a new write lands.
    cache.set("a", 2);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("a", 1); // in-flight call saw the pre-update value

    resolveFlush();
    await cyclePromise;

    // The new write re-dirtied "a" rather than being silently dropped.
    expect(cache.isDirty("a")).toBe(true);
    expect(cache.get("a")).toBe(2);

    await vi.advanceTimersByTimeAsync(3000);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith("a", 2);
  });
});

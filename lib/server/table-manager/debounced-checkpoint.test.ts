import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebouncedTableCheckpoint } from "./debounced-checkpoint";

describe("DebouncedTableCheckpoint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst into the newest single write", async () => {
    const write = vi.fn(async () => undefined);
    const checkpoint = new DebouncedTableCheckpoint({
      delayMs: 1_000,
      cloneState: structuredClone,
      write,
      onError: vi.fn(),
    });

    checkpoint.schedule({ version: 1 });
    checkpoint.schedule({ version: 2 });
    checkpoint.schedule({ version: 3 });
    await vi.advanceTimersByTimeAsync(999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith({ version: 3 });
  });

  it("flushes immediately and leaves no delayed duplicate", async () => {
    const write = vi.fn(async () => undefined);
    const checkpoint = new DebouncedTableCheckpoint({
      cloneState: structuredClone,
      write,
      onError: vi.fn(),
    });

    checkpoint.schedule({ version: 7 });
    await checkpoint.flush();
    await vi.runAllTimersAsync();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ version: 7 });
  });

  it("writes the final halt snapshot and rejects future scheduling", async () => {
    const write = vi.fn(async () => undefined);
    const checkpoint = new DebouncedTableCheckpoint({
      cloneState: structuredClone,
      write,
      onError: vi.fn(),
    });

    checkpoint.schedule({ version: 1 });
    await checkpoint.halt({ version: 2 });
    checkpoint.schedule({ version: 3 });
    await vi.runAllTimersAsync();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ version: 2 });
  });
});

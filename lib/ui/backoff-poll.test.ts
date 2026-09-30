import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollDelayMs, startBackoffPoll } from "./backoff-poll";

function stubDom() {
  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (event: string, handler: () => void) => {
      if (event === "visibilitychange") listeners.add(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      if (event === "visibilitychange") listeners.delete(handler);
    },
  };
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", doc);
  return {
    listenerCount: () => listeners.size,
    setHidden: (hidden: boolean) => {
      doc.hidden = hidden;
      for (const handler of [...listeners]) handler();
    },
  };
}

describe("pollDelayMs", () => {
  it("slows down as the wait gets longer", () => {
    expect(pollDelayMs(0)).toBe(2_000);
    expect(pollDelayMs(9_999)).toBe(2_000);
    expect(pollDelayMs(10_000)).toBe(4_000);
    expect(pollDelayMs(59_999)).toBe(4_000);
    expect(pollDelayMs(60_000)).toBe(8_000);
  });
});

describe("startBackoffPoll", () => {
  let dom: ReturnType<typeof stubDom>;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = stubDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads right away, then backs off", () => {
    const load = vi.fn();
    const stop = startBackoffPoll(load);

    vi.advanceTimersByTime(0);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(load).toHaveBeenCalledTimes(6);

    vi.advanceTimersByTime(8_000);
    expect(load).toHaveBeenCalledTimes(8);
    stop();
  });

  it("does not load while the tab is hidden, and reads on return", () => {
    const load = vi.fn();
    const stop = startBackoffPoll(load);
    vi.advanceTimersByTime(0);
    expect(load).toHaveBeenCalledTimes(1);

    dom.setHidden(true);
    vi.advanceTimersByTime(20_000);
    expect(load).toHaveBeenCalledTimes(1);

    dom.setHidden(false);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not read again on a quick tab switch", () => {
    const load = vi.fn();
    const stop = startBackoffPoll(load);
    vi.advanceTimersByTime(0);
    dom.setHidden(true);
    dom.setHidden(false);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops cleanly", () => {
    const load = vi.fn();
    const stop = startBackoffPoll(load);
    vi.advanceTimersByTime(0);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(dom.listenerCount()).toBe(0);
  });
});

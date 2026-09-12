import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePoll } from "./visible-poll";

const INTERVAL = 15_000;

/**
 * No jsdom in this repo, so the two globals startVisiblePoll touches are
 * stubbed by hand: `window` is just the fake-timer host, and `document` is a
 * flippable `hidden` flag plus a listener registry.
 */
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
    doc,
    listenerCount: () => listeners.size,
    setHidden: (hidden: boolean) => {
      doc.hidden = hidden;
      for (const handler of [...listeners]) handler();
    },
  };
}

describe("startVisiblePoll", () => {
  let dom: ReturnType<typeof stubDom>;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = stubDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads once immediately, then on every interval while visible", () => {
    const load = vi.fn();
    startVisiblePoll(load, INTERVAL);

    expect(load).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(0);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(INTERVAL * 3);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("skips every tick while the tab is hidden", () => {
    const load = vi.fn();
    startVisiblePoll(load, INTERVAL);
    vi.advanceTimersByTime(0);
    expect(load).toHaveBeenCalledTimes(1);

    dom.doc.hidden = true;
    vi.advanceTimersByTime(INTERVAL * 10);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refreshes on the way back from a long absence", () => {
    const load = vi.fn();
    startVisiblePoll(load, INTERVAL);
    vi.advanceTimersByTime(0);

    dom.doc.hidden = true;
    vi.advanceTimersByTime(INTERVAL * 10);
    expect(load).toHaveBeenCalledTimes(1);

    dom.setHidden(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not refetch when a tab is only away for a moment", () => {
    const load = vi.fn();
    startVisiblePoll(load, INTERVAL);
    vi.advanceTimersByTime(0);

    dom.doc.hidden = true;
    vi.advanceTimersByTime(1_000);
    dom.setHidden(false);

    // Under one interval since the last load, so there is nothing new to get.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("stops the interval and unregisters the listener on cleanup", () => {
    const load = vi.fn();
    const stop = startVisiblePoll(load, INTERVAL);
    vi.advanceTimersByTime(0);
    expect(dom.listenerCount()).toBe(1);

    stop();
    vi.advanceTimersByTime(INTERVAL * 5);
    expect(load).toHaveBeenCalledTimes(1);
    expect(dom.listenerCount()).toBe(0);
  });
});

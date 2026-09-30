import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubPayload, HubSection } from "./types";

const TICK = 15_000;
const SLOW = 60_000;

/**
 * No jsdom in this repo, so the globals the poller touches are stubbed by
 * hand -- the same shape lib/ui/visible-poll.test.ts already uses, plus a
 * fetch that records the `include` each request asked for.
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

/** Records every `include` sent, and answers with a payload for each section. */
function stubFetch() {
  const calls: string[][] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const include = new URL(url, "https://stackchips.test").searchParams.get("include") ?? "";
    const sections = include.split(",").filter(Boolean) as HubSection[];
    calls.push(sections);
    const payload: HubPayload = {};
    for (const section of sections) {
      Object.assign(payload, { [section]: { marker: section } });
    }
    return { ok: true, json: async () => payload };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Fresh module per test: the poller's subscriber set and clocks are module state. */
async function loadPoller() {
  vi.resetModules();
  return import("./hub-poller");
}

describe("hub poller", () => {
  let dom: ReturnType<typeof stubDom>;
  let calls: string[][];

  beforeEach(() => {
    vi.useFakeTimers();
    dom = stubDom();
    calls = stubFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks only for the sections something is actually subscribed to", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});

    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual([["notifications"]]);
  });

  it("sends one request for every subscriber, not one each", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});
    subscribeHub(["missions"], () => {});
    subscribeHub(["achievements"], () => {});

    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["notifications", "missions", "achievements"]);
  });

  it("hands each subscriber only the section it asked for", async () => {
    const { subscribeHub } = await loadPoller();
    const seen: HubPayload[] = [];
    subscribeHub(["missions"], (payload) => seen.push(payload));
    subscribeHub(["achievements"], () => {});

    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0])).toEqual(["missions"]);
  });

  it("holds a slow section to its own cadence, not the tick", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    // Three ticks inside the 60s cadence: nothing is due, so nothing is sent.
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(calls).toHaveLength(2);
  });

  it("keeps an expiring section on the fast cadence", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["invites"], () => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(TICK * 3);

    expect(calls).toHaveLength(4);
    expect(calls.every((sections) => sections.join() === "invites")).toBe(true);
  });

  it("carries a slow section along only on the tick it comes due", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});
    subscribeHub(["invites"], () => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0]).toEqual(["notifications", "invites"]);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(calls[1]).toEqual(["invites"]);

    await vi.advanceTimersByTimeAsync(TICK * 3);
    // 60s on from the first load, so notifications rejoins that one request.
    expect(calls[calls.length - 1]).toEqual(["notifications", "invites"]);
  });

  it("sends nothing while the tab is hidden", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["invites"], () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    dom.doc.hidden = true;
    await vi.advanceTimersByTimeAsync(TICK * 10);
    expect(calls).toHaveLength(1);
  });

  it("catches up on the way back from a long absence", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});
    await vi.advanceTimersByTimeAsync(0);

    dom.doc.hidden = true;
    await vi.advanceTimersByTimeAsync(SLOW * 2);
    expect(calls).toHaveLength(1);

    dom.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
  });

  it("does not refetch when a tab is away for less than a cadence", async () => {
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});
    await vi.advanceTimersByTimeAsync(0);

    dom.doc.hidden = true;
    await vi.advanceTimersByTimeAsync(1_000);
    dom.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toHaveLength(1);
  });

  it("refreshHub ignores the cadence", async () => {
    const { subscribeHub, refreshHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    await refreshHub(["notifications"]);
    expect(calls).toHaveLength(2);
  });

  it("refreshHub reads again after a poll that was already in flight", async () => {
    // The poll below starts before the mutation. Joining it is how the unread
    // badge stayed up after opening the inbox.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const counts: number[] = [];
    let served = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      served += 1;
      const unreadCount = served === 1 ? 3 : 0;
      if (served === 1) await gate;
      return { ok: true, json: async () => ({ notifications: { notifications: [], unreadCount } }) };
    }));
    const { subscribeHub, refreshHub } = await loadPoller();
    subscribeHub(["notifications"], (payload) => {
      const section = payload.notifications as { unreadCount: number } | undefined;
      if (section) counts.push(section.unreadCount);
    });
    await vi.advanceTimersByTimeAsync(0);

    const refreshed = refreshHub(["notifications"]);
    release();
    await refreshed;

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
    expect(counts).toEqual([3, 0]);
  });

  it("backs a failing section off to its own cadence instead of every tick", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const { subscribeHub } = await loadPoller();
    subscribeHub(["notifications"], () => {});

    await vi.advanceTimersByTimeAsync(0);
    const failing = vi.mocked(globalThis.fetch);
    expect(failing).toHaveBeenCalledTimes(1);

    // Three ticks inside the 60s cadence. A signed-out tab left open must not
    // retry four times a minute just because every attempt 401s.
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(failing).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("stops polling and unregisters the listener once the last holder lets go", async () => {
    const { subscribeHub } = await loadPoller();
    const stopOne = subscribeHub(["invites"], () => {});
    const stopTwo = subscribeHub(["invites"], () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(dom.listenerCount()).toBe(1);

    stopOne();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(calls).toHaveLength(2);

    stopTwo();
    await vi.advanceTimersByTimeAsync(TICK * 5);
    expect(calls).toHaveLength(2);
    expect(dom.listenerCount()).toBe(0);
  });

  it("leaves the last-known answer standing when a poll fails", async () => {
    const { subscribeHub } = await loadPoller();
    const seen: HubPayload[] = [];
    subscribeHub(["invites"], (payload) => seen.push(payload));

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await vi.advanceTimersByTimeAsync(TICK);

    // No second callback, so the consumer's own state is untouched.
    expect(seen).toHaveLength(1);
  });
});

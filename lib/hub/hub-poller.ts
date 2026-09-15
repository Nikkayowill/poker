"use client";

import { HUB_SECTIONS, type HubPayload, type HubSection } from "./types";

/**
 * One poll, one request, for every lobby readout.
 *
 * What this replaces: six independent intervals (notifications, missions,
 * achievements, pending table invites, heads-up invites, and the friends
 * drawer's own refetch), each with its own cadence and its own serverless
 * invocation. A lobby with the drawer open was up to six requests every 15
 * seconds, all of them answering for the same player.
 *
 * Two rules keep this from being a plain "same thing, one endpoint":
 *
 *  - a section is only asked for while something is subscribed to it, so an
 *    idle lobby does not pay for a missions roll-up nobody has open;
 *  - each section keeps its own cadence. Notifications and the two catalogs
 *    are backstops behind a realtime channel and can afford a minute. Table
 *    invites expire, so they stay on the fast cadence the drawer needs.
 *
 * The tick below runs at the fastest cadence any section uses; a tick where
 * nothing is due sends no request at all.
 */

const TICK_MS = 15_000;

/** How often each section is worth re-reading. See the note above. */
const CADENCE_MS: Record<HubSection, number> = {
  notifications: 60_000,
  missions: 60_000,
  achievements: 60_000,
  invites: 15_000,
  headsUp: 15_000,
};

type Listener = (payload: HubPayload) => void;

interface Subscription {
  sections: HubSection[];
  listener: Listener;
}

const subscriptions = new Set<Subscription>();
/**
 * Last time each section was *attempted*, so cadences survive a resubscribe.
 *
 * Attempted rather than succeeded on purpose. A section that keeps failing --
 * a signed-out tab left open, most often -- would otherwise be due on every
 * tick forever and poll four times faster than a working one, which is the
 * opposite of what this module is for. The cost is that a transient miss
 * waits out its own cadence, which every readout here already tolerates.
 */
const lastAttemptedAt = new Map<HubSection, number>();
let timer: number | null = null;
let inFlight: { sections: HubSection[]; done: Promise<void> } | null = null;

function subscribedSections(): HubSection[] {
  const live = new Set<HubSection>();
  for (const sub of subscriptions) for (const section of sub.sections) live.add(section);
  return HUB_SECTIONS.filter((section) => live.has(section));
}

function dueSections(now: number): HubSection[] {
  return subscribedSections().filter((section) => {
    const last = lastAttemptedAt.get(section);
    return last === undefined || now - last >= CADENCE_MS[section];
  });
}

/**
 * Fetches the given sections and fans the answer out.
 *
 * A call whose sections are already covered by the request in flight joins it
 * rather than opening a second one -- a visibilitychange landing on the same
 * beat as a tick must not double the traffic this module exists to halve. A
 * call asking for anything extra waits its turn instead, so the promise a
 * caller gets back always covers what it asked for; refreshHub()'s callers
 * await it precisely to read the result.
 */
function fetchSections(sections: HubSection[]): Promise<void> {
  if (sections.length === 0) return Promise.resolve();
  const pending = inFlight;
  if (pending && sections.every((section) => pending.sections.includes(section))) {
    return pending.done;
  }

  const entry: { sections: HubSection[]; done: Promise<void> } = {
    sections,
    done: Promise.resolve(),
  };

  const run = async () => {
    if (pending) await pending.done;

    const now = Date.now();
    for (const section of sections) lastAttemptedAt.set(section, now);

    try {
      const query = new URLSearchParams({ include: sections.join(",") });
      const response = await fetch(`/api/hub?${query}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as HubPayload;

      // A copy of the set: a listener is allowed to unsubscribe from inside
      // its own callback, which is what a component unmounting on this very
      // update does.
      for (const sub of [...subscriptions]) {
        if (!subscriptions.has(sub)) continue;
        // Handed only what it asked for, so a consumer cannot accidentally
        // start depending on a section another component happens to keep warm.
        const slice: HubPayload = {};
        let touched = false;
        for (const section of sub.sections) {
          if (!sections.includes(section)) continue;
          Object.assign(slice, { [section]: payload[section] });
          touched = true;
        }
        if (touched) sub.listener(slice);
      }
    } catch {
      // Silent, matching the contract every readout behind this already had:
      // a background poll that misses should leave the last-known answer
      // standing rather than blank a panel or raise a banner.
    } finally {
      if (inFlight === entry) inFlight = null;
    }
  };

  entry.done = run();
  inFlight = entry;
  return entry.done;
}

function tick() {
  if (document.hidden) return;
  void fetchSections(dueSections(Date.now()));
}

function onVisibility() {
  if (document.hidden) return;
  // Only what has actually gone stale while the tab was away, so flicking
  // between tabs costs nothing.
  void fetchSections(dueSections(Date.now()));
}

function start() {
  if (timer !== null) return;
  timer = window.setInterval(tick, TICK_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function stop() {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibility);
  lastAttemptedAt.clear();
}

/**
 * Subscribes to a set of sections. The returned function unsubscribes.
 *
 * The first load is immediate rather than a tick away -- a panel opening
 * wants its data now -- but it only fetches sections that are actually stale,
 * so a second consumer mounting a moment after the first reuses what the
 * first already fetched instead of firing again.
 */
export function subscribeHub(sections: HubSection[], listener: Listener): () => void {
  const sub: Subscription = { sections, listener };
  subscriptions.add(sub);
  start();

  // Deferred, not called straight from the caller's effect body: every hook
  // behind this sets state from the response, and a fetch kicked off
  // synchronously resolves into the same commit that mounted it.
  const first = window.setTimeout(() => void fetchSections(dueSections(Date.now())), 0);

  return () => {
    window.clearTimeout(first);
    subscriptions.delete(sub);
    if (subscriptions.size === 0) stop();
  };
}

/**
 * Forces a re-read of the given sections, ignoring their cadence.
 *
 * For the two things a cadence cannot serve: a realtime broadcast saying a
 * notification just landed, and a mutation whose own effect the caller needs
 * reflected immediately (marking the bell read, accepting an invite).
 */
export function refreshHub(sections: HubSection[]): Promise<void> {
  for (const section of sections) lastAttemptedAt.delete(section);
  return fetchSections(sections);
}

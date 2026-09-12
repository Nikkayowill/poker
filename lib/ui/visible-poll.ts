"use client";

/**
 * The shared poll behind notifications, missions and achievements, which all
 * run on one cadence. Same setTimeout(0) + setInterval each of them used to
 * own, plus the rule they were missing: a hidden tab does not poll, so a
 * backgrounded phone stops fetching for a screen nobody is looking at.
 *
 * Returns the stop function for the effect's cleanup.
 */
export function startVisiblePoll(load: () => void, intervalMs: number): () => void {
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    load();
  };

  const first = window.setTimeout(run, 0);
  const poll = window.setInterval(() => {
    if (document.hidden) return;
    run();
  }, intervalMs);

  // The elapsed check keeps flicking between tabs from firing a request on
  // every switch: a tab away for a moment has missed nothing.
  const onVisibility = () => {
    if (document.hidden || Date.now() - lastRun < intervalMs) return;
    run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.clearTimeout(first);
    window.clearInterval(poll);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

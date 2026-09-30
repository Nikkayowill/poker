"use client";

/**
 * The poll behind the Heads-Up and Sit & Go waiting rooms. It starts fast so a
 * seat filling feels instant, then slows down the longer the wait runs, since
 * a player who has waited a minute is not helped by a request every 2 seconds.
 * A hidden tab does not poll.
 */
export function pollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 10_000) return 2_000;
  if (elapsedMs < 60_000) return 4_000;
  return 8_000;
}

/** Returns the stop function for the effect's cleanup. */
export function startBackoffPoll(load: () => void): () => void {
  const startedAt = Date.now();
  let timer: number | undefined;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    if (!document.hidden) load();
    timer = window.setTimeout(run, pollDelayMs(Date.now() - startedAt));
  };

  timer = window.setTimeout(run, 0);

  // Coming back to the tab reads now if the last read is stale, without
  // firing on every quick tab switch.
  const onVisibility = () => {
    if (document.hidden || Date.now() - lastRun < 2_000) return;
    window.clearTimeout(timer);
    run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

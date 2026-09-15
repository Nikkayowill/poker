"use client";

/**
 * Error and diagnostic reporting that does not name the Sentry SDK.
 *
 * Any module in a page's graph that imports "@sentry/nextjs" -- statically or
 * dynamically -- resolves it to the *Node* build during the server render of
 * a client component, and file tracing then copies the whole server SDK into
 * every function that page belongs to. 1.7MB a copy, across 46 functions, for
 * reports that only ever run in a browser.
 *
 * So the dependency is inverted. instrumentation-client.ts imports the SDK
 * where it belongs -- the browser -- and hands this module the three calls
 * the app actually makes. Nothing here names Sentry, so nothing that imports
 * it pulls the SDK in.
 */

export type MonitorLevel = "info" | "warning" | "error";

export interface Monitor {
  captureException(error: unknown): void;
  captureMessage(
    message: string,
    options: { level: MonitorLevel; extra: Record<string, unknown> },
  ): void;
  addBreadcrumb(crumb: {
    category: string;
    level: MonitorLevel;
    message: string;
    data: Record<string, unknown>;
  }): void;
}

let monitor: Monitor | null = null;

/**
 * Reports that arrived before the monitor did, held as the calls themselves.
 *
 * Small on purpose: this covers the narrow race where a hydration error or a
 * very fast first click beats instrumentation-client.ts's own init, not
 * general buffering. Past the cap the oldest go -- a session failing this
 * hard will not be diagnosed from the ninth report rather than the first.
 */
const pending: ((target: Monitor) => void)[] = [];
const PENDING_LIMIT = 8;

/** Called once by instrumentation-client.ts, after Sentry.init. */
export function setMonitor(next: Monitor): void {
  monitor = next;
  for (const replay of pending.splice(0, pending.length)) replay(next);
}

function send(call: (target: Monitor) => void): void {
  if (monitor) {
    call(monitor);
    return;
  }
  pending.push(call);
  if (pending.length > PENDING_LIMIT) pending.shift();
}

/** Named for what it does rather than `reportError`, which is a DOM global. */
export function reportFatalError(error: unknown): void {
  send((target) => target.captureException(error));
}

export function reportMessage(
  message: string,
  options: { level: MonitorLevel; extra: Record<string, unknown> },
): void {
  send((target) => target.captureMessage(message, options));
}

export function addTrail(crumb: {
  category: string;
  level: MonitorLevel;
  message: string;
  data: Record<string, unknown>;
}): void {
  send((target) => target.addBreadcrumb(crumb));
}

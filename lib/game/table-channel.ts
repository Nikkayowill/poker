/**
 * The wire contract for the table broadcast channel.
 *
 * One thing publishes to `table:<gameId>`: the Postgres trigger
 * `broadcast_game_signal()`, which fires on every write to `game_signals`.
 *
 * It had company once. A persistent Node worker published the same channel
 * through its own `SupabaseRoomStream`, nesting the version under `state`
 * instead of alongside it, so the browser coped by reading
 * `body.version ?? body.state.version` and no single definition of the message
 * existed anywhere. That worker was never wired to an entry point and its code
 * was deleted; this module is the definition that outlived it, and it is
 * deliberately shared rather than server-only, because the consumer is the
 * browser.
 *
 * WHY THE PAYLOAD STAYS THIS SMALL
 *
 * It is an invalidation ping, not a state feed. A receiver re-fetches its own
 * snapshot from the API, which is the only place per-viewer redaction happens
 * (your hole cards, nobody else's). Putting pot/street/stacks in here would
 * add a second source of truth for facts the very next fetch overwrites, and
 * -- because the channel is public, see below -- would widen what a non-player
 * who guessed a table UUID can observe. The one field worth carrying is the
 * version, because that is what tells a receiver whether it is already ahead.
 *
 * WHY THE CHANNEL IS PUBLIC
 *
 * A private channel authorizes against the connection's JWT via RLS on
 * `realtime.messages`. StackChips' primary player is a guest: gameplay
 * identity is the `river_session` cookie, and `profiles.user_id` is null by
 * design until someone signs up. A guest has no JWT, so private would lock out
 * the default player. That is a product decision, not a config flag, so the
 * channel stays public and the payload stays free of anything worth reading:
 * a table UUID is 122 bits, and all you get for guessing one is a counter.
 */

export const TABLE_STATE_CHANGED = "TABLE_STATE_CHANGED";

/**
 * Envelope version, bumped only when a field changes meaning. It exists so a
 * receiver can tell "old publisher" from "malformed", which matters here
 * because the publisher is a database trigger: it only starts emitting v1
 * once its migration is applied, and a deployed app can be newer than the
 * database it is pointed at.
 */
export const TABLE_EVENT_VERSION = 1;

export interface TableStateChangedEvent {
  /** Envelope version -- 0 for a publisher that predates this contract. */
  v: number;
  /** The game state version this signal announces. Monotonic per table. */
  version: number;
  /** When the signal row was written, or null from a v0 publisher. */
  updatedAt: string | null;
}

export function tableChannelName(gameId: string): string {
  return `table:${gameId}`;
}

export function tableStateChangedPayload(
  version: number,
  updatedAt: string | null,
): TableStateChangedEvent {
  return { v: TABLE_EVENT_VERSION, version, updatedAt };
}

function finiteVersion(value: unknown): number | null {
  // Postgres bigint arrives as a JSON number here because `version` is well
  // under 2^53; a string would still be a legitimate encoding of one, so
  // accept both rather than silently dropping signals.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Reads a broadcast payload into the envelope, or null if it carries no usable
 * version. Tolerates both pre-contract shapes on purpose: the trigger emits
 * bare `{version}` until its migration is applied, and dropping those would
 * turn a database that is merely behind into a table that never updates.
 */
export function parseTableStateChanged(
  payload: unknown,
): TableStateChangedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    v?: unknown;
    version?: unknown;
    updatedAt?: unknown;
    state?: unknown;
  };

  const nested = body.state && typeof body.state === "object"
    ? (body.state as { version?: unknown; updatedAt?: unknown })
    : null;

  const version = finiteVersion(body.version) ?? finiteVersion(nested?.version);
  if (version === null) return null;

  const rawUpdatedAt = body.updatedAt ?? nested?.updatedAt;
  return {
    v: finiteVersion(body.v) ?? 0,
    version,
    updatedAt: typeof rawUpdatedAt === "string" ? rawUpdatedAt : null,
  };
}

import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * Keeps `player_sessions.last_seen_at` current.
 *
 * game-store.ts reads it as a liveness signal against a 30 minute cutoff, for
 * retiring stale tables and for the matchmaking "is this table populated"
 * check. Nothing was actually bumping it: ensureProfile's upsert carries
 * `ignoreDuplicates`, so it never touched an existing row and the column just
 * held whenever the session was created. Every returning player read as
 * absent.
 *
 * Throttled rather than written every request because ensureProfile is the
 * front door for nearly every route -- a write there is the most executed
 * statement in the database. A 30 minute cutoff doesn't need better than five
 * minute accuracy.
 */

/** How stale a token's heartbeat may get before the next sighting writes it. */
const HEARTBEAT_MS = 5 * 60 * 1000;

/** Backstop against a long-lived instance leaking tokens, not a working limit. */
const MAX_TRACKED = 10_000;

const lastWrittenAt = new Map<string, number>();

/**
 * Whether this sighting should write, recording it if so. Asking marks the
 * token, so two callers racing the same one produce a single write.
 */
export function dueForHeartbeat(token: string, nowMs: number): boolean {
  const previous = lastWrittenAt.get(token);
  if (previous !== undefined && nowMs - previous < HEARTBEAT_MS) return false;

  if (lastWrittenAt.size >= MAX_TRACKED) {
    for (const [key, written] of lastWrittenAt) {
      if (nowMs - written >= HEARTBEAT_MS) lastWrittenAt.delete(key);
    }
  }
  lastWrittenAt.set(token, nowMs);
  return true;
}

/** Records a heartbeat without writing: for a row just created at `nowMs`. */
export function markHeartbeatWritten(token: string, nowMs: number): void {
  lastWrittenAt.set(token, nowMs);
}

/** Test seam. Module state would otherwise carry between cases. */
export function resetHeartbeatTracking(): void {
  lastWrittenAt.clear();
}

/**
 * Notes that this token is still around, at most once every HEARTBEAT_MS.
 *
 * An UPDATE and never an upsert, so it cannot create a session row -- reading
 * must not mint an identity (session-minting.test.ts). Failure is swallowed
 * because a missed heartbeat is cheaper than failing the player's request.
 */
export async function touchSession(token: string, nowMs = Date.now()): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;
  if (!dueForHeartbeat(token, nowMs)) return;

  try {
    await supabase
      .from("player_sessions")
      .update({ last_seen_at: new Date(nowMs).toISOString() })
      .eq("token", token);
  } catch {
    // See above: a dropped heartbeat is not worth failing a request over.
  }
}

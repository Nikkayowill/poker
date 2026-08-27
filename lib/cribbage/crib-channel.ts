/**
 * The wire contract for cribbage's two invalidation channels.
 *
 * Mirrors lib/game/table-channel.ts's shape and lib/pvp/duel-channel.ts's
 * per-viewer reasoning, but split across cribbage's own two-phase lobby:
 * `crib:lobby` for the open-table join screen, `crib:<tableId>` once seated.
 * Both are fired by the `broadcast_crib_signal()` trigger (see its
 * migration, crib_realtime_signals.sql) on every write to `cribbage_tables`
 * or `cribbage_table_players` -- a table created, dealt, settled or
 * cancelled, or a seat joined or left.
 *
 * `crib:lobby` is one global channel rather than a per-profile one like
 * duels: GET /api/cribbage lists open tables across every stake with no
 * per-viewer filter (unlike a duel's own challenge list), so there is no
 * narrower key to give it. Every browser sitting on the join screen shares
 * it.
 *
 * Like duel-channel.ts, neither carries a version to compare -- a table row
 * and a seat row don't share one monotonic counter, and cribbage-shell.tsx's
 * refresh() always re-reads the whole lobby-or-table snapshot regardless.
 * The event firing IS the signal.
 *
 * Public, not RLS-gated, for the same reason every channel here is:
 * StackChips' primary player is a guest with no JWT to authorize a private
 * channel against, and the payload carries nothing worth reading either way
 * -- a guessed table id (122 bits) buys nothing but a reason to re-fetch
 * data that is itself gated server-side by the caller's own session.
 */

export const CRIB_STATE_CHANGED = "CRIB_STATE_CHANGED";

export function cribLobbyChannelName(): string {
  return "crib:lobby";
}

export function cribTableChannelName(tableId: string): string {
  return `crib:${tableId}`;
}

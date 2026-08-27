/**
 * The wire contract for a player's duel invalidation channel.
 *
 * Mirrors lib/game/table-channel.ts's shape and reasoning, adapted for PvP
 * duels: the `broadcast_pvp_signal()` trigger (see its migration,
 * pvp_duel_realtime_signals.sql) fires on every write to `pvp_challenges` or
 * `pvp_matches` that names this profile, whether that's a new challenge
 * landing, one being accepted, an opponent's move, or a match settling.
 *
 * Unlike the table channel this carries no version to compare. A poker table
 * has one row whose version only ever climbs, so the channel needs one to
 * tell "already applied" from "new." A player's duel lobby has no single
 * counter like that -- a challenge and a match are different rows with
 * different lifetimes -- so the payload carries nothing at all. The event
 * firing IS the signal: DuelShell's refresh() always re-reads the whole
 * lobby from the API, which is the only place per-viewer redaction happens
 * anyway (an opponent's hidden trivia answer, a challenge that isn't yours),
 * so there is nothing worth trusting out of a broadcast payload here.
 *
 * Public, not RLS-gated, for the same reason table-channel.ts's channel is:
 * StackChips' primary player is a guest with no JWT to authorize a private
 * channel against. profile.id is documented in lib/profile/types.ts as
 * "stable, safe-to-share" -- a 122-bit UUID -- so this is the same exposure
 * shape as a guessable table id: all it buys a guesser is a reason to
 * re-fetch data that is itself gated server-side by the caller's own
 * session, never game or profile content.
 */

export const PVP_STATE_CHANGED = "PVP_STATE_CHANGED";

export function pvpChannelName(profileId: string): string {
  return `pvp:${profileId}`;
}

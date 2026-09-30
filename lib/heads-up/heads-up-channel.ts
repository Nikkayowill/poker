/**
 * The wire contract for a player's Heads-Up ping channel.
 *
 * Per profile like lib/pvp/duel-channel.ts, because an invitee has no table
 * id to watch until the invite lands. The `broadcast_heads_up_signal()`
 * trigger pings the host, the invitee and every seated player on each write
 * to `heads_up_tables` or `heads_up_table_players`. The payload carries
 * nothing, so the event firing is the signal and the client re-reads.
 */

export const HEADS_UP_STATE_CHANGED = "HEADS_UP_STATE_CHANGED";

export function headsUpChannelName(profileId: string): string {
  return `hu:${profileId}`;
}

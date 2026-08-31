/**
 * The wire contract for a player's notification channel.
 *
 * Copies lib/pvp/duel-channel.ts's shape exactly: a per-profile Broadcast
 * channel fired by a trigger on insert to `notifications` (see
 * notifications_realtime.sql), carrying no content -- the event firing IS the
 * signal, and useNotifications always re-fetches its own list from the API on
 * receipt, which is also where per-viewer redaction would happen if this ever
 * needed any.
 *
 * Public, not RLS-gated, for the same reason every other per-profile channel
 * here is: profile.id is documented in lib/profile/types.ts as "stable,
 * safe-to-share", so a guessed id buys nothing but a reason to re-fetch data
 * that's already gated server-side by the caller's own session.
 */

export const NOTIFICATION_CREATED = "NOTIFICATION_CREATED";

export function notificationChannelName(profileId: string): string {
  return `notify:${profileId}`;
}

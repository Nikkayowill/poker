import type { AvatarPreset } from "@/lib/profile/types";

/**
 * The friends wire contract, shared rather than server-only.
 *
 * lib/server/friends-store.ts carries `import "server-only"`, so the drawer
 * cannot import its shapes from there without pulling the service-role client
 * into the browser bundle. Same reasoning as lib/game/table-channel.ts: the
 * consumer is the browser, so the definition lives outside lib/server and the
 * store imports it back.
 */

/**
 * A friend as the client sees one.
 *
 * Deliberately not PlayerProfile. That type carries goldBalance,
 * unlimitedGold and lastDailyClaimAt, which are fine to show an owner about
 * themselves and wrong to show about anyone else. Keeping this shape explicit
 * means adding a field to PlayerProfile can never silently widen what a
 * friend learns about you.
 */
export interface FriendSummary {
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  accent: string;
  /** When the friendship was created, not when either profile was. */
  since: string;
}

export interface PendingRequest {
  id: string;
  /** The other party -- the requester on an incoming row, the addressee on an outgoing one. */
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  accent: string;
  createdAt: string;
}

export interface FriendsOverview {
  friends: FriendSummary[];
  incoming: PendingRequest[];
  outgoing: PendingRequest[];
}

import type { AvatarPreset } from "@/lib/profile/types";
// Type-only: head-to-head-store.ts is server-only, but its type declarations
// carry no runtime code, so importing just the type here doesn't pull the
// service-role client into the browser bundle.
import type { HeadToHeadRecord } from "@/lib/server/head-to-head-store";

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
  /**
   * Wins/losses/draws against this friend across every game that has two
   * named players (the duels and cribbage), or null if the two of you have
   * never finished one. Read from head_to_head_records, which is written at
   * settlement -- so this can lag a match that settled in the last few
   * seconds by at most one poll, same as everything else in the drawer.
   *
   * The leaderboard's Friends tab shows the same numbers split per game.
   * Both read the same store on purpose: a drawer badge and a board that
   * disagreed about one player's record would be worse than either being
   * slightly stale.
   */
  duelRecord: HeadToHeadRecord | null;
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

/**
 * A live "come play with me" the caller has been sent.
 *
 * Flattened around the inviter exactly like PendingRequest: this is also "the
 * other party, plus the row", and nesting one and flattening the other would
 * make the drawer read two shapes for the same idea.
 *
 * There is deliberately no room code here. The invite row carries the private
 * table's code so that accepting can join without either party ever seeing it
 * -- see the column comment in 20260804120000_friends_and_table_invites.sql.
 * Putting it in this payload would hand every invitee a code they could pass
 * on, which is the one thing the server-side carry exists to prevent.
 */
export interface PendingTableInvite {
  id: string;
  /** The other party -- always the inviter, since these are inbound only. */
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  accent: string;
  gameId: string;
  /** Stakes, so the notification can say what it is inviting you to. */
  smallBlind: number;
  bigBlind: number;
  createdAt: string;
  /** When this invite stops being offered. The client may count down to it; the server does not trust it to. */
  expiresAt: string;
}

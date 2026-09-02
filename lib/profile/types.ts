import type { EquippedCosmetics } from "@/lib/cosmetics/catalog";

/**
 * The valid `avatarPreset` ids. Only `.id` is load-bearing (validation and
 * dedup in `lib/server/profile-store.ts`) -- this used to also carry a
 * `label`/`symbol` per entry for a UI that read neither, since the avatar
 * system has long since moved to the seat-art character roster
 * (`lib/cosmetics/catalog.ts`) for anything actually drawn on screen.
 */
export const avatarPresets = [
  { id: "ace" },
  { id: "crown" },
  { id: "diamond" },
  { id: "lucky" },
  { id: "bolt" },
  { id: "river" },
] as const;

export const profileAccents = [
  "#e7c66a",
  "#c08dff",
  "#ff9e78",
  "#79c9ff",
  "#65d6a2",
  "#f08ca7",
] as const;

export type AvatarPreset = (typeof avatarPresets)[number]["id"];

export interface PlayerProfile {
  /** Stable, safe-to-share identifier, distinct from the HttpOnly session token, which never reaches JavaScript. */
  id: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  /** Equipped cosmetic per slot; falls back to the room defaults. */
  equipped: EquippedCosmetics;
  accent: string;
  createdAt: string;
  updatedAt: string;
  /** Persistent currency spent on table buy-ins; 1 Gold = 1 chip. */
  goldBalance: number;
  /** When true, spendGold is a no-op for this profile, used to gift a specific person free play. */
  unlimitedGold: boolean;
  /** ISO timestamp of the last successful daily-Gold claim, or null if never claimed. */
  lastDailyClaimAt: string | null;
  /** ISO timestamp of the last broke-player recovery top-up, or null if never claimed. See lib/profile/backstop.ts. */
  lastBackstopAt: string | null;
  /**
   * Whether this profile is backed by a real account. A boolean rather than
   * the account id: the client only needs to know if progress is safe and
   * which rewards are unlocked, never who the account is.
   */
  isRegistered: boolean;
  /**
   * Admin-granted access to the Homestead while it is unreleased -- see
   * lib/server/homestead-access.ts. Safe to expose here even though it's
   * assigned in the admin dashboard: it says nothing about anyone but the
   * profile it belongs to, which is exactly who's asking. This is what lets
   * the Homestead tile grey itself out client-side instead of every visitor
   * round-tripping to find out.
   */
  homesteadAccess: boolean;
  /**
   * Whether this player's seat carries an "Admin" tag at the poker table,
   * styled like the dealer's own label. Granted from the admin dashboard,
   * same as homesteadAccess; it changes nothing about what the account can
   * do, only how the seat reads to everyone else at the table.
   */
  adminBadge: boolean;
}

/**
 * What one player may know about *another* player: friends, leaderboard
 * entries, invite/duel-challenge senders. Excludes goldBalance,
 * unlimitedGold, and the claim timestamps, since those are wallet-adjacent
 * and belong only in a profile's own PlayerProfile view. Keeping this as its
 * own narrower type (rather than trusting every call site of
 * getPublicProfilesByIds to destructure carefully) means a future call site
 * can't accidentally hand another player's balance to the client just by
 * spreading the object.
 */
export interface PublicProfileSummary {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  /** Equipped 2D seat-art character id, same field seat.avatarCosmetic already carries at the table. */
  avatarCosmetic: string;
  accent: string;
}

export interface ProfileUpdate {
  displayName: string;
  avatarPreset: AvatarPreset;
  accent: string;
  clearUpload?: boolean;
}

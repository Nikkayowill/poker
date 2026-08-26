import type { EquippedCosmetics } from "@/lib/cosmetics/catalog";

export const avatarPresets = [
  { id: "ace", label: "The Ace", symbol: "A♠" },
  { id: "crown", label: "High Roller", symbol: "♛" },
  { id: "diamond", label: "Diamond", symbol: "♦" },
  { id: "lucky", label: "Lucky Seven", symbol: "7" },
  { id: "bolt", label: "Live Wire", symbol: "ϟ" },
  { id: "river", label: "The River", symbol: "≋" },
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
  accent: string;
}

export interface ProfileUpdate {
  displayName: string;
  avatarPreset: AvatarPreset;
  accent: string;
  clearUpload?: boolean;
}

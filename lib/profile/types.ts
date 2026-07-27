import type { AvatarConfig } from "@/lib/avatar/catalog";

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
  /** Stable, safe-to-share identifier -- distinct from the HttpOnly session token, which never reaches JavaScript. */
  id: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  /** The layered avatar's chosen options; falls back to defaults when never customized. */
  avatar: AvatarConfig;
  accent: string;
  createdAt: string;
  updatedAt: string;
  /** Persistent currency spent on table buy-ins; 1 Gold = 1 chip. */
  goldBalance: number;
  /** When true, spendGold is a no-op for this profile -- used to gift a specific person free play. */
  unlimitedGold: boolean;
  /** ISO timestamp of the last successful daily-Gold claim, or null if never claimed. */
  lastDailyClaimAt: string | null;
  /**
   * Whether this profile is backed by a real account. Deliberately a boolean
   * rather than the account id: the client only needs to know if progress is
   * safe and which rewards are unlocked, never who the account is.
   */
  isRegistered: boolean;
}

export interface ProfileUpdate {
  displayName: string;
  avatarPreset: AvatarPreset;
  avatar: AvatarConfig;
  accent: string;
  clearUpload?: boolean;
}

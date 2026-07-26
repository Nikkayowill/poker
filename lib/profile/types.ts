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
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  accent: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileUpdate {
  displayName: string;
  avatarPreset: AvatarPreset;
  accent: string;
  clearUpload?: boolean;
}

import "server-only";
import type { AvatarPreset, PublicProfileSummary } from "@/lib/profile/types";
import { DEFAULT_AVATAR_COSMETIC } from "@/lib/cosmetics/catalog";
import { getPublicProfilesByIds } from "./profile-store";

export type PublicIdentity = {
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
};

/** Name, initials, avatar and accent for a profile, with the fallbacks used when it did not resolve. */
export function publicIdentity(profile: PublicProfileSummary | undefined): PublicIdentity {
  return {
    displayName: profile?.displayName ?? "Player",
    initials: profile?.initials ?? "??",
    avatarUrl: profile?.avatarUrl ?? null,
    accent: profile?.accent ?? "#e7c66a",
  };
}

/** Rank plus public-profile identity, with the fallbacks every leaderboard uses for an unresolved profile. */
export type RankedIdentity = {
  profileId: string;
  rank: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  avatarCosmetic: string;
  accent: string;
};

/**
 * Attaches rank and public-profile identity (name, avatar, accent, with the
 * same "Player" / null / gold fallbacks every board uses) to an already-
 * sorted row list.
 *
 * Shared across every leaderboard-shaped decorator (the global board and
 * every registered game's board) so none of them can drift on the fallback
 * values by building the same shape twice.
 */
export async function decorateRankedRows<Row extends { profileId: string }, Extra>(
  rows: Row[],
  extra: (row: Row) => Extra,
): Promise<(RankedIdentity & Extra)[]> {
  const profiles = await getPublicProfilesByIds(rows.map((row) => row.profileId));
  return rows.map((row, index) => {
    const profile = profiles.get(row.profileId);
    return {
      profileId: row.profileId,
      rank: index + 1,
      ...publicIdentity(profile),
      avatarPreset: profile?.avatarPreset ?? "ace",
      avatarCosmetic: profile?.avatarCosmetic ?? DEFAULT_AVATAR_COSMETIC,
      ...extra(row),
    };
  });
}

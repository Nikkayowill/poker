import "server-only";
import type { AvatarPreset } from "@/lib/profile/types";
import { DEFAULT_AVATAR_COSMETIC } from "@/lib/cosmetics/catalog";
import { getPublicProfilesByIds } from "./profile-store";

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
 * Shared across every leaderboard-shaped decorator -- poker's global/season
 * board, every registered game's board, and poker's own stats board -- so
 * none of them can drift on the fallback values by building the same shape
 * twice. Split into its own module rather than living in leaderboard-store.ts
 * (where it started) because stats-store.ts needs it too, and
 * leaderboard-store.ts already imports from stats-store.ts for the global
 * blend -- defining it there would have made stats-store import back from a
 * module that imports it.
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
      displayName: profile?.displayName ?? "Player",
      initials: profile?.initials ?? "??",
      avatarUrl: profile?.avatarUrl ?? null,
      avatarPreset: profile?.avatarPreset ?? "ace",
      avatarCosmetic: profile?.avatarCosmetic ?? DEFAULT_AVATAR_COSMETIC,
      accent: profile?.accent ?? "#e7c66a",
      ...extra(row),
    };
  });
}

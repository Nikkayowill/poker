import "server-only";
import type { ProfileBadge } from "@/lib/badges/types";
import { achievementTitle, grantedCodes } from "./achievement-store";
import { adminClient } from "./supabase-admin";

/**
 * Badges: read-only access to profile_badges, the public flair table season
 * rollover and achievement grants already write to (see
 * 20260728195100_leaderboards_and_seasons.sql and
 * 20260817120000_achievements.sql). This module never writes it -- both
 * writers already exist, and adding a third path to the same table is how
 * that kind of thing drifts.
 */

const SEASON_BADGE_PATTERN = /^season-(\d{4}-\d{2})-rank-(\d+)$/;
const ACHIEVEMENT_BADGE_PREFIX = "achievement-";

interface BadgeRow {
  badge: string;
  seasonId: string | null;
  awardedAt: string;
}

/** Turns a raw badge id into what a player actually reads. Falls back to the
 * raw id for anything that doesn't match a known shape, rather than hiding
 * it -- a badge earned by a future grant path should still show up as
 * *something* here. */
async function labelFor(badge: string): Promise<string> {
  const seasonMatch = badge.match(SEASON_BADGE_PATTERN);
  if (seasonMatch) {
    const [, month, rank] = seasonMatch;
    return `Season ${month} · Rank #${rank}`;
  }
  if (badge.startsWith(ACHIEVEMENT_BADGE_PREFIX)) {
    const code = badge.slice(ACHIEVEMENT_BADGE_PREFIX.length);
    const title = await achievementTitle(code);
    if (title) return title;
  }
  return badge;
}

async function readRows(profileId: string): Promise<BadgeRow[]> {
  const supabase = adminClient();
  if (!supabase) {
    // Memory mode never populates profile_badges directly -- season rollover
    // says as much in stats-store.ts, and an achievement grant records to
    // achievement-store's own memory map instead. Rebuild the achievement
    // half from that map; the season half stays a known gap, same as it is
    // for stats-store's memory-mode rollover.
    const granted = await grantedCodes(profileId);
    return [...granted.entries()].map(([code, awardedAt]) => ({
      badge: `${ACHIEVEMENT_BADGE_PREFIX}${code}`,
      seasonId: null,
      awardedAt,
    }));
  }

  const { data, error } = await supabase
    .from("profile_badges")
    .select("badge, season_id, awarded_at")
    .eq("profile_id", profileId)
    .order("awarded_at", { ascending: false });
  if (error) throw new Error(`Could not load your badges: ${error.message}`);
  return (data ?? []).map((row) => ({
    badge: String(row.badge),
    seasonId: (row.season_id as string | null) ?? null,
    awardedAt: String(row.awarded_at),
  }));
}

/** Every badge this profile has earned, newest first, with a display label
 * already resolved. Write-free, like every other store read in this file. */
export async function getProfileBadges(profileId: string): Promise<ProfileBadge[]> {
  const rows = await readRows(profileId);
  rows.sort((a, b) => (a.awardedAt < b.awardedAt ? 1 : a.awardedAt > b.awardedAt ? -1 : 0));

  return Promise.all(rows.map(async (row) => ({
    badge: row.badge,
    seasonId: row.seasonId,
    awardedAt: row.awardedAt,
    label: await labelFor(row.badge),
  })));
}

/**
 * The badges wire contract, shared rather than server-only -- same split as
 * lib/achievements/types.ts, for the same reason: lib/server/badge-store.ts
 * carries `import "server-only"`, so a client component reading this shape
 * cannot pull the service-role client into the browser bundle.
 */

/** One row of public flair earned by a profile: a season top-10 finish or an
 * achievement unlock. Mirrors profile_badges
 * (20260728195100_leaderboards_and_seasons.sql, populated further by
 * 20260817120000_achievements.sql). `label` is resolved server-side so
 * nothing on the client has to parse the raw badge id. */
export interface ProfileBadge {
  badge: string;
  seasonId: string | null;
  awardedAt: string;
  label: string;
}

export interface ProfileBadgesPayload {
  badges: ProfileBadge[];
}

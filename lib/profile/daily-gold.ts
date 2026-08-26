import type { PlayerProfile } from "./types";

/**
 * Who may claim the daily Gold, and when.
 *
 * The rule itself belongs to the server: lib/server/profile-store.ts's
 * claimDailyGold is the authority and re-checks the same day boundary before
 * crediting anything. What lives here is the *display* half of it, so the
 * navbar and the player menu can agree on what to offer without either of
 * them re-deriving "same UTC day" from a timestamp.
 *
 * In lib/ rather than beside the component, same as lib/arcade/games.ts and
 * lib/game/seat-presence.ts: vitest.config.ts collects only lib/ and app/,
 * so a predicate written next to the badge would be untestable.
 */

/** The boundary the credit uses: a calendar day in UTC, not in local time. */
export function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

/**
 * - `ready`: there is Gold waiting; offer the claim.
 * - `claimed`: already taken today; say so rather than offering a no-op.
 * - `guest`: the reward needs an account, so the offer is to make one.
 * - `unlimited`: crediting a profile that is never charged means nothing.
 */
export type DailyGoldState = "ready" | "claimed" | "guest" | "unlimited";

export function dailyGoldState(profile: PlayerProfile | null, now: Date): DailyGoldState | null {
  if (!profile) return null;
  if (profile.unlimitedGold) return "unlimited";
  if (!profile.isRegistered) return "guest";
  if (profile.lastDailyClaimAt && isSameUtcDay(new Date(profile.lastDailyClaimAt), now)) return "claimed";
  return "ready";
}

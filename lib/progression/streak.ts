/**
 * The daily-claim streak.
 *
 * The existing daily grant (DAILY_GOLD_GRANT in lib/server/profile-store.ts)
 * pays the same 1,000 Gold on a player's first day and on their hundredth,
 * which makes coming back tomorrow worth exactly as much as coming back next
 * month. This module is the multiplier that fixes that, and nothing else: the
 * *authority* on whether a claim may happen at all is still claimDailyGold's
 * UTC-day check, re-run inside the guarded RPC.
 *
 * Pure, and keyed on day strings rather than timestamps. A streak is a question
 * about calendar days, and every bug this kind of code has ever had comes from
 * doing date arithmetic in milliseconds across a boundary. Comparing
 * "2026-08-06" to "2026-08-05" cannot drift.
 */

/** The day a timestamp falls in, in UTC -- the same boundary the credit uses. */
export function utcDayKey(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/** The UTC day before `day`. Takes and returns the same YYYY-MM-DD form. */
export function previousUtcDay(day: string): string {
  const asDate = new Date(`${day}T00:00:00.000Z`);
  asDate.setUTCDate(asDate.getUTCDate() - 1);
  return utcDayKey(asDate);
}

/**
 * Where a claim on `today` leaves the streak.
 *
 * Idempotent by day, which is what makes it safe to record *before* the credit
 * is attempted: claiming twice on one day is the second branch here, and it
 * returns the streak unchanged rather than extending it.
 */
export function streakAfterClaim(
  lastClaimDay: string | null,
  currentStreak: number,
  today: string,
): number {
  const held = Math.max(1, Math.floor(currentStreak) || 1);
  if (!lastClaimDay) return 1;
  // Already claimed today: the streak is whatever it already was. This is the
  // branch that makes recording safe to retry.
  if (lastClaimDay === today) return held;
  if (lastClaimDay === previousUtcDay(today)) return held + 1;
  // A gap of any size is a fresh start, not a pause.
  return 1;
}

/** How many days a streak is worth as a multiplier before it stops growing. */
export const STREAK_CAP_DAYS = 7;
/** Added to the multiplier per consecutive day after the first. */
export const STREAK_STEP = 0.25;

/**
 * The daily grant's multiplier at a given streak length.
 *
 * Capped at seven days, and the cap is the design rather than a safety rail: a
 * multiplier that grows forever eventually pays more than the Gold store sells,
 * and a week is long enough to be a habit and short enough that missing one day
 * is not a month thrown away. 1.0 on day one rising to 2.5 on day seven.
 */
export function streakMultiplier(streak: number): number {
  const days = Math.min(Math.max(Math.floor(streak), 1), STREAK_CAP_DAYS);
  return 1 + STREAK_STEP * (days - 1);
}

/** The daily grant at a given streak, rounded to whole Gold. */
export function dailyGrantFor(baseGrant: number, streak: number): number {
  return Math.round(baseGrant * streakMultiplier(streak));
}

/**
 * Whether a streak survives to `today` untouched.
 *
 * Read-only counterpart to streakAfterClaim, for the readout that has to say
 * "3 day streak" *before* today's claim -- and must not say it once the streak
 * has already lapsed. A streak whose last claim was neither today nor yesterday
 * is over, whatever the stored number still says.
 */
export function liveStreak(lastClaimDay: string | null, storedStreak: number, today: string): number {
  if (!lastClaimDay) return 0;
  if (lastClaimDay === today || lastClaimDay === previousUtcDay(today)) {
    return Math.max(0, Math.floor(storedStreak));
  }
  return 0;
}

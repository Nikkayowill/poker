import { utcDayKey } from "@/lib/progression/streak";

/**
 * The UTC-week boundary missions use.
 *
 * A daily mission's period is a UTC day, already owned by
 * lib/progression/streak.ts (re-exported below rather than duplicated). A
 * weekly mission's period is a different boundary this feature owns --
 * streak.ts's job is the daily-claim day, not the calendar week.
 */
export { utcDayKey };

/** The UTC Monday (YYYY-MM-DD) of the week containing `date`. */
export function utcWeekKey(date: Date): string {
  const midnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay(): 0 = Sunday .. 6 = Saturday. ISO weekday puts Sunday last, so
  // it is 6 days after that week's Monday; every other day is (weekday - 1).
  const isoWeekday = midnight.getUTCDay() === 0 ? 7 : midnight.getUTCDay();
  midnight.setUTCDate(midnight.getUTCDate() - (isoWeekday - 1));
  return utcDayKey(midnight);
}

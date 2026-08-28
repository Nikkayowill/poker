/**
 * Per-player local-time targeting for the re-engagement push cron.
 *
 * The cron runs hourly (see vercel.json); this decides, for one candidate
 * with a possibly-null stored timezone, whether *this* run is the one that
 * should reach them. Two independent decisions live here rather than one,
 * because they answer different questions: which hourly run is "their"
 * run (isInLocalSendWindow), and whether they've already been notified
 * since their own local midnight (isSameLocalDay, the per-player successor
 * to lib/profile/daily-gold.ts's isSameUtcDay).
 *
 * A player with no stored timezone yet (not captured, or capture never
 * fired) falls back to the original fixed-UTC-hour behavior rather than
 * being silently dropped from the cron -- see FALLBACK_UTC_HOUR.
 */

/** Local hour (0-23) the nudge should land in -- afternoon, when someone is plausibly awake and free almost anywhere. */
const TARGET_LOCAL_HOUR = 12;

/** Pre-timezone-capture behavior, preserved for profiles with no stored zone: the original vercel.json schedule. */
const FALLBACK_UTC_HOUR = 22;

/** {year, month, day, hour} in a given zone, via Intl rather than manual offset math so DST is handled by the platform's own timezone database. */
function localParts(timezone: string, when: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  // hour12: false renders midnight as "24", not "00" -- normalize it back to 0.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour };
}

/** True when `when` falls in this player's local send hour (or the UTC fallback hour, for a player with no stored zone). */
export function isInLocalSendWindow(timezone: string | null, when: Date): boolean {
  if (!timezone) return when.getUTCHours() === FALLBACK_UTC_HOUR;
  try {
    return localParts(timezone, when).hour === TARGET_LOCAL_HOUR;
  } catch {
    // An invalid/unrecognized zone name got stored somehow (isValidTimezone
    // should have stopped it, but don't let a bad row crash the whole sweep) --
    // fall back rather than throwing out of a Promise.all over other players.
    return when.getUTCHours() === FALLBACK_UTC_HOUR;
  }
}

/** True when `a` and `b` are the same calendar day in this player's zone (or in UTC, for a player with no stored zone). */
export function isSameLocalDay(timezone: string | null, a: Date, b: Date): boolean {
  if (!timezone) {
    return a.getUTCFullYear() === b.getUTCFullYear()
      && a.getUTCMonth() === b.getUTCMonth()
      && a.getUTCDate() === b.getUTCDate();
  }
  try {
    const pa = localParts(timezone, a);
    const pb = localParts(timezone, b);
    return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
  } catch {
    return a.getUTCFullYear() === b.getUTCFullYear()
      && a.getUTCMonth() === b.getUTCMonth()
      && a.getUTCDate() === b.getUTCDate();
  }
}

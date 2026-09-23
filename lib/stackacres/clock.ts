/**
 * The farm's clock: one game day every 13 real minutes, shared by the server and the browser.
 *
 * Game time is world time: (now + offset) mod one day, read as 0..24 hours. Every farm starts with
 * an offset of 0, so everyone shares the same sky until they sleep. Sleeping only moves that
 * farm's offset forward to the next 6 AM. It never touches crop, animal or machine timers, energy,
 * the UTC-day limits or Gold: the clock is how the farm looks, not what it earns.
 */

/** One game day, in real milliseconds. */
export const STACKACRES_DAY_MS = 13 * 60_000;
/** One game hour, in real milliseconds (32.5 s). */
export const STACKACRES_HOUR_MS = STACKACRES_DAY_MS / 24;
/** Sleeping wakes you at this hour. */
export const WAKE_HOUR = 6;
/** You can go to bed from this hour until WAKE_HOUR. */
export const BEDTIME_HOUR = 18;

export const NOT_SLEEPY = "Not sleepy yet. You can sleep from 6 PM.";

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** How far into the game day `nowMs + offsetMs` is, in real ms (0 up to one day). */
function msIntoDay(nowMs: number, offsetMs: number): number {
  return mod(nowMs + offsetMs, STACKACRES_DAY_MS);
}

/** The game hour, 0 up to 24, at a real moment for a farm with this offset. */
export function gameHourAt(nowMs: number, offsetMs: number): number {
  return (msIntoDay(nowMs, offsetMs) / STACKACRES_DAY_MS) * 24;
}

/** Evening and night: 6 PM up to 6 AM. */
export function canSleepAt(hour: number): boolean {
  const h = mod(hour, 24);
  return h >= BEDTIME_HOUR || h < WAKE_HOUR;
}

/**
 * The offset that makes it exactly 6 AM at `nowMs`: the next morning, always forward. At 10 PM
 * that is 8 game hours ahead, at 3 AM it is 3. Integer ms in, integer ms out, so the hour it lands
 * on is exactly 6. The offset is not wrapped, so every sleep leaves a new value behind, which is
 * what the compare-and-set write relies on.
 */
export function offsetAfterSleep(nowMs: number, offsetMs: number): number {
  const wakeMs = WAKE_HOUR * STACKACRES_HOUR_MS;
  const ahead = mod(wakeMs - msIntoDay(nowMs, offsetMs), STACKACRES_DAY_MS);
  return offsetMs + (ahead === 0 ? STACKACRES_DAY_MS : ahead);
}

/** "6:40 PM": the hour on a 12-hour clock, rounded down to 10 game minutes. */
export function clockLabel(hour: number): string {
  // The tiny nudge keeps 6:10 from reading 6:00 when the float lands a hair under.
  const tens = Math.floor(mod(hour, 24) * 6 + 1e-9) % (24 * 6);
  const h24 = Math.floor(tens / 6);
  const minutes = (tens % 6) * 10;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${minutes === 0 ? "00" : minutes} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Night on the clock face: the moon shows from 6 PM to 6 AM. */
export function isNightHour(hour: number): boolean {
  return canSleepAt(hour);
}

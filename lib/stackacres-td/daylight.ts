/**
 * The light over the top-down farm at a given game hour: a multiply tint for the whole view and how
 * strongly windows and lamps glow.
 *
 * Shaped after Stardew Valley's lighting (decompiled Game1.cs): night is a gradual blue subtraction that
 * deepens over a couple of hours, never a snap, and lamps cancel it locally. Our night stays well lighter
 * than Stardew's so a young player can still read everything they might tap. The hour is the farm clock's
 * (lib/stackacres/clock.ts, a day every 13 minutes), the same one the music's `timeOfDay()` reads.
 * docs/stackacres-premium-life.md has the reasoning.
 */

export interface Daylight {
  /** Multiply factors for red, green and blue, 0..1. 1,1,1 is plain daylight. */
  r: number;
  g: number;
  b: number;
  /** 0 by day, 1 at full night: how strongly windows, the porch lamp and the lantern glow. */
  lamps: number;
}

interface Key extends Daylight {
  hour: number;
}

const NIGHT = { r: 0.54, g: 0.6, b: 0.86, lamps: 1 };
const DAY = { r: 1, g: 1, b: 1, lamps: 0 };

/** Keyframes by game hour. Between two keys the light eases, so every minute moves a little. */
const KEYS: readonly Key[] = [
  { hour: 0, ...NIGHT },
  { hour: 4.5, ...NIGHT },
  { hour: 6, r: 0.92, g: 0.78, b: 0.84, lamps: 0.45 },
  { hour: 7.5, ...DAY },
  { hour: 16.5, ...DAY },
  { hour: 18, r: 1, g: 0.9, b: 0.74, lamps: 0 },
  { hour: 19.5, r: 0.82, g: 0.7, b: 0.86, lamps: 0.55 },
  { hour: 21, ...NIGHT },
  { hour: 24, ...NIGHT },
];

/** The dimmest the view may get, as perceived brightness. Tap targets have to stay readable. */
export const NIGHT_FLOOR = 0.55;

export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

const ease = (t: number) => t * t * (3 - 2 * t);

export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = ease((h - a.hour) / (b.hour - a.hour));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), lamps: mix(a.lamps, b.lamps) };
}

/** Inside by day: plain and bright, the lamps barely on. */
export const INDOOR_DAY: Daylight = { r: 1, g: 0.98, b: 0.94, lamps: 0.15 };
/** Inside at night: lamplit and dim, still easy to read. */
export const INDOOR_NIGHT: Daylight = { r: 0.66, g: 0.64, b: 0.84, lamps: 1 };

/**
 * Inside a room at a game hour. It goes from day to night as the lamps come on outside, so a room dims
 * through the same dawn and dusk as the yard does.
 */
export function indoorDaylightAt(hour: number): Daylight {
  const t = daylightAt(hour).lamps;
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    r: mix(INDOOR_DAY.r, INDOOR_NIGHT.r),
    g: mix(INDOOR_DAY.g, INDOOR_NIGHT.g),
    b: mix(INDOOR_DAY.b, INDOOR_NIGHT.b),
    lamps: mix(INDOOR_DAY.lamps, INDOOR_NIGHT.lamps),
  };
}

/** Perceived brightness of a tint, 0..1. */
export function brightness(light: Daylight): number {
  return 0.299 * light.r + 0.587 * light.g + 0.114 * light.b;
}

/** The tint as a 0xRRGGBB colour for a multiply-blended rectangle. */
export function tintColor(light: Daylight): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(light.r) << 16) | (c(light.g) << 8) | c(light.b);
}

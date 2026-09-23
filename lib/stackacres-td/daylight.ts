/**
 * The light over the top-down farm at a given local hour: a multiply tint for the whole view and how
 * strongly windows and lamps glow.
 *
 * Shaped after Stardew Valley's lighting (decompiled Game1.cs): night is a gradual blue subtraction that
 * deepens over a couple of hours, never a snap, and lamps cancel it locally. Our night stays well lighter
 * than Stardew's so a young player can still read everything they might tap. Local time, like the music's
 * `timeOfDay()` (lib/audio/stackacres-music.ts): the farm is dark when the player's evening is.
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
/** Not pure white: a touch less blue, so daylight reads warm the way Stardew's does. */
const DAY = { r: 1, g: 0.99, b: 0.95, lamps: 0 };

/** Keyframes by local hour. Between two keys the light eases, so every minute moves a little. */
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

/** Inside the barn or the workshop: lamplit and a touch warm at any hour, lanterns always burning. */
export const INDOORS: Daylight = { r: 1, g: 0.96, b: 0.88, lamps: 0.8 };

/** Perceived brightness of a tint, 0..1. */
export function brightness(light: Daylight): number {
  return 0.299 * light.r + 0.587 * light.g + 0.114 * light.b;
}

/** The tint as a 0xRRGGBB colour for a multiply-blended rectangle. */
export function tintColor(light: Daylight): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(light.r) << 16) | (c(light.g) << 8) | c(light.b);
}

/** How much sun is on the farm at a local hour: what drives the god rays, the cloud shadows and the lit tree tops. */
export interface Sunlight {
  /** 0..1, the shafts of light across the view: low sun in the morning and late afternoon throws the longest. */
  rays: number;
  /** 0..1, how dark a cloud's shadow falls: full by day, gone at night when there is no sun to block. */
  clouds: number;
  /** 0..1, the warm light on the top of every canopy. */
  canopy: number;
}

interface SunKey extends Sunlight {
  hour: number;
}

/**
 * Shaped after Stardew's outdoor light: shafts come in with the low morning sun, thin out under the high sun
 * of midday, come back long in the late afternoon and are gone by dusk. Cloud shadow and canopy light simply
 * follow the sun being up.
 */
const SUN_KEYS: readonly SunKey[] = [
  { hour: 0, rays: 0, clouds: 0, canopy: 0 },
  { hour: 6, rays: 0, clouds: 0, canopy: 0 },
  { hour: 7.5, rays: 0.7, clouds: 0.6, canopy: 0.7 },
  { hour: 9, rays: 1, clouds: 1, canopy: 1 },
  { hour: 12.5, rays: 0.45, clouds: 1, canopy: 0.8 },
  { hour: 16.5, rays: 0.9, clouds: 1, canopy: 1 },
  { hour: 18.5, rays: 0.5, clouds: 0.5, canopy: 0.5 },
  { hour: 20, rays: 0, clouds: 0, canopy: 0 },
  { hour: 24, rays: 0, clouds: 0, canopy: 0 },
];

export function sunlightAt(hour: number): Sunlight {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SUN_KEYS.length - 2 && SUN_KEYS[i + 1].hour <= h) i++;
  const a = SUN_KEYS[i];
  const b = SUN_KEYS[i + 1];
  const t = ease((h - a.hour) / (b.hour - a.hour));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return { rays: mix(a.rays, b.rays), clouds: mix(a.clouds, b.clouds), canopy: mix(a.canopy, b.canopy) };
}

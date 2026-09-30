/**
 * A landed fish: it jumps out of the water, lands in the farmer's hands and
 * he holds it up over his head while "+1 Trout" shows above it.
 *
 * Timed off Stardew Valley's own catch (decompiled 1.6, FishingRod.cs
 * `doPullFishFromWater` and `tickUpdate`). There the fish flies on a gravity
 * arc from the bobber to the farmer's hands without spinning, and half a
 * second into the flight he turns to face the camera to take it. Stardew's
 * side-on gravity is 0.001 px/ms² on 64px tiles, which is `FISH_GRAVITY` on
 * our 16px ones. Its flights run 0.6 to 1.2 s; the dock's comes out at about
 * one second.
 *
 * The pose is the sheet's `hold_down` (art/stackacres-td/lpc/build.py HOLD):
 * hands at his chest, arms spreading, then up over his head and held. The
 * fish follows those frames, which ./fish-catch.test.ts reads out of the
 * sheet so a redraw that moves the hands fails a test instead of drifting.
 *
 * The art is public/stackacres-td/common/fish.png, one 18px cell per
 * species in `FISH_SPECIES` order (art/stackacres-td/rich/fish.py), drawn
 * facing right.
 *
 * Pure and renderer-free, same split as ./pull.ts and ./fishing-cast.ts.
 */
import { FISH_SPECIES, type FishSpecies } from "@/lib/stackacres/fishing";

export interface Point {
  x: number;
  y: number;
}

/** One fish's cell in common/fish.png, square. */
export const FISH_CELL = 18;

/** The fish's frame in common/fish.png. */
export function fishFrame(species: FishSpecies): number {
  return FISH_SPECIES.indexOf(species);
}

/** Stardew's side-on 0.001 px/ms², over four for our 16px tiles. */
export const FISH_GRAVITY = 0.00025;

/** How far above his hands the fish's jump peaks: about two tiles of air, a little over his hat. */
export const FISH_APEX_PX = 28;

/** Stardew turns him to face the camera this far into the flight, ready to take it. */
export const FISH_TURN_MS = 500;

/** Where the fish lands, above his feet: in his hands at his chest (the first `hold_down` frame). */
export const FISH_AT_CHEST: Point = { x: 0, y: -11 };

/** Where he holds it up, above his feet: its belly just clear of his hat (the last two frames). */
export const FISH_OVERHEAD: Point = { x: 0, y: -36 };

/** The `hold_down` frame holds, in order, as build.py writes them: chest, arms out, up, held. */
export const HOLD_FRAME_MS = [140, 90, 90, 600] as const;

/** From the catch until the fish starts up: the first frame, with it at his chest. */
export const LIFT_START_MS = HOLD_FRAME_MS[0];

/** From the catch until it is over his head: chest, then the two frames the arms rise through. */
export const LIFT_END_MS = HOLD_FRAME_MS[0] + HOLD_FRAME_MS[1] + HOLD_FRAME_MS[2];

/** How long he shows it off once it is up. A tap lets go sooner. */
export const SHOW_MS = 1600;

/** Drips off the held fish: one about this often, falling this far. */
export const DRIP_EVERY_MS = 280;
export const DRIP_FALL_PX = 7;
export const DRIP_MS = 420;

export interface FishFlight {
  /** Start to landing, in ms. */
  readonly ms: number;
  /** Which way it travels, and so which way its head points: +1 right, -1 left. */
  readonly heading: 1 | -1;
  /** Where it is `t` ms after leaving the water, clamped to the flight. */
  at(t: number): Point;
}

/**
 * The jump from the float to his hands: a real throw under `gravity`, peaking
 * `apex` above whichever end is higher, so it rises fast, hangs, and drops in.
 */
export function fishFlight(from: Point, to: Point, apex = FISH_APEX_PX, gravity = FISH_GRAVITY): FishFlight {
  const top = Math.min(from.y, to.y) - apex;
  const up = Math.sqrt((2 * (from.y - top)) / gravity);
  const down = Math.sqrt((2 * (to.y - top)) / gravity);
  const ms = up + down;
  const vx = (to.x - from.x) / ms;
  const vy = -gravity * up;
  return {
    ms,
    heading: to.x >= from.x ? 1 : -1,
    at(t: number): Point {
      const k = Math.min(ms, Math.max(0, t));
      return { x: from.x + vx * k, y: from.y + vy * k + 0.5 * gravity * k * k };
    },
  };
}

/**
 * Where the fish sits on him `t` ms after it lands, above his feet: at his
 * chest for the first frame, rising with his arms through the next two, then
 * held up.
 */
export function heldOffset(t: number): Point {
  if (t <= LIFT_START_MS) return FISH_AT_CHEST;
  if (t >= LIFT_END_MS) return FISH_OVERHEAD;
  const k = (t - LIFT_START_MS) / (LIFT_END_MS - LIFT_START_MS);
  const eased = 1 - (1 - k) * (1 - k);
  return {
    x: FISH_AT_CHEST.x + (FISH_OVERHEAD.x - FISH_AT_CHEST.x) * eased,
    y: FISH_AT_CHEST.y + (FISH_OVERHEAD.y - FISH_AT_CHEST.y) * eased,
  };
}

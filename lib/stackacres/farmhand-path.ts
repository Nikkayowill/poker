/**
 * How anyone on two legs crosses this map: the tile grid they aim at, and the
 * one frame of walking that gets them there.
 *
 * EXTRACTED, NOT NEW. Every function below was private to ./farmhand.ts and
 * is now shared with ./farmhand-machine.ts, because the two of them walk the
 * same man. A second copy of `advance` would be a second place for the
 * arrival dead-band and the delta clamp to drift apart, and both of those are
 * the kind of bug that only shows up as a permanent sub-pixel shuffle or a
 * hundred-unit teleport off a backgrounded tab -- neither of which reads as a
 * pathing bug when you finally see it.
 *
 * THE TILE GRID IS THE TARGETING SPACE, and that is the ordering this module
 * exists to enforce: a job names a TILE, `tileCentre` turns it into a world
 * point, the walk integrates in world units, and only the scene projects the
 * result through `isoProject` on its way to a sprite. Nothing here knows what
 * a screen coordinate is. Going the other way -- picking a target in screen
 * space and unprojecting it -- would put the pathing at the mercy of the
 * camera's zoom, which is exactly the coupling ./iso.ts's own header keeps
 * the rest of the scene clear of.
 *
 * Pure, and in lib/ for the usual reason: vitest only reaches lib/ and app/.
 */

import { STACKACRES_TILE, MAX_FRAME_MS, clampFrameMs, type WorldPoint } from "./world";

// Re-exported so every existing importer of this module's own `MAX_FRAME_MS`
// (this file used to declare it) keeps working unchanged -- ./world.ts is now
// the one place the constant and its clamp are defined.
export { MAX_FRAME_MS };

/* ------------------------------------------------------------------ */
/* The tile grid                                                       */
/* ------------------------------------------------------------------ */

/**
 * One cell of the world's own `STACKACRES_TILE` grid. Integer, and allowed to
 * be negative -- the world has no origin corner (the Wallow sits at
 * x -320, y -390), so a tile index is a plain floor divide and never an array
 * offset.
 */
export interface TileCoord {
  tx: number;
  ty: number;
}

/** Which tile a world point stands on. `Math.floor`, not a truncation, so
 *  a point at x -1 lands on tile -1 rather than sharing tile 0 with x +1. */
export function tileOf(point: WorldPoint): TileCoord {
  return {
    tx: Math.floor(point.x / STACKACRES_TILE),
    ty: Math.floor(point.y / STACKACRES_TILE),
  };
}

/** The middle of a tile, which is the only point in it anything ever walks
 *  to. Aiming at a corner would let two adjacent tiles' targets sit a
 *  sub-unit apart and read as the same destination. */
export function tileCentre(tile: TileCoord): WorldPoint {
  return {
    x: (tile.tx + 0.5) * STACKACRES_TILE,
    y: (tile.ty + 0.5) * STACKACRES_TILE,
  };
}

export function sameTile(a: TileCoord, b: TileCoord): boolean {
  return a.tx === b.tx && a.ty === b.ty;
}

/* ------------------------------------------------------------------ */
/* Walking                                                             */
/* ------------------------------------------------------------------ */

/**
 * World units a second. Faster than every animal here (a hen is 14, a cow 7)
 * because he is running an errand rather than grazing, and because the walk
 * is the part of this the player is waiting through.
 */
export const FARMHAND_SPEED = 20;

/** Arrival dead-band, in world units. Straight from `stepCritter`: a target
 *  reached within a stride is SNAPPED to rather than eased toward, which is
 *  what stops a walk ending in a permanent sub-pixel shuffle. */
export const ARRIVE_WITHIN = 0.75;

/** A raw Phaser delta as clamped seconds. The clamp is the whole content:
 *  every caller wants the same ceiling (`MAX_FRAME_MS`, ./world.ts's
 *  `clampFrameMs`) -- one that forgot it would fling a walker across the map
 *  on the first frame back from a sleeping tab. */
export function frameSeconds(dtMs: number): number {
  return clampFrameMs(dtMs) / 1000;
}

/**
 * Everything a walk reads and writes. Both `Farmhand` (./farmhand.ts) and
 * `FarmhandAutomation` (./farmhand-machine.ts) satisfy this structurally, so
 * `advanceTowards` moves either without either of them naming the other.
 */
export interface Walker {
  x: number;
  y: number;
  /**
   * Which way along the SCREEN's x axis he is heading: 1 right, -1 left.
   * Screen rather than world for the same reason `Critter.facing` is -- the
   * iso projection puts screen x at (world x - world y), so a step due +y
   * reads as leftward however its world x looks.
   */
  facing: 1 | -1;
  /**
   * The other half of the four isometric diagonals: 1 walking TOWARD the
   * camera (down the picture, growing x + y), -1 walking away from it. Two
   * signs, four combinations, and they are exactly the four diagonals a 2:1
   * tile has.
   */
  towards: 1 | -1;
  /** World units walked, ever. Drives the step-frame toggle, which is tied
   *  to DISTANCE rather than time for the same reason the animals' sway is. */
  travelled: number;
}

/**
 * Which way a step reads on screen. A step that is equal parts +x and +y runs
 * straight up or down the picture and is not a turn either way, so a tie
 * keeps the sign he already had rather than flipping him to some default
 * every time a target happens to land on the diagonal. Same rule, and same
 * reason, as `headingTo` in ./world.ts.
 */
function heading(along: number, current: 1 | -1): 1 | -1 {
  if (along === 0) return current;
  return along > 0 ? 1 : -1;
}

/** Both facing signs for a step, in one place so two callers can never drift
 *  apart on it. */
export function aim(walker: Walker, dx: number, dy: number): Pick<Walker, "facing" | "towards"> {
  return { facing: heading(dx - dy, walker.facing), towards: heading(dx + dy, walker.towards) };
}

export interface WalkStep<W extends Walker> {
  walker: W;
  /** True on the frame the target was reached and snapped to. */
  arrived: boolean;
}

/**
 * One frame of walking toward `target`, in WORLD units.
 *
 * Returns a new walker, never a mutated one -- same convention as
 * `stepCritter` and `stepGait`, and what lets a caller hold the previous
 * frame's state to compare against. `dt` is seconds and is expected to have
 * been through `frameSeconds` already; passing a raw millisecond delta here
 * is the one way to misuse this, and it shows up immediately as a walker who
 * finishes every trip on his first frame.
 *
 * `speedMultiplier` defaults to 1 (every caller before the Frenzy Heat Combo
 * Engine and the Synergy Tree gets exactly the speed it always did) and is
 * ONE COMBINED NUMBER, not a slot for either source alone: the scene
 * multiplies the Frenzy tier's real-time, never-persisted nudge
 * (`FrenzyTierDef.speedMultiplier`, lib/stackacres/frenzy.ts) by the
 * Synergy Tree's slow-changing, server-known one
 * (`StackAcresView.synergy.farmhandSpeedMultiplier`,
 * lib/stackacres/synergy-perks.ts) before it ever reaches here -- this
 * function has no opinion about where either half came from. It scales the
 * STRIDE only, not `ARRIVE_WITHIN`: a faster errand runner still snaps to a
 * target from the same distance he always did, he simply covers more ground
 * to get there each frame.
 */
export function advanceTowards<W extends Walker>(
  walker: W,
  target: WorldPoint,
  dt: number,
  speedMultiplier = 1,
): WalkStep<W> {
  const dx = target.x - walker.x;
  const dy = target.y - walker.y;
  const distance = Math.hypot(dx, dy);
  const stride = FARMHAND_SPEED * dt * speedMultiplier;
  const facing = aim(walker, dx, dy);

  if (distance <= Math.max(stride, ARRIVE_WITHIN)) {
    return {
      walker: { ...walker, ...facing, x: target.x, y: target.y, travelled: walker.travelled + distance },
      arrived: true,
    };
  }
  return {
    walker: {
      ...walker,
      ...facing,
      x: walker.x + (dx / distance) * stride,
      y: walker.y + (dy / distance) * stride,
      travelled: walker.travelled + stride,
    },
    arrived: false,
  };
}

/** Whether a walker is close enough to `target` to count as standing on it,
 *  independent of any step. What a caller uses to decide it does not need to
 *  walk at all -- a re-plan that lands him where he already is. */
export function withinReach(walker: Walker, target: WorldPoint, reach = ARRIVE_WITHIN): boolean {
  return Math.hypot(target.x - walker.x, target.y - walker.y) <= reach;
}

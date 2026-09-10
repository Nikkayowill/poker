/**
 * The Mower as a thing that rolls across the meadow: how far it moves in a
 * frame, where it may go, which way it faces, and which lawn stripe a pass
 * leaves. Pure so vitest reaches it; stackacres-scene.ts draws it.
 */

import type { WorldPoint } from "./world";
import { CROP_FIELD } from "./yard";

/** World units a second: edge to edge of the Crop Fields in about four seconds. */
export const MOWER_SPEED = 130;

/**
 * A press further than this from where the Mower is parked moves it straight
 * under the finger instead of driving over, which would mow a line across
 * the field the player never drew.
 */
export const MOWER_REGRAB_REACH = 120;

/** Kept this far inside the Crop Fields so the sprite never hangs over the edge. */
const EDGE_MARGIN = 10;

export function clampToMeadow(point: WorldPoint): WorldPoint {
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  return {
    x: clamp(point.x, CROP_FIELD.x + EDGE_MARGIN, CROP_FIELD.x + CROP_FIELD.width - EDGE_MARGIN),
    y: clamp(point.y, CROP_FIELD.y + EDGE_MARGIN, CROP_FIELD.y + CROP_FIELD.height - EDGE_MARGIN),
  };
}

/** One frame of driving toward `target`, never overshooting it. */
export function stepMowerToward(
  at: WorldPoint,
  target: WorldPoint,
  dtSeconds: number,
  speed: number = MOWER_SPEED,
): WorldPoint {
  const dx = target.x - at.x;
  const dy = target.y - at.y;
  const gap = Math.hypot(dx, dy);
  const reach = Math.max(0, dtSeconds) * speed;
  if (gap <= reach) return { x: target.x, y: target.y };
  return { x: at.x + (dx / gap) * reach, y: at.y + (dy / gap) * reach };
}

/**
 * The lawn stripe a pass leaves, 0 light or 1 dark, by which way it went
 * along whichever SCREEN axis it mostly followed. Measured on screen rather
 * than in world units because that is the direction the player drags in, so
 * rows dragged back and forth across the screen alternate. Null when it did
 * not move. The screen offsets are `isoProject`'s, minus its common scale.
 */
export function mowerStripe(from: WorldPoint, to: WorldPoint): 0 | 1 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  const screenX = dx - dy;
  const screenY = (dx + dy) / 2;
  const along = Math.abs(screenX) >= Math.abs(screenY) ? screenX : screenY;
  return along > 0 ? 0 : 1;
}

/** Which way the sprite faces on screen, 1 right or -1 left. A move straight
 *  up or down the screen keeps the facing it had. */
export function mowerFacing(from: WorldPoint, to: WorldPoint, previous: 1 | -1): 1 | -1 {
  const screenX = to.x - from.x - (to.y - from.y);
  if (Math.abs(screenX) < 1e-6) return previous;
  return screenX > 0 ? 1 : -1;
}

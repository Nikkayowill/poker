/** Fades a tree or building while the farmer is hidden behind it. Pure; components/arcade/stackacres-td/see-through.ts applies it. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How opaque something is while he is behind it. */
export const SEE_THROUGH_ALPHA = 0.42;

/** Ms to fade all the way out or back in. */
export const FADE_MS = 180;

/** World px. Rocks, bushes and fences are shorter than him and never fade. */
export const HIDES_FROM_HEIGHT = 24;

/** World px above its base where a faded thing still takes a tap. */
export const TAP_FOOT = 16;

/** Points on the farmer's body, from his feet (his standing frames are 18 x 32 px above them). */
export const BODY_POINTS: readonly Point[] = [
  { x: 0, y: -28 },
  { x: 0, y: -22 },
  { x: -6, y: -17 },
  { x: 6, y: -17 },
  { x: 0, y: -11 },
  { x: 0, y: -4 },
];

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Whether something this tall on screen can ever hide him. */
export function canHide(height: number): boolean {
  return height >= HIDES_FROM_HEIGHT;
}

/** Whether a thing in front of him (base south of his feet) covers part of his body with a real pixel. */
export function hidesFarmer(baseY: number, box: Box, feet: Point, opaqueAt: (x: number, y: number) => boolean): boolean {
  if (baseY <= feet.y) return false;
  for (const point of BODY_POINTS) {
    const x = feet.x + point.x;
    const y = feet.y + point.y;
    if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) continue;
    if (opaqueAt(x, y)) return true;
  }
  return false;
}

/** Cheap box test before any pixel is read. */
export function nearBody(box: Box, feet: Point): boolean {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of BODY_POINTS) {
    left = Math.min(left, feet.x + point.x);
    right = Math.max(right, feet.x + point.x);
    top = Math.min(top, feet.y + point.y);
    bottom = Math.max(bottom, feet.y + point.y);
  }
  return right >= box.x && left < box.x + box.width && bottom >= box.y && top < box.y + box.height;
}

/** One frame's step of the fade toward `target`, never past it. */
export function fadeStep(alpha: number, target: number, deltaMs: number): number {
  const step = ((1 - SEE_THROUGH_ALPHA) * deltaMs) / FADE_MS;
  if (alpha < target) return Math.min(target, alpha + step);
  return Math.max(target, alpha - step);
}

/** A faded thing lets taps through to what's behind it, except on its foot. */
export function tapPassesThrough(faded: boolean, baseY: number, tapY: number): boolean {
  return faded && tapY < baseY - TAP_FOOT;
}

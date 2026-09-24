/**
 * The fishing line: a rope from the rod tip to the float, stepped every frame.
 *
 * Verlet points held together by distance constraints, the usual game rope.
 * Both ends are pinned (the rod tip, which moves with the farmer's frames, and
 * the float), and `length` says how much line is out. More line than the gap
 * between the ends and it sags; the same or less and the constraints pull it
 * straight. That one number is how the scene says slack, taut, paying out on
 * a cast and reeling in.
 *
 * Stardew draws its line as a curve that droops toward the camera while the
 * float sits and goes straight while the fish is on (FishingRod.cs `draw`).
 * On a top-down map "down" on screen is toward the camera, so gravity here is
 * +y, same as its droop.
 *
 * Pure and renderer-free, same split as ./fishing-cast.ts.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rope {
  points: Point[];
  prev: Point[];
  /** How much line is out, rod tip to float, in map pixels. */
  length: number;
}

/** Joints along the line. Enough to curve smoothly at this size, few enough to cost nothing. */
export const LINE_POINTS = 14;

/** How hard the slack falls, in map pixels per second squared. The droop's depth is set by the
 *  line out (`length`); this only sets how fast it gets there after a throw leaves it hanging in the air. */
export const LINE_GRAVITY = 320;

/** Share of each point's speed kept per 16ms step; the rest is drag from the air and water. */
export const LINE_DAMPING = 0.84;

/** Constraint passes per step. More is stiffer. */
export const LINE_ITERATIONS = 24;

/** Line out while the float sits, against the straight gap: the slack that makes it droop. */
export const SLACK_WAITING = 1.14;

/** While a fish pulls: a touch shorter than the gap, so the constraints hold it straight. */
export const SLACK_TAUT = 0.9;

/** Just after a line goes slack on a lost fish: loose enough to fall in a lazy curve. */
export const SLACK_SNAPPED = 1.45;

export function createRope(from: Point, to: Point, length = distance(from, to)): Rope {
  const points: Point[] = [];
  for (let i = 0; i < LINE_POINTS; i++) {
    const t = i / (LINE_POINTS - 1);
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return { points, prev: points.map((p) => ({ ...p })), length };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * One step: move every free point by its own speed plus gravity, then pull
 * neighbours back to their share of `length`, with the two ends pinned to
 * `tip` and `float`. `dtMs` is clamped so a stalled tab does not fling it.
 */
export function stepRope(rope: Rope, tip: Point, float: Point, dtMs: number): void {
  const dt = Math.min(Math.max(dtMs, 0), 50) / 1000;
  const damping = Math.pow(LINE_DAMPING, (dt * 1000) / 16);
  const last = rope.points.length - 1;
  // A line pulled tight does not hang: gravity fades out as the slack runs out.
  const gap = distance(tip, float) || 1;
  const hang = Math.min(1, Math.max(0, (rope.length / gap - 1) * 6));
  for (let i = 1; i < last; i++) {
    const p = rope.points[i];
    const q = rope.prev[i];
    const vx = (p.x - q.x) * damping;
    const vy = (p.y - q.y) * damping;
    q.x = p.x;
    q.y = p.y;
    p.x += vx;
    p.y += vy + LINE_GRAVITY * hang * dt * dt;
  }
  pin(rope, 0, tip);
  pin(rope, last, float);
  const segment = rope.length / last;
  for (let pass = 0; pass < LINE_ITERATIONS; pass++) {
    for (let i = 0; i < last; i++) {
      const a = rope.points[i];
      const b = rope.points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      // Rope, not rod: it only ever pulls. A segment shorter than its share is left to sag.
      if (d <= segment) continue;
      const push = (d - segment) / d;
      const aFree = i !== 0;
      const bFree = i + 1 !== last;
      if (aFree && bFree) {
        a.x += dx * push * 0.5;
        a.y += dy * push * 0.5;
        b.x -= dx * push * 0.5;
        b.y -= dy * push * 0.5;
      } else if (aFree) {
        a.x += dx * push;
        a.y += dy * push;
      } else if (bFree) {
        b.x -= dx * push;
        b.y -= dy * push;
      }
    }
  }
}

function pin(rope: Rope, i: number, at: Point): void {
  rope.points[i].x = at.x;
  rope.points[i].y = at.y;
  rope.prev[i].x = at.x;
  rope.prev[i].y = at.y;
}

/** A shake along the line: every free point nudged across it, strongest mid-line. For the bite and the fight. */
export function twitchRope(rope: Rope, strength: number, random: () => number = Math.random): void {
  const last = rope.points.length - 1;
  for (let i = 1; i < last; i++) {
    const mid = 1 - Math.abs(i / last - 0.5) * 2;
    rope.points[i].x += (random() - 0.5) * strength * mid;
    rope.points[i].y += (random() - 0.5) * strength * mid;
  }
}

/** How far the middle of the line hangs below the straight line between its ends. */
export function sag(rope: Rope): number {
  const a = rope.points[0];
  const b = rope.points[rope.points.length - 1];
  const mid = rope.points[Math.floor(rope.points.length / 2)];
  const len = distance(a, b) || 1;
  // Signed distance from the chord, positive toward +y (toward the camera).
  return ((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) / len * Math.sign(b.x - a.x || 1);
}

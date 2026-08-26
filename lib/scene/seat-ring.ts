/**
 * Where a seat sits on the ring, as an angle.
 *
 * The racetrack's own chip animation (`lib/scene/chips/chip-scene.ts`) reads
 * this to place a chip pile at a seat's position on the arc. Everything else
 * that used to live in this file -- the classic room's world-space anchors
 * for the bet spot, the tray, the pot -- went with the classic room; see
 * `lib/scene/table-anchors.ts` for the racetrack's equivalents, which are
 * real metres rather than a fraction of this angle's radius.
 */

/**
 * Slot 0 faces the viewer. Screen-space Y grows downward and world-space Z
 * grows *toward* the viewer, so where table-geometry.ts takes sin(theta) as
 * "further down the screen", this takes it as "nearer": the same 90-degree
 * offset, read in the axis this scene actually has.
 */
const NEAR_ANGLE_DEG = 90;

/** The angle, in radians, of ring slot `slot` on a ring of `count`. */
export function seatAngle(slot: number, count: number): number {
  if (count <= 0) return 0;
  return ((NEAR_ANGLE_DEG + (slot * 360) / count) * Math.PI) / 180;
}

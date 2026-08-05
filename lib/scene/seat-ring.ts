/**
 * Where a seat is, in the room.
 *
 * The 3D counterpart of `lib/game/table-geometry.ts`, and deliberately built
 * on the same convention rather than a fresh one: slot 0 is the near edge --
 * the chair the local player is sitting in -- and slots advance clockwise
 * from there, so ring slot N addresses the same player in both systems. Two
 * layouts that disagreed about which chair slot 2 meant would put a WebGL
 * avatar under someone else's DOM nameplate, and nothing would throw.
 *
 * The difference is what the ellipse *is*. In the DOM the ellipse is the
 * drawing: a circle already flattened by hand to fake a tilted camera. Here
 * the ring is a real ellipse on a real floor and the camera does the
 * flattening itself, so the foreshortening comes out of the projection
 * instead of being baked into the radii.
 */

import { FELT, LAYERS, SEAT_RING, type Vec3 } from "./scene-config";

/**
 * Slot 0 faces the camera. Screen-space Y grows downward and world-space Z
 * grows *toward* the camera, so where table-geometry.ts takes sin(theta) as
 * "further down the screen", this takes it as "nearer the viewer" -- the same
 * 90-degree offset, read in the axis this scene actually has.
 */
const NEAR_ANGLE_DEG = 90;

export interface SeatPlacement {
  /** Where the avatar sprite's centre column stands. */
  position: Vec3;
  /** Where this seat's chair back sits, further out along the same ray. */
  chairPosition: Vec3;
  /**
   * 0 at the far rail, 1 nearest the camera. The same quantity
   * `table-geometry.ts` exposes as `depth`, and it means the same thing --
   * but here it is used to decide how much of the rim a sprite is allowed to
   * hide behind, not to pick a z-index.
   */
  nearness: number;
  /**
   * Rotation about Y that turns a flat plane to face the table's centre.
   * The chair backs use it; the avatar sprites do not, because a sprite
   * billboards to the camera and a rotation would be discarded.
   */
  facing: number;
}

/** The angle, in radians, of ring slot `slot` on a ring of `count`. */
export function seatAngle(slot: number, count: number): number {
  if (count <= 0) return 0;
  return ((NEAR_ANGLE_DEG + (slot * 360) / count) * Math.PI) / 180;
}

/**
 * A point on the seat ellipse, scaled outward from the felt by `scale`.
 *
 * Exposed on its own because three different rings are concentric with it --
 * the avatars, the chair backs and (in `room.ts`) the rim -- and they must
 * share one ellipse or a chair will drift out from behind its occupant on the
 * sides of the table while still looking correct front and back.
 */
export function ringPoint(slot: number, count: number, scale: number, y = 0): Vec3 {
  const theta = seatAngle(slot, count);
  return {
    x: FELT.radiusX * SEAT_RING.radiusScale * scale * Math.cos(theta),
    y,
    z: FELT.radiusZ * SEAT_RING.radiusScale * scale * Math.sin(theta),
  };
}

/**
 * Everything the renderer needs to place one player.
 *
 * `figureSink` is subtracted from the rim height rather than added to the
 * floor: the artwork is a half-body that begins at the waist, so anchoring it
 * to the floor would leave a torso floating a metre above an empty chair. It
 * hangs from the rail instead, which is the one line in the room the figure
 * was drawn to meet.
 */
export function seatPlacement(slot: number, count: number): SeatPlacement {
  const theta = seatAngle(slot, count);
  const avatar = ringPoint(slot, count, LAYERS.avatar.ringScale, LAYERS.rim.y - SEAT_RING.figureSink);
  const chair = ringPoint(slot, count, LAYERS.chair.ringScale, LAYERS.chair.y);
  return {
    position: avatar,
    chairPosition: chair,
    nearness: (Math.sin(theta) + 1) / 2,
    // atan2(x, z) rather than the usual (z, x): a plane's default normal is
    // +Z, so this is the rotation that swings that normal onto the inward
    // ray, which is what "the chair faces the table" means.
    facing: Math.atan2(-chair.x, -chair.z),
  };
}

/**
 * Where a seat's chips leave from when it bets.
 *
 * Not the seat itself: chips are pushed forward onto the felt, so they start
 * on the table surface a little inside the rail rather than at the player's
 * chest. Interpolating from the felt's own radius toward the centre keeps
 * that offset proportional on a table whose ellipse is far wider than it is
 * deep -- a fixed inset would look right at the sides and wrong front and
 * back.
 */
export function seatBetOrigin(slot: number, count: number): Vec3 {
  const theta = seatAngle(slot, count);
  const inset = 0.74;
  return {
    x: FELT.radiusX * inset * Math.cos(theta),
    y: FELT.y,
    z: FELT.radiusZ * inset * Math.sin(theta),
  };
}

/**
 * The middle of the felt, where the pot sits.
 *
 * A named export rather than a bare origin because it is the target of every
 * chip in the room, and the one point the DOM's `.pot-anchor` has to agree
 * with. If the pot ever moves off centre, it moves here.
 */
export const POT_POSITION: Vec3 = { x: 0, y: FELT.y, z: 0 };

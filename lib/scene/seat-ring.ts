/**
 * Where a seat is, in the room.
 *
 * The world-space counterpart of `lib/game/table-geometry.ts`, and
 * deliberately built on the same convention rather than a fresh one: slot 0
 * is the near edge — the chair the local player is sitting in — and slots
 * advance clockwise from there, so ring slot N addresses the same player in
 * both systems. Two layouts that disagreed about which chair slot 2 meant
 * would land a payout under someone else's nameplate, and nothing would
 * throw.
 */

import { FELT, SEAT_RING, type Vec3 } from "./scene-config";

/**
 * Slot 0 faces the viewer. Screen-space Y grows downward and world-space Z
 * grows *toward* the viewer, so where table-geometry.ts takes sin(theta) as
 * "further down the screen", this takes it as "nearer" — the same 90-degree
 * offset, read in the axis this scene actually has.
 */
const NEAR_ANGLE_DEG = 90;

export interface SeatPlacement {
  /** Where the seat sits on the ring, at table height. */
  position: Vec3;
  /** 0 at the far rail, 1 nearest the viewer. Same meaning as the DOM's. */
  nearness: number;
}

/** The angle, in radians, of ring slot `slot` on a ring of `count`. */
export function seatAngle(slot: number, count: number): number {
  if (count <= 0) return 0;
  return ((NEAR_ANGLE_DEG + (slot * 360) / count) * Math.PI) / 180;
}

/**
 * A point on the seat ellipse, scaled outward from the felt by `scale`.
 *
 * Exposed on its own because everything aimed at a player shares it — the
 * seat anchors, the payout landing spots — and they must share one ellipse
 * or a payout drifts out from under the seat it was pushed to.
 */
export function ringPoint(slot: number, count: number, scale: number, y = 0): Vec3 {
  const theta = seatAngle(slot, count);
  return {
    x: FELT.radiusX * SEAT_RING.radiusScale * scale * Math.cos(theta),
    y,
    z: FELT.radiusZ * SEAT_RING.radiusScale * scale * Math.sin(theta),
  };
}

/** Everything the renderer needs to aim at one player. */
export function seatPlacement(slot: number, count: number): SeatPlacement {
  const theta = seatAngle(slot, count);
  return {
    position: ringPoint(slot, count, 1, FELT.y),
    nearness: (Math.sin(theta) + 1) / 2,
  };
}

/**
 * Where a seat's chips leave from when it bets.
 *
 * Not the seat itself: chips are pushed forward onto the felt, so they start
 * on the table surface a little inside the rail rather than at the player's
 * chest. Interpolating from the felt's own radius toward the centre keeps
 * that offset proportional on a table whose ellipse is far wider than it is
 * deep — a fixed inset would look right at the sides and wrong front and
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

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
export function ringPoint(
  slot: number,
  count: number,
  scale: number,
  y = 0,
  radiusZ: number = FELT.radiusZ,
): Vec3 {
  const theta = seatAngle(slot, count);
  return {
    x: FELT.radiusX * SEAT_RING.radiusScale * scale * Math.cos(theta),
    y,
    z: radiusZ * SEAT_RING.radiusScale * scale * Math.sin(theta),
  };
}

/** Everything the renderer needs to aim at one player. */
export function seatPlacement(slot: number, count: number, radiusZ: number = FELT.radiusZ): SeatPlacement {
  const theta = seatAngle(slot, count);
  return {
    position: ringPoint(slot, count, 1, FELT.y, radiusZ),
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
export function seatBetOrigin(slot: number, count: number, radiusZ: number = FELT.radiusZ): Vec3 {
  const theta = seatAngle(slot, count);
  const inset = 0.74;
  return {
    x: FELT.radiusX * inset * Math.cos(theta),
    y: FELT.y,
    z: radiusZ * inset * Math.sin(theta),
  };
}

/**
 * How far back from the middle the pot sits, as a fraction of the felt's
 * depth. Measured *away from the viewer* — the sign is applied below.
 *
 * Not zero, and that is the whole point of it. The board is laid across the
 * middle of the cloth (`.community-cards`, `top: 51%` — 47% on a phone), so
 * a pot at the felt's own centre is stacked *on the flop*: five cards and a
 * pile of chips competing for one spot, each hiding the other, on a table
 * with room to spare in front of and behind them.
 *
 * Behind the board rather than in front of it, and that direction is a real
 * invariant rather than a preference. The near half of the felt is spoken
 * for at every breakpoint: the local player's own figure is `SEAT_HEIGHT_
 * RATIO` (0.30) of the table tall and sits on the near rail, with their hole
 * cards beside it, so on a wide plate it reaches most of the way to the
 * middle. A pot pushed toward the viewer lands behind the player's own head
 * — measured at 1440x900, where the near figure's crown is 11px below the
 * board's bottom edge. The far half has only the opposite nameplate in it,
 * which sits above the felt entirely. It is also where this app has always
 * said the pot lives: `--deck-y: 26%` in app/styles/06-table.css is the
 * point every dealt card and every muck already flies from.
 *
 * A fraction rather than a world constant so it tracks the plate: the felt
 * is a wide shallow oval on a desktop and a long deep one on a portrait
 * phone, and a fixed offset that cleared the board on one would sit on the
 * board or off the felt on the other.
 *
 * Known limit: a landscape phone has no clearance to find. `--table-aspect`
 * is 3.6 there, so the board is 108px tall inside a felt only 150px tall and
 * nothing can be both on the cloth and off the cards. The pot rides as high
 * as the felt allows and still overlaps; that is a board-size problem, not a
 * pot-position one, and it is no worse than the dead-centre it replaced.
 */
export const POT_DEPTH_FRACTION = 0.55;

/**
 * Where the pot sits, on a felt of this depth.
 *
 * A function rather than the constant it used to be, because the felt's plan
 * depth is now per-fit (see `SceneView.radiusZ`): the same fraction has to
 * resolve to a different world Z on a phone than on a desktop, or the pot
 * drifts off the far edge of the shallower table. It is still the one point
 * every chip in the room agrees on — the pile syncs here, bets sweep here,
 * and the payout funnel leaves from here.
 */
export function potPosition(radiusZ: number = FELT.radiusZ): Vec3 {
  // Negative Z is away from the viewer: world Z grows *toward* the chair the
  // local player is sitting in (see `NEAR_ANGLE_DEG` above).
  return { x: 0, y: FELT.y, z: -radiusZ * POT_DEPTH_FRACTION };
}

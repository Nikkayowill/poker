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
 * How far in from the rail an ordinary seat pushes its chips, as a fraction
 * of the felt's own radius.
 */
const BET_INSET = 0.74;

/**
 * The same, for slot 0 — the chair the local player is sitting in.
 *
 * Shallower, and it has to be, because slot 0 is the one seat whose figure is
 * drawn *over the cloth*. Every `.seat-figure` is a square box centred on its
 * point of the DOM ellipse (`aspect-ratio: 1`, centred by `.seat-ring`'s
 * negative margins) and the artwork is anchored to the box's base, so a
 * figure occupies the space *above* its seat. For the five opponents "above"
 * points away from the table and their chips sit on open felt below them. For
 * the near seat "above" points at the middle of the table, straight across
 * the bet spot — so at the ordinary inset the local player's own avatar is
 * painted on top of their own bet, and the canvas can never win that fight:
 * `.table-scene` is `z-index: 0` and `.seat-figure` is `z-index: 4` and up.
 *
 * The symptom was that the local player is the only one at the table who
 * cannot see their chips go out. The chips were flying and landing correctly
 * the whole time; they were landing behind the player's own chest.
 *
 * The value is the middle of a genuinely narrow corridor, and it was measured
 * rather than reasoned. The near seat's chips have two things to stay clear
 * of: its own figure below, and the board (`.community-cards`, `top: 51%`)
 * above. At 1440x900 the figure's box starts at y=549 and the board's cards
 * end at y=527, so the whole corridor is about 20px of cloth, which in inset
 * units is [0.315, 0.388]. This sits in the centre of it: the bet lands at
 * y=541, clearing the figure's crown by 8px and the bottom of the board by
 * 14px. The ordinary inset put it at y=613 — 64px inside the player's own
 * avatar, at about chest height.
 *
 * 0.30 is the obvious round number here and it is *just* outside that window:
 * it lands the chip's centre at y=531, and a chip's painted face is about
 * 13px tall in each direction at this scale, so its top edge crosses the
 * board's bottom card by ~9px. Hence 0.35 rather than 0.3.
 *
 * Known limit, and it is the same one `POT_DEPTH_FRACTION` documents: on a
 * landscape phone the corridor does not exist. `--table-aspect` is 3-3.6
 * there, so the felt is only ~150px deep, and the board's box already ends
 * 35px *below* where the near figure's box begins — the two overlap each
 * other before any chip is placed. No inset can be both below the board and
 * above the figure. This value still lifts the bet from 39px inside the
 * figure to about 7px, which is most of the defect, and the rest is a
 * plate-depth problem rather than a bet-spot one.
 */
const NEAR_SEAT_BET_INSET = 0.35;

/** Slot 0 is the near edge — see `NEAR_ANGLE_DEG`. */
const NEAR_SLOT = 0;

/**
 * Where a seat's chips leave from when it bets.
 *
 * Not the seat itself: chips are pushed forward onto the felt, so they start
 * on the table surface a little inside the rail rather than at the player's
 * chest. Interpolating from the felt's own radius toward the centre keeps
 * that offset proportional on a table whose ellipse is far wider than it is
 * deep — a fixed inset would look right at the sides and wrong front and
 * back.
 *
 * Slot 0 gets its own, shallower inset. That asymmetry is not a fudge: it is
 * the one seat with a figure standing between it and the pot. See
 * `NEAR_SEAT_BET_INSET`.
 */
export function seatBetOrigin(slot: number, count: number, radiusZ: number = FELT.radiusZ): Vec3 {
  const theta = seatAngle(slot, count);
  const inset = slot === NEAR_SLOT ? NEAR_SEAT_BET_INSET : BET_INSET;
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

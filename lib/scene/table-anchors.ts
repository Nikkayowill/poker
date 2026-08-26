/**
 * The 2.5D table: a real racetrack table, seen from a low seated camera.
 *
 * This is the geometry layer only: felt, rail, table body, six seats, the
 * dealer, and the camera that frames them. Nothing here draws a character.
 *
 * The camera is a true perspective camera, not the orthographic tilt the
 * rest of `lib/scene/` uses. An orthographic tilt gives a plan view: the
 * table reads as an oval lying flat on the screen with seats ringed evenly
 * around it, near and far the same size. What we want is the view from a
 * player's own chair, the near rail close and wide, the far rail
 * compressed, opponents stacked in the upper half of the frame, the local
 * player's own seat under the camera. Only a real perspective divide does
 * that; a tilt angle cannot, however low you set it.
 *
 * Everything is in metres, real numbers rather than arbitrary units: a
 * casino table is 2.13 x 1.07 m with a ~0.14 m padded rail and a 0.75 m
 * playing height, and a seated person's head is about 1.25 m off the
 * floor. Stating them in their own units means they can be checked against
 * reality instead of only against each other.
 */

import { offsetStadium, stadiumOutline, type StadiumPoint } from "./table-shape";

/** A plain XYZ triple. X across the table, Y up from the floor, Z toward the camera. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const FLOOR_Y = 0;

/* ---------------------------------------------------------------------- *
 * The table itself
 * ---------------------------------------------------------------------- */

/** Outer edge of the table, rail included: a real casino 6-max top. */
export const TABLE_LENGTH_M = 2.13;
export const TABLE_WIDTH_M = 1.07;

/** Padded rail width. Real rails run 5-6 inches. */
export const RAIL_WIDTH = 0.08;

/** Height of the playing surface off the floor. */
export const FELT_TOP_Y = 0.75;

/** How far the rail's padded cushion rises above the felt. */
export const RAIL_LIP_HEIGHT = 0.025;

/**
 * Thickness of the tabletop slab below the rail: the table's "girth".
 *
 * This is what makes the table read as a solid object on a floor rather
 * than a shape painted onto the background. From a low camera you see this
 * side wall all the way round the near half, and the eye reads it as mass.
 * A flat outline has no such edge and always looks pasted on.
 */
export const SLAB_THICKNESS = 0.16;

/** Underside of the tabletop slab; the pedestal carries it from here down. */
export const SLAB_BOTTOM_Y = FELT_TOP_Y - SLAB_THICKNESS;

/** The plinth under the slab, as a plan inset from the table's outer edge.
 * Not a full-size box: a real table is carried on a central pedestal, and
 * the daylight between the floor and the slab's overhang is a big part of
 * why it reads as furniture. */
export const PEDESTAL_INSET = 0.42;

export const TABLE_OUTER = {
  halfLength: TABLE_LENGTH_M / 2,
  halfWidth: TABLE_WIDTH_M / 2,
} as const;

/** The green playing surface: the outer top, less the rail all round. */
export const FELT = offsetStadium(TABLE_OUTER.halfLength, TABLE_OUTER.halfWidth, -RAIL_WIDTH);

export const PEDESTAL = offsetStadium(TABLE_OUTER.halfLength, TABLE_OUTER.halfWidth, -PEDESTAL_INSET);

/* ---------------------------------------------------------------------- *
 * Who sits where
 * ---------------------------------------------------------------------- */

/** How far behind the table's outer edge a player's chest sits. */
export const SEAT_SETBACK = 0.16;

/** The dealer sits closer in than a player: they're working at the table,
 * reaching the board and the pot, not sitting back from it. */
export const DEALER_SETBACK = 0.1;

/**
 * The crown of a seated figure: the top of the head, not its centre.
 *
 * The camera fit clamps against the crown rather than the centre, because
 * a fit that keeps head centres on screen crops the tops of everyone's
 * heads by exactly one head radius. That's not hypothetical: it's what the
 * first render with real figures in it did.
 *
 * This is also the one measurement in the file that isn't the real-world
 * one. A real adult seated at a 0.75 m table has their crown about 1.25 m
 * off the floor, half a metre of air above the cloth. At that height the
 * players would float clear of the rail with a visible gap, since at this
 * camera angle half a metre of height covers far more screen than the
 * 0.16 m of depth that sets them behind it.
 *
 * The reference art solves this the way stylized character art usually
 * does: figures are drawn small against the table so their heads sit just
 * above the rail. Measured off it, crowns land about 0.35 m above the
 * cloth. Importing real proportions later should scale the figures to
 * this, not raise this to match them.
 */
export const SEATED_HEAD_Y = FELT_TOP_Y + 0.35;

/** The dealer sits a little higher than the players, as they do in a room. */
export const DEALER_HEAD_Y = FELT_TOP_Y + 0.41;

export const SEAT_COUNT = 6;

/** Plan angles: 90deg is the near edge (the camera's own chair), 270deg the
 * far edge. x = cos(theta), z = sin(theta), the same convention
 * `lib/scene/seat-ring.ts` already uses, so a slot means the same chair in
 * both. */
const NEAR_ANGLE_DEG = 90;
const FAR_ANGLE_DEG = 270;

/**
 * The dealer's own place: dead centre of the far rail, at the table.
 *
 * A real oval table has a dealer cutout, a 30-36 inch notch centred on one
 * long side with players seated around the rest, so "the dealer is at far
 * centre" is the real table's own layout, not a rendering convenience. The
 * reference this table is modelled on does the same thing.
 *
 * This also means there is no player seat at far centre. An earlier cut of
 * this file read "behind the far rail" literally and parked the dealer
 * several metres back, behind the whole seat ring, so she stood in the
 * room rather than working at the table while slot 3 kept the seat
 * directly opposite the camera. Only one of them can have that spot, and
 * on a real table it belongs to the dealer.
 */
export const DEALER_ANGLE_DEG = FAR_ANGLE_DEG;

/**
 * How far apart neighbouring places sit around the rail.
 *
 * The five opponents do not ring the whole table. They cluster across the
 * far arc, flanking the dealer, and the table's own left and right tips
 * stick out past the outermost of them with nobody sitting there.
 *
 * Getting this wrong is what made the first two cuts of this file read as
 * the wrong game: a ring spread evenly over the whole table puts a player
 * at each end, out at the widest point of the plan, so the seats rather
 * than the table become the widest thing on screen, the camera has to
 * retreat to fit them, and the table shrinks to about half the frame.
 * Clustering them on the far arc makes the table the widest thing, which
 * lets it fill the frame the way the reference does, and puts the whole
 * crowd in the upper band where the local player's HUD isn't competing
 * with them.
 *
 * 20deg is measured off the reference rather than picked, against a
 * specific test: the outermost opponents sit just inside the table's own
 * tips, never past them. At 24 the end seats overhang the tips by about
 * 0.1 m, enough to put a head out over bare floor with no table under it,
 * the giveaway that the crowd is orbiting the table rather than sitting
 * at it.
 */
const SEAT_SPACING_DEG = 20;

/**
 * Three places sit left of the dealer and two right at a full table, and
 * the lopsidedness is forced rather than chosen. Five seats cannot be
 * arranged symmetrically about a centre that is itself occupied: symmetry
 * with an odd count needs one seat at the middle, and the middle is the
 * dealer's. The reference does the same thing (count its chairs: three to
 * the dealer's left, two to the right) and nobody notices, because at this
 * angle the far arc reads as one crowd rather than two counted groups.
 */
/**
 * Seat slots, in the order the brief names them: slot 0 is the local
 * player's own chair (the camera's own position, so no figure is ever
 * drawn there), then round the table left to right.
 *
 * Slot 3 is no longer the seat opposite. That place belongs to the dealer,
 * for the reason `DEALER_ANGLE_DEG` gives; slot 3 is the last chair on the
 * dealer's left.
 *
 * This solves for the table's actual headcount rather than a fixed six,
 * because the game seats anywhere from two to six and a fixed six-slot
 * table would leave a short-handed hand with gaps in the middle of the
 * crowd while the outermost chairs stay occupied, which reads as players
 * having stood up and walked round rather than as a smaller game.
 *
 * The rule generalises the six-handed layout rather than replacing it: the
 * opponents flank the dealer at `SEAT_SPACING_DEG` intervals, with the
 * extra chair going to the dealer's left when the count is odd. At six that
 * reproduces the measured 3/2 split exactly (210, 230, 250 | 290, 310), so
 * the composition this module was tuned against is the six-handed case of
 * one general rule.
 *
 * The ordering matters as much as the angles: slots advance the same way
 * `lib/game/table-geometry.ts`'s ring does, monotonically increasing angle
 * from the near chair, so ring slot N addresses the same player in both
 * systems. Two layouts that disagreed about which chair slot 2 meant would
 * put a payout under someone else's nameplate, and nothing would throw.
 */
export function seatAnglesDeg(count: number = SEAT_COUNT): number[] {
  const seats = Math.max(1, Math.floor(count));
  const opponents = seats - 1;
  // The odd chair goes left, matching the reference's own 3/2 split; see
  // the note above for why five seats cannot be symmetric about an
  // occupied centre.
  const left = Math.ceil(opponents / 2);
  const right = opponents - left;
  return [
    NEAR_ANGLE_DEG,
    ...Array.from({ length: left }, (_, i) => FAR_ANGLE_DEG - (left - i) * SEAT_SPACING_DEG),
    ...Array.from({ length: right }, (_, i) => FAR_ANGLE_DEG + (i + 1) * SEAT_SPACING_DEG),
  ];
}

const SEAT_ANGLES_DEG: readonly number[] = seatAnglesDeg(SEAT_COUNT);

export const SEAT_LABELS: readonly string[] = [
  "seat0 · you (camera)",
  "seat1 · far left",
  "seat2 · left of dealer",
  "seat3 · dealer's left",
  "seat4 · dealer's right",
  "seat5 · far right",
];

/** The local player's slot. Drawn as a HUD along the bottom of the frame,
 * never as a figure at the table, since the camera sits in this chair. */
export const HERO_SLOT = 0;

const SEAT_RING = offsetStadium(TABLE_OUTER.halfLength, TABLE_OUTER.halfWidth, SEAT_SETBACK);
const DEALER_RING = offsetStadium(TABLE_OUTER.halfLength, TABLE_OUTER.halfWidth, DEALER_SETBACK);

interface StadiumRadii {
  halfLength: number;
  halfWidth: number;
}

function ringPoint(angleDeg: number, radii: StadiumRadii): { x: number; z: number } {
  const theta = (angleDeg * Math.PI) / 180;
  return { x: radii.halfLength * Math.cos(theta), z: radii.halfWidth * Math.sin(theta) };
}

export function seatAngleDeg(slot: number, count: number = SEAT_COUNT): number {
  const angles = count === SEAT_COUNT ? SEAT_ANGLES_DEG : seatAnglesDeg(count);
  return angles[Math.min(Math.max(slot, 0), angles.length - 1)];
}

/**
 * Per-seat position offsets (in metres).
 *
 * IMPORTANT: this is 3D table space, not screen space.
 * - x: left (-) / right (+) on the felt
 * - y: height ABOVE the floor (-) below / (+) above. Leave at 0.
 * - z: forward toward the camera (+) / back away from the camera (-). This
 *   is the axis that reads as up/down on screen: negative z (away) moves
 *   a seat up and further back on screen.
 */
export const SEAT_OFFSET_PER_SEAT: Vec3[] = [
  { x: 0, y: 0, z: 0 }, // seat 0 (you, camera)
  { x: 0, y: 0, z: 0 }, // seat 1 (far left)
  { x: 0, y: 0, z: 0 }, // seat 2 (left of dealer) — moved back
  { x: 0.02, y: 0, z: -0.0 }, // seat 3 (dealer's left)
  { x: 0.0, y: 0, z: 0 }, // seat 4 (dealer's right)
  { x: 0, y: 0, z: 0 }, // seat 5 (far right)
];

/** Where a player sits, at the floor -- the base of their chair. */
export function seatAnchor(slot: number, count: number = SEAT_COUNT): Vec3 {
  const { x, z } = ringPoint(seatAngleDeg(slot, count), SEAT_RING);
  const offset = SEAT_OFFSET_PER_SEAT[Math.min(Math.max(slot, 0), SEAT_OFFSET_PER_SEAT.length - 1)] ?? { x: 0, y: 0, z: 0 };
  return {
    x: x + offset.x,
    y: FLOOR_Y + offset.y,
    z: z + offset.z
  };
}

/** The top of a seated player's head, for the camera fit. */
export function seatHead(slot: number, count: number = SEAT_COUNT): Vec3 {
  const seat = seatAnchor(slot, count);
  return { x: seat.x, y: SEATED_HEAD_Y, z: seat.z };
}

/** The dealer, at the centre of the far rail. Never one of the six seats. */
export function dealerAnchor(): Vec3 {
  const { x, z } = ringPoint(DEALER_ANGLE_DEG, DEALER_RING);
  return { x, y: FLOOR_Y, z };
}

export function dealerHead(): Vec3 {
  const dealer = dealerAnchor();
  return { x: dealer.x, y: DEALER_HEAD_Y, z: dealer.z };
}

/**
 * How wide a figure at this seat may be drawn without colliding with its
 * neighbour, in metres.
 *
 * Exported because it's a real budget somebody will spend, and because
 * it's not obvious: five figures clustered on the far arc have far less
 * elbow room than five figures spread around a whole table. Measured
 * rather than assumed: the first render used a true 0.46 m adult shoulder
 * width and the six figures overlapped into one solid wall of bodies,
 * wider than the table they sat at. No arrangement of real-sized people
 * fits this arc, so the art has to be narrower than life, the same
 * conclusion `SEATED_HEAD_Y` reaches about height.
 *
 * Returns the gap to the nearest neighbour, so a figure drawn at exactly
 * this width just touches it. Art should sit some way inside it.
 */
export function seatShoulderRoom(slot: number, count: number = SEAT_COUNT): number {
  const here = seatAnchor(slot, count);
  let closest = Infinity;
  const neighbours: Vec3[] = [dealerAnchor()];
  for (let other = 1; other < count; other += 1) {
    if (other !== slot) neighbours.push(seatAnchor(other, count));
  }
  for (const neighbour of neighbours) {
    closest = Math.min(closest, Math.hypot(here.x - neighbour.x, here.z - neighbour.z));
  }
  return closest;
}

/**
 * How wide the dealer may be drawn before she touches the chairs beside her.
 *
 * Her own budget rather than a seat's, because she does not have a seat's
 * neighbours: she sits at far centre with a chair to each side, so the two
 * gaps that bound her are the ones `seatShoulderRoom` would never measure.
 * She also sits closer in than a player (`DEALER_SETBACK` against
 * `SEAT_SETBACK`), which moves her relative to both of them.
 */
export function dealerShoulderRoom(count: number = SEAT_COUNT): number {
  const dealer = dealerAnchor();
  let closest = Infinity;
  for (let slot = 1; slot < count; slot += 1) {
    const seat = seatAnchor(slot, count);
    closest = Math.min(closest, Math.hypot(dealer.x - seat.x, dealer.z - seat.z));
  }
  return Number.isFinite(closest) ? closest : TABLE_WIDTH_M;
}

/* ---------------------------------------------------------------------- *
 * What sits on the felt
 * ---------------------------------------------------------------------- */

/** The board sits just past the middle, toward the dealer. */
export const BOARD_DEPTH_FRACTION = 0.12;
export function communityCardsAnchor(): Vec3 {
  return { x: 0, y: FELT_TOP_Y, z: -FELT.halfWidth * BOARD_DEPTH_FRACTION };
}

/**
 * A real poker card is 63mm wide, ISO 216-adjacent "poker size", matching
 * the proportion `.playing-card`'s `aspect-ratio: .7` already assumes.
 * Sizing the board off this rather than a breakpoint clamp is what makes
 * it small and proportionate on this specific table, the same way seats
 * and chips are sized from the live camera rather than eyeballed: at
 * 1.07m of felt width, 63mm reads as about 6% of the cloth, well under the
 * classic room's own `.community-cards .playing-card` ceiling of 76px,
 * which this camera used to inherit unchanged before it had a rule of its
 * own.
 */
export const BOARD_CARD_WIDTH_M = 0.063;

/**
 * The gap between a "just revealed" card and its neighbour -- the turn
 * joining the flop, the river joining the turn. A fraction of the card's own
 * width rather than a fixed number, so five cards read as a laid row at
 * every size instead of drifting apart on a big desktop frame.
 */
export const BOARD_CARD_REVEAL_GAP_FRACTION = 0.14;

/**
 * How far the flop's three cards overlap each other -- corners just
 * touching, like a dealer laying them in a loose fan, not stacked deep
 * enough to eat a neighbour's pips. Only the flop: the turn and river keep
 * `BOARD_CARD_REVEAL_GAP_FRACTION`'s ordinary gap instead, because that gap
 * is the signal a new card just arrived. Overlapping all five evenly would
 * compress the row further but erase that signal.
 */
export const BOARD_CARD_FLOP_OVERLAP_FRACTION = 0.06;

/** The pot rests between the board and the dealer, never under the board.
 * Pulled a bit further toward the dealer than a straight midpoint would put
 * it: bigger board cards (RACETRACK_BOARD_CARD_MAX_PX) grew the row's own
 * height enough to press into a pot sitting right at 0.52, and this buys
 * the gap back on every frame size since it's a felt-space fraction rather
 * than a pixel offset. */
export const POT_DEPTH_FRACTION = 0.74;
export function potAnchor(): Vec3 {
  return { x: 0, y: FELT_TOP_Y, z: -FELT.halfWidth * POT_DEPTH_FRACTION };
}

/** Where a seat's bet sits once it is out on the cloth. */
export const CHIP_INSET_FRACTION = 0.88; // fallback default
/**
 * Per-seat chip inset fractions. Adjust each seat individually:
 * - Lower values (e.g. 0.80) = chips closer to center
 * - Higher values (e.g. 0.90) = chips further out on the curve
 */
export const CHIP_INSET_PER_SEAT = [
  0.7, // seat 0 (near, you)
  0.90, // seat 1 (far left)
  0.88, // seat 2 (left of dealer)
  0.88, // seat 3 (dealer's left)
  0.88, // seat 4 (dealer's right)
  0.88, // seat 5 (far right)
];

/**
 * Per-seat chip position offsets (in metres).
 *
 * IMPORTANT: this is 3D table space, not screen space.
 * - x: left (-) / right (+) on the felt — this is the only axis that reads
 *   as pure left/right on screen.
 * - y: height ABOVE the cloth (-) below / (+) above. Leave at 0. This does
 *   NOT mean "screen down" — moving it changes how high the chip floats
 *   over the felt, which looks wrong fast.
 * - z: forward toward the camera (+) / back away from the camera (-). This
 *   is the axis that reads as up/down on screen (since the table is seen
 *   from an angle): negative z (away) moves a pile up and further; positive
 *   z (toward) moves it down and closer.
 *
 * To move a seat's chips diagonally down-and-left on screen: negative x,
 * positive z. Leave y at 0.
 */
export const CHIP_OFFSET_PER_SEAT: Vec3[] = [
  { x: 0, y: 0, z: 0 }, // seat 0 (near, you)
  { x: -0.10, y: -0.04, z: 0.12 }, // seat 1 (far left)
  { x: -0.13, y: -0.04, z: 0 }, // seat 2 (left of left of dealer)
  { x: -0.10, y: 0, z: 0 }, // seat 3 (dealer's left)
  { x: 0.12, y: -0.03, z: 0 }, // seat 4 (dealer's right)
  { x: 0.20, y: -0.09, z: 0.07 }, // seat 5 (far right)
];

export function chipAnchor(slot: number, count: number = SEAT_COUNT): Vec3 {
  const inset = CHIP_INSET_PER_SEAT[Math.min(Math.max(slot, 0), CHIP_INSET_PER_SEAT.length - 1)] ?? CHIP_INSET_FRACTION;
  const offset = CHIP_OFFSET_PER_SEAT[Math.min(Math.max(slot, 0), CHIP_OFFSET_PER_SEAT.length - 1)] ?? { x: 0, y: 0, z: 0 };
  const { x, z } = ringPoint(seatAngleDeg(slot, count), {
    halfLength: FELT.halfLength * inset,
    halfWidth: FELT.halfWidth * inset,
  });
  return {
    x: x + offset.x,
    y: FELT_TOP_Y + offset.y,
    z: z + offset.z
  };
}

/**
 * Where a seat's chips rest before it bets: the tray on the rail in front of
 * the player, not the player's own chest.
 *
 * Just outside the cloth rather than on it, since a tray sits on the rail
 * and the direction of travel from there inward is what says whose bet it
 * is. The 2D room learned this the expensive way at its own scale: chips
 * used to launch from a point outside the painted rail entirely, on the
 * carpet behind the player, and fly in over the table's edge (see
 * `lib/scene/seat-ring.ts`'s `SEAT_TRAY_INSET`).
 *
 * This is a true outward offset, not a scaled radius, and on this table
 * those aren't the same thing. Every "fraction of the felt" anchor above
 * scales both radii, which is exact on an ellipse and wrong on a stadium:
 * scaling moves the straight sides out by a fraction of the length and the
 * end caps by a fraction of the width, and this table is 2:1, so the same
 * multiplier is more than twice as generous at the sides as at the ends.
 * Written as `FELT * 1.04` (the classic room's own tray figure, from a
 * room whose table really is an ellipse), the outermost chairs' trays came
 * out 29mm inside the cloth, a bet launching from the middle of the felt
 * rather than from the rail. `offsetStadium` moves the whole boundary out
 * by one distance, which is what "on the rail" means.
 */
export const TRAY_OFFSET = RAIL_WIDTH * 0.5;
const TRAY_RING = offsetStadium(FELT.halfLength, FELT.halfWidth, TRAY_OFFSET);
export function seatTrayAnchor(slot: number, count: number = SEAT_COUNT): Vec3 {
  const { x, z } = stadiumRayPoint(seatAngleDeg(slot, count), TRAY_RING);
  return { x, y: FELT_TOP_Y, z };
}

/**
 * Where a ray from the middle at `angleDeg` crosses a stadium's boundary.
 *
 * `ringPoint` doesn't answer this, and the difference is the second half of
 * the bug above: it traces the ellipse with the stadium's two half-extents,
 * which touches the stadium at exactly four points (the ends of each axis)
 * and lies strictly inside it everywhere else. On this 2:1 table the gap
 * peaks around 23mm at the diagonals, so a tray built by offsetting the
 * felt by half a rail and then read off the ellipse came out inside the
 * cloth at precisely the chairs flanking the dealer.
 *
 * This is closed-form rather than a search, since a stadium is only two
 * cases. Let `s` be half the straight run and `W` the cap radius (which is
 * the half-width). Along the unit direction (cx, cz) the ray either leaves
 * through a straight edge, where |z| = W fixes `t` directly, or through an
 * end cap, where it meets a circle of radius W centred at (+/-s, 0) and `t`
 * falls out of the quadratic. Try the edge first and take the cap when the
 * edge solution lands beyond the straight run.
 *
 * The ellipse stays in place for the seats, the bet spots, the payouts and
 * the button. Those points need to sit somewhere sensible on the cloth
 * rather than at an exact distance from its boundary, they're what the
 * approved composition was judged with, and moving them would move every
 * figure at the table to fix nothing.
 */
export function stadiumRayPoint(
  angleDeg: number,
  radii: StadiumRadii,
): { x: number; z: number } {
  const theta = (angleDeg * Math.PI) / 180;
  const cx = Math.cos(theta);
  const cz = Math.sin(theta);
  const width = radii.halfWidth;
  const straightHalf = Math.max(0, radii.halfLength - width);

  if (Math.abs(cz) > 1e-9) {
    const t = width / Math.abs(cz);
    if (Math.abs(t * cx) <= straightHalf) return { x: t * cx, z: t * cz };
  }
  // Through an end cap. The discriminant cannot go negative: the centre is
  // inside the circle, so the ray always crosses it.
  const along = straightHalf * Math.abs(cx);
  const t = along + Math.sqrt(Math.max(0, along * along - straightHalf * straightHalf + width * width));
  return { x: t * cx, z: t * cz };
}

/**
 * Where a winner's payout lands -- just inside their own bet spot, so a
 * funnel arriving reads as chips being pushed to a player rather than as the
 * pot moving to a second pot.
 */
export const PAYOUT_INSET_FRACTION = 0.82;
export function payoutAnchor(slot: number, count: number = SEAT_COUNT): Vec3 {
  const { x, z } = ringPoint(seatAngleDeg(slot, count), {
    halfLength: FELT.halfLength * PAYOUT_INSET_FRACTION,
    halfWidth: FELT.halfWidth * PAYOUT_INSET_FRACTION,
  });
  return { x, y: FELT_TOP_Y, z };
}

/** The button, on the cloth just inside whichever seat currently has it. */
export const BUTTON_INSET_FRACTION = 0.88;
export function dealerButtonAnchor(slot: number, count: number = SEAT_COUNT): Vec3 {
  const { x, z } = ringPoint(seatAngleDeg(slot, count), {
    halfLength: FELT.halfLength * BUTTON_INSET_FRACTION,
    halfWidth: FELT.halfWidth * BUTTON_INSET_FRACTION,
  });
  return { x, y: FELT_TOP_Y, z };
}

/* ---------------------------------------------------------------------- *
 * Chips, at this table's scale
 * ---------------------------------------------------------------------- */

/**
 * A chip, in metres. A real casino chip is 39mm across and 3.3mm thick.
 *
 * True to life rather than scaled to taste, like every other dimension
 * here. The fudge the 2D room needs at phone sizes stays where it already
 * is: `paint.ts` enlarges the drawn token by a third because a physically
 * exact chip edge is sub-pixel on a small plate. Baking that enlargement
 * into the world instead would put the chips at the wrong size relative to
 * the felt for anything reasoning about the geometry itself.
 */
export const CHIP_RADIUS_M = 0.0195;
export const CHIP_THICKNESS_M = 0.0033;

/* ---------------------------------------------------------------------- *
 * Outlines
 * ---------------------------------------------------------------------- */

export function feltOutline(capSegments?: number): StadiumPoint[] {
  return stadiumOutline(FELT.halfLength, FELT.halfWidth, capSegments);
}

/** The table's outer edge: the rail's outside, and the top of the slab. */
export function tableOutline(capSegments?: number): StadiumPoint[] {
  return stadiumOutline(TABLE_OUTER.halfLength, TABLE_OUTER.halfWidth, capSegments);
}

export function pedestalOutline(capSegments?: number): StadiumPoint[] {
  return stadiumOutline(PEDESTAL.halfLength, PEDESTAL.halfWidth, capSegments);
}

/* ---------------------------------------------------------------------- *
 * The camera
 * ---------------------------------------------------------------------- */

/**
 * How high above the horizontal the camera looks down.
 *
 * The single most sensitive number in this file, a narrow window between
 * two bad renders.
 *
 * Too high and the depth collapses into the plan view this module exists
 * to get away from: the table lies flat on the screen, near and far read
 * the same, and it stops looking like a room. Past about 40 that's what
 * happens.
 *
 * Too low and the felt closes up into a sliver. Ground-plane depth
 * compresses by roughly sin(elevation), so at 21 the cloth was about 15%
 * as tall as it was wide: the board and the pot had nowhere to sit and the
 * table read as a plank seen edge-on. Measured off the reference, its
 * cloth runs about 18%, which puts it here.
 */
export const CAMERA_ELEVATION_DEG = 28;

/** Vertical field of view. Narrow-ish: a wide lens at this range bows the
 * near rail badly and exaggerates how much closer the near seats are. */
export const CAMERA_FOV_DEG = 34;

/**
 * What the camera looks at -- a little past the felt's centre, toward the
 * dealer.
 *
 * Aiming dead centre puts the far rail and everyone behind it in the top
 * third and leaves the near half of the cloth eating the middle of the
 * frame. Aiming slightly long lifts the crowd into the upper-middle, which
 * is the composition the reference has.
 */
export const CAMERA_AIM_DEPTH = -0.1;

export interface Camera {
  /** Where the camera is, in world metres. */
  position: Vec3;
  /** What it is pointed at. */
  target: Vec3;
  /** Focal length in pixels, derived from the frame's height and the FOV. */
  focal: number;
  /** Frame centre, in CSS pixels. */
  cx: number;
  cy: number;
}

export interface Frame {
  width: number;
  height: number;
  /**
   * Fraction of the frame's height reserved at the bottom for the local
   * player's HUD. The table is allowed to run underneath it -- a near rail
   * that stops short of the HUD reads as a small table floating in a room,
   * where one that runs under it reads as a table you are sitting at.
   */
  hudFraction?: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance in front of the camera, in metres. Negative is behind it. */
  depth: number;
}

/** World point to frame pixels, through a standard pinhole camera. */
export function project(camera: Camera, point: Vec3): ScreenPoint {
  const forward = normalize(subtract(camera.target, camera.position));
  // The camera never rolls or yaws off the table's own axis, so right is
  // simply world X and up falls out of the cross product.
  const right: Vec3 = { x: 1, y: 0, z: 0 };
  const up = cross(right, forward);

  const relative = subtract(point, camera.position);
  const depth = dot(relative, forward);
  // Behind the lens: project it anyway so a caller sorting or clipping can
  // see the negative depth, rather than handing back NaN.
  const safeDepth = Math.abs(depth) < 1e-6 ? 1e-6 : depth;
  return {
    x: camera.cx + (camera.focal * dot(relative, right)) / safeDepth,
    y: camera.cy - (camera.focal * dot(relative, up)) / safeDepth,
    depth,
  };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/** A camera at `distance` metres back along the elevation ray from the aim
 * point. Exposed so the fit below can walk it, and so a caller can pin a
 * distance by hand if it ever wants to. */
export function cameraAtDistance(frame: Frame, distance: number): Camera {
  const elevation = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
  const target: Vec3 = { x: 0, y: FELT_TOP_Y, z: CAMERA_AIM_DEPTH };
  return {
    position: {
      x: 0,
      y: target.y + Math.sin(elevation) * distance,
      z: target.z + Math.cos(elevation) * distance,
    },
    target,
    focal: frame.height / 2 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 180 / 2),
    cx: frame.width / 2,
    cy: frame.height / 2,
  };
}

/** Side margin kept clear of the table and the outermost seats. Generous:
 * a table jammed against both frame edges reads as cropped rather than as
 * a table in a room, and the reference leaves about this much. */
const SIDE_MARGIN = 0.08;
/** Headroom above the tallest thing in frame. */
// Keep the far character/dealer band a little closer to the header on short
// landscape stages. A small composition adjustment; the camera still owns
// all projected coordinates and the fit remains the source of truth for
// every DOM overlay.
const TOP_MARGIN = 0.04;

/**
 * Everything the fit has to keep on screen: the far half of the table, and
 * every opponent's head.
 *
 * Three things are left out on purpose, and each one would wreck the
 * framing if it were in.
 *
 * Seat 0, because the camera sits in it. Its anchor is under the lens and
 * projects below the frame by construction; requiring it to fit pushes the
 * camera back until the table is a distant oval.
 *
 * The near rail, for the same reason: it's supposed to run off the bottom
 * edge and under the HUD. A near rail that stops short reads as a small
 * table across the room rather than one you're sitting at.
 *
 * And everyone's feet. These are seated players seen from the chest up
 * over a rail; their chairs and legs are behind the table and under it.
 * Requiring floor-level seat anchors in frame held the first cut of this
 * fit to 38% of the frame's width: the near flanks' feet are close to the
 * camera and project very low, so the bisection kept retreating to bring
 * two points on screen that are occluded by the table anyway.
 */
/*
 * This always frames the full six-handed crowd, never just the seats
 * actually occupied. The fit would frame a short-handed table more
 * tightly, but bots leave and return between hands
 * (`BOT_VOLUNTARY_LEAVE_CHANCE`), so a count-sensitive camera would dolly
 * in and out on its own several times a session for a reason the player
 * can't see. A camera that moves when nobody moved it reads as a bug
 * however correct each individual framing is, so the widest arrangement
 * the table can hold is framed once and held.
 */
function framingPoints(): Vec3[] {
  const points: Vec3[] = [];
  for (const point of tableOutline()) {
    if (point.z <= 0) points.push({ x: point.x, y: FELT_TOP_Y + RAIL_LIP_HEIGHT, z: point.z });
  }
  for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
    if (slot === HERO_SLOT) continue;
    points.push(seatHead(slot));
  }
  points.push(dealerHead());
  return points;
}

/**
 * What has to fit across the frame: the whole table, near half included.
 *
 * Width and height are governed by different sets here, which looks fussy
 * until you notice they want opposite things from the near rail. The near
 * half is the widest part of the drawn table (it's closest to the lens, so
 * perspective spreads it), so leaving it out of the width check lets the
 * table's own near edge run off the sides, fitting the far rail neatly
 * inside the margins while the near one is cropped. But including it in
 * the height check would defeat the whole composition, because the near
 * rail is meant to run off the bottom and under the HUD.
 *
 * So: everything for width, far half only for height.
 */
function widthPoints(): Vec3[] {
  return tableOutline()
    .map((point) => ({ x: point.x, y: FELT_TOP_Y + RAIL_LIP_HEIGHT, z: point.z }))
    .concat(framingPoints());
}

interface Span {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The projected extent of `points`, or null if any is behind the lens. */
function framingSpan(camera: Camera, points: Vec3[]): Span | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const screen = project(camera, point);
    if (screen.depth <= 0) return null;
    minX = Math.min(minX, screen.x);
    maxX = Math.max(maxX, screen.x);
    minY = Math.min(minY, screen.y);
    maxY = Math.max(maxY, screen.y);
  }
  return { minX, maxX, minY, maxY };
}

const MIN_CAMERA_DISTANCE = 0.5;
const MAX_CAMERA_DISTANCE = 20;
const FIT_ITERATIONS = 40;

/**
 * The closest camera that still holds the far rail and every head in frame.
 *
 * Two steps, and separating them is the point. First a distance, chosen so
 * the crowd's projected extent fits the usable area. Then a translation,
 * which decides where in the frame that extent sits.
 *
 * The first cut ran them together: it asked "is every point inside the
 * safe box" and bisected on that, leaving the camera centred. That fits
 * the content but composes it badly, with the table floating in the
 * middle and dead floor below it, since nothing was asking for the near
 * rail to do anything in particular. Aligning the crowd to the top margin
 * instead puts the players where the reference has them and lets the near
 * rail run down past the bottom edge and under the HUD, which is what
 * makes the view read as your own seat at the table rather than a table
 * across the room.
 *
 * The distance search is a bisection rather than a formula, and has to be:
 * under perspective, moving the camera changes the foreshortening as well
 * as the size, so which constraint binds can swap over as the distance
 * walks and there is no closed form to solve. (The deleted WebGL 3D room's
 * own camera fit -- `archive/webgl-3d-table` git tag -- reached the same
 * conclusion.)
 */
export function fitCamera(frame: Frame): Camera {
  const vertical = framingPoints();
  const horizontal = widthPoints();
  const usableWidth = frame.width * (1 - 2 * SIDE_MARGIN);
  const usableTop = frame.height * TOP_MARGIN;
  const usableBottom = frame.height * (1 - (frame.hudFraction ?? 0));
  const usableHeight = usableBottom - usableTop;

  const fits = (distance: number): boolean => {
    const camera = cameraAtDistance(frame, distance);
    const across = framingSpan(camera, horizontal);
    const down = framingSpan(camera, vertical);
    if (!across || !down) return false;
    return across.maxX - across.minX <= usableWidth && down.maxY - down.minY <= usableHeight;
  };

  let distance = MAX_CAMERA_DISTANCE;
  if (fits(MAX_CAMERA_DISTANCE)) {
    let low = MIN_CAMERA_DISTANCE;
    let high = MAX_CAMERA_DISTANCE;
    for (let i = 0; i < FIT_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) high = mid;
      else low = mid;
    }
    distance = high;
  }

  const base = cameraAtDistance(frame, distance);
  const across = framingSpan(base, horizontal);
  const down = framingSpan(base, vertical);
  if (!across || !down) return base;

  /*
   * Known and left alone: on a frame near 16:9 this leaves a band of empty
   * floor below the near rail.
   *
   * The table is 2:1. In a frame wider than that, a phone held sideways,
   * fitting its width fills the height too and the near rail runs off the
   * bottom on its own, which is the composition this module describes. In
   * a 16:9 frame the width still binds, so there's real vertical slack,
   * and pinning the crowd to the top margin puts all of it underneath the
   * table. Measured at 1440x832: the near rail finishes about 140px short
   * of the bottom edge.
   *
   * Taking that slack up by pushing the camera down was tried and
   * reverted. It does fix 16:9, but wrecks everything taller: on a
   * portrait phone the same rule drove the entire table and every player
   * into the bottom fifth of the frame with a screen of empty floor above
   * them, since "push down until the near rail reaches the bottom" has no
   * upper bound that a tall frame respects. The clamp that would bound it
   * is a composition decision, not arithmetic.
   *
   * So the band stays until somebody looks at both frames and decides
   * what should give: a tighter `SIDE_MARGIN` (letting the table's tips
   * run off the sides, which the seat spacing was tuned to avoid), a lower
   * `CAMERA_ELEVATION_DEG`, or simply accepting floor as background on
   * wide screens. All three are design calls, not fixes.
   */
  return {
    ...base,
    cx: base.cx + (frame.width / 2 - (across.minX + across.maxX) / 2),
    cy: base.cy + (usableTop - down.minY),
  };
}

/** Desktop landscape, the reference composition. */
export const DESKTOP_LANDSCAPE_FRAME: Frame = { width: 1600, height: 900, hudFraction: 0.2 };
/** The handset this codebase already treats as "the" landscape phone --
 * see `lib/game/table-geometry.ts`'s own landscape-band note. */
export const MOBILE_LANDSCAPE_FRAME: Frame = { width: 844, height: 390, hudFraction: 0.24 };

/* ---------------------------------------------------------------------- *
 * Debug
 * ---------------------------------------------------------------------- */

export interface DebugMarker {
  id: string;
  label: string;
  position: Vec3;
  kind: "seat" | "dealer" | "felt" | "button";
}

export function debugMarkers(): DebugMarker[] {
  const seats: DebugMarker[] = SEAT_LABELS.map((label, slot) => ({
    id: `seat${slot}`,
    label,
    position: seatHead(slot),
    kind: "seat",
  }));
  return [
    ...seats,
    { id: "dealerAnchor", label: "dealer", position: dealerHead(), kind: "dealer" },
    { id: "communityCards", label: "board", position: communityCardsAnchor(), kind: "felt" },
    { id: "pot", label: "pot", position: potAnchor(), kind: "felt" },
    { id: "button", label: "button", position: dealerButtonAnchor(1), kind: "button" },
  ];
}

/**
 * The 2.5D table: a real racetrack table, seen from a low seated camera.
 *
 * This is the geometry layer only -- felt, rail, table body, six seats, the
 * dealer, and the camera that frames them. Nothing here draws a character.
 *
 * THE CAMERA IS PERSPECTIVE, NOT THE ORTHOGRAPHIC TILT the rest of
 * `lib/scene/` uses, and that is the whole point of this module. An
 * orthographic tilt gives you a plan view: the table reads as an oval lying
 * flat on the screen with seats ringed evenly around it, near and far the
 * same size. What we want instead is the view from a player's own chair --
 * the near rail close and wide, the far rail compressed, opponents stacked
 * in the upper half of the frame, the local player's own seat under the
 * camera. Only a real perspective divide does that; a tilt angle cannot,
 * however low you set it.
 *
 * EVERYTHING IS IN METRES. Real numbers, not arbitrary units: a casino
 * table is 2.13 x 1.07 m with a ~0.14 m padded rail and a 0.75 m playing
 * height, and a seated person's head is about 1.25 m off the floor. Those
 * relationships are what make a render read as "a table in a room" rather
 * than a shape on a background, and stating them in their own units means
 * they can be checked against reality instead of against each other.
 */

import { offsetStadium, stadiumOutline, type StadiumPoint } from "../game3d/table-shape";

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

/** Outer edge of the table, rail included -- a real casino 6-max top. */
export const TABLE_LENGTH_M = 2.13;
export const TABLE_WIDTH_M = 1.07;

/** Padded rail width. Real rails run 5-6 inches. */
export const RAIL_WIDTH = 0.14;

/** Height of the playing surface off the floor. */
export const FELT_TOP_Y = 0.75;

/** How far the rail's padded cushion rises above the felt. */
export const RAIL_LIP_HEIGHT = 0.025;

/**
 * Thickness of the tabletop slab below the rail -- the table's "girth".
 *
 * This is what makes the table read as a solid object standing on a floor
 * rather than a shape painted onto the background: from a low camera you
 * see this side wall all the way round the near half, and the eye reads it
 * as mass. A table drawn as a flat outline has no such edge and always
 * looks pasted on, whatever you do to the felt.
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

/** The dealer sits closer in than a player -- they are working at the table,
 * reaching the board and the pot, not sitting back from it. */
export const DEALER_SETBACK = 0.1;

/**
 * The CROWN of a seated figure -- the top of the head, not its centre.
 *
 * The crown and not the centre because this is what the camera fit clamps
 * against, and a fit that keeps head *centres* on screen crops the tops of
 * everyone's heads by exactly one head radius. That is not a hypothetical:
 * it is what the first render with real figures in it did.
 *
 * STYLIZED, NOT ANATOMICAL, and this is the one measurement in the file
 * that deliberately isn't the real-world one. A real adult seated at a
 * 0.75 m table has their crown about 1.25 m off the floor -- half a metre
 * of air above the cloth. At that height the players float clear of the
 * rail with a visible gap, because at this camera angle half a metre of
 * height covers far more screen than the 0.16 m of depth that sets them
 * behind it.
 *
 * The reference art solves this the way stylized character art always
 * does: figures are drawn small against the table so their heads sit just
 * above the rail. Measured off it, crowns land about 0.35 m above the
 * cloth. Anyone importing real proportions later should scale the figures
 * to this, not raise this to them.
 */
export const SEATED_HEAD_Y = FELT_TOP_Y + 0.35;

/** The dealer sits a little higher than the players, as they do in a room. */
export const DEALER_HEAD_Y = FELT_TOP_Y + 0.41;

export const SEAT_COUNT = 6;

/** Plan angles: 90deg is the near edge (the camera's own chair), 270deg the
 * far edge. x = cos(theta), z = sin(theta) -- the same convention
 * `lib/scene/seat-ring.ts` already uses, so a slot means the same chair in
 * both. */
const NEAR_ANGLE_DEG = 90;
const FAR_ANGLE_DEG = 270;

/**
 * The dealer's own place: dead centre of the far rail, AT the table.
 *
 * A real oval table has a dealer cutout -- a 30-36 inch notch centred on
 * one long side, with players seated around the rest -- so "the dealer is
 * at far centre" is the real table's own layout, not a rendering
 * convenience. The reference this table is modelled on does exactly the
 * same thing.
 *
 * IT ALSO MEANS THERE IS NO PLAYER SEAT AT FAR CENTRE, which is a real
 * change from the first cut of this file. That version read "behind the far
 * rail" literally and parked the dealer several metres back, behind the
 * whole seat ring -- so the dealer was standing in the room rather than
 * working at the table, and slot 3 still had the seat directly opposite the
 * camera. Only one of them can have that spot and on a real table it is the
 * dealer's.
 */
export const DEALER_ANGLE_DEG = FAR_ANGLE_DEG;

/**
 * How far apart neighbouring places sit around the rail.
 *
 * The five opponents do NOT ring the whole table. They are clustered across
 * the far arc, flanking the dealer, and the table's own left and right tips
 * stick out past the outermost of them with nobody sitting there.
 *
 * THIS IS WHAT "EVERYONE AT THE TOP" ACTUALLY MEANS, and getting it wrong
 * is what made the first two cuts of this file read as the wrong game. A
 * ring spread evenly over the whole table puts a player at each end, out at
 * the widest point of the plan -- so the seats, not the table, become the
 * widest thing on screen, the camera has to retreat to fit them, and the
 * table shrinks to about half the frame. Clustering them on the far arc
 * makes the TABLE the widest thing, which lets it fill the frame the way
 * the reference does, and puts the whole crowd in the upper band where the
 * local player's HUD is not competing with them.
 *
 * 20deg is measured off the reference rather than picked, against a
 * specific test: its outermost opponents sit just INSIDE the table's own
 * tips, never past them. At 24 the end seats overhang the tips by about
 * 0.1 m, which is enough to put a head out over bare floor with no table
 * under it -- the giveaway that the crowd is orbiting the table rather than
 * sitting at it.
 */
const SEAT_SPACING_DEG = 20;

/**
 * THREE PLACES LEFT OF THE DEALER AND TWO RIGHT, and the lopsidedness is
 * forced rather than chosen. Five seats cannot be arranged symmetrically
 * about a centre that is itself occupied -- symmetry with an odd count
 * needs one seat AT the middle, and the middle is the dealer's. The
 * reference does exactly the same thing (count its chairs: three to the
 * dealer's left, two to the right) and nobody notices, because at this
 * angle the far arc reads as one crowd rather than two counted groups.
 */
const LEFT_OF_DEALER = 3;
const RIGHT_OF_DEALER = 2;

/**
 * Seat slots, in the order the brief names them: slot 0 is the local
 * player's own chair -- the camera's own position, so no figure is ever
 * drawn there -- then round the table left to right.
 *
 * SLOT 3 IS NOT THE SEAT OPPOSITE any more. That place belongs to the
 * dealer, for the reason DEALER_ANGLE_DEG gives. Slot 3 is the last chair
 * on the dealer's left.
 */
const SEAT_ANGLES_DEG: readonly number[] = [
  NEAR_ANGLE_DEG,
  ...Array.from({ length: LEFT_OF_DEALER }, (_, i) => FAR_ANGLE_DEG - (LEFT_OF_DEALER - i) * SEAT_SPACING_DEG),
  ...Array.from({ length: RIGHT_OF_DEALER }, (_, i) => FAR_ANGLE_DEG + (i + 1) * SEAT_SPACING_DEG),
];

export const SEAT_LABELS: readonly string[] = [
  "seat0 · you (camera)",
  "seat1 · far left",
  "seat2 · left of dealer",
  "seat3 · dealer's left",
  "seat4 · dealer's right",
  "seat5 · far right",
];

/** The local player's slot. Drawn as a HUD along the bottom of the frame,
 * never as a figure at the table -- the camera is sitting in this chair. */
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

export function seatAngleDeg(slot: number): number {
  return SEAT_ANGLES_DEG[Math.min(Math.max(slot, 0), SEAT_COUNT - 1)];
}

/** Where a player sits, at the floor -- the base of their chair. */
export function seatAnchor(slot: number): Vec3 {
  const { x, z } = ringPoint(seatAngleDeg(slot), SEAT_RING);
  return { x, y: FLOOR_Y, z };
}

/** The top of a seated player's head, for the camera fit. */
export function seatHead(slot: number): Vec3 {
  const seat = seatAnchor(slot);
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
 * Exported because it is a real budget somebody is going to spend, and
 * because it is not obvious: five figures clustered on the far arc have far
 * less elbow room than five figures spread around a whole table. Measured
 * rather than assumed -- the first render used a true 0.46 m adult shoulder
 * width and the six figures overlapped into one solid wall of bodies, wider
 * than the table they were sitting at. There is no arrangement of real-sized
 * people that fits this arc; the art has to be narrower than life, which is
 * the same conclusion SEATED_HEAD_Y reaches about height.
 *
 * The gap to each neighbour, so a figure drawn at exactly this width just
 * touches. Art should sit some way inside it.
 */
export function seatShoulderRoom(slot: number): number {
  const here = seatAnchor(slot);
  let closest = Infinity;
  const neighbours: Vec3[] = [dealerAnchor()];
  for (let other = 1; other < SEAT_COUNT; other += 1) {
    if (other !== slot) neighbours.push(seatAnchor(other));
  }
  for (const neighbour of neighbours) {
    closest = Math.min(closest, Math.hypot(here.x - neighbour.x, here.z - neighbour.z));
  }
  return closest;
}

/* ---------------------------------------------------------------------- *
 * What sits on the felt
 * ---------------------------------------------------------------------- */

/** The board sits just past the middle, toward the dealer. */
export const BOARD_DEPTH_FRACTION = 0.12;
export function communityCardsAnchor(): Vec3 {
  return { x: 0, y: FELT_TOP_Y, z: -FELT.halfWidth * BOARD_DEPTH_FRACTION };
}

/** The pot rests between the board and the dealer, never under the board. */
export const POT_DEPTH_FRACTION = 0.52;
export function potAnchor(): Vec3 {
  return { x: 0, y: FELT_TOP_Y, z: -FELT.halfWidth * POT_DEPTH_FRACTION };
}

/** Where a seat's bet sits once it is out on the cloth. */
export const CHIP_INSET_FRACTION = 0.7;
export function chipAnchor(slot: number): Vec3 {
  const { x, z } = ringPoint(seatAngleDeg(slot), {
    halfLength: FELT.halfLength * CHIP_INSET_FRACTION,
    halfWidth: FELT.halfWidth * CHIP_INSET_FRACTION,
  });
  return { x, y: FELT_TOP_Y, z };
}

/** The button, on the cloth just inside whichever seat currently has it. */
export const BUTTON_INSET_FRACTION = 0.88;
export function dealerButtonAnchor(slot: number): Vec3 {
  const { x, z } = ringPoint(seatAngleDeg(slot), {
    halfLength: FELT.halfLength * BUTTON_INSET_FRACTION,
    halfWidth: FELT.halfWidth * BUTTON_INSET_FRACTION,
  });
  return { x, y: FELT_TOP_Y, z };
}

/* ---------------------------------------------------------------------- *
 * Outlines
 * ---------------------------------------------------------------------- */

export function feltOutline(capSegments?: number): StadiumPoint[] {
  return stadiumOutline(FELT.halfLength, FELT.halfWidth, capSegments);
}

/** The table's outer edge -- the rail's outside, and the top of the slab. */
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
 * The single most sensitive number in this file, and it is a narrow window
 * between two bad renders.
 *
 * Too high and the depth collapses into the plan view this module exists to
 * get away from -- the table lies flat on the screen, near and far read the
 * same, and it stops looking like a room. Past about 40 that is what you
 * get.
 *
 * Too low and the felt closes up into a sliver. Ground-plane depth
 * compresses by roughly sin(elevation), so at 21 the cloth was about 15% as
 * tall as it was wide: the board and the pot had nowhere to sit and the
 * table read as a plank seen edge-on. Measured off the reference, its cloth
 * runs about 18% -- which puts it here.
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
const TOP_MARGIN = 0.05;

/**
 * Everything the fit has to keep on screen: the far half of the table, and
 * every opponent's head.
 *
 * THREE THINGS ARE DELIBERATELY LEFT OUT, and each one would wreck the
 * framing if it were in.
 *
 * Seat 0, because the camera is sitting in it. Its anchor is under the lens
 * and projects below the frame by construction; requiring it to fit pushes
 * the camera back until the table is a distant oval.
 *
 * The near rail, for the same reason -- it is *supposed* to run off the
 * bottom edge and under the HUD. A near rail that stops short reads as a
 * small table across the room rather than one you are sitting at.
 *
 * And everyone's feet. These are seated players seen from the chest up over
 * a rail; their chairs and legs are behind the table and under it. Requiring
 * floor-level seat anchors in frame is what held the first cut of this fit
 * to 38% of the frame's width -- the near flanks' feet are close to the
 * camera and project very low, so the bisection kept retreating to bring
 * two points on screen that are occluded by the table anyway.
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
 * What has to fit ACROSS the frame -- the whole table, near half included.
 *
 * Width and height are governed by different sets here, which looks fussy
 * until you notice they want opposite things from the near rail. The near
 * half is the widest part of the drawn table (it is closest to the lens, so
 * perspective spreads it), so leaving it out of the width check lets the
 * table's own near edge run off the sides -- fitting the far rail neatly
 * inside the margins while the near one is cropped. But including it in the
 * HEIGHT check would defeat the whole composition, because the near rail is
 * meant to run off the bottom and under the HUD.
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
 * TWO STEPS, AND SEPARATING THEM IS THE POINT. First a distance, chosen so
 * the crowd's projected *extent* fits the usable area. Then a translation,
 * which decides where in the frame that extent sits.
 *
 * The first cut ran them together -- it asked "is every point inside the
 * safe box" and bisected on that, leaving the camera centred. That fits the
 * content but composes it badly: the table ends up floating in the middle
 * with dead floor below it, because nothing was asking for the near rail to
 * do anything in particular. Aligning the crowd to the top margin instead
 * puts the players where the reference has them and lets the near rail run
 * down past the bottom edge and under the HUD, which is what makes the view
 * read as *your own seat at the table* rather than a table across the room.
 *
 * The distance search is a bisection rather than a formula, and has to be:
 * under perspective, moving the camera changes the foreshortening as well
 * as the size, so which constraint binds can swap over as the distance
 * walks and there is no closed form to solve. (The 3D room's camera fit
 * reached the same conclusion -- see `lib/game3d`'s `frameCamera`.)
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

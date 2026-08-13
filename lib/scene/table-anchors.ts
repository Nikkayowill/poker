/**
 * The racetrack table: felt outline, rail, six seats, and the dealer's own
 * space -- rebuilt from scratch as a foundation pass. Nothing here draws an
 * avatar, an IK rig, or a gesture; it only says *where things are*, so a
 * renderer can drop debug markers on it before any of that gets built on top.
 *
 * A real oval poker table is a stadium (two straight rails joined by
 * semicircular ends), not an ellipse -- `lib/game3d/table-shape.ts` already
 * builds that shape and its outward-offset math for the 3D room, and both
 * are pure geometry with no renderer dependency, so this reuses them rather
 * than re-deriving the same curve a second time. Seat/anchor placement still
 * uses an ellipse approximation of that stadium, matching
 * `lib/game3d/seat-layout.ts`'s own seatPosition -- a true stadium-boundary
 * projection exists (see the offset math below) but neither room needs seats
 * pinned to the exact rail curve, only outside it.
 *
 * Proportions are the real 6-max table's, 2.13m x 1.07m, the same ratio
 * `lib/game3d/seat-layout.ts` already settled on after several rounds of
 * tuning -- restated here rather than imported, so this module doesn't pull
 * the 3D room's avatar/rail config across the renderer seam
 * (`seam-contract.ts`) for the sake of one ratio.
 */

import { offsetStadium, stadiumOutline, type StadiumPoint } from "../game3d/table-shape";
import { TILT_COS, TILT_SIN, type Vec3 } from "./scene-config";

const TABLE_LENGTH_M = 2.13;
const TABLE_WIDTH_M = 1.07;

/**
 * The felt, in world units. radiusX is picked to sit near the old
 * ellipse-only room's own FELT.radiusX (9.0) so this drops into the existing
 * tilt/scale intuition; radiusZ is derived from the real table's ratio
 * instead of typed, so "premium proportions" means the same thing here as it
 * does in the 3D room.
 */
export const FELT = {
  /** Half the felt's overall length, tip to tip along X. */
  radiusX: 9.0,
  /** Cap radius -- half the felt's depth. */
  radiusZ: 9.0 * (TABLE_WIDTH_M / TABLE_LENGTH_M),
  /** Table height. Every anchor below rests on this plane. */
  y: 0.9,
} as const;

/** "Thick black padded rail" -- an outward offset of the felt's own stadium. */
export const RAIL_THICKNESS = 1.1;

/** How far outside the rail's own edge a seat sits. */
export const SEAT_SETBACK = 1.5;

/**
 * How much further back than an ordinary seat the dealer sits, along the
 * same far-centre ray as seat3. This is the whole point of a separate
 * anchor: a normal seat only needs SEAT_SETBACK of clearance for a chair, but
 * a dealer needs a chair, a torso, a head, and an arm's reach back toward the
 * rail on top of that -- so it gets its own, much deeper, offset rather than
 * sharing seat3's.
 */
export const DEALER_WORKSPACE_DEPTH = 3.6;

/** Extra clearance behind `dealerAnchor` reserved for the chair back and
 * head -- the anchor itself is the torso, not the outer edge of the space. */
export const DEALER_HEAD_MARGIN = 1.4;

const SEAT_COUNT = 6;

/** Seat0 faces the viewer -- same convention `lib/scene/seat-ring.ts` uses. */
const NEAR_ANGLE_DEG = 90;

/** The far-centre seat, directly opposite the hero -- where the dealer's own
 * ray points. */
export const FAR_CENTER_SLOT = 3;

export function seatAngle(slot: number): number {
  return ((NEAR_ANGLE_DEG + (slot * 360) / SEAT_COUNT) * Math.PI) / 180;
}

interface StadiumRadii {
  halfLength: number;
  halfWidth: number;
}

const RAIL: StadiumRadii = offsetStadium(FELT.radiusX, FELT.radiusZ, RAIL_THICKNESS);
const SEAT_RING: StadiumRadii = offsetStadium(RAIL.halfLength, RAIL.halfWidth, SEAT_SETBACK);
const DEALER_RING: StadiumRadii = offsetStadium(SEAT_RING.halfLength, SEAT_RING.halfWidth, DEALER_WORKSPACE_DEPTH);

function ellipsePoint(slot: number, radii: StadiumRadii): { x: number; z: number } {
  const theta = seatAngle(slot);
  return { x: radii.halfLength * Math.cos(theta), z: radii.halfWidth * Math.sin(theta) };
}

/** One of the six player seats. slot0 is the hero's own chair; slots advance
 * clockwise from there (slot1 near-left ... slot5 near-right). */
export function seatAnchor(slot: number): Vec3 {
  const { x, z } = ellipsePoint(slot, SEAT_RING);
  return { x, y: FELT.y, z };
}

/**
 * The dealer's own anchor -- centred behind the far rail, on seat3's ray but
 * pushed back DEALER_WORKSPACE_DEPTH beyond where a player would sit. Not
 * one of the six seats, and never returned by `seatAnchor`.
 */
export function dealerAnchor(): Vec3 {
  const { x, z } = ellipsePoint(FAR_CENTER_SLOT, DEALER_RING);
  return { x, y: FELT.y, z };
}

/** Just past centre, toward the far side -- the near half of the felt stays
 * the hero's own. */
export const COMMUNITY_CARDS_DEPTH_FRACTION = 0.15;
export function communityCardsAnchor(): Vec3 {
  return { x: 0, y: FELT.y, z: -FELT.radiusZ * COMMUNITY_CARDS_DEPTH_FRACTION };
}

/** Further back than the board, never stacked under it. */
export const POT_DEPTH_FRACTION = 0.5;
export function potAnchor(): Vec3 {
  return { x: 0, y: FELT.y, z: -FELT.radiusZ * POT_DEPTH_FRACTION };
}

/** Where a seat's bet sits once it's out of their hands and on the felt. */
export const CHIP_INSET_FRACTION = 0.72;
export function chipAnchor(slot: number): Vec3 {
  const { x, z } = ellipsePoint(slot, { halfLength: FELT.radiusX * CHIP_INSET_FRACTION, halfWidth: FELT.radiusZ * CHIP_INSET_FRACTION });
  return { x, y: FELT.y, z };
}

/** Where the dealer button sits for a given slot -- just inside that seat,
 * on the cloth. Movable per-hand; this is the anchor for wherever it
 * currently is, not a fixed slot. */
export const BUTTON_INSET_FRACTION = 0.85;
export function dealerButtonAnchor(slot: number): Vec3 {
  const { x, z } = ellipsePoint(slot, { halfLength: FELT.radiusX * BUTTON_INSET_FRACTION, halfWidth: FELT.radiusZ * BUTTON_INSET_FRACTION });
  return { x, y: FELT.y, z };
}

/** The felt's own outline, for drawing the green playing surface. */
export function feltOutline(capSegments?: number): StadiumPoint[] {
  return stadiumOutline(FELT.radiusX, FELT.radiusZ, capSegments);
}

/** The rail's outer outline, for drawing the thick black padded rail as the
 * band between this and `feltOutline`. */
export function railOutline(capSegments?: number): StadiumPoint[] {
  return stadiumOutline(RAIL.halfLength, RAIL.halfWidth, capSegments);
}

export interface SceneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Everything the camera has to fit: the rail, all six seats, and the
 * dealer's reserved space (anchor plus head margin). Not the felt alone --
 * a fit that only knew about the felt would happily crop every seat off
 * frame.
 */
export function sceneBounds(): SceneBounds {
  const dealer = dealerAnchor();
  const points: Array<{ x: number; z: number }> = [
    ...railOutline(),
    ...Array.from({ length: SEAT_COUNT }, (_, slot) => seatAnchor(slot)),
    dealer,
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  // The dealer's own reserved depth, not just the point of their torso.
  minZ = Math.min(minZ, dealer.z - DEALER_HEAD_MARGIN);
  return { minX, maxX, minZ, maxZ };
}

/** The camera: where world-origin lands on screen, and pixels per world
 * unit. Deliberately smaller than `projection.ts`'s `SceneView` -- this
 * scene doesn't need a per-fit felt radius, only the tilt projection. */
export interface CameraView {
  cx: number;
  cy: number;
  scale: number;
}

/** World point to canvas-local CSS pixels, under the same fixed tilt every
 * room in this app shares (`scene-config.ts`'s TILT_DEG). */
export function project(view: CameraView, point: Vec3): { x: number; y: number } {
  return {
    x: view.cx + point.x * view.scale,
    y: view.cy + point.z * TILT_SIN * view.scale - point.y * TILT_COS * view.scale,
  };
}

export interface Box {
  width: number;
  height: number;
}

/** Breathing room at the frame edges -- the scene fills this fraction of the
 * box, not all of it. */
const FRAME_MARGIN = 0.92;

/**
 * Fits the whole scene (rail, seats, dealer's space) inside `box`, centred.
 *
 * Takes a plain viewport box rather than a measured DOM rect on purpose:
 * this is landscape-only groundwork with nothing mounted yet, so there is no
 * `.poker-rail` to read a real box from the way `projection.ts`'s `fitView`
 * does. `DESKTOP_LANDSCAPE_VIEWPORT` / `MOBILE_LANDSCAPE_VIEWPORT` below are
 * the two boxes this pass actually needs to look right in; a caller that
 * later has a real measured box can pass that instead without this function
 * changing.
 */
export function fitCameraToBox(box: Box): CameraView {
  const bounds = sceneBounds();
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = (bounds.maxZ - bounds.minZ) * TILT_SIN;
  const scale = Math.min(
    spanX > 0 ? (box.width * FRAME_MARGIN) / spanX : 1,
    spanZ > 0 ? (box.height * FRAME_MARGIN) / spanZ : 1,
  );
  const center: Vec3 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: FELT.y,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const rawCenter = project({ cx: 0, cy: 0, scale }, center);
  return { cx: box.width / 2 - rawCenter.x, cy: box.height / 2 - rawCenter.y, scale };
}

/**
 * The two frames this pass targets. Both read the same seat/dealer anchors
 * above -- only the fit changes -- so tuning one later can't silently move
 * what "seat1" means on the other.
 */
export const DESKTOP_LANDSCAPE_VIEWPORT: Box = { width: 1600, height: 900 };
/** The same handset this codebase already treats as "the" landscape phone --
 * see `lib/game/table-geometry.ts`'s `LANDSCAPE_MAX_HEIGHT_PX` comment --
 * reused rather than invented. */
export const MOBILE_LANDSCAPE_VIEWPORT: Box = { width: 844, height: 390 };

export interface DebugMarker {
  id: string;
  label: string;
  position: Vec3;
}

const SEAT_LABELS: readonly string[] = [
  "seat0 · you",
  "seat1 · near left",
  "seat2 · far left",
  "seat3 · far center",
  "seat4 · far right",
  "seat5 · near right",
];

/** Every anchor this pass defines, labelled for a debug overlay. */
export function debugMarkers(): DebugMarker[] {
  const seats = SEAT_LABELS.map((label, slot) => ({
    id: `seat${slot}`,
    label,
    position: seatAnchor(slot),
  }));
  return [
    ...seats,
    { id: "dealerAnchor", label: "dealer", position: dealerAnchor() },
    { id: "communityCards", label: "board", position: communityCardsAnchor() },
    { id: "pot", label: "pot", position: potAnchor() },
    { id: "button", label: "button (seat0)", position: dealerButtonAnchor(0) },
  ];
}

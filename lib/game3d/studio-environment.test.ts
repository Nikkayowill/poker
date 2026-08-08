import { describe, expect, it } from "vitest";
import { frameCamera, projectToNdc } from "./camera-framing";
import { SEAT_COUNT_3D, seatPosition, type Vec3 } from "./seat-layout";
import { DEALER_HEAD_Y, PLAYER_HEAD_Y } from "./studio-environment";
import {
  BET_SLIDE,
  DEALER_STAND,
  FOLD_SLIDE,
  STUDIO_SPOT,
  crispProbePoints,
  foldedSeatPosition,
  seatPoseTarget,
  spotFalloffAt,
  studioFog,
  studioFogForAspect,
} from "./studio-environment";

/**
 * The four device shapes the room must lay out on: desktop, landscape
 * phone, portrait phone, portrait tablet.
 */
const ASPECTS = [
  { name: "1440x900", aspect: 1440 / 900, landscape: true },
  { name: "844x390", aspect: 844 / 390, landscape: true },
  { name: "390x844", aspect: 390 / 844, landscape: false },
  { name: "820x1180", aspect: 820 / 1180, landscape: false },
] as const;

/** Radius of the floor disc in table-3d.tsx — the last thing fog must eat. */
const FLOOR_RADIUS = 9;

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function seatPlanRadius(slot: number): number {
  const seat = seatPosition(slot);
  return Math.hypot(seat.x, seat.z);
}

function foldedPlanRadius(slot: number): number {
  const folded = foldedSeatPosition(slot);
  return Math.hypot(folded.x, folded.z);
}

describe("studioFog", () => {
  it.each(ASPECTS)(
    "keeps every head and the whole rail crisp at $name",
    ({ aspect }) => {
      const framing = frameCamera(aspect);
      const fog = studioFog(framing);
      for (const point of crispProbePoints()) {
        expect(distance(framing.position, point)).toBeLessThan(fog.near);
      }
    }
  );

  it.each(ASPECTS)("swallows the visible floor rim entirely at $name", ({ aspect }) => {
    const framing = frameCamera(aspect);
    const fog = studioFog(framing);
    // The rim's near half sits behind the camera; only the half the camera
    // can face matters, and its nearest points are the side extremes.
    for (let i = 0; i <= 12; i += 1) {
      const angle = Math.PI / 2 + (i / 12) * Math.PI; // z <= 0 half
      const rim: Vec3 = {
        x: Math.cos(angle) * FLOOR_RADIUS,
        y: 0,
        z: -Math.abs(Math.sin(angle)) * FLOOR_RADIUS,
      };
      expect(distance(framing.position, rim)).toBeGreaterThan(fog.far);
    }
  });

  it.each(ASPECTS)(
    "leaves a folded player faded but never gone at $name",
    ({ aspect }) => {
      const framing = frameCamera(aspect);
      const fog = studioFog(framing);
      for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
        const folded = foldedSeatPosition(slot);
        const head: Vec3 = { x: folded.x, y: PLAYER_HEAD_Y, z: folded.z };
        expect(distance(framing.position, head)).toBeLessThan(fog.far);
      }
    }
  );

  it("solves per framing rather than carrying one set of distances", () => {
    // Portrait stands the camera several units further out than landscape;
    // fog typed against one of them would either smoke the portrait table
    // or leave the landscape void un-swallowed.
    const landscape = studioFogForAspect(1440 / 900);
    const portrait = studioFogForAspect(390 / 844);
    expect(portrait.near).toBeGreaterThan(landscape.near + 1);
    expect(portrait.far - portrait.near).toBeCloseTo(landscape.far - landscape.near);
  });
});

describe("studio spotlight", () => {
  it("keeps the televised soft edge the studio look is named for", () => {
    expect(STUDIO_SPOT.penumbra).toBe(0.85);
  });

  it("is at full strength over the board", () => {
    expect(spotFalloffAt(0)).toBeGreaterThanOrEqual(0.99);
  });

  it("lights every seated player and the dealer", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      expect(spotFalloffAt(seatPlanRadius(slot))).toBeGreaterThanOrEqual(0.3);
    }
    expect(
      spotFalloffAt(Math.hypot(DEALER_STAND.x, DEALER_STAND.z))
    ).toBeGreaterThanOrEqual(0.3);
  });

  it("drops a folded player well down the gradient from their seat", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      const seated = spotFalloffAt(seatPlanRadius(slot));
      const folded = spotFalloffAt(foldedPlanRadius(slot));
      expect(folded).toBeLessThan(seated * 0.65);
      expect(folded).toBeLessThanOrEqual(0.5);
    }
  });

  it("keeps even a folded figure inside the cone, at its rim", () => {
    // Outside the outer cone entirely means an unlit silhouette against an
    // unlit floor: invisible, not dramatic. The pool covers the deepest
    // folded radius so the fade is gradient, not cliff.
    const poolRadius =
      Math.tan(STUDIO_SPOT.angle) * (STUDIO_SPOT.position.y - STUDIO_SPOT.target.y);
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      expect(foldedPlanRadius(slot)).toBeLessThanOrEqual(poolRadius);
    }
  });
});

describe("seat posing", () => {
  it("slides a fold back and a bet forward, and fold wins", () => {
    expect(seatPoseTarget(false, false)).toEqual({ slide: 0, tilt: 0 });
    expect(seatPoseTarget(false, true).slide).toBe(BET_SLIDE);
    expect(seatPoseTarget(true, false).slide).toBe(-FOLD_SLIDE);
    expect(seatPoseTarget(true, true).slide).toBe(-FOLD_SLIDE);
    expect(seatPoseTarget(true, true).tilt).toBeLessThan(0);
  });

  it("folds along the seat's own outward radial", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      expect(foldedPlanRadius(slot)).toBeCloseTo(seatPlanRadius(slot) + FOLD_SLIDE, 5);
    }
  });
});

describe("layout across devices", () => {
  it.each(ASPECTS.filter((a) => a.landscape))(
    "keeps every folded head on screen in landscape ($name)",
    ({ aspect }) => {
      const framing = frameCamera(aspect);
      // Slot 0 slides toward the viewer and may leave via the bottom edge,
      // which is where the local player's figure already lives — the same
      // trade camera-framing documents for portrait side seats.
      for (let slot = 1; slot < SEAT_COUNT_3D; slot += 1) {
        const folded = foldedSeatPosition(slot);
        const head = projectToNdc(
          { x: folded.x, y: PLAYER_HEAD_Y, z: folded.z },
          framing,
          aspect
        );
        expect(Math.abs(head.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(head.y)).toBeLessThanOrEqual(1);
      }
    }
  );

  it.each(ASPECTS.filter((a) => !a.landscape))(
    "keeps the far folded player and the table guarantee upright ($name)",
    ({ aspect }) => {
      // Portrait deliberately lets side seats run off the edges; the far
      // seat is the one whose fold must stay visible.
      const framing = frameCamera(aspect);
      const folded = foldedSeatPosition(3);
      const head = projectToNdc(
        { x: folded.x, y: PLAYER_HEAD_Y, z: folded.z },
        framing,
        aspect
      );
      expect(Math.abs(head.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(head.y)).toBeLessThanOrEqual(1);
    }
  );

  it.each(ASPECTS)("frames the dealer, hair included, at $name", ({ aspect }) => {
    const framing = frameCamera(aspect);
    const headTop = projectToNdc(
      { x: DEALER_STAND.x, y: DEALER_HEAD_Y + 0.2, z: DEALER_STAND.z },
      framing,
      aspect
    );
    expect(Math.abs(headTop.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(headTop.y)).toBeLessThanOrEqual(1);
  });

  it("stands the dealer clear of the two seats they stand between", () => {
    for (const slot of [2, 3]) {
      expect(distance(DEALER_STAND, seatPosition(slot))).toBeGreaterThan(0.9);
    }
  });
});

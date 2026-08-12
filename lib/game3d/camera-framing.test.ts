import { describe, expect, it } from "vitest";
import {
  frameCamera,
  framingProbePoints,
  horizontalFov,
  projectToNdc,
} from "./camera-framing";
import { FELT_TOP_Y, SEAT_COUNT_3D, holeCardPosition, seatPosition } from "./seat-layout";

/** Real viewports, not round numbers: the shapes this actually ships to. */
const ASPECTS = {
  "desktop 1440x900": 1440 / 900,
  "laptop 1280x800": 1280 / 800,
  "ultrawide 2560x1080": 2560 / 1080,
  "phone landscape 844x390": 844 / 390,
  "tablet portrait 820x1180": 820 / 1180,
  "phone portrait 390x844": 390 / 844,
  "small phone portrait 360x780": 360 / 780,
};

describe("frameCamera", () => {
  it("keeps both ends of the felt and the far player on screen everywhere", () => {
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const framing = frameCamera(aspect);
      for (const point of framingProbePoints(aspect)) {
        const ndc = projectToNdc(point, framing, aspect);
        expect(Math.abs(ndc.x), `${name} x`).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y), `${name} y`).toBeLessThanOrEqual(1);
        expect(ndc.depth, `${name} depth`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the local player's own hole cards on screen everywhere", () => {
    // The near edge is where a fit goes wrong first: raising the camera
    // pushes the nearest cloth down the frame and off the bottom.
    const spot = holeCardPosition(0);
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const framing = frameCamera(aspect);
      const ndc = projectToNdc({ ...spot, y: FELT_TOP_Y }, framing, aspect);
      expect(Math.abs(ndc.y), `${name}`).toBeLessThanOrEqual(1);
    }
  });

  it("looks down on the table more steeply than the old fixed rig", () => {
    // The rig it replaces sat at atan(3.6 / 5.65) ≈ 32.5 degrees, which is
    // what made the board hard to read.
    const landscape = frameCamera(16 / 9);
    expect(landscape.elevationDeg).toBeGreaterThan(40);
    expect(landscape.elevationDeg).toBeLessThan(60);
  });

  it("stands steeper and wider on an upright phone than in landscape", () => {
    const portrait = frameCamera(390 / 844);
    const landscape = frameCamera(844 / 390);
    expect(portrait.elevationDeg).toBeGreaterThan(landscape.elevationDeg);
    expect(portrait.fovY).toBeGreaterThan(landscape.fovY);
  });

  it("moves the camera, not the table, between orientations", () => {
    // Every framing looks at the felt from straight in front of the near
    // seat: a rig that drifted sideways would seat the local player off
    // centre, which is the one thing the layout guarantees.
    for (const aspect of Object.values(ASPECTS)) {
      const framing = frameCamera(aspect);
      expect(framing.position.x).toBe(0);
      expect(framing.target.x).toBe(0);
      expect(framing.position.y).toBeGreaterThan(FELT_TOP_Y);
    }
  });

  it("fills the frame rather than merely fitting it", () => {
    // A fit that always cleared by miles would be a table lost in a sea of
    // carpet. On every shape, one axis has to be close to full.
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const framing = frameCamera(aspect);
      const extents = framingProbePoints(aspect).map((point) => {
        const ndc = projectToNdc(point, framing, aspect);
        return Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
      });
      expect(Math.max(...extents), name).toBeGreaterThan(0.7);
    }
  });

  it("gives the bottom of an upright screen to the controls", () => {
    // Upright, the table fills the width and leaves the height half empty.
    // That space has to land above the table, not be split either side of
    // it — below is where the action bar and a thumb are.
    for (const aspect of [390 / 844, 360 / 780]) {
      const framing = frameCamera(aspect);
      const centre = projectToNdc({ x: 0, y: FELT_TOP_Y, z: 0 }, framing, aspect);
      expect(centre.y).toBeGreaterThan(0.1);
    }
    // Sideways there is no spare height to give away, so it stays centred.
    const landscape = frameCamera(844 / 390);
    const centre = projectToNdc({ x: 0, y: FELT_TOP_Y, z: 0 }, landscape, 844 / 390);
    expect(Math.abs(centre.y)).toBeLessThan(0.1);
  });

  it("fills the frame EXACTLY, at every shape, not approximately", () => {
    // The closed-form fit this replaces summed two upper bounds that never
    // co-occur, so it cleared by a margin that varied with the aspect —
    // measured, 36% of the width was dead at 2560x1080. An exact solve puts
    // the worst-required point on the safety margin and nowhere else, so
    // this asserts the fill is tight at every shape rather than merely
    // adequate at one.
    for (const [name, aspect] of Object.entries(ASPECTS)) {
      const framing = frameCamera(aspect);
      const worst = Math.max(
        ...framingProbePoints(aspect).map((point) => {
          const ndc = projectToNdc(point, framing, aspect);
          return Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
        })
      );
      expect(worst, name).toBeCloseTo(1 / 1.32, 3);
    }
  });

  it("keeps seated bodies on screen BETWEEN the two profiles, not just at them", () => {
    // The regression this exists for: at 1180x820 the old probe set skipped
    // the players entirely (its gate was `landscapeness >= 1`, and that
    // aspect blends at 0.91), and the outer seats projected to |x| = 1.04 —
    // clipped, by a fit that reported success. Every aspect in the blend
    // band is checked here, against the bodies at the height they are
    // actually occupied rather than at felt level.
    for (let aspect = 0.8; aspect <= 2.6; aspect += 0.05) {
      const framing = frameCamera(aspect);
      for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
        const seat = seatPosition(slot);
        const ndc = projectToNdc({ x: seat.x, y: 1.5, z: seat.z }, framing, aspect);
        expect(Math.abs(ndc.x), `aspect ${aspect.toFixed(2)} slot ${slot}`)
          .toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y), `aspect ${aspect.toFixed(2)} slot ${slot}`)
          .toBeLessThanOrEqual(1);
      }
    }
  });

  it("balances the leftover height in landscape instead of stacking it on top", () => {
    // The old rig aimed at nothing sideways, which left ~30% of the frame
    // empty above the far player's head and 9% below the near ones. Slack
    // split evenly is what lets the fit pull the camera in.
    for (const aspect of [2560 / 1080, 16 / 9, 844 / 390]) {
      const framing = frameCamera(aspect);
      const ys = framingProbePoints(aspect).map(
        (point) => projectToNdc(point, framing, aspect).y
      );
      const centre = (Math.min(...ys) + Math.max(...ys)) / 2;
      expect(Math.abs(centre), `aspect ${aspect.toFixed(2)}`).toBeLessThan(0.02);
    }
  });

  it("is deterministic — the same viewport always solves to the same camera", () => {
    // The fit is a search, so this is worth stating: it is a fixed number of
    // iterations over a fixed point set with no clock and no randomness, and
    // a resize that lands back on a previous size must land back on exactly
    // the previous framing rather than somewhere near it.
    for (const aspect of Object.values(ASPECTS)) {
      expect(frameCamera(aspect)).toEqual(frameCamera(aspect));
    }
  });

  it("survives a degenerate aspect instead of returning NaN", () => {
    // A canvas measured before layout reports 0 x 0; every position in the
    // scene is derived from this, so it must never hand back NaN.
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const framing = frameCamera(aspect);
      expect(Number.isFinite(framing.position.y)).toBe(true);
      expect(Number.isFinite(framing.position.z)).toBe(true);
      expect(Number.isFinite(framing.fovY)).toBe(true);
    }
  });
});

describe("horizontalFov", () => {
  it("matches the vertical fov at a square aspect", () => {
    expect(horizontalFov(50, 1)).toBeCloseTo((50 * Math.PI) / 180, 6);
  });

  it("widens with the viewport", () => {
    expect(horizontalFov(40, 2)).toBeGreaterThan(horizontalFov(40, 1));
  });
});

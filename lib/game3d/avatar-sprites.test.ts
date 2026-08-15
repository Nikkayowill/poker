import { describe, expect, it } from "vitest";
import {
  ART_FRACTIONS,
  CAMERA_HEADROOM_Y,
  CROWN_RISE,
  HEAD_HEIGHT,
  RAIL_TOP_Y,
  SHOULDER_SPAN,
  SPRITE_ASPECT,
  SPRITE_BASE_Y,
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  spriteCrownWorld,
} from "./avatar-sprites";
import { SEAT_COUNT_3D } from "./seat-layout";
import { cameraBasis, frameCamera, projectToNdc } from "./camera-framing";

describe("sprite metrics", () => {
  it("keeps every seat's crown under the camera's headroom guarantee", () => {
    // The quad rises along the camera's up axis, so the crown's world
    // height depends on the framing — check it at each viewport rather
    // than against a single constant.
    for (const aspect of [1440 / 900, 844 / 390, 390 / 844]) {
      const framing = frameCamera(aspect);
      for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
        expect(spriteCrownWorld(slot, framing, false).y).toBeLessThan(CAMERA_HEADROOM_Y);
      }
    }
  });

  it("puts the crown a real bust's height above the foot", () => {
    expect(CROWN_RISE).toBeGreaterThan(SPRITE_HEIGHT * 0.9);
    expect(CROWN_RISE).toBeLessThanOrEqual(SPRITE_HEIGHT);
  });

  it("tucks the crop's bottom edge behind the rail", () => {
    // The art ends at mid-chest; if that edge floated above the rail the
    // figure would read as a cut-out card standing on the cloth.
    expect(SPRITE_BASE_Y).toBeLessThan(RAIL_TOP_Y);
  });

  it("derives world sizes that match the art's own proportions", () => {
    expect(SPRITE_HEIGHT).toBeCloseTo(SPRITE_WIDTH / SPRITE_ASPECT, 10);
    expect(SHOULDER_SPAN).toBeCloseTo(SPRITE_WIDTH * ART_FRACTIONS.shoulderSpan, 10);
    expect(HEAD_HEIGHT).toBeCloseTo(SPRITE_HEIGHT * ART_FRACTIONS.headHeight, 10);
  });

  it("gives each figure real presence against the felt", () => {
    // Set on a render: at half of this the players read as dolls behind
    // their own chairs, at twice it they crowd the cloth. Stated against
    // the felt's 4.3-unit width so the bound means something.
    const feltWidth = 4.3;
    expect(SHOULDER_SPAN / feltWidth).toBeGreaterThan(0.25);
    expect(SHOULDER_SPAN / feltWidth).toBeLessThan(0.45);
  });

  it("keeps the head stylised but not swollen", () => {
    expect(HEAD_HEIGHT).toBeGreaterThan(0.35);
    expect(HEAD_HEIGHT).toBeLessThan(0.75);
    // The art's head-to-shoulder ratio is the stylisation itself.
    expect(ART_FRACTIONS.headWidth / ART_FRACTIONS.shoulderSpan).toBeGreaterThan(0.4);
    expect(ART_FRACTIONS.headWidth / ART_FRACTIONS.shoulderSpan).toBeLessThan(0.6);
  });
});

describe("every seat's head stays on screen", () => {
  // env() is 0 headless and a canvas cannot be measured in a unit test, so
  // this is the same arithmetic the camera itself is solved with — the only
  // way to check all six seats against a screen shape nobody has opened.
  // It exists because the first cut used the studio's FOLD_SLIDE (0.55) and
  // the two near-side seats' heads left the frame the moment they folded,
  // which no existing test could see.
  const headHalf = (SPRITE_WIDTH * ART_FRACTIONS.headWidth) / 2;

  /**
   * The head's centre in world space: the crown, dropped half a head back
   * down the camera's up axis — the same axis the quad is built on.
   */
  function headCentre(slot: number, folded: boolean, framing: ReturnType<typeof frameCamera>) {
    const crown = spriteCrownWorld(slot, framing, folded);
    const { up } = cameraBasis(framing);
    const drop = (SPRITE_HEIGHT * ART_FRACTIONS.headHeight) / 2;
    return {
      x: crown.x - up.x * drop,
      y: crown.y - up.y * drop,
      z: crown.z - up.z * drop,
    };
  }

  function headSpan(slot: number, folded: boolean, aspect: number) {
    const framing = frameCamera(aspect);
    const c = headCentre(slot, folded, framing);
    const { right } = cameraBasis(framing);
    // Widen along the camera's right axis, which is where the quad's width
    // actually lies now that it is screen-aligned.
    const a = projectToNdc(
      { x: c.x - right.x * headHalf, y: c.y - right.y * headHalf, z: c.z - right.z * headHalf },
      framing,
      aspect
    );
    const b = projectToNdc(
      { x: c.x + right.x * headHalf, y: c.y + right.y * headHalf, z: c.z + right.z * headHalf },
      framing,
      aspect
    );
    return Math.max(Math.abs(a.x), Math.abs(b.x));
  }

  it("keeps whole heads in frame on a landscape desktop, seated or folded", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      for (const folded of [false, true]) {
        expect(headSpan(slot, folded, 1440 / 900)).toBeLessThan(1);
      }
    }
  });

  it("keeps whole heads in frame on a landscape phone", () => {
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      for (const folded of [false, true]) {
        expect(headSpan(slot, folded, 844 / 390)).toBeLessThan(1);
      }
    }
  });

  it("folding never pushes a seat further out than seating it", () => {
    // The fold recede moves a near-side seat outward AND toward the camera,
    // so its cost at the frame edge is more than its world-space length.
    for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
      const seated = headSpan(slot, false, 1440 / 900);
      const folded = headSpan(slot, true, 1440 / 900);
      expect(folded - seated).toBeLessThan(0.1);
    }
  });

  it("keeps crowns inside the frame vertically", () => {
    for (const aspect of [1440 / 900, 844 / 390, 390 / 844]) {
      const framing = frameCamera(aspect);
      for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
        const crown = spriteCrownWorld(slot, framing, false);
        expect(Math.abs(projectToNdc(crown, framing, aspect).y)).toBeLessThan(1);
      }
    }
  });

  it("lets an upright phone graze the side seats, but no more than that", () => {
    // camera-framing.ts states the upright profile as a deliberate trade:
    // it guarantees the table and lets the side seats run off the edges.
    // So a little overhang is expected here and only here — this pins how
    // much. Anything past a tenth means something grew or moved, not that
    // the trade got slightly worse.
    const worst = Math.max(...[1, 5].map((slot) => headSpan(slot, false, 390 / 844)));
    expect(worst).toBeLessThan(1.1);
  });
});

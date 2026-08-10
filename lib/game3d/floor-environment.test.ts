import { describe, expect, it } from "vitest";
import { frameCamera } from "./camera-framing";
import { STUDIO_BACKDROP, studioFog } from "./studio-environment";
import {
  CARPET_STOPS,
  FLOOR_RADIUS,
  FLOOR_RINGS,
  FLOOR_SEGMENTS,
  STUDIO_RIM,
  carpetColorAt,
  floorFootprintRadius,
  frustumFloorHit,
  hexToRgb,
  horizonInFrame,
} from "./floor-environment";

/** The whole shipped range, walked rather than sampled at four devices. */
function everyAspect(): number[] {
  const aspects: number[] = [];
  for (let a = 0.4; a <= 3.2; a += 0.02) aspects.push(Number(a.toFixed(2)));
  return aspects;
}

describe("the room is the floor", () => {
  it("never looks past the horizon, which is why there is no backdrop wall", () => {
    // This is the load-bearing fact behind the whole module. If it ever
    // stops being true — a shallower elevation, a much wider lens — then
    // there IS an off-table background on screen and a flat void colour
    // stops being an acceptable answer for it.
    for (const aspect of everyAspect()) {
      expect(horizonInFrame(aspect), `aspect ${aspect}`).toBe(false);
    }
  });

  it("covers the frame at every aspect, with the rim outside it", () => {
    // The defect this replaces: a literal radius of 9 against a footprint
    // that reaches 9.6 at 2560x1080. The rim was in frame and invisible
    // only because the fog happened to be opaque out there.
    for (const aspect of everyAspect()) {
      expect(floorFootprintRadius(aspect), `aspect ${aspect}`).toBeLessThan(FLOOR_RADIUS);
    }
  });

  it("keeps the rim fogged out even though it is now further away", () => {
    // Growing the floor moves its rim away from the camera, so fog swallows
    // it more easily, not less — but "more easily" is an argument, and the
    // studio's contract is that the void is total. Measured, not reasoned.
    for (const aspect of [2560 / 1080, 16 / 9, 1440 / 900, 390 / 844, 820 / 1180]) {
      const framing = frameCamera(aspect);
      const fog = studioFog(framing);
      for (let i = 0; i <= 16; i += 1) {
        const angle = Math.PI / 2 + (i / 16) * Math.PI;
        const rim = {
          x: Math.cos(angle) * FLOOR_RADIUS,
          y: 0,
          z: -Math.abs(Math.sin(angle)) * FLOOR_RADIUS,
        };
        const distance = Math.hypot(
          rim.x - framing.position.x,
          rim.y - framing.position.y,
          rim.z - framing.position.z
        );
        expect(distance, `aspect ${aspect}`).toBeGreaterThan(fog.far);
      }
    }
  });

  it("stays inside the camera's far plane", () => {
    // poker-scene.tsx clips at 40. A floor solved past that would be culled
    // in bands, which reads as the room ending in a straight line.
    for (const aspect of [390 / 844, 360 / 780]) {
      const framing = frameCamera(aspect);
      const hit = frustumFloorHit(framing, aspect, -1, 1);
      expect(hit).not.toBeNull();
      expect(hit!.distance).toBeLessThan(40);
    }
    expect(FLOOR_RADIUS + frameCamera(390 / 844).position.z).toBeLessThan(40);
  });
});

describe("the carpet", () => {
  it("reaches EXACTLY the colour the fog fades to at its rim", () => {
    // The one equality that lets a lit floor sit inside a fogged void with
    // no horizon line. If these drift apart the seam appears as a faint
    // ring at the edge of the light, which is very hard to attribute to a
    // colour stop once it is on screen.
    expect(carpetColorAt(FLOOR_RADIUS)).toEqual(hexToRgb(STUDIO_BACKDROP));
    expect(carpetColorAt(FLOOR_RADIUS * 5)).toEqual(hexToRgb(STUDIO_BACKDROP));
  });

  it("falls monotonically outward, so the light has one direction", () => {
    let previous = Infinity;
    for (let r = 0; r <= FLOOR_RADIUS; r += 0.1) {
      const { r: red, g, b } = carpetColorAt(r);
      const luminance = red + g + b;
      expect(luminance).toBeLessThanOrEqual(previous + 1e-9);
      previous = luminance;
    }
  });

  it("is a carpet and not a light — nothing here competes with the felt", () => {
    // Every stop stays well under the lit felt (#1c5c40). A floor that
    // reads brighter than the cloth inverts the whole studio premise.
    const feltLuminance = hexToRgb("#1c5c40").r + hexToRgb("#1c5c40").g + hexToRgb("#1c5c40").b;
    for (const stop of CARPET_STOPS) {
      const { r, g, b } = hexToRgb(stop.color);
      expect(r + g + b).toBeLessThan(feltLuminance);
    }
  });

  it("stays ultra-low-poly", () => {
    // The brief's budget, as a number rather than an adjective: the entire
    // environment is under a thousand triangles and one draw call.
    const triangles = (FLOOR_RINGS.length - 1) * FLOOR_SEGMENTS * 2;
    expect(triangles).toBeLessThan(1000);
  });

  it("puts its rings where the gradient is, not evenly", () => {
    expect(FLOOR_RINGS[0]).toBe(0);
    expect(FLOOR_RINGS[FLOOR_RINGS.length - 1]).toBe(1);
    const gaps = FLOOR_RINGS.slice(1).map((r, i) => r - FLOOR_RINGS[i]);
    expect(gaps[0]).toBeLessThan(gaps[gaps.length - 1]);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
  });
});

describe("the rim light", () => {
  it("never casts, so it cannot add a shadow pass", () => {
    // Stated as data precisely so this can be asserted. A second casting
    // light doubles the per-frame depth prepass over every character, chair
    // and chip in the scene to produce a shadow this intensity could not
    // make visible.
    expect(STUDIO_RIM.castShadow).toBe(false);
  });

  it("is a rim and not a second key", () => {
    expect(STUDIO_RIM.intensity).toBeLessThan(0.55);
  });

  it("comes from behind the table, opposite the camera-side kick", () => {
    // The existing warm directional sits at +Z (camera side). An edge needs
    // the other one, or both lights flatten the same silhouette.
    expect(STUDIO_RIM.position.z).toBeLessThan(0);
    expect(frameCamera(16 / 9).position.z).toBeGreaterThan(0);
  });
});

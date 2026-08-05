import { describe, expect, it } from "vitest";
import {
  AMBIENT,
  CAMERA,
  FELT,
  FOG,
  LAYERS,
  MAX_PIXEL_RATIO,
  MAX_TEXTURE_PX,
  SEAT_RING,
  SHADOW_ANCHOR,
  SPOTLIGHT,
  spotlightIntensityFor,
} from "./scene-config";

/**
 * These are the numbers the composition is, so the things worth asserting are
 * the relationships between them rather than the values themselves. A tweak
 * to the tilt is a design decision; a tilt that puts the camera under the
 * table is a bug, and only one of the two should fail a test.
 */
describe("camera", () => {
  it("looks down at the table from behind it", () => {
    expect(CAMERA.position.y).toBeGreaterThan(FELT.y);
    expect(CAMERA.position.z).toBeGreaterThan(CAMERA.target.z);
    expect(CAMERA.target.y).toBeLessThan(CAMERA.position.y);
  });

  it("sits on the table's centre line, so the oval is not skewed", () => {
    expect(CAMERA.position.x).toBe(0);
    expect(CAMERA.target.x).toBe(0);
  });

  it("aims a little past the middle, so the near rail is not centred", () => {
    // Aiming at dead centre leaves as much empty floor below the table as
    // above it and the shot reads as a diagram rather than a chair.
    expect(CAMERA.target.z).toBeLessThan(0);
  });

  it("clears the whole room without wasting the depth buffer on nothing", () => {
    const furthest = Math.hypot(CAMERA.position.y, LAYERS.floor.size / 2 + CAMERA.position.z);
    expect(CAMERA.far).toBeGreaterThan(furthest);
    expect(CAMERA.near).toBeGreaterThan(0);
    expect(CAMERA.near).toBeLessThan(1);
  });

  it("keeps the whole felt inside the frame", () => {
    // The vertical half-angle, against the angle subtended by the near and
    // far edges of the table. If the felt does not fit, no amount of room
    // scaling at runtime can rescue the composition.
    const halfFovRad = ((CAMERA.fov / 2) * Math.PI) / 180;
    const angleTo = (z: number) => {
      const dy = CAMERA.position.y - FELT.y;
      const dz = CAMERA.position.z - z;
      return Math.atan2(dy, dz);
    };
    const centre = angleTo(CAMERA.target.z);
    for (const edge of [FELT.radiusZ, -FELT.radiusZ]) {
      expect(Math.abs(angleTo(edge) - centre)).toBeLessThan(halfFovRad);
    }
  });
});

describe("lighting", () => {
  it("hangs the lamp over the pot", () => {
    expect(SPOTLIGHT.position.y).toBeGreaterThan(FELT.y);
    expect(SPOTLIGHT.position.x).toBe(0);
    expect(SPOTLIGHT.target).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps the room dark enough for the pool of light to mean something", () => {
    expect(AMBIENT.intensity).toBeLessThan(SPOTLIGHT.intensity);
    // Physical falloff. At decay 1 the whole room lifts evenly and the
    // contrast the scene is built on disappears.
    expect(SPOTLIGHT.decay).toBe(2);
    expect(SPOTLIGHT.penumbra).toBeGreaterThan(0.5);
  });

  /**
   * The bug this exists to prevent shipped once already: the first render of
   * this scene was a black table, because `THREE.SpotLight` has been
   * physically based since r155 and a flat intensity of 5 from 14 units away
   * puts 0.025 on the cloth. It looked exactly like a lighting *taste*
   * problem and was an arithmetic one.
   */
  it("puts the stated illuminance on the felt, not the stated candela in the lamp", () => {
    const lampToFelt = SPOTLIGHT.position.y - FELT.y;
    const candela = spotlightIntensityFor(lampToFelt);
    // Inverse-square: what actually lands on the cloth is intensity / d^2,
    // and that has to come back out as the number the spec asked for.
    expect(candela / (lampToFelt * lampToFelt)).toBeCloseTo(SPOTLIGHT.intensity, 9);
    // Which is necessarily a far larger number than the dial value.
    expect(candela).toBeGreaterThan(SPOTLIGHT.intensity * 100);
  });

  it("still falls off toward the rail, rather than flattening the room", () => {
    // The compensation must not turn into "no falloff at all" -- the mood is
    // the difference between the middle of the cloth and its edge.
    const lampToFelt = SPOTLIGHT.position.y - FELT.y;
    const candela = spotlightIntensityFor(lampToFelt);
    const atRim = candela / (lampToFelt ** 2 + FELT.radiusX ** 2);
    expect(atRim).toBeLessThan(SPOTLIGHT.intensity);
    // And the floor well outside the table is dimmer again by a wide margin.
    const atFloor = candela / (SPOTLIGHT.position.y ** 2 + (FELT.radiusX * 2.2) ** 2);
    expect(atFloor).toBeLessThan(atRim * 0.6);
  });

  it("reaches the rail it is meant to fall off across", () => {
    // The cone has to actually cover the felt, or the table is lit as a
    // circle with dark corners rather than as a table.
    const reach = (SPOTLIGHT.position.y - FELT.y) * Math.tan(SPOTLIGHT.angle);
    expect(reach).toBeGreaterThan(FELT.radiusX);
    expect(SPOTLIGHT.distance).toBeGreaterThan(SPOTLIGHT.position.y - FELT.y);
  });

  it("fogs the far wall into darkness before the floor plane ends", () => {
    expect(FOG.near).toBeLessThan(FOG.far);
    expect(FOG.far).toBeLessThan(LAYERS.floor.size);
  });
});

describe("the sandwich", () => {
  it("orders the layers back to front the way the illusion needs", () => {
    // Floor under everything, chairs outside the players, rim above the felt
    // and above the point a figure's waist starts.
    expect(LAYERS.floor.y).toBeLessThan(FELT.y);
    expect(LAYERS.chair.ringScale).toBeGreaterThan(LAYERS.avatar.ringScale);
    expect(LAYERS.rim.y).toBeGreaterThan(FELT.y);
  });

  it("puts the rail across the figure rather than under it", () => {
    // Layer D's whole job: a flat sprite passes behind a solid ring and gets
    // cut off at the stomach. If the figure's base sat above the rim there
    // would be nothing to clip and every player would float.
    const figureBaseY = LAYERS.rim.y - SEAT_RING.figureSink;
    expect(figureBaseY).toBeLessThan(LAYERS.rim.y);
    expect(SEAT_RING.figureHeight).toBeGreaterThan(SEAT_RING.figureSink);
  });

  it("grounds each figure with a shadow that clears the floor", () => {
    expect(SHADOW_ANCHOR.y).toBeGreaterThan(LAYERS.floor.y);
    expect(SHADOW_ANCHOR.y).toBeLessThan(0.1);
    expect(SHADOW_ANCHOR.opacity).toBeGreaterThan(0);
    expect(SHADOW_ANCHOR.opacity).toBeLessThan(1);
  });

  it("keeps the table a wide oval rather than a circle", () => {
    expect(FELT.radiusX).toBeGreaterThan(FELT.radiusZ);
  });
});

describe("low-end safeguards", () => {
  /**
   * Both of these are invisible in development and expensive in the field. A
   * 2048px carpet costs 16MB of VRAM after upload and looks identical on a
   * desktop GPU; a pixel ratio of 4 has a phone shading sixteen times the
   * pixels for a scene made of soft gradients.
   */
  it("caps textures at the documented resolution", () => {
    expect(MAX_TEXTURE_PX).toBe(1024);
    expect(Math.log2(MAX_TEXTURE_PX) % 1).toBe(0);
  });

  it("caps the pixel ratio below what a modern phone reports", () => {
    expect(MAX_PIXEL_RATIO).toBeLessThan(3);
    expect(MAX_PIXEL_RATIO).toBeGreaterThanOrEqual(1);
  });
});

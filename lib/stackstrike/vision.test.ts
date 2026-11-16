import { describe, expect, it } from "vitest";
import { FLASHLIGHT } from "./content";
import { angleDiff, beamPolygon, glowPolygon, isLit } from "./vision";

const origin = { x: 500, y: 500 };

describe("angleDiff", () => {
  it("takes the short way round", () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2, 6);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
    expect(angleDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });
});

describe("isLit", () => {
  it("lights a point inside the beam", () => {
    expect(isLit(origin, 0, true, { x: 700, y: 500 }, [])).toBe(true);
  });

  it("does not light a point past the range or off to the side", () => {
    expect(isLit(origin, 0, true, { x: 500 + FLASHLIGHT.range + 20, y: 500 }, [])).toBe(false);
    expect(isLit(origin, 0, true, { x: 500, y: 700 }, [])).toBe(false);
  });

  it("never lights what is behind a wall", () => {
    const wall = { x: 600, y: 400, w: 20, h: 200 };
    expect(isLit(origin, 0, true, { x: 700, y: 500 }, [wall])).toBe(false);
  });

  it("with the light off only the glow around the player is lit", () => {
    expect(isLit(origin, 0, false, { x: 700, y: 500 }, [])).toBe(false);
    expect(isLit(origin, 0, false, { x: 500 + FLASHLIGHT.ambient - 10, y: 500 }, [])).toBe(true);
  });

  it("the glow lights things beside and behind the player", () => {
    expect(isLit(origin, 0, true, { x: 500 - FLASHLIGHT.ambient + 10, y: 500 }, [])).toBe(true);
  });
});

describe("beamPolygon", () => {
  it("starts at the player and reaches full range in the open", () => {
    const poly = beamPolygon(origin, 0, []);
    expect(poly[0]).toEqual(origin);
    const farthest = Math.max(...poly.slice(1).map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)));
    expect(farthest).toBeCloseTo(FLASHLIGHT.range, 3);
  });

  it("is cut short by a wall", () => {
    const wall = { x: 600, y: 300, w: 20, h: 400 };
    const poly = beamPolygon(origin, 0, [wall]);
    for (const point of poly.slice(1)) expect(point.x).toBeLessThanOrEqual(600 + 0.001);
  });
});

describe("glowPolygon", () => {
  it("is a ring of the glow radius in the open and shrinks against a wall", () => {
    const open = glowPolygon(origin, []);
    for (const p of open) expect(Math.hypot(p.x - origin.x, p.y - origin.y)).toBeCloseTo(FLASHLIGHT.ambient, 3);
    const walled = glowPolygon(origin, [{ x: 520, y: 400, w: 10, h: 200 }]);
    expect(Math.max(...walled.map((p) => p.x))).toBeLessThanOrEqual(520.001);
  });
});

import { describe, expect, it } from "vitest";
import { PLAYER_GLOW } from "./content";
import { angleDiff, beamPolygon, coverAt, glowPolygon } from "./vision";

const origin = { x: 500, y: 500 };

describe("angleDiff", () => {
  it("takes the short way round", () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2, 6);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
    expect(angleDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });
});

describe("beamPolygon", () => {
  it("starts at the player and reaches full range in the open", () => {
    const poly = beamPolygon(origin, 0, [], 380, 0.5);
    expect(poly[0]).toEqual(origin);
    const farthest = Math.max(...poly.slice(1).map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)));
    expect(farthest).toBeCloseTo(380, 3);
  });

  it("is cut short by a wall", () => {
    const wall = { x: 600, y: 300, w: 20, h: 400 };
    const poly = beamPolygon(origin, 0, [wall], 380, 0.5);
    for (const point of poly.slice(1)) expect(point.x).toBeLessThanOrEqual(600 + 0.001);
  });
});

describe("glowPolygon", () => {
  it("is a ring of the glow radius in the open and shrinks against a wall", () => {
    const open = glowPolygon(origin, []);
    for (const p of open) expect(Math.hypot(p.x - origin.x, p.y - origin.y)).toBeCloseTo(PLAYER_GLOW.radius, 3);
    const walled = glowPolygon(origin, [{ x: 520, y: 400, w: 10, h: 200 }]);
    expect(Math.max(...walled.map((p) => p.x))).toBeLessThanOrEqual(520.001);
  });
});

describe("coverAt", () => {
  it("is zero in the open, a third against a flat wall and over half in a corner", () => {
    expect(coverAt(origin, [])).toBe(0);
    expect(coverAt({ x: 514, y: 500 }, [{ x: 400, y: 300, w: 100, h: 400 }])).toBeCloseTo(3 / 8, 6);
    const corner = [
      { x: 400, y: 300, w: 100, h: 400 },
      { x: 400, y: 300, w: 400, h: 100 },
    ];
    expect(coverAt({ x: 514, y: 414 }, corner)).toBeGreaterThanOrEqual(0.5);
  });
});

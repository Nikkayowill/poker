import { describe, expect, it } from "vitest";
import { LAND_OBSTACLES } from "@/lib/stackacres/land-clearing";
import { tileKey } from "./movement";
import { dealLandObstacles, type LandField } from "./land-obstacles";

function field(overrides: Partial<LandField> = {}): LandField {
  return { width: 28, height: 22, tile: 16, blocked: new Set<string>(), keepClear: [], from: { tx: 1, ty: 1 }, ...overrides };
}

describe("dealLandObstacles", () => {
  it("seats every obstacle on a field with room", () => {
    const placed = dealLandObstacles(LAND_OBSTACLES.wallow, field(), 1);
    expect(placed).toHaveLength(LAND_OBSTACLES.wallow.length);
    expect(placed.map((p) => p.id)).toEqual(LAND_OBSTACLES.wallow.map((o) => o.id));
    expect(placed.map((p) => p.kind)).toEqual(LAND_OBSTACLES.wallow.map((o) => o.kind));
  });

  it("gives the same field the same layout twice", () => {
    expect(dealLandObstacles(LAND_OBSTACLES.wallow, field(), 7)).toEqual(
      dealLandObstacles(LAND_OBSTACLES.wallow, field(), 7),
    );
  });

  it("never seats two on the same tile", () => {
    const placed = dealLandObstacles(LAND_OBSTACLES.oxfields, field({ width: 36, height: 26 }), 3);
    expect(new Set(placed.map((p) => tileKey(p.tx, p.ty))).size).toBe(placed.length);
  });

  it("anchors on the bottom middle of its tile, the way every prop is", () => {
    const [first] = dealLandObstacles(LAND_OBSTACLES.wallow, field(), 1);
    expect(first.x).toBe(first.tx * 16 + 8);
    expect(first.y).toBe(first.ty * 16 + 16);
  });

  it("leaves the edge strip alone", () => {
    for (const p of dealLandObstacles(LAND_OBSTACLES.wallow, field(), 2)) {
      expect(p.tx).toBeGreaterThan(0);
      expect(p.ty).toBeGreaterThan(0);
      expect(p.tx).toBeLessThan(27);
      expect(p.ty).toBeLessThan(21);
    }
  });

  it("stands nothing on a blocked tile", () => {
    const blocked = new Set<string>();
    for (let tx = 0; tx < 28; tx += 1) for (let ty = 8; ty < 12; ty += 1) blocked.add(tileKey(tx, ty));
    for (const p of dealLandObstacles(LAND_OBSTACLES.wallow, field({ blocked }), 4)) {
      expect(blocked.has(tileKey(p.tx, p.ty))).toBe(false);
    }
  });

  it("keeps a doorway open", () => {
    const keepClear = [{ x: 0, y: 160, width: 48, height: 48 }];
    for (const p of dealLandObstacles(LAND_OBSTACLES.wallow, field({ keepClear }), 5)) {
      const inside = p.x > 0 && p.x < 48 && p.y > 160 && p.y < 208;
      expect(inside).toBe(false);
    }
  });

  it("tightens the spacing before it gives up on a small field", () => {
    // Two tiles apart will not fit 24 obstacles in a 9x9 yard, so it seats
    // them closer together instead.
    const roomy = dealLandObstacles(LAND_OBSTACLES.wallow, field(), 6);
    const tight = dealLandObstacles(LAND_OBSTACLES.wallow, field({ width: 9, height: 9 }), 6);
    expect(roomy).toHaveLength(LAND_OBSTACLES.wallow.length);
    expect(tight.length).toBeGreaterThan(0);
    const gaps = tight.flatMap((a, i) =>
      tight.slice(i + 1).map((b) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))),
    );
    expect(Math.min(...gaps)).toBe(2);
  });

  it("would rather leave one out than wall the field off behind it", () => {
    // A yard with one way in: filling it up must never seal the far half off,
    // so the deal stops short instead.
    const blocked = new Set<string>();
    for (let ty = 0; ty < 22; ty += 1) if (ty !== 5) blocked.add(tileKey(10, ty));
    const placed = dealLandObstacles(LAND_OBSTACLES.wallow, field({ blocked, from: { tx: 1, ty: 5 } }), 9);
    expect(placed.some((p) => p.tx === 10 && p.ty === 5)).toBe(false);
    expect(placed.some((p) => p.tx > 10)).toBe(true);
  });

  it("deals nothing on a field with no room at all", () => {
    const blocked = new Set<string>();
    for (let tx = 0; tx < 28; tx += 1) for (let ty = 0; ty < 22; ty += 1) blocked.add(tileKey(tx, ty));
    expect(dealLandObstacles(LAND_OBSTACLES.wallow, field({ blocked }), 8)).toEqual([]);
  });
});

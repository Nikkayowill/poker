import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * The two real maps, read off the committed area data the scene loads.
 *
 * These are the tests that matter: a field is only playable if every
 * obstacle on it can actually be walked up to and the way out stays open,
 * and neither is something the placement rules guarantee on their own.
 */
describe("the Fold and the Pasture as they are actually drawn", () => {
  interface AreaJson {
    width: number;
    height: number;
    tile: number;
    spawn: { x: number; y: number };
    props: { tag?: string; blocks: [number, number][] }[];
    blocked: [number, number][];
    exits: { x: number; y: number; w: number; h: number }[];
  }

  function area(name: string): AreaJson {
    return JSON.parse(readFileSync(join(process.cwd(), "public/stackacres-td/areas", name, "area.json"), "utf8"));
  }

  /** The same field the scene builds in `buildLandObstacles`. */
  function fieldOf(spec: AreaJson): LandField {
    const blocked = new Set<string>();
    for (const [tx, ty] of spec.blocked) blocked.add(tileKey(tx, ty));
    for (const prop of spec.props) for (const [tx, ty] of prop.blocks) blocked.add(tileKey(tx, ty));
    const keepClear = spec.exits.map((exit) => ({
      x: exit.x - spec.tile,
      y: exit.y - spec.tile,
      width: exit.w + spec.tile * 2,
      height: exit.h + spec.tile * 2,
    }));
    keepClear.push({
      x: spec.spawn.x - spec.tile,
      y: spec.spawn.y - spec.tile,
      width: spec.tile * 2,
      height: spec.tile * 2,
    });
    return {
      width: spec.width,
      height: spec.height,
      tile: spec.tile,
      blocked,
      keepClear,
      from: { tx: Math.floor(spec.spawn.x / spec.tile), ty: Math.floor(spec.spawn.y / spec.tile) },
    };
  }

  /** The same tiles again, minus the gate across a district's entrance --
   *  that one is drawn shut and opens on its own, so walking the field is
   *  judged with it out of the way. */
  function walkable(spec: AreaJson): Set<string> {
    const blocked = new Set<string>();
    for (const [tx, ty] of spec.blocked) blocked.add(tileKey(tx, ty));
    for (const prop of spec.props) {
      if (prop.tag?.startsWith("locked:")) continue;
      for (const [tx, ty] of prop.blocks) blocked.add(tileKey(tx, ty));
    }
    return blocked;
  }

  /** Every tile the farmer can reach from where he walks in, over the same
   *  eight-way grid lib/stackacres-td/movement.ts walks him on. */
  function reachable(spec: AreaJson, blocked: ReadonlySet<string>, standing: ReadonlySet<string>): Set<string> {
    const start = { tx: Math.floor(spec.spawn.x / spec.tile), ty: Math.floor(spec.spawn.y / spec.tile) };
    const seen = new Set<string>([tileKey(start.tx, start.ty)]);
    const queue = [start];
    const open = (tx: number, ty: number) =>
      tx >= 0 && ty >= 0 && tx < spec.width && ty < spec.height && !blocked.has(tileKey(tx, ty)) && !standing.has(tileKey(tx, ty));
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (queue.length > 0) {
      const { tx, ty } = queue.shift()!;
      for (const [dx, dy] of steps) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!open(nx, ny) || seen.has(tileKey(nx, ny))) continue;
        // No cutting a blocked corner, same rule `findPath` keeps.
        if (dx !== 0 && dy !== 0 && (!open(tx + dx, ty) || !open(tx, ty + dy))) continue;
        seen.add(tileKey(nx, ny));
        queue.push({ tx: nx, ty: ny });
      }
    }
    return seen;
  }

  for (const [name, sector] of [["fold", "wallow"], ["pasture", "oxfields"]] as const) {
    describe(name, () => {
      const spec = area(name);
      const field = fieldOf(spec);
      const placed = dealLandObstacles(LAND_OBSTACLES[sector], field, spec.width * 31 + spec.height);
      const standing = new Set(placed.map((p) => tileKey(p.tx, p.ty)));

      it("has room for every obstacle the sector owes", () => {
        expect(placed).toHaveLength(LAND_OBSTACLES[sector].length);
      });

      it("stands none of them on ground that was already taken", () => {
        for (const p of placed) expect(field.blocked.has(tileKey(p.tx, p.ty))).toBe(false);
      });

      it("leaves every obstacle walkable up to", () => {
        const open = reachable(spec, walkable(spec), standing);
        const stranded = placed.filter(
          (p) =>
            !open.has(tileKey(p.tx + 1, p.ty)) &&
            !open.has(tileKey(p.tx - 1, p.ty)) &&
            !open.has(tileKey(p.tx, p.ty + 1)) &&
            !open.has(tileKey(p.tx, p.ty - 1)),
        );
        expect(stranded.map((p) => p.id)).toEqual([]);
      });

      it("leaves every doorway reachable", () => {
        const open = reachable(spec, walkable(spec), standing);
        for (const exit of spec.exits) {
          const tx = Math.floor((exit.x + exit.w / 2) / spec.tile);
          const ty = Math.floor((exit.y + exit.h / 2) / spec.tile);
          expect(open.has(tileKey(tx, ty))).toBe(true);
        }
      });
    });
  }
});

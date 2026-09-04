import { describe, expect, it } from "vitest";
import { STACKACRES_STOCK } from "./catalogue";
import { nearPath } from "./paths";
import {
  BARN_FOOTPRINT,
  FARM_ZONE,
  STACKACRES_CHUNK,
  STACKACRES_ZOOM_MAX,
  STACKACRES_ZOOM_MIN,
  barnHitAt,
  chunkScenery,
  forestDensityAt,
  clampZoom,
  cropSpot,
  growAreaAt,
  growAreaBounds,
  growAreaInterior,
  inFarmZone,
  powerOfTwoCeil,
  scrollToKeepUnderPointer,
  seedFromId,
  seededRandom,
  spawnCritter,
  stepCritter,
  stockAllowedInZone,
  stockZone,
  stocksInZone,
} from "./world";
import { ZONE_IDS } from "./zones";

describe("stock zoning", () => {
  it("gives every kind exactly the district the pen-zoning pass put it in", () => {
    expect(stockZone("hen")).toBe("farmstead");
    expect(stockZone("sprout")).toBe("meadow");
    expect(stockZone("cash_crop")).toBe("meadow");
    expect(stockZone("pig")).toBe("wallow");
    expect(stockZone("cattle")).toBe("oxfields");
  });

  it("agrees with itself: a stock is only allowed in its own zone", () => {
    for (const stock of STACKACRES_STOCK) {
      const home = stockZone(stock);
      for (const zone of ZONE_IDS) {
        expect(stockAllowedInZone(zone, stock)).toBe(zone === home);
      }
    }
  });

  it("names every zone's stock as the exact reverse of stockZone", () => {
    for (const zone of ZONE_IDS) {
      const listed = stocksInZone(zone);
      for (const stock of listed) expect(stockZone(stock)).toBe(zone);
      for (const stock of STACKACRES_STOCK) {
        expect(listed.includes(stock)).toBe(stockZone(stock) === zone);
      }
    }
    // Every stock is accounted for exactly once across all four zones.
    const total = ZONE_IDS.reduce((sum, zone) => sum + stocksInZone(zone).length, 0);
    expect(total).toBe(STACKACRES_STOCK.length);
  });
});

describe("grow areas", () => {
  it("gives every district a sane, non-degenerate rect", () => {
    for (const zone of ZONE_IDS) {
      const bounds = growAreaBounds(zone);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    }
  });

  it("keeps the walkable interior nested inside the fenced bounds, on every side", () => {
    for (const zone of ZONE_IDS) {
      const bounds = growAreaBounds(zone);
      const interior = growAreaInterior(zone);
      expect(interior.width).toBeGreaterThan(0);
      expect(interior.height).toBeGreaterThan(0);
      expect(interior.x).toBeGreaterThan(bounds.x);
      expect(interior.y).toBeGreaterThan(bounds.y);
      expect(interior.x + interior.width).toBeLessThan(bounds.x + bounds.width);
      expect(interior.y + interior.height).toBeLessThan(bounds.y + bounds.height);
    }
  });

  // `growAreaAt` returns the first match with no tie-break, which is only
  // honest while the four boxes are disjoint. A district nudged on top of
  // another would silently start offering the wrong stock to a tap.
  it("keeps the four grow areas from overlapping each other", () => {
    for (const a of ZONE_IDS) {
      for (const b of ZONE_IDS) {
        if (a === b) continue;
        const one = growAreaBounds(a);
        const two = growAreaBounds(b);
        const apart =
          one.x + one.width < two.x ||
          two.x + two.width < one.x ||
          one.y + one.height < two.y ||
          two.y + two.height < one.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("finds a district from a point inside its grow area, and only there", () => {
    for (const zone of ZONE_IDS) {
      const bounds = growAreaBounds(zone);
      const mid = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      expect(growAreaAt(mid.x, mid.y)).toBe(zone);
      // Corners are inside: the fence is part of the ground you can seed.
      expect(growAreaAt(bounds.x, bounds.y)).toBe(zone);
      expect(growAreaAt(bounds.x + bounds.width, bounds.y + bounds.height)).toBe(zone);
      // A step outside is not. A tap in the woods must offer nothing.
      expect(growAreaAt(bounds.x - 1, bounds.y - 1)).not.toBe(zone);
    }
  });

  it("is narrower than the district itself -- the woods answer nothing", () => {
    // Far outside every district, in the open world the camera can roam.
    expect(growAreaAt(5_000, 5_000)).toBeNull();
  });
});

describe("the barn's tap target", () => {
  it("hits dead centre and at the box's own edges", () => {
    const mid = {
      x: BARN_FOOTPRINT.x + BARN_FOOTPRINT.width / 2,
      y: BARN_FOOTPRINT.y + BARN_FOOTPRINT.height / 2,
    };
    expect(barnHitAt(mid.x, mid.y)).toBe(true);
    expect(barnHitAt(BARN_FOOTPRINT.x, BARN_FOOTPRINT.y)).toBe(true);
    expect(
      barnHitAt(BARN_FOOTPRINT.x + BARN_FOOTPRINT.width, BARN_FOOTPRINT.y + BARN_FOOTPRINT.height),
    ).toBe(true);
  });

  it("misses a step outside the box, and misses every district's own ground", () => {
    expect(barnHitAt(BARN_FOOTPRINT.x - 1, BARN_FOOTPRINT.y - 1)).toBe(false);
    expect(
      barnHitAt(BARN_FOOTPRINT.x + BARN_FOOTPRINT.width + 1, BARN_FOOTPRINT.y + BARN_FOOTPRINT.height + 1),
    ).toBe(false);
    for (const zone of ZONE_IDS) {
      const bounds = growAreaBounds(zone);
      const mid = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      expect(barnHitAt(mid.x, mid.y)).toBe(false);
    }
  });
});

describe("zoom", () => {
  it("holds fixed min/max now the camera is unbounded", () => {
    expect(clampZoom(0.1)).toBe(STACKACRES_ZOOM_MIN);
    expect(clampZoom(50)).toBe(STACKACRES_ZOOM_MAX);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(STACKACRES_ZOOM_MIN);
  });

  it("keeps the world point under the finger through a zoom", () => {
    const view = { width: 800, height: 400 };
    const finger = { x: 600, y: 100 };
    const world = { x: 250, y: 120 };
    for (const zoom of [1, 2, 3.5]) {
      const scroll = scrollToKeepUnderPointer(world, finger, view.width, view.height, zoom);
      // Phaser: worldX = scrollX + width/2 + (screenX - width/2) / zoom.
      const back = scroll.x + view.width / 2 + (finger.x - view.width / 2) / zoom;
      expect(back).toBeCloseTo(world.x);
      const backY = scroll.y + view.height / 2 + (finger.y - view.height / 2) / zoom;
      expect(backY).toBeCloseTo(world.y);
    }
  });
});

describe("animals", () => {
  it("never walks an animal through the fence, however long it wanders", () => {
    const pen = growAreaInterior("farmstead");
    const random = seededRandom(99);
    let critter = spawnCritter(pen, random);
    let walked = 0;
    for (let i = 0; i < 5_000; i += 1) {
      const before = critter;
      critter = stepCritter(critter, pen, 14, 33, random);
      if (critter.mode === "walk" && before.mode === "walk") walked += 1;
      expect(critter.x).toBeGreaterThanOrEqual(pen.x);
      expect(critter.x).toBeLessThanOrEqual(pen.x + pen.width);
      expect(critter.y).toBeGreaterThanOrEqual(pen.y);
      expect(critter.y).toBeLessThanOrEqual(pen.y + pen.height);
    }
    // It actually went somewhere, rather than idling for the whole run.
    expect(walked).toBeGreaterThan(100);
  });

  it("faces the way it is walking and arrives exactly on its target", () => {
    const pen = { x: 0, y: 0, width: 100, height: 100 };
    const critter = {
      x: 10,
      y: 10,
      targetX: 10,
      targetY: 10,
      mode: "idle" as const,
      waitMs: 1,
      facing: 1 as const,
    };
    // A random source that always picks the far corner.
    const toCorner = () => 0.9;
    const walking = stepCritter(critter, pen, 10, 16, toCorner);
    expect(walking.mode).toBe("walk");
    expect(walking.targetX).toBe(90);
    expect(walking.facing).toBe(-1);
    let c = walking;
    for (let i = 0; i < 2_000 && c.mode === "walk"; i += 1) c = stepCritter(c, pen, 10, 16, toCorner);
    expect(c.mode).toBe("idle");
    expect(c.x).toBe(90);
    expect(c.y).toBe(90);
  });

  it("caps a long frame so a background tab does not teleport the herd", () => {
    const pen = { x: 0, y: 0, width: 1000, height: 10 };
    const critter = {
      x: 0,
      y: 5,
      targetX: 1000,
      targetY: 5,
      mode: "walk" as const,
      waitMs: 0,
      facing: -1 as const,
    };
    const after = stepCritter(critter, pen, 100, 60_000, () => 0.5);
    // 250ms at 100 units/s, not 60s worth.
    expect(after.x).toBeCloseTo(25);
  });
});

describe("open-world scenery", () => {
  const isWood = (p: { kind: string }) => p.kind !== "tuft" && !p.kind.startsWith("flower");

  it("grows a chunk deterministically and keeps every piece inside it", () => {
    const first = chunkScenery(5, -2);
    expect(chunkScenery(5, -2)).toEqual(first);
    expect(chunkScenery(6, -2)).not.toEqual(first);
    for (const piece of first) {
      expect(piece.x).toBeGreaterThanOrEqual(5 * STACKACRES_CHUNK);
      expect(piece.x).toBeLessThan(6 * STACKACRES_CHUNK);
      expect(piece.y).toBeGreaterThanOrEqual(-2 * STACKACRES_CHUNK);
      expect(piece.y).toBeLessThan(-1 * STACKACRES_CHUNK);
    }
  });

  it("never grows scenery inside the farm zone", () => {
    // The chunk sitting on top of the farm itself is the sharpest test: every
    // candidate point in it falls inside FARM_ZONE somewhere along the way.
    const cx = Math.floor(FARM_ZONE.x / STACKACRES_CHUNK);
    const cy = Math.floor(FARM_ZONE.y / STACKACRES_CHUNK);
    for (const piece of chunkScenery(cx, cy)) {
      expect(inFarmZone(piece.x, piece.y)).toBe(false);
    }
  });

  it("keeps the barn yard, the lane's verge and the mailbox inside the farm zone", () => {
    // Roof peak of the barn, the stone wall's sprite top, the lane's lamps
    // on the west verge, and the mailbox at the lane's end.
    expect(inFarmZone(108, -28)).toBe(true);
    expect(inFarmZone(160, -50)).toBe(true);
    expect(inFarmZone(36, 300)).toBe(true);
    expect(inFarmZone(46, 404)).toBe(true);
    // And not the woods a chunk away.
    expect(inFarmZone(-100, 100)).toBe(false);
    expect(inFarmZone(200, -100)).toBe(false);
  });

  it("never grows scenery on a path", () => {
    // The chunks the track crosses on its way out, the ones the road curves
    // through, and the one holding the lane's verge: every candidate near a
    // path is dropped rather than shifted.
    for (const [cx, cy] of [[-1, -1], [-1, -2], [0, -1], [0, 0], [0, 1], [0, 2], [2, -1], [3, -1]]) {
      for (const piece of chunkScenery(cx, cy)) {
        expect(nearPath(piece.x, piece.y), `${cx}:${cy} ${piece.kind} at ${piece.x},${piece.y}`).toBe(false);
      }
    }
  });

  it("sorts a chunk's scenery by y, for correct draw order", () => {
    const items = chunkScenery(3, 8);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i].y).toBeGreaterThanOrEqual(items[i - 1].y);
    }
  });

  it("grows real woods and real open ground, not an even sprinkle", () => {
    // The point of the forest field: somewhere out there is deep wood, and
    // somewhere out there is grass you can cross. An even scatter -- which is
    // what this replaced, twice -- would make every chunk look like every
    // other one, and would fail this.
    const counts: number[] = [];
    for (let cx = -12; cx <= 12; cx += 1) {
      for (let cy = -12; cy <= 12; cy += 1) {
        counts.push(chunkScenery(cx, cy).filter(isWood).length);
      }
    }
    const dense = counts.filter((n) => n >= 12).length;
    const open = counts.filter((n) => n <= 2).length;
    expect(dense).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
    // And the lattice is a hard ceiling: 5x5 planting points per chunk, plus
    // at most 3 lone things out in the grass.
    expect(Math.max(...counts)).toBeLessThanOrEqual(28);
  });

  it("keeps the gaps open: a lane through the wood is walkable ground", () => {
    // Sample a long line across the world and confirm the field actually
    // returns to zero inside otherwise-wooded country, rather than being one
    // unbroken mass with soft edges.
    let inWood = 0;
    let gapsInsideWood = 0;
    for (let x = -3000; x < 3000; x += 7) {
      const here = forestDensityAt(x, 640);
      if (here > 0.5) inWood += 1;
      if (here === 0 && forestDensityAt(x - 90, 640) > 0.5 && forestDensityAt(x + 90, 640) > 0.5) {
        gapsInsideWood += 1;
      }
    }
    expect(inWood).toBeGreaterThan(0);
    expect(gapsInsideWood).toBeGreaterThan(0);
  });
});

describe("powerOfTwoCeil", () => {
  it("rounds a texture side up to the next power of two, never down", () => {
    expect(powerOfTwoCeil(1)).toBe(1);
    expect(powerOfTwoCeil(2)).toBe(2);
    expect(powerOfTwoCeil(3)).toBe(4);
    expect(powerOfTwoCeil(112)).toBe(128);
    expect(powerOfTwoCeil(128)).toBe(128);
    expect(powerOfTwoCeil(640)).toBe(1024);
    expect(powerOfTwoCeil(0)).toBe(1);
    expect(powerOfTwoCeil(Number.NaN)).toBe(1);
  });

  it("makes every painter side a power of two once scaled", () => {
    // The whole point: the renderer only mips power-of-two textures.
    for (const side of [12, 14, 16, 20, 22, 24, 30, 34, 62, 74, 80, 160]) {
      const px = powerOfTwoCeil(Math.ceil(side * 8));
      expect(Math.log2(px) % 1).toBe(0);
      expect(px).toBeGreaterThanOrEqual(side * 8);
    }
  });
});

describe("seeded randomness", () => {
  it("is repeatable and in range", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("seedFromId", () => {
  it("is deterministic: the same id always hashes the same", () => {
    expect(seedFromId("unit-42")).toBe(seedFromId("unit-42"));
  });

  it("differs for different ids", () => {
    expect(seedFromId("unit-1")).not.toBe(seedFromId("unit-2"));
  });
});

describe("cropSpot", () => {
  it("is deterministic per unit id", () => {
    expect(cropSpot("meadow", "crop-7")).toEqual(cropSpot("meadow", "crop-7"));
  });

  it("lands inside the zone's own grow-area interior", () => {
    const ids = ["crop-1", "crop-2", "crop-3", "another-id", "yet-another"];
    for (const zone of ZONE_IDS) {
      const interior = growAreaInterior(zone);
      for (const id of ids) {
        const spot = cropSpot(zone, id);
        expect(spot.x).toBeGreaterThanOrEqual(interior.x);
        expect(spot.x).toBeLessThanOrEqual(interior.x + interior.width);
        expect(spot.y).toBeGreaterThanOrEqual(interior.y);
        expect(spot.y).toBeLessThanOrEqual(interior.y + interior.height);
      }
    }
  });
});

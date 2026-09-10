import { describe, expect, it } from "vitest";
import { worldBoundsRect } from "./bounds";
import { GREENHOUSE_PLOT } from "./greenhouse";
import { isoProject, isoUnproject, projectedBounds } from "./iso";
import { ALL_FARM_PATHS, FARM_PATHS, nearestOnPath } from "./paths";
import {
  DIRT_YARDS,
  SEA_EXPANSE_TILE,
  SEA_SAND_WIDTH,
  SEA_SHALLOW_WIDTH,
  SEA_SHORE_WOBBLE,
  SEA_SHORE_X,
  SEA_TILES_EAST,
  SEA_WOBBLE_PERIOD,
  TERRAIN_CELL,
  TERRAIN_CHUNK,
  TERRAIN_CHUNK_CELLS,
  TERRAIN_OVERHANG,
  TERRAIN_SCAN,
  cellAt,
  cellOrigin,
  cellTile,
  dirtReach,
  inSea,
  seaExpanseTiles,
  seaShoreX,
  terrainChunkScreenRect,
  terrainChunks,
  terrainMaterialAt,
  tileFrameOffset,
} from "./terrain";
import { POND, POND_SAND, POND_SHALLOW, POND_ZONE } from "./water";
import { BARN_FOOTPRINT, FARM_ZONE, STACKACRES_CHUNK, WHEAT_FIELD, chunkScenery, type WorldPoint } from "./world";
import { ZONE_LIST } from "./zones";

describe("the lattice", () => {
  it("puts every cell's diamond on one of the lawn's own stamps", () => {
    // bakeGrass tiles the lawn from screen (0, 0); its stamps' centres sit
    // at (16k, 8m + 8) with k + m odd (see the module header).
    for (let i = -20; i <= 20; i += 7) {
      for (let j = -20; j <= 20; j += 5) {
        const o = cellOrigin(i, j);
        const c = isoProject(o.x + TERRAIN_CELL / 2, o.y + TERRAIN_CELL / 2);
        expect(Math.abs(c.x % 16)).toBe(0);
        expect(Math.abs((c.y - 8) % 8)).toBe(0);
        const k = c.x / 16;
        const m = (c.y - 8) / 8;
        expect(Math.abs(k + m) % 2).toBe(1);
      }
    }
  });

  it("round-trips a point through cellAt and cellOrigin", () => {
    for (const [x, y] of [
      [0, 0],
      [8, -8],
      [7.9, -8.1],
      [-700, 300],
      [455.5, -13],
    ]) {
      const c = cellAt(x, y);
      const o = cellOrigin(c.i, c.j);
      expect(x).toBeGreaterThanOrEqual(o.x);
      expect(x).toBeLessThan(o.x + TERRAIN_CELL);
      expect(y).toBeGreaterThanOrEqual(o.y);
      expect(y).toBeLessThan(o.y + TERRAIN_CELL);
    }
  });

  it("bakes a chunk into a 512x256 canvas at two pixels per unit", () => {
    const rect = terrainChunkScreenRect(3, -2);
    expect(rect.width).toBe(TERRAIN_CHUNK * 2);
    expect(rect.height).toBe(TERRAIN_CHUNK);
    expect((rect.width) * 2).toBeLessThanOrEqual(512);
    expect((rect.height + TERRAIN_OVERHANG) * 2).toBeLessThanOrEqual(256);
  });
});

describe("the sea", () => {
  it("lies east of every district and west of the camera's wall", () => {
    const eastmost = Math.max(...ZONE_LIST.map((z) => z.bounds.x + z.bounds.width));
    const wall = worldBoundsRect();
    let shoreMin = Infinity;
    let shoreMax = -Infinity;
    for (let y = -1500; y <= 1500; y += 4) {
      const x = seaShoreX(y);
      shoreMin = Math.min(shoreMin, x);
      shoreMax = Math.max(shoreMax, x);
    }
    expect(shoreMin).toBeGreaterThan(eastmost);
    expect(shoreMax + SEA_SAND_WIDTH + SEA_SHALLOW_WIDTH).toBeLessThan(wall.x + wall.width);
    expect(SEA_SHORE_X).toBeGreaterThan(eastmost);
  });

  it("repeats its shore every two chunks, so a stretch of coast bakes once", () => {
    for (let y = -600; y <= 600; y += 13) {
      expect(seaShoreX(y + SEA_WOBBLE_PERIOD)).toBeCloseTo(seaShoreX(y), 9);
    }
    expect(SEA_WOBBLE_PERIOD).toBe(TERRAIN_CHUNK * 2);
  });

  it("keeps its bands wider than a cell's diagonal across the shore", () => {
    let steepest = 0;
    for (let y = -600; y <= 600; y += 1) {
      steepest = Math.max(steepest, Math.abs(seaShoreX(y + 1) - seaShoreX(y)));
    }
    const across = Math.hypot(1, steepest);
    const diagonal = TERRAIN_CELL * Math.SQRT2;
    expect(SEA_SAND_WIDTH / across).toBeGreaterThan(diagonal);
    expect(SEA_SHALLOW_WIDTH / across).toBeGreaterThan(diagonal);
  });

  it("grows nothing wild in the water or on the sand", () => {
    const wall = worldBoundsRect();
    const cx0 = Math.floor((SEA_SHORE_X - 40) / STACKACRES_CHUNK);
    const cx1 = Math.floor((wall.x + wall.width) / STACKACRES_CHUNK);
    let inspected = 0;
    for (let cy = -4; cy <= 4; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (const item of chunkScenery(cx, cy)) {
          inspected += 1;
          expect(inSea(item.x, item.y), `${item.kind} at ${item.x},${item.y}`).toBe(false);
        }
      }
    }
    expect(inspected).toBeGreaterThan(0);
  });

  it("steps grass, sand, shallows, deep going east", () => {
    const y = 40;
    const shore = seaShoreX(y);
    expect(terrainMaterialAt(shore - 1, y)).toBe("grass");
    expect(terrainMaterialAt(shore + 1, y)).toBe("sand");
    expect(terrainMaterialAt(shore + SEA_SAND_WIDTH + 1, y)).toBe("shallow");
    expect(terrainMaterialAt(shore + SEA_SAND_WIDTH + SEA_SHALLOW_WIDTH + 1, y)).toBe("deep");
    expect(terrainMaterialAt(SEA_TILES_EAST, y)).toBe("deep");
  });

  it("lays open-water images over everything past the tiles and never over the lawn", () => {
    // A desktop window at the minimum zoom overhangs the camera's box; the
    // scene hands in that larger reach. Use a generous one here.
    const box = projectedBounds(worldBoundsRect());
    const reach = { x: box.x - 400, y: box.y - 400, width: box.width + 1600, height: box.height + 1400 };
    const tiles = seaExpanseTiles(reach);
    expect(tiles.length).toBeGreaterThan(40);
    expect(tiles.length).toBeLessThan(600);
    const inside = (sx: number, sy: number) =>
      tiles.some((t) => sx >= t.x && sx < t.x + SEA_EXPANSE_TILE && sy >= t.y && sy < t.y + SEA_EXPANSE_TILE);
    let checked = 0;
    for (let sx = reach.x; sx <= reach.x + reach.width; sx += 24) {
      for (let sy = reach.y; sy <= reach.y + reach.height; sy += 24) {
        const w = isoUnproject(sx, sy);
        if (w.x >= SEA_TILES_EAST + 8) {
          expect(inside(sx, sy), `open water at ${sx},${sy} (world x ${w.x.toFixed(0)})`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // No image reaches back over the lawn: every corner is past the shore's
    // furthest wander, where the ground is sand or water and tiled anyway.
    let shoreMax = -Infinity;
    for (let y = -3000; y <= 3000; y += 2) shoreMax = Math.max(shoreMax, seaShoreX(y));
    for (const t of tiles) {
      for (const [sx, sy] of [
        [t.x, t.y],
        [t.x + SEA_EXPANSE_TILE, t.y],
        [t.x, t.y + SEA_EXPANSE_TILE],
        [t.x + SEA_EXPANSE_TILE, t.y + SEA_EXPANSE_TILE],
      ]) {
        expect(isoUnproject(sx, sy).x).toBeGreaterThan(shoreMax);
      }
    }
    expect(SEA_SHORE_X + SEA_SHORE_WOBBLE).toBeGreaterThanOrEqual(shoreMax);
    expect(TERRAIN_SCAN.x + TERRAIN_SCAN.width).toBe(SEA_TILES_EAST);
  });
});

describe("the pond", () => {
  it("is deep in the middle, shallow, then sand, then lawn", () => {
    expect(terrainMaterialAt(POND.x, POND.y)).toBe("deep");
    const r = Math.min(POND.rx, POND.ry);
    expect(terrainMaterialAt(POND.x + POND.rx * ((r - POND_SHALLOW / 2) / r), POND.y)).toBe("shallow");
    expect(terrainMaterialAt(POND.x + POND.rx + POND_SAND / 2, POND.y)).toBe("sand");
    expect(terrainMaterialAt(POND.x, POND.y - POND.ry - POND_SAND - 2)).toBe("grass");
  });

  it("draws every one of its tiles inside its own clearing", () => {
    const first = cellAt(POND_ZONE.x - TERRAIN_CELL * 2, POND_ZONE.y - TERRAIN_CELL * 2);
    const last = cellAt(POND_ZONE.x + POND_ZONE.width + TERRAIN_CELL * 2, POND_ZONE.y + POND_ZONE.height + TERRAIN_CELL * 2);
    // A shore tile's grass half may lie a cell past the clearing: the sand
    // it carries stops at the vertex the clearing was measured from.
    const zone = {
      x: POND_ZONE.x - TERRAIN_CELL,
      y: POND_ZONE.y - TERRAIN_CELL,
      width: POND_ZONE.width + TERRAIN_CELL * 2,
      height: POND_ZONE.height + TERRAIN_CELL * 2,
    };
    let water = 0;
    for (let j = first.j; j <= last.j; j += 1) {
      for (let i = first.i; i <= last.i; i += 1) {
        const tile = cellTile(i, j);
        if (!tile) continue;
        const o = cellOrigin(i, j);
        const corners: [number, number][] = [
          [o.x, o.y],
          [o.x + TERRAIN_CELL, o.y],
          [o.x, o.y + TERRAIN_CELL],
          [o.x + TERRAIN_CELL, o.y + TERRAIN_CELL],
        ];
        // The lane and the dock spur run through this range too; only a tile
        // with water or sand at a corner is the pond's.
        const wet = corners.some(([x, y]) => {
          const m = terrainMaterialAt(x, y);
          return m === "sand" || m === "shallow" || m === "deep";
        });
        if (!wet) continue;
        water += 1;
        for (const [x, y] of corners) {
          expect(x).toBeGreaterThanOrEqual(zone.x);
          expect(x).toBeLessThanOrEqual(zone.x + zone.width);
          expect(y).toBeGreaterThanOrEqual(zone.y);
          expect(y).toBeLessThanOrEqual(zone.y + zone.height);
        }
      }
    }
    expect(water).toBeGreaterThan(20);
  });
});

describe("the paving", () => {
  /** The frames of pair p: 16p to 16p + 15 (see the atlas's own header). */
  const pairOf = (frame: number): number => Math.floor(frame / 16);
  const PAIR_GRASS_DIRT = 3;
  const PAIR_GRASS_COBBLE = 4;

  const spec = (key: string) => {
    const found = ALL_FARM_PATHS.find((p) => p.key === key);
    if (!found) throw new Error(`no path ${key}`);
    return found;
  };

  /** The middle of a spec's first leg, on its own centreline. */
  const on = (key: string): WorldPoint => {
    const [a, b] = spec(key).points;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  it("paves the entrance lane", () => {
    const at = on("lane");
    expect(terrainMaterialAt(at.x, at.y)).toBe("cobble");
  });

  it("leaves every other road bare earth", () => {
    // Measured on each road's own centreline, so the answer is that road's
    // surface and not a neighbour's paving reaching over.
    for (const key of ["yardRoad", "midRoad", "northRoadEast", "northRoadWest", "southRoadEast", "southRoadWest", "eastRoad", "foldRoad", "meadowSpur"]) {
      const at = on(key);
      expect([key, terrainMaterialAt(at.x, at.y)]).toEqual([key, "dirt"]);
    }
  });

  it("leaves a service spur bare where it runs clear of the road it forks off", () => {
    // Measured out along a spur rather than at its middle: the dock spur is
    // shorter than the reach of the lane it forks off, so every point on it
    // is inside the lane's own paving and it reads as the stone fanning out
    // at the junction.
    const henCoop = on("spur-henCoop");
    expect(terrainMaterialAt(henCoop.x, henCoop.y)).toBe("dirt");
  });

  it("never paves a connector the pathway walk grew", () => {
    const grown = ALL_FARM_PATHS.filter((p) => p.key.startsWith("spur-"));
    expect(grown.length).toBeGreaterThan(0);
    for (const s of grown) expect(s.surface).toBe("dirt");
  });

  it("cuts a paved cell from the grass-cobble pair and a bare one from grass-dirt", () => {
    const paved = cellAt(on("lane").x, on("lane").y);
    const bare = cellAt(on("spur-henCoop").x, on("spur-henCoop").y);
    expect(pairOf(cellTile(paved.i, paved.j)!.frame)).toBe(PAIR_GRASS_COBBLE);
    expect(pairOf(cellTile(bare.i, bare.j)!.frame)).toBe(PAIR_GRASS_DIRT);
  });

  it("keeps the stone where a bare spur runs into the paved lane", () => {
    // The dock spur forks off the lane, so the ground at its root has paving
    // on one side and bare earth on the other. Stone wins, which keeps the
    // lane's edge a straight line rather than a bite out of it.
    const [start] = spec("dockSpur").points;
    const root = nearestOnPath(start.x, start.y, spec("lane"));
    expect(terrainMaterialAt(root.point.x, root.point.y)).toBe("cobble");
  });
});

describe("the dirt", () => {
  it("takes in exactly the two lattice rows under a grid road", () => {
    // The middle road's body is x -288..-256; the rows either side of its
    // centreline are at -280 and -264, and the next ones out at -296 and
    // -248 must stay grass. What this holds is the reach, not the surface.
    expect(terrainMaterialAt(-280, 40)).toBe("dirt");
    expect(terrainMaterialAt(-264, 40)).toBe("dirt");
    expect(terrainMaterialAt(-296, 40)).toBe("grass");
    expect(terrainMaterialAt(-248, 40)).toBe("grass");
    const mid = FARM_PATHS.find((p) => p.key === "midRoad");
    expect(mid && dirtReach(mid)).toBe(22);
  });

  it("puts a yard under the barn and around the Greenhouse, and nowhere else", () => {
    expect(DIRT_YARDS).toHaveLength(2);
    const [barn, greenhouse] = DIRT_YARDS;
    // The barn's feet stand on its ground band.
    expect(barn.x).toBeLessThanOrEqual(BARN_FOOTPRINT.x);
    expect(barn.x + barn.width).toBeGreaterThanOrEqual(BARN_FOOTPRINT.x + BARN_FOOTPRINT.width);
    const feet = BARN_FOOTPRINT.y + BARN_FOOTPRINT.height;
    expect(barn.y).toBeLessThan(feet);
    expect(barn.y + barn.height).toBeGreaterThan(feet + 8);
    expect(greenhouse.x).toBeLessThanOrEqual(GREENHOUSE_PLOT.x - 8);
    expect(greenhouse.y).toBeLessThanOrEqual(GREENHOUSE_PLOT.y - 8);
    expect(greenhouse.x + greenhouse.width).toBeGreaterThanOrEqual(GREENHOUSE_PLOT.x + GREENHOUSE_PLOT.width + 8);
    expect(greenhouse.y + greenhouse.height).toBeGreaterThanOrEqual(GREENHOUSE_PLOT.y + GREENHOUSE_PLOT.height + 8);
    for (const yard of DIRT_YARDS) {
      expect(yard.x).toBeGreaterThanOrEqual(FARM_ZONE.x);
      expect(yard.y).toBeGreaterThanOrEqual(FARM_ZONE.y);
      expect(yard.x + yard.width).toBeLessThanOrEqual(FARM_ZONE.x + FARM_ZONE.width);
      expect(yard.y + yard.height).toBeLessThanOrEqual(FARM_ZONE.y + FARM_ZONE.height);
      const overlapsWheat =
        yard.x < WHEAT_FIELD.x + WHEAT_FIELD.width &&
        yard.x + yard.width > WHEAT_FIELD.x &&
        yard.y < WHEAT_FIELD.y + WHEAT_FIELD.height &&
        yard.y + yard.height > WHEAT_FIELD.y;
      expect(overlapsWheat).toBe(false);
    }
  });
});

describe("the tiles", () => {
  it("never needs a tile the pack does not have", () => {
    const first = cellAt(TERRAIN_SCAN.x, TERRAIN_SCAN.y);
    const last = cellAt(TERRAIN_SCAN.x + TERRAIN_SCAN.width, TERRAIN_SCAN.y + TERRAIN_SCAN.height);
    const counts = { plain: 0, edge: 0, saddle: 0, skip: 0 };
    for (let j = first.j; j <= last.j; j += 1) {
      for (let i = first.i; i <= last.i; i += 1) {
        const tile = cellTile(i, j);
        if (tile) counts[tile.resolution] += 1;
      }
    }
    expect(counts.plain).toBeGreaterThan(1000);
    expect(counts.edge).toBeGreaterThan(300);
    expect(counts.saddle).toBe(0);
    expect(counts.skip).toBe(0);
  });

  it("lists a chunk's tiles north to south, apron included, and shares textures between identical chunks", () => {
    const chunks = terrainChunks();
    expect(chunks.length).toBeGreaterThan(30);
    const keys = new Set<string>();
    let seaChunks = 0;
    const seaKeys = new Set<string>();
    for (const chunk of chunks) {
      keys.add(chunk.key);
      let last = -Infinity;
      for (const tile of chunk.tiles) {
        expect(tile.di).toBeGreaterThanOrEqual(-1);
        expect(tile.di).toBeLessThanOrEqual(TERRAIN_CHUNK_CELLS);
        expect(tile.dj).toBeGreaterThanOrEqual(-1);
        expect(tile.dj).toBeLessThanOrEqual(TERRAIN_CHUNK_CELLS);
        expect(tile.di + tile.dj).toBeGreaterThanOrEqual(last);
        last = tile.di + tile.dj;
      }
      const o = cellOrigin(chunk.cx * TERRAIN_CHUNK_CELLS, chunk.cy * TERRAIN_CHUNK_CELLS);
      // Coast well away from the farm's roads and from the scan's own ends,
      // where a chunk's apron is cut short.
      if (o.x >= SEA_SHORE_X - TERRAIN_CHUNK && Math.abs(o.y) > 300 && Math.abs(o.y) < 700) {
        seaChunks += 1;
        seaKeys.add(chunk.key);
      }
    }
    // The coast is the same two chunks over and over, per column of chunks.
    expect(seaChunks).toBeGreaterThan(12);
    expect(seaKeys.size).toBeLessThanOrEqual(6);
    // And the whole map bakes into far fewer textures than it has chunks.
    expect(keys.size).toBeLessThan(chunks.length * 0.8);
  });

  it("places a frame so its diamond lands on the cell's own diamond", () => {
    const chunk = terrainChunks()[0];
    const tile = chunk.tiles[0];
    const off = tileFrameOffset(chunk, tile);
    const rect = terrainChunkScreenRect(chunk.cx, chunk.cy);
    const o = cellOrigin(chunk.cx * TERRAIN_CHUNK_CELLS + tile.di, chunk.cy * TERRAIN_CHUNK_CELLS + tile.dj);
    const centre = isoProject(o.x + TERRAIN_CELL / 2, o.y + TERRAIN_CELL / 2);
    // A frame is 64 px = 32 units wide with its diamond centred 46 px = 23
    // units down; whole units, so the bake copies pixels without resampling.
    expect(rect.x + off.x + 16).toBe(centre.x);
    expect(rect.y + off.y + 23).toBe(centre.y);
    expect(Number.isInteger(off.x)).toBe(true);
    expect(Number.isInteger(off.y)).toBe(true);
    expect(off.y).toBeGreaterThanOrEqual(-TERRAIN_OVERHANG - 15);
  });
});

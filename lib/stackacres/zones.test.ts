import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FARM_PATHS, nearPath } from "./paths";
import { STACKACRES_TOOLS } from "./tools";
import { POND, POND_ZONE } from "./water";
import {
  MEADOW_REGROW_MS,
  MEADOW_TILE,
  OUTER_ZONE_IDS,
  SCYTHE_REACH,
  STACKACRES_ZONES,
  ZONE_FEATHER,
  ZONE_IDS,
  ZONE_TILE,
  inOuterZone,
  isActionValidInZone,
  meadowBaseDensity,
  meadowDensityAt,
  meadowTileAt,
  mowStroke,
  zoneAt,
  zoneFrame,
  zoneGroundTiles,
  zoneHerd,
  zoneToolPolicy,
  zonesByDistance,
  type ZoneId,
} from "./zones";
import { FARM_ZONE, chunkScenery, STACKACRES_CHUNK } from "./world";

const corners = (r: { x: number; y: number; width: number; height: number }) => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("the district map", () => {
  it("gives every district a label, a blurb and a gate inside its own bounds", () => {
    for (const id of ZONE_IDS) {
      const zone = STACKACRES_ZONES[id];
      expect(zone.id).toBe(id);
      expect(zone.label.length).toBeGreaterThan(3);
      expect(zone.blurb.length).toBeGreaterThan(10);
      expect(zone.bounds.width).toBeGreaterThan(0);
      expect(zone.bounds.height).toBeGreaterThan(0);
      // Arriving somewhere means arriving INSIDE it.
      expect(zoneAt(zone.approach.x, zone.approach.y)).toBe(id);
    }
  });

  it("never overlaps two districts, so `zoneAt` is unambiguous", () => {
    for (let i = 0; i < ZONE_IDS.length; i += 1) {
      for (let j = i + 1; j < ZONE_IDS.length; j += 1) {
        const a = STACKACRES_ZONES[ZONE_IDS[i]].bounds;
        const b = STACKACRES_ZONES[ZONE_IDS[j]].bounds;
        expect(overlaps(a, b), `${ZONE_IDS[i]} overlaps ${ZONE_IDS[j]}`).toBe(false);
      }
    }
  });

  it("matches the farmstead's rect to FARM_ZONE, the rectangle the woods already respect", () => {
    // Two different answers to "where is the farm" would drift apart, and the
    // one that governs scenery has to be the one the map draws.
    expect(STACKACRES_ZONES.farmstead.bounds).toEqual({
      x: FARM_ZONE.x,
      y: FARM_ZONE.y,
      width: FARM_ZONE.width,
      height: FARM_ZONE.height,
    });
  });

  it("leaves woodland between every district, so one is arrived at rather than blended into", () => {
    const home = STACKACRES_ZONES.farmstead.bounds;
    for (const id of OUTER_ZONE_IDS) {
      const b = STACKACRES_ZONES[id].bounds;
      const gapX = Math.max(home.x - (b.x + b.width), b.x - (home.x + home.width));
      const gapY = Math.max(home.y - (b.y + b.height), b.y - (home.y + home.height));
      expect(Math.max(gapX, gapY), `${id} is flush against the farm`).toBeGreaterThan(20);
    }
  });

  it("keeps every district clear of the pond", () => {
    for (const id of OUTER_ZONE_IDS) {
      expect(overlaps(STACKACRES_ZONES[id].bounds, POND_ZONE), id).toBe(false);
    }
    // The pond is WEST of FARM_ZONE, not inside it -- FARM_ZONE is the box
    // that keeps wild scenery off the plots and the yard, and the water needs
    // its own exclusion (`inPondZone`) precisely because it falls outside.
    // So `zoneAt` names no district over open water, and that is correct: the
    // districts are the places you can act in, and the pond is not one.
    expect(POND.x).toBeLessThan(FARM_ZONE.x);
    expect(zoneAt(POND.x, POND.y)).toBeNull();
  });

  it("resolves the farmstead last, so a future overlap breaks in the farm's favour", () => {
    // The farm rect is a generous box around a place whose real content has
    // its own exact geometry; an outer district crossing it should win the
    // ground and lose the rules, not the other way round.
    const order = ZONE_IDS.indexOf("farmstead");
    expect(order).toBe(0); // declared first...
    expect(OUTER_ZONE_IDS).not.toContain("farmstead"); // ...but matched last.
  });

  it("is null out in the open woodland between the districts", () => {
    expect(zoneAt(224, 430)).toBeNull(); // between the farm and the meadow
    expect(zoneAt(470, 160)).toBeNull(); // between the farm and the ox fields
    expect(zoneAt(-600, -600)).toBeNull(); // far out
    expect(inOuterZone(224, 174)).toBe(false); // the farm is not an outer one
  });

  it("orders the destination strip outward from the farm", () => {
    const order = zonesByDistance();
    expect(order[0].id).toBe("farmstead");
    const home = STACKACRES_ZONES.farmstead.approach;
    const far = order
      .slice(1)
      .map((z) => Math.hypot(z.approach.x - home.x, z.approach.y - home.y));
    expect(far).toEqual([...far].sort((a, b) => a - b));
  });
});

describe("roads reach the districts", () => {
  it("ends a path inside every outer district", () => {
    const arrivals = new Set<ZoneId>();
    for (const spec of FARM_PATHS) {
      const last = spec.points[spec.points.length - 1];
      const id = zoneAt(last.x, last.y);
      if (id !== null && id !== "farmstead") arrivals.add(id);
    }
    for (const id of OUTER_ZONE_IDS) {
      expect(arrivals.has(id), `no road ends in ${id}`).toBe(true);
    }
  });

  it("puts every gate on or beside the road that serves it", () => {
    // A gate the road does not reach is a waypoint, not an entrance.
    for (const id of OUTER_ZONE_IDS) {
      const gate = STACKACRES_ZONES[id].approach;
      const onRoad = FARM_PATHS.some((spec) =>
        spec.points.some((p) => Math.hypot(p.x - gate.x, p.y - gate.y) < 90),
      );
      expect(onRoad, `${id}'s gate is nowhere near a road`).toBe(true);
    }
  });
});

describe("zone tool policy", () => {
  it("covers every tool", () => {
    for (const tool of STACKACRES_TOOLS) {
      expect(zoneToolPolicy[tool], `${tool} has no policy`).toBeDefined();
      expect(zoneToolPolicy[tool].length).toBeGreaterThan(0);
    }
  });

  it("lets Look work anywhere and the scythe only in the meadow", () => {
    expect(zoneToolPolicy.inspect).toEqual([...ZONE_IDS]);
    expect(zoneToolPolicy.scythe).toEqual(["meadow"]);
  });

  it("passes an action in its own district and names the right place when it refuses", () => {
    const meadow = STACKACRES_ZONES.meadow.approach;
    const ok = isActionValidInZone(meadow.x, meadow.y, "scythe");
    expect(ok).toEqual({ ok: true, zone: "meadow" });

    const farm = STACKACRES_ZONES.farmstead.approach;
    const no = isActionValidInZone(farm.x, farm.y, "scythe");
    expect(no.ok).toBe(false);
    if (no.ok) throw new Error("unreachable");
    expect(no.zone).toBe("farmstead");
    // The refusal has to say where it DOES work, or the player finds out by
    // walking the whole map.
    expect(no.reason).toContain(STACKACRES_ZONES.meadow.label);
  });

  it("refuses out in the woodland, where there is no district at all", () => {
    const no = isActionValidInZone(-600, -600, "scythe");
    expect(no.ok).toBe(false);
    if (no.ok) throw new Error("unreachable");
    expect(no.zone).toBeNull();
  });
});

describe("district ground", () => {
  it("paints nothing for the farmstead, which already has its own art", () => {
    expect(zoneGroundTiles("farmstead")).toEqual([]);
  });

  it("covers each outer district and stays inside its bounds", () => {
    for (const id of OUTER_ZONE_IDS) {
      const zone = STACKACRES_ZONES[id];
      const tiles = zoneGroundTiles(id);
      expect(tiles.length).toBeGreaterThan(8);
      for (const t of tiles) {
        expect(t.size).toBe(ZONE_TILE);
        expect(t.x).toBeGreaterThanOrEqual(zone.bounds.x);
        expect(t.y).toBeGreaterThanOrEqual(zone.bounds.y);
        // A tile may hang one tile past the far edge (the grid is ceil'd);
        // it may never start outside.
        expect(t.x).toBeLessThan(zone.bounds.x + zone.bounds.width);
        expect(t.y).toBeLessThan(zone.bounds.y + zone.bounds.height);
        expect(t.alpha).toBeGreaterThan(0);
        expect(t.alpha).toBeLessThanOrEqual(zone.ground.cover);
      }
    }
  });

  it("is deterministic, so a district looks the same every time you come back", () => {
    for (const id of OUTER_ZONE_IDS) {
      expect(zoneGroundTiles(id)).toEqual(zoneGroundTiles(id));
    }
  });

  it("shades each tile's colour a little, so same-colour tiles are not identical", () => {
    for (const id of OUTER_ZONE_IDS) {
      const zone = STACKACRES_ZONES[id];
      const tiles = zoneGroundTiles(id);
      const distinctColours = new Set(tiles.map((t) => t.colour));
      // More distinct shades than the two colours `ground.base`/`alt` alone
      // would produce -- the jitter is doing something.
      expect(distinctColours.size).toBeGreaterThan(2);
      // But every shade stays close to the colour it was dealt from, per
      // `shade`'s own comment: this is grain, not a third hard colour.
      for (const colour of distinctColours) {
        const dist = (a: number, b: number) =>
          Math.max(
            Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)),
            Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)),
            Math.abs((a & 255) - (b & 255)),
          );
        expect(Math.min(dist(colour, zone.ground.base), dist(colour, zone.ground.alt))).toBeLessThan(20);
      }
    }
  });

  it("fades out at the edge and eats the corners, so the box is not a box", () => {
    for (const id of OUTER_ZONE_IDS) {
      const zone = STACKACRES_ZONES[id];
      const tiles = zoneGroundTiles(id);
      const at = (x: number, y: number) =>
        tiles.find((t) => x >= t.x && x < t.x + t.size && y >= t.y && y < t.y + t.size);

      // The corner tile is dropped entirely -- its inset is 0, so its alpha
      // is 0 whatever the jitter rolls. That is what stops the rectangle
      // reading as a rectangle.
      for (const c of corners(zone.bounds)) {
        const nudged = {
          x: Math.min(Math.max(c.x + 1, zone.bounds.x + 1), zone.bounds.x + zone.bounds.width - 1),
          y: Math.min(Math.max(c.y + 1, zone.bounds.y + 1), zone.bounds.y + zone.bounds.height - 1),
        };
        expect(at(nudged.x, nudged.y), `${id} kept a corner tile`).toBeUndefined();
      }

      // The heart is at full cover, give or take the jitter (which is zero
      // once a tile is a full feather-width in).
      // At full cover give or take the mottle, which only ever subtracts.
      const mid = at(zone.bounds.x + zone.bounds.width / 2, zone.bounds.y + zone.bounds.height / 2);
      expect(mid).toBeDefined();
      expect(mid!.alpha).toBeLessThanOrEqual(zone.ground.cover);
      expect(mid!.alpha).toBeGreaterThan(zone.ground.cover * 0.88);
    }
  });

  it("sizes the feather so it never swallows the whole district", () => {
    for (const id of OUTER_ZONE_IDS) {
      const b = STACKACRES_ZONES[id].bounds;
      expect(Math.min(b.width, b.height)).toBeGreaterThan(ZONE_FEATHER * 2);
    }
  });
});

describe("the woodland yields to the districts", () => {
  it("grows no wild scenery inside any district", () => {
    // Walk every chunk that touches a district and check what the woodland
    // would have grown there.
    for (const id of OUTER_ZONE_IDS) {
      const b = STACKACRES_ZONES[id].bounds;
      const cx0 = Math.floor(b.x / STACKACRES_CHUNK);
      const cy0 = Math.floor(b.y / STACKACRES_CHUNK);
      const cx1 = Math.floor((b.x + b.width) / STACKACRES_CHUNK);
      const cy1 = Math.floor((b.y + b.height) / STACKACRES_CHUNK);
      for (let cy = cy0; cy <= cy1; cy += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          for (const item of chunkScenery(cx, cy)) {
            expect(zoneAt(item.x, item.y), `${item.kind} grew in ${id}`).not.toBe(id);
          }
        }
      }
    }
  });
});

describe("the Long Meadow's grass", () => {
  const meadow = STACKACRES_ZONES.meadow;
  const someTile = () => meadowTileAt(meadow.approach.x + 60, meadow.approach.y + 60);

  it("floor-divides tile coordinates, so negative world space does not fold two tiles into one", () => {
    expect(meadowTileAt(-1, -1)).toEqual({ tx: -1, ty: -1 });
    expect(meadowTileAt(0, 0)).toEqual({ tx: 0, ty: 0 });
    expect(meadowTileAt(MEADOW_TILE - 0.001, 0).tx).toBe(0);
    expect(meadowTileAt(MEADOW_TILE, 0).tx).toBe(1);
  });

  it("grows only inside the meadow, and not on the lane through it", () => {
    const farm = meadowTileAt(224, 174);
    expect(meadowBaseDensity(farm.tx, farm.ty)).toBe(0);
    const woods = meadowTileAt(-600, -600);
    expect(meadowBaseDensity(woods.tx, woods.ty)).toBe(0);

    // Every tile the meadow lane passes through is bare.
    const lane = FARM_PATHS.find((p) => p.key === "meadowLane");
    if (!lane) throw new Error("no meadowLane");
    for (const p of lane.points) {
      const t = meadowTileAt(p.x, p.y);
      if (zoneAt(p.x, p.y) !== "meadow") continue;
      expect(nearPath(p.x, p.y)).toBe(true);
      expect(meadowBaseDensity(t.tx, t.ty), `grass on the lane at ${p.x},${p.y}`).toBe(0);
    }
  });

  it("is not one uniform height -- a flat field reads as flat as a bare one", () => {
    const seen = new Set<number>();
    const b = meadow.bounds;
    for (let y = b.y; y < b.y + b.height; y += MEADOW_TILE) {
      for (let x = b.x; x < b.x + b.width; x += MEADOW_TILE) {
        const t = meadowTileAt(x + 1, y + 1);
        seen.add(meadowBaseDensity(t.tx, t.ty));
      }
    }
    // Full height, two thinner grades, and the bare tiles along the lane.
    expect(seen.has(3)).toBe(true);
    expect(seen.has(2)).toBe(true);
    expect(seen.has(1)).toBe(true);
    expect(seen.has(0)).toBe(true);
  });

  it("cuts to nothing and grows back one grade at a time, never past its own base", () => {
    const t = someTile();
    const base = meadowBaseDensity(t.tx, t.ty);
    expect(base).toBeGreaterThan(0);

    const cut = 1_000_000;
    expect(meadowDensityAt(t.tx, t.ty, cut, cut)).toBe(0);
    expect(meadowDensityAt(t.tx, t.ty, cut, cut + MEADOW_REGROW_MS - 1)).toBe(0);
    expect(meadowDensityAt(t.tx, t.ty, cut, cut + MEADOW_REGROW_MS)).toBe(Math.min(base, 1));
    expect(meadowDensityAt(t.tx, t.ty, cut, cut + MEADOW_REGROW_MS * 2)).toBe(Math.min(base, 2));
    // Capped at the tile's own base, so mowing the field flat and waiting
    // does not quietly erase the grain the base density put there.
    expect(meadowDensityAt(t.tx, t.ty, cut, cut + MEADOW_REGROW_MS * 99)).toBe(base);
  });

  it("treats an untouched tile as its base height, and a clock that went backwards as just cut", () => {
    const t = someTile();
    const base = meadowBaseDensity(t.tx, t.ty);
    expect(meadowDensityAt(t.tx, t.ty, null, 0)).toBe(base);
    // A device clock that jumps backwards must not resurrect grass.
    expect(meadowDensityAt(t.tx, t.ty, 1_000_000, 0)).toBe(0);
  });
});

describe("the scythe's stroke", () => {
  const gate = STACKACRES_ZONES.meadow.approach;

  it("cuts an unbroken swathe however fast the finger moved", () => {
    // One long stroke arriving as a single move event: the sampling, not the
    // event rate, is what has to keep the swathe continuous.
    const cut = mowStroke({ x: gate.x, y: gate.y + 40 }, { x: gate.x + 200, y: gate.y + 40 });
    expect(cut.length).toBeGreaterThan(10);
    const columns = new Set(cut.map((t) => t.tx));
    // Every tile column between the ends is represented -- no gaps.
    const min = Math.min(...columns);
    const max = Math.max(...columns);
    for (let tx = min; tx <= max; tx += 1) {
      expect(columns.has(tx), `column ${tx} was stepped over`).toBe(true);
    }
  });

  it("returns each tile once, in the order the hand reached it", () => {
    const cut = mowStroke({ x: gate.x, y: gate.y }, { x: gate.x + 120, y: gate.y + 30 });
    const keys = cut.map((t) => `${t.tx}:${t.ty}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cuts nothing outside the meadow, so a stroke that runs off the field just stops", () => {
    const farm = STACKACRES_ZONES.farmstead.approach;
    expect(mowStroke(farm, { x: farm.x + 120, y: farm.y })).toEqual([]);
    // A stroke starting in the meadow and running north into the woods keeps
    // only the meadow half.
    const out = mowStroke({ x: gate.x, y: gate.y }, { x: gate.x, y: gate.y - 400 });
    for (const t of out) {
      expect(meadowBaseDensity(t.tx, t.ty)).toBeGreaterThan(0);
    }
  });

  it("stays within the scythe's reach of the line it drew", () => {
    const from = { x: gate.x, y: gate.y + 20 };
    const to = { x: gate.x + 160, y: gate.y + 20 };
    for (const t of mowStroke(from, to)) {
      const cx = t.tx * MEADOW_TILE + MEADOW_TILE / 2;
      const cy = t.ty * MEADOW_TILE + MEADOW_TILE / 2;
      // Distance to the segment, which for a horizontal line is the y offset
      // once x is clamped into range.
      const x = Math.min(Math.max(cx, from.x), to.x);
      expect(Math.hypot(cx - x, cy - from.y)).toBeLessThanOrEqual(SCYTHE_REACH + 0.001);
    }
  });

  it("handles a tap -- a stroke of zero length -- without dividing by zero", () => {
    const cut = mowStroke(gate, gate);
    expect(cut.length).toBeGreaterThan(0);
    for (const t of cut) expect(Number.isFinite(t.tx) && Number.isFinite(t.ty)).toBe(true);
  });
});

describe("the herds", () => {
  it("has no ambient herd anywhere -- the player's own pens replaced them", () => {
    // Ox Fields and the Fold each had a wild, unownable herd before real
    // Cattle Pens and Sheep Pens moved in; Kayo's call was to replace it, not
    // keep both. HERDS staying an empty record (rather than deleted outright)
    // is what leaves room for a future district to get ambient life of its
    // own with nothing to tend yet.
    for (const id of ZONE_IDS) expect(zoneHerd(id)).toBeNull();
  });

  it("keeps every herd's range well inside its own district, if one is ever added back", () => {
    for (const id of ZONE_IDS) {
      const herd = zoneHerd(id);
      if (!herd) continue;
      const b = STACKACRES_ZONES[id].bounds;
      for (const c of corners(herd.range)) {
        expect(zoneAt(c.x, c.y), `${id}'s herd can walk out of its district`).toBe(id);
      }
      // Inset, not flush: an animal on the boundary is an animal in the woods
      // the moment the range and the bounds disagree by a rounding error.
      expect(herd.range.x).toBeGreaterThan(b.x);
      expect(herd.range.y).toBeGreaterThan(b.y);
      expect(herd.range.x + herd.range.width).toBeLessThan(b.x + b.width);
      expect(herd.range.y + herd.range.height).toBeLessThan(b.y + b.height);
      expect(herd.count).toBeGreaterThan(0);
      expect(herd.speed).toBeGreaterThan(0);
    }
  });
});

describe("the signpost's swatches match the ground they name", () => {
  // The same class of guard props.test.ts puts on PROP_SIZE: two hand-written
  // copies of one number with nothing holding them together is the drift this
  // codebase has already been bitten by (STAKES_TIERS, the wager ladders).
  // The CSS cannot import the module, so the test reads the CSS.
  it("keeps 52-stackacres.css's --sa-zone-* tokens equal to each district's ground.base", () => {
    const css = readFileSync(join(process.cwd(), "app/styles/52-stackacres.css"), "utf8");
    for (const id of ZONE_IDS) {
      const zone = STACKACRES_ZONES[id];
      const declared = new RegExp(`--sa-zone-${id}:\\s*([^;]+);`).exec(css);
      expect(declared, `no --sa-zone-${id} token in 52-stackacres.css`).not.toBeNull();
      const value = declared![1].trim();
      // The farmstead's token defers to --sa-grass, which is the grass
      // painter's own fill and already has its own comment saying so.
      const hex = value.startsWith("var(")
        ? (/--sa-grass:\s*(#[0-9a-f]{6})/i.exec(css) ?? [])[1]
        : value;
      expect(hex?.toLowerCase(), `--sa-zone-${id} drifted from zones.ts`).toBe(
        `#${zone.ground.base.toString(16).padStart(6, "0")}`,
      );
    }
  });
});

describe("arriving", () => {
  it("frames a fixed window on the gate rather than the whole district", () => {
    for (const id of ZONE_IDS) {
      const frame = zoneFrame(id);
      const gate = STACKACRES_ZONES[id].approach;
      expect(frame.x + frame.width / 2).toBeCloseTo(gate.x, 5);
      expect(frame.y + frame.height / 2).toBeCloseTo(gate.y, 5);
      // Same window everywhere, so a big district and a small one both open
      // at a readable zoom.
      expect(frame.width).toBe(frame.height);
    }
    expect(zoneFrame("meadow").width).toBe(zoneFrame("wallow").width);
  });
});

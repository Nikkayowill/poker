import { describe, expect, it } from "vitest";
import {
  FARM_PATHS,
  PATH_CLEARANCE,
  distanceToPath,
  nearPath,
  pathBakePadding,
  pathBounds,
} from "./paths";
import {
  FARM_ZONE,
  STACKACRES_PEN_ZONES,
  cellCenter,
  inFarmZone,
  penGroupBounds,
} from "./world";
import { STACKACRES_GRID_PLOTS } from "./catalogue";
import { zoneAt } from "./zones";

/** Every kind's own 2x2 pen block -- the plots are four separate small
 *  squares now, one per district, not one 4x4 square at the Farmstead. */
const PLOT_BLOCKS = STACKACRES_PEN_ZONES.map(penGroupBounds);

function insidePlots(x: number, y: number, margin = 0): boolean {
  return PLOT_BLOCKS.some(
    (block) =>
      x >= block.x - margin &&
      x <= block.x + block.width + margin &&
      y >= block.y - margin &&
      y <= block.y + block.height + margin,
  );
}

const byKey = (key: string) => {
  const spec = FARM_PATHS.find((p) => p.key === key);
  if (!spec) throw new Error(`no path ${key}`);
  return spec;
};

describe("farm paths", () => {
  it("has six paths with unique keys, at least two points each, 10..20 wide", () => {
    // Four around the yard, plus the two connectors out to the districts.
    expect(FARM_PATHS.length).toBe(6);
    expect(new Set(FARM_PATHS.map((p) => p.key)).size).toBe(FARM_PATHS.length);
    for (const spec of FARM_PATHS) {
      expect(spec.points.length).toBeGreaterThanOrEqual(2);
      expect(spec.width).toBeGreaterThanOrEqual(10);
      expect(spec.width).toBeLessThanOrEqual(20);
    }
  });

  it("starts the lane's stone row only after its legs along the barn's foot", () => {
    const lane = FARM_PATHS.find((p) => p.key === "lane");
    expect(lane).toBeDefined();
    // Door leg (14) + west leg (58) + corner (20) = 92 units of polyline; the
    // smoothed curve cuts the corner, so the row starts a little before that.
    expect(lane?.stonesFrom).toBeGreaterThanOrEqual(80);
    expect(lane?.stonesFrom).toBeLessThan(120);
    for (const path of FARM_PATHS) {
      if (path.stonesFrom === undefined) continue;
      let length = 0;
      for (let i = 1; i < path.points.length; i += 1) {
        length += Math.hypot(path.points[i].x - path.points[i - 1].x, path.points[i].y - path.points[i - 1].y);
      }
      expect(path.stonesFrom).toBeGreaterThanOrEqual(0);
      expect(path.stonesFrom).toBeLessThan(length);
    }
  });

  it("never puts a vertex inside a plot cell", () => {
    for (const spec of FARM_PATHS) {
      for (const p of spec.points) expect(insidePlots(p.x, p.y)).toBe(false);
    }
  });

  it("keeps every path's body and rim clear of the plot square", () => {
    // A vertex test misses a leg crossing a cell; walk each segment instead
    // and keep the swept strip (half the width plus a rim's worth) out.
    for (const spec of FARM_PATHS) {
      const margin = spec.width / 2 + 3;
      for (let i = 1; i < spec.points.length; i += 1) {
        const a = spec.points[i - 1];
        const b = spec.points[i];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5);
        for (let k = 0; k <= steps; k += 1) {
          const t = k / steps;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          expect(insidePlots(x, y, margin), `${spec.key} at ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it("is on a path at every vertex and midpoint, and not 40 units away", () => {
    for (const spec of FARM_PATHS) {
      for (let i = 0; i < spec.points.length; i += 1) {
        const p = spec.points[i];
        expect(nearPath(p.x, p.y)).toBe(true);
        if (i > 0) {
          const q = spec.points[i - 1];
          expect(nearPath((p.x + q.x) / 2, (p.y + q.y) / 2)).toBe(true);
        }
      }
    }
    // 40 west of the lane's verge leg, out in the woods.
    expect(nearPath(10, 200)).toBe(false);
    // Deep inside the plot square, 54 south of the road.
    expect(nearPath(250, 100)).toBe(false);
    // Far north-east, past the road's end.
    expect(nearPath(700, -300)).toBe(false);
    // The margin itself: the lane at x 50 is 14 wide, so 7 + 6 clears at 13.
    expect(nearPath(50 + 7 + PATH_CLEARANCE - 0.1, 200)).toBe(true);
    expect(nearPath(50 + 7 + PATH_CLEARANCE + 0.1, 200)).toBe(false);
  });

  it("is off every plot's centre", () => {
    for (let index = 1; index <= STACKACRES_GRID_PLOTS; index += 1) {
      const c = cellCenter(index);
      expect(nearPath(c.x, c.y)).toBe(false);
    }
  });

  it("measures distance to the nearest segment", () => {
    const lane = byKey("lane");
    expect(distanceToPath(50, 200, lane)).toBe(0);
    expect(distanceToPath(60, 200, lane)).toBe(10);
    // Past the lane's end the distance is to the end point, not its extension.
    expect(distanceToPath(50, 412, lane)).toBe(10);
  });

  it("joins the road and the track to the lane at the barn's corner", () => {
    const lane = byKey("lane");
    // Each branch starts inside the lane's body, so the three read as one
    // junction rather than as strips that happen to be near each other.
    expect(distanceToPath(byKey("road").points[0].x, byKey("road").points[0].y, lane)).toBeLessThan(
      lane.width / 2,
    );
    expect(distanceToPath(byKey("track").points[0].x, byKey("track").points[0].y, lane)).toBeLessThan(
      lane.width / 2,
    );
    // The spur to the dock leaves the lane's verge leg the same way, and
    // comes after the lane so the renderer paints it over the lane.
    const spur = byKey("spur");
    expect(distanceToPath(spur.points[0].x, spur.points[0].y, lane)).toBeLessThan(lane.width / 2);
    expect(FARM_PATHS.findIndex((p) => p.key === "spur")).toBeGreaterThan(
      FARM_PATHS.findIndex((p) => p.key === "lane"),
    );
  });

  it("starts each connector inside the path it forks off, and lands it in its district", () => {
    // The lane runs to the mailbox at y 402; the meadow lane picks up inside
    // that body rather than beside it, so the two read as one road south.
    const meadowLane = byKey("meadowLane");
    expect(distanceToPath(meadowLane.points[0].x, meadowLane.points[0].y, byKey("lane"))).toBeLessThan(
      byKey("lane").width / 2,
    );
    const oxRoad = byKey("oxRoad");
    expect(distanceToPath(oxRoad.points[0].x, oxRoad.points[0].y, byKey("road"))).toBeLessThan(
      byKey("road").width / 2,
    );
    // Each connector has to come after the path it leaves, or the renderer's
    // junction repaint runs the wrong way round -- the same ordering rule the
    // spur already carries.
    for (const [branch, trunk] of [
      ["meadowLane", "lane"],
      ["oxRoad", "road"],
    ]) {
      expect(FARM_PATHS.findIndex((p) => p.key === branch)).toBeGreaterThan(
        FARM_PATHS.findIndex((p) => p.key === trunk),
      );
    }
    // And each one actually arrives: its last vertex is inside the district
    // it exists to reach, not merely pointing at it.
    expect(zoneAt(meadowLane.points[meadowLane.points.length - 1].x, meadowLane.points[meadowLane.points.length - 1].y)).toBe("meadow");
    expect(zoneAt(oxRoad.points[oxRoad.points.length - 1].x, oxRoad.points[oxRoad.points.length - 1].y)).toBe("oxfields");
    // The Wallow needs no connector -- the track already ends inside it.
    const track = byKey("track");
    expect(zoneAt(track.points[track.points.length - 1].x, track.points[track.points.length - 1].y)).toBe("wallow");
  });

  it("keeps the yard paths inside the farm zone and lets the outbound ones leave it", () => {
    const lane = byKey("lane");
    for (const p of lane.points) expect(inFarmZone(p.x, p.y)).toBe(true);
    for (const key of ["road", "track", "meadowLane", "oxRoad"]) {
      const spec = byKey(key);
      expect(inFarmZone(spec.points[0].x, spec.points[0].y)).toBe(true);
      const last = spec.points[spec.points.length - 1];
      expect(inFarmZone(last.x, last.y)).toBe(false);
    }
    // The zone is what keeps a wild canopy off the lane's west verge.
    expect(FARM_ZONE.x).toBeLessThanOrEqual(lane.points[0].x - lane.width / 2 - PATH_CLEARANCE);
  });

  it("bakes into a texture no bigger than 2048 px a side at 4 px per unit", () => {
    for (const spec of FARM_PATHS) {
      const box = pathBounds(spec);
      expect(box.width).toBeLessThanOrEqual(512);
      expect(box.height).toBeLessThanOrEqual(512);
      const pad = pathBakePadding(spec);
      // Room for the rim, its blur and the stones outside the body.
      expect(pad).toBeGreaterThanOrEqual(spec.width / 2 + 7.5);
      for (const p of spec.points) {
        expect(p.x - box.x).toBeGreaterThanOrEqual(pad - 1);
        expect(box.x + box.width - p.x).toBeGreaterThanOrEqual(pad - 1);
        expect(p.y - box.y).toBeGreaterThanOrEqual(pad - 1);
        expect(box.y + box.height - p.y).toBeGreaterThanOrEqual(pad - 1);
      }
    }
  });
});

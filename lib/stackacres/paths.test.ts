import { describe, expect, it } from "vitest";
import { projectedBounds } from "./iso";
import {
  ALL_FARM_PATHS,
  FARM_PATHS,
  FARMSTEAD_PATH_NODES,
  FARMSTEAD_PATHWAYS,
  PATH_CLEARANCE,
  distanceToPath,
  generatePathwaysBetweenNodes,
  nearPath,
  pathBakePadding,
  pathBounds,
} from "./paths";
import { FARM_ZONE, WHEAT_FIELD, growAreaBounds, inFarmZone } from "./world";
import { ZONE_IDS, zoneAt } from "./zones";

/** Every district's own grow area -- the plots are gone; each district has
 *  one fixed rect where its units stand, and that is what a path must stay
 *  clear of now. */
const GROW_AREA_BLOCKS = ZONE_IDS.map(growAreaBounds);

function insidePlots(x: number, y: number, margin = 0): boolean {
  return GROW_AREA_BLOCKS.some(
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
  it("has six paths with unique keys, at least two points each, 10..24 wide", () => {
    // Four around the yard, plus the two connectors out to the districts.
    expect(FARM_PATHS.length).toBe(6);
    expect(new Set(FARM_PATHS.map((p) => p.key)).size).toBe(FARM_PATHS.length);
    for (const spec of FARM_PATHS) {
      expect(spec.points.length).toBeGreaterThanOrEqual(2);
      expect(spec.width).toBeGreaterThanOrEqual(10);
      expect(spec.width).toBeLessThanOrEqual(24);
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
    // The margin itself, expressed off the lane's own width rather than a
    // literal copy of it, so a future width change (like this one) can't
    // silently make this assertion test the wrong boundary.
    const laneHalf = byKey("lane").width / 2;
    expect(nearPath(50 + laneHalf + PATH_CLEARANCE - 0.1, 200)).toBe(true);
    expect(nearPath(50 + laneHalf + PATH_CLEARANCE + 0.1, 200)).toBe(false);
  });

  it("is off every grow area's corners and centre", () => {
    for (const zone of ZONE_IDS) {
      const area = growAreaBounds(zone);
      const points = [
        { x: area.x, y: area.y },
        { x: area.x + area.width, y: area.y },
        { x: area.x, y: area.y + area.height },
        { x: area.x + area.width, y: area.y + area.height },
        { x: area.x + area.width / 2, y: area.y + area.height / 2 },
      ];
      for (const p of points) expect(nearPath(p.x, p.y), `${zone} at ${p.x},${p.y}`).toBe(false);
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
    // The Fold needs no connector -- the track already ends inside it.
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

  it("bakes into a texture no bigger than 4096 px a side at 4 px per unit", () => {
    // bakePathTexture bakes in the isometric camera's SHEARED space (see its
    // own header), so it's the PROJECTED bbox that has to stay in budget --
    // isoProject can grow a diagonal rect's footprint by up to sqrt(2)x, so
    // this is a materially bigger number than the raw world box below.
    for (const spec of FARM_PATHS) {
      const box = pathBounds(spec);
      const projected = projectedBounds(box);
      expect(projected.width).toBeLessThanOrEqual(1024);
      expect(projected.height).toBeLessThanOrEqual(1024);
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

describe("generated Farmstead connectors", () => {
  it("grows one spur per node, each a straight vector ending exactly on the node", () => {
    expect(FARMSTEAD_PATHWAYS.length).toBe(FARMSTEAD_PATH_NODES.length);
    for (const node of FARMSTEAD_PATH_NODES) {
      const spur = FARMSTEAD_PATHWAYS.find((p) => p.key === `spur-${node.id}`);
      expect(spur).toBeDefined();
      expect(spur?.points.length).toBe(2);
      const last = spur!.points[spur!.points.length - 1];
      expect(last).toEqual({ x: node.x, y: node.y });
    }
  });

  it("anchors each spur on the network it was grown from, not floating free", () => {
    for (const spur of FARMSTEAD_PATHWAYS) {
      const anchor = spur.points[0];
      // The anchor is either on FARM_PATHS itself or on an earlier spur in
      // this same pass -- either way it must read as already served by
      // whatever came before it, the same "starts inside the path it forks
      // off" invariant the hand-authored connectors hold to.
      const before = ALL_FARM_PATHS.slice(0, ALL_FARM_PATHS.indexOf(spur));
      const onNetwork = before.some((other) => distanceToPath(anchor.x, anchor.y, other) < other.width / 2 + 0.5);
      expect(onNetwork, `${spur.key}'s anchor ${anchor.x},${anchor.y}`).toBe(true);
    }
  });

  it("stays clear of every zone's grow area, the same clearance every hand-authored path holds to", () => {
    for (const zone of ZONE_IDS) {
      const area = growAreaBounds(zone);
      const points = [
        { x: area.x, y: area.y },
        { x: area.x + area.width, y: area.y },
        { x: area.x, y: area.y + area.height },
        { x: area.x + area.width, y: area.y + area.height },
        { x: area.x + area.width / 2, y: area.y + area.height / 2 },
      ];
      for (const p of points) expect(nearPath(p.x, p.y), `${zone} at ${p.x},${p.y}`).toBe(false);
    }
    // And the wheat field itself, which is not one of ZONE_IDS' grow areas.
    const wheatCentre = { x: WHEAT_FIELD.x + WHEAT_FIELD.width / 2, y: WHEAT_FIELD.y + WHEAT_FIELD.height / 2 };
    expect(nearPath(wheatCentre.x, wheatCentre.y)).toBe(false);
  });

  it("is folded into nearPath and ALL_FARM_PATHS, so a generated spur excludes scenery exactly like a hand-placed one", () => {
    expect(ALL_FARM_PATHS.length).toBe(FARM_PATHS.length + FARMSTEAD_PATHWAYS.length);
    for (const spur of FARMSTEAD_PATHWAYS) {
      for (const p of spur.points) expect(nearPath(p.x, p.y)).toBe(true);
    }
  });

  it("adds nothing for a node the base network already reaches", () => {
    const onTheLane = [{ id: "already-served", x: 50, y: 200 }];
    expect(generatePathwaysBetweenNodes(onTheLane, FARM_PATHS)).toEqual([]);
  });

  it("lets two close nodes share one fork instead of each running back to the base network", () => {
    const near = [
      { id: "a", x: 250, y: 300 },
      { id: "b", x: 290, y: 340 },
    ];
    const spurs = generatePathwaysBetweenNodes(near, FARM_PATHS);
    expect(spurs.length).toBe(2);
    // The second node's spur is far shorter than a straight run back to the
    // base network would be, because it forked off the first node's spur
    // instead.
    const second = spurs.find((p) => p.key === "spur-b")!;
    const secondLength = Math.hypot(
      second.points[1].x - second.points[0].x,
      second.points[1].y - second.points[0].y,
    );
    const straightBackToBase = Math.min(...FARM_PATHS.map((spec) => distanceToPath(260, 305, spec)));
    expect(secondLength).toBeLessThan(straightBackToBase);
  });
});

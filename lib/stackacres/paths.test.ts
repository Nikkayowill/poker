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
import { YARD_DELTA } from "./yard";
import { STACKACRES_ZONES, ZONE_IDS } from "./zones";

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
  it("has the grid roads and the yard's three, with unique keys, 12..48 wide", () => {
    // The Grid Bench layout (see the module header): five grid roads, the
    // two long ones split at the middle road, the short hop into the Crop
    // Fields, plus the yard's own lane, road and dock spur. No spurs into
    // districts: every pen sits on a road.
    const keys = FARM_PATHS.map((path) => path.key);
    expect(keys.filter((k) => k.startsWith("ring"))).toHaveLength(0);
    expect(keys.filter((k) => k.endsWith("Spur"))).toEqual(["dockSpur", "meadowSpur"]);
    for (const road of ["midRoad", "northRoadEast", "northRoadWest", "southRoadEast", "southRoadWest", "eastRoad", "foldRoad"]) {
      expect(keys).toContain(road);
    }
    expect(FARM_PATHS.length).toBe(11);
    expect(new Set(FARM_PATHS.map((p) => p.key)).size).toBe(FARM_PATHS.length);
    for (const spec of FARM_PATHS) {
      expect(spec.points.length).toBeGreaterThanOrEqual(2);
      // A tile and a half for the narrowest service path, three tiles at the
      // widest a road gets (see roads.ts; roads.test.ts holds the tiers).
      expect(spec.width).toBeGreaterThanOrEqual(12);
      expect(spec.width).toBeLessThanOrEqual(48);
    }
  });

  it("starts the lane's stone row only after its legs along the barn's foot", () => {
    const lane = FARM_PATHS.find((p) => p.key === "lane");
    expect(lane).toBeDefined();
    // Door leg (22) + west leg (58) + corner (20) = 100 units of polyline; the
    // smoothed curve cuts the corner, so the row starts a little before that.
    expect(lane?.stonesFrom).toBeGreaterThanOrEqual(88);
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

  it("keeps every path's body out of every pen", () => {
    // A vertex test misses a leg crossing a pen; walk each segment instead
    // and keep the swept body out. On the grid a pen's edge IS a road's
    // edge, so the margin is the body alone (less a unit of slack), not the
    // body plus a rim the way it was when roads kept their distance.
    for (const spec of FARM_PATHS) {
      const margin = spec.width / 2 - 1;
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
    // Out in the open, well away from anything. In the yard's own frame these
    // are the same places they always were; the yard moved bodily in the
    // 2026-09-07 re-lay.
    const y = (x: number, yy: number) => ({ x: x + YARD_DELTA.x, y: yy + YARD_DELTA.y });
    const west = y(10, 200);
    expect(nearPath(west.x, west.y)).toBe(false);
    // The middle of the Grand Farm's own field, which every spur near it
    // bends around rather than crosses.
    expect(nearPath(64, -64)).toBe(false);
    // Off the map's south-east corner entirely.
    expect(nearPath(1200, 900)).toBe(false);
    // The margin itself, expressed off the lane's own width rather than a
    // literal copy of it, so a future width change (like this one) can't
    // silently make this assertion test the wrong boundary.
    const laneHalf = byKey("lane").width / 2;
    const on = y(50 + laneHalf + PATH_CLEARANCE - 0.1, 200);
    const off = y(50 + laneHalf + PATH_CLEARANCE + 0.1, 200);
    expect(nearPath(on.x, on.y)).toBe(true);
    expect(nearPath(off.x, off.y)).toBe(false);
  });

  it("is off every grow area's centre, and no road body reaches a pen's corner", () => {
    // Pens sit flush on roads now, so a corner may be inside a rim's
    // clearance; it may not be inside a body.
    for (const zone of ZONE_IDS) {
      const area = growAreaBounds(zone);
      const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      expect(nearPath(centre.x, centre.y), `${zone} centre`).toBe(false);
      const corners = [
        { x: area.x, y: area.y },
        { x: area.x + area.width, y: area.y },
        { x: area.x, y: area.y + area.height },
        { x: area.x + area.width, y: area.y + area.height },
      ];
      for (const p of corners) {
        for (const spec of FARM_PATHS) {
          expect(distanceToPath(p.x, p.y, spec), `${zone} corner ${p.x},${p.y} in ${spec.key}`).toBeGreaterThanOrEqual(
            spec.width / 2 - 0.5,
          );
        }
      }
    }
  });

  it("measures distance to the nearest segment", () => {
    // The yard's own frame; the lane is the same lane it always was.
    const lane = byKey("lane");
    const y = (x: number, yy: number) => ({ x: x + YARD_DELTA.x, y: yy + YARD_DELTA.y });
    const on = y(50, 200);
    const off = y(60, 200);
    const past = y(50, 412);
    expect(distanceToPath(on.x, on.y, lane)).toBe(0);
    expect(distanceToPath(off.x, off.y, lane)).toBe(10);
    // Past the lane's end the distance is to the end point, not its extension.
    expect(distanceToPath(past.x, past.y, lane)).toBe(10);
  });

  it("joins the yard road and the dock spur to the lane at the barn's corner", () => {
    const lane = byKey("lane");
    // Each branch starts inside the lane's body, so they read as one junction
    // rather than as strips that happen to be near each other. `road` and
    // `track` were the two branches before the 2026-09-07 re-lay; `yardRoad`
    // replaces `road` and carries the yard out to the road network, and
    // `track` is gone because there is no longer a lone path into the woods
    // to be the only way out.
    const yardRoad = byKey("yardRoad");
    expect(distanceToPath(yardRoad.points[0].x, yardRoad.points[0].y, lane)).toBeLessThan(
      lane.width / 2,
    );
    // The spur to the dock leaves the lane's verge leg the same way, and comes
    // after the lane so the renderer paints it over the lane.
    const spur = byKey("dockSpur");
    expect(distanceToPath(spur.points[0].x, spur.points[0].y, lane)).toBeLessThan(lane.width / 2);
    for (const branch of ["yardRoad", "dockSpur"]) {
      expect(FARM_PATHS.findIndex((path) => path.key === branch)).toBeGreaterThan(
        FARM_PATHS.findIndex((path) => path.key === "lane"),
      );
    }
    // And the yard road actually reaches the grid: its last vertex sits on
    // the middle road's own centreline, and the hop into the Crop Fields
    // starts on that centreline too.
    const midRoad = byKey("midRoad");
    const last = yardRoad.points[yardRoad.points.length - 1];
    expect(distanceToPath(last.x, last.y, midRoad)).toBe(0);
    const hop = byKey("meadowSpur").points[0];
    expect(distanceToPath(hop.x, hop.y, midRoad)).toBe(0);
  });

  it("lays every grid road off one already laid, and runs one along every outer district's pen", () => {
    // No spurs into districts on the grid: a pen's edge is a road's edge.
    // Every grid road after `midRoad` starts inside an earlier road's body
    // (so the junction repaint covers the fork), and every outer district's
    // gate sits a few units off some road.
    const grid = FARM_PATHS.filter((path) => path.tier === "track" && path.key !== "midRoad");
    expect(grid.length).toBe(7);
    for (const road of grid) {
      const start = road.points[0];
      const earlier = FARM_PATHS.slice(0, FARM_PATHS.indexOf(road));
      const onNetwork = earlier.some((other) => distanceToPath(start.x, start.y, other) < other.width / 2);
      expect(onNetwork, `${road.key} does not fork off the network`).toBe(true);
    }
    const widest = Math.max(...FARM_PATHS.map((path) => path.width));
    for (const zone of ZONE_IDS) {
      if (zone === "farmstead") continue;
      const gate = STACKACRES_ZONES[zone].approach;
      const nearest = Math.min(...FARM_PATHS.map((path) => distanceToPath(gate.x, gate.y, path)));
      expect(nearest, `${zone}'s gate is off the roads`).toBeLessThanOrEqual(widest / 2 + 8);
    }
  });

  it("keeps the yard paths inside the farm zone and lets the outbound ones leave it", () => {
    const lane = byKey("lane");
    for (const p of lane.points) expect(inFarmZone(p.x, p.y)).toBe(true);
    // `yardRoad` runs from the barn front out to the hub, and the spurs
    // beyond it are what actually leave the farm zone -- so the property
    // worth holding is that the yard's own road starts at home and that the
    // network it joins genuinely leaves.
    const yardRoad = byKey("yardRoad");
    expect(inFarmZone(yardRoad.points[0].x, yardRoad.points[0].y)).toBe(true);
    const networkLeaves = FARM_PATHS.some((path) =>
      path.points.some((p) => !inFarmZone(p.x, p.y)),
    );
    expect(networkLeaves).toBe(true);
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

  it("stays out of every zone's grow area, the same rule every hand-authored path holds to", () => {
    for (const zone of ZONE_IDS) {
      const area = growAreaBounds(zone);
      const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      expect(nearPath(centre.x, centre.y), `${zone} centre`).toBe(false);
      const corners = [
        { x: area.x, y: area.y },
        { x: area.x + area.width, y: area.y },
        { x: area.x, y: area.y + area.height },
        { x: area.x + area.width, y: area.y + area.height },
      ];
      for (const p of corners) {
        for (const spur of FARMSTEAD_PATHWAYS) {
          expect(distanceToPath(p.x, p.y, spur), `${zone} corner in ${spur.key}`).toBeGreaterThanOrEqual(spur.width / 2);
        }
      }
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
    // On the lane's verge leg, in the yard's own frame.
    const onTheLane = [{ id: "already-served", x: 50 + YARD_DELTA.x, y: 200 + YARD_DELTA.y }];
    expect(generatePathwaysBetweenNodes(onTheLane, FARM_PATHS)).toEqual([]);
  });

  it("lets two close nodes share one fork instead of each running back to the base network", () => {
    // Two nodes out in the yard's own eastern grass, close to each other and
    // well off the lane, in the yard's own frame.
    const near = [
      { id: "a", x: 250 + YARD_DELTA.x, y: 300 + YARD_DELTA.y },
      { id: "b", x: 290 + YARD_DELTA.x, y: 340 + YARD_DELTA.y },
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
    // Node b's own position, not a bare literal -- comparing against an
    // unrelated point only ever worked by coincidence (it happened to sit
    // far from the base network under the old YARD_DELTA), the same way the
    // lamp-verge check in props.test.ts did before the map restructure.
    const nodeB = near[1];
    const straightBackToBase = Math.min(
      ...FARM_PATHS.map((spec) => distanceToPath(nodeB.x, nodeB.y, spec)),
    );
    expect(secondLength).toBeLessThan(straightBackToBase);
  });
});

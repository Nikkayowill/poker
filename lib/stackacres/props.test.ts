import { describe, expect, it } from "vitest";
import { PROP_SHADOW, PROP_SIZE, VERGE_PROPS, WINDMILL_HUB, YARD_PROPS, propRect, type PropKind } from "./props";
// Test-only: pulls in the (Phaser-free) painter module so PROP_SIZE's
// hand-restated boxes can be checked against the shapes they claim to
// describe. Production code in this file never makes this import -- only
// ./paths and ./world do, same arrangement connections.ts has with
// connections-puzzles.ts -- this is purely a drift guard.
import { PROP_PAINTERS } from "@/components/arcade/stackacres/art-props";
import { FARM_PATHS, PATH_CLEARANCE, distanceToPath, nearPath } from "./paths";
import { POND, POND_SAND, pondRadial } from "./water";
import { FARM_ZONE, inFarmZone, penGroupBounds } from "./world";

/** The Farmstead's own plots now: the Hen Coop block, x 170..330, y 200..360
 *  -- not the old 4x4 square, which is what "the plot square" meant before
 *  the other three kinds moved out to their own districts. */
const PLOTS = penGroupBounds("hen");

/** What paintBarn stands in the yard, as boxes (see stackacres-scene.ts). */
const BARN_PIECES = [
  { name: "barn", x: 71, y: -28, width: 74, height: 62 },
  { name: "silo", x: 143, y: -28, width: 22, height: 62 },
  { name: "hay1", x: 166, y: 23, width: 14, height: 10 },
  { name: "hay2", x: 174, y: 23, width: 14, height: 10 },
  { name: "barrel", x: 60, y: 20, width: 10, height: 13 },
];

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const of = (kind: string) => YARD_PROPS.filter((p) => p.kind === kind);

describe("yard props", () => {
  it("has a size and a shadow for every kind it places", () => {
    for (const prop of YARD_PROPS) {
      expect(PROP_SIZE[prop.kind].w).toBeGreaterThan(0);
      expect(PROP_SIZE[prop.kind].h).toBeGreaterThan(0);
      expect(PROP_SHADOW[prop.kind].w).toBeGreaterThan(0);
      expect(PROP_SHADOW[prop.kind].h).toBeGreaterThan(0);
    }
  });

  it("is about a dozen in the yard, not a junk shop", () => {
    const yard = YARD_PROPS.filter((p) => p.y < PLOTS.y && p.x > 150);
    expect(yard.length).toBeGreaterThanOrEqual(8);
    expect(yard.length).toBeLessThanOrEqual(14);
  });

  it("stands every prop inside the farm zone, picture included", () => {
    for (const prop of YARD_PROPS) {
      const box = propRect(prop);
      expect(inFarmZone(prop.x, prop.y), `${prop.kind} at ${prop.x},${prop.y}`).toBe(true);
      // The sprite's top must be inside too, or a wild tree can be dropped
      // on the roof of something the zone was meant to keep clear.
      expect(box.y, `${prop.kind} top`).toBeGreaterThanOrEqual(FARM_ZONE.y);
      expect(box.y + box.height).toBeLessThanOrEqual(FARM_ZONE.y + FARM_ZONE.height);
    }
  });

  it("keeps every picture off the plot square, and every foot off the water and its sand", () => {
    // The pond's zone is a woodland exclusion, not a rule for props: a lamp
    // may stand on the lane's verge beside the pond, but never on the sand.
    for (const prop of YARD_PROPS) {
      expect(overlaps(propRect(prop), PLOTS), `${prop.kind} at ${prop.x},${prop.y}`).toBe(false);
      expect(pondRadial(prop.x, prop.y), `${prop.kind} on the shore`).toBeGreaterThan(1 + (POND_SAND + 4) / POND.rx);
    }
  });

  it("stands nothing on a path body, and keeps all but the verge props clear of the paths", () => {
    for (const prop of YARD_PROPS) {
      for (const path of FARM_PATHS) {
        const d = distanceToPath(prop.x, prop.y, path);
        // Off the body with a step to spare, for the lamps and signs that
        // stand right at the edge.
        expect(d, `${prop.kind} at ${prop.x},${prop.y} on ${path.key}`).toBeGreaterThanOrEqual(path.width / 2 + 2);
      }
      if (!VERGE_PROPS.has(prop.kind)) {
        expect(nearPath(prop.x, prop.y), `${prop.kind} at ${prop.x},${prop.y} near a path`).toBe(false);
      }
    }
    // The verge props really are at the verge, not out in the grass. The
    // ceiling is off the widest path's own width rather than a literal copy
    // of it (it used to be the lane's, back when 14 was the lane's width),
    // so a future width change can't silently make this assert the wrong
    // thing the way it did when the lane widened here without this line
    // moving with it.
    const widestPath = Math.max(...FARM_PATHS.map((path) => path.width));
    for (const prop of YARD_PROPS) {
      if (!VERGE_PROPS.has(prop.kind)) continue;
      const nearest = Math.min(...FARM_PATHS.map((path) => distanceToPath(prop.x, prop.y, path)));
      expect(nearest, `${prop.kind} too far from any path`).toBeLessThan(widestPath / 2 + PATH_CLEARANCE + 2);
    }
  });

  it("does not stand on the barn, the silo, the hay or the barrel", () => {
    for (const prop of YARD_PROPS) {
      const box = propRect(prop);
      for (const piece of BARN_PIECES) {
        // A picture may rise behind a piece whose feet are further south
        // (the depth sort handles that); it may not sit ON one. Compare
        // the feet band: the bottom quarter of each box.
        const feet = { ...box, y: box.y + box.height * 0.75, height: box.height * 0.25 };
        const pieceFeet = { ...piece, y: piece.y + piece.height * 0.5, height: piece.height * 0.5 };
        expect(overlaps(feet, pieceFeet), `${prop.kind} at ${prop.x},${prop.y} on the ${piece.name}`).toBe(false);
      }
    }
  });

  it("keeps the yard props north of the road, with their feet clear of its rim", () => {
    // The road's body is y 38..54 and its rim reaches ~35 between the lane
    // and x 430; anything in the yard band stands north of that. The cutoff
    // is the road's own geometry, not PLOTS -- the scarecrow (still watching
    // over where the fields used to be, at y 110) is south of the road on
    // purpose and was never part of the yard band this check means.
    const SOUTH_OF_ROAD = 60;
    for (const prop of YARD_PROPS) {
      if (prop.y >= SOUTH_OF_ROAD || prop.x < 150 || prop.x > 430) continue;
      expect(prop.y, `${prop.kind} at ${prop.x},${prop.y}`).toBeLessThanOrEqual(32);
    }
  });

  it("does not pile two props on the same spot", () => {
    for (let i = 0; i < YARD_PROPS.length; i += 1) {
      for (let j = i + 1; j < YARD_PROPS.length; j += 1) {
        const a = YARD_PROPS[i];
        const b = YARD_PROPS[j];
        // The two crates lean together on purpose; everything else stands apart.
        const both = a.kind === "crate" && b.kind === "crate";
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.kind} vs ${b.kind}`).toBeGreaterThanOrEqual(both ? 8 : 16);
      }
    }
  });

  it("lights the lane with three lamps on its west verge, and only the lane", () => {
    const lamps = of("lampPost");
    expect(lamps.length).toBe(3);
    const lane = FARM_PATHS.find((p) => p.key === "lane");
    expect(lane).toBeDefined();
    if (!lane) return;
    const verge = lane.points[lane.points.length - 1].x;
    for (const lamp of lamps) {
      expect(lamp.x).toBeLessThan(verge);
      expect(lamp.x).toBeGreaterThanOrEqual(verge - 12);
      expect(distanceToPath(lamp.x, lamp.y, lane)).toBeLessThan(lane.width / 2 + PATH_CLEARANCE);
    }
    const ys = lamps.map((l) => l.y).sort((a, b) => a - b);
    // Spread down the verge, well apart, none at the spur to the dock (y 118).
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(80);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(80);
    for (const y of ys) expect(Math.abs(y - 118)).toBeGreaterThan(20);
  });

  it("puts the mailbox at the lane's end and the signpost at the fork", () => {
    const [mailbox] = of("mailbox");
    const lane = FARM_PATHS.find((p) => p.key === "lane");
    expect(mailbox).toBeDefined();
    if (!mailbox || !lane) return;
    const end = lane.points[lane.points.length - 1];
    expect(Math.hypot(mailbox.x - end.x, mailbox.y - end.y)).toBeLessThan(16);
    const [signpost] = of("signpost");
    const track = FARM_PATHS.find((p) => p.key === "track");
    expect(signpost && track && distanceToPath(signpost.x, signpost.y, track)).toBeLessThan(24);
  });

  it("stands one windmill left of the seed strip with its hub on the tower", () => {
    const mills = of("windmill");
    expect(mills.length).toBe(1);
    expect(mills[0].x + PROP_SIZE.windmill.w / 2 + 23).toBeLessThan(374);
    expect(WINDMILL_HUB.y).toBeLessThan(0);
    expect(-WINDMILL_HUB.y).toBeLessThan(PROP_SIZE.windmill.h);
  });

  it("breaks the stone wall into three or four short lengths north of the yard", () => {
    const wall = of("stoneWall");
    expect(wall.length).toBeGreaterThanOrEqual(3);
    expect(wall.length).toBeLessThanOrEqual(4);
    for (const seg of wall) {
      expect(seg.y).toBe(-46);
      expect(seg.x - PROP_SIZE.stoneWall.w / 2).toBeGreaterThanOrEqual(160);
      expect(seg.x + PROP_SIZE.stoneWall.w / 2).toBeLessThanOrEqual(270);
      // Right of the title chip (x < 146, y < -41) at the opening shot.
      expect(seg.x - PROP_SIZE.stoneWall.w / 2).toBeGreaterThan(150);
    }
    const xs = wall.map((s) => s.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) {
      // A gap between lengths: it is a broken wall, not a fence line.
      expect(xs[i] - xs[i - 1]).toBeGreaterThan(PROP_SIZE.stoneWall.w);
    }
  });
});

// PROP_SIZE hand-restates each painter's own box so propRect() -- and every
// test above that leans on it -- never has to import a Phaser-adjacent
// module. Nothing else keeps the two in sync: if a future art pass resizes
// a painter without updating its PROP_SIZE row, propRect() keeps checking
// the wrong box and every test above keeps passing anyway. This is what
// catches that instead.
describe("PROP_SIZE matches each painter's own w/h", () => {
  const kinds = Object.keys(PROP_SIZE) as PropKind[];

  it("covers every PropKind", () => {
    expect(kinds.length).toBeGreaterThan(0);
  });

  it.each(kinds)("%s", (kind) => {
    expect(PROP_SIZE[kind]).toEqual({ w: PROP_PAINTERS[kind].w, h: PROP_PAINTERS[kind].h });
  });
});

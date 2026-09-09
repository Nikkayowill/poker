import { describe, expect, it } from "vitest";
import { ALL_FARM_PATHS, FARM_PATHS, distanceToPath, type PathSpec } from "./paths";
import {
  ARM_E,
  ARM_N,
  ARM_S,
  ARM_W,
  FARM_JUNCTIONS,
  FILLET_EDGE_INSET,
  JUNCTION_SHAPES,
  compassBit,
  findPathJunctions,
  junctionFillets,
} from "./path-junctions";

const spec = (key: string, width: number, points: { x: number; y: number }[]): PathSpec => ({
  key,
  tier: "service",
  width,
  points,
  stones: 0,
});

describe("junction bitmask lookup", () => {
  it("reads a direction as the compass arm it leans on", () => {
    expect(compassBit(1, 0)).toBe(ARM_E);
    expect(compassBit(-1, 0.2)).toBe(ARM_W);
    expect(compassBit(0.1, 1)).toBe(ARM_S);
    expect(compassBit(-0.3, -1)).toBe(ARM_N);
  });

  it("has sixteen entries, one per mask, keyed by how many arms and how they lie", () => {
    expect(JUNCTION_SHAPES.length).toBe(16);
    expect(JUNCTION_SHAPES[0]).toBe("cap");
    expect(JUNCTION_SHAPES[ARM_N]).toBe("cap");
    expect(JUNCTION_SHAPES[ARM_N | ARM_S]).toBe("straight");
    expect(JUNCTION_SHAPES[ARM_E | ARM_W]).toBe("straight");
    expect(JUNCTION_SHAPES[ARM_N | ARM_E]).toBe("corner");
    expect(JUNCTION_SHAPES[ARM_S | ARM_W]).toBe("corner");
    expect(JUNCTION_SHAPES[ARM_N | ARM_E | ARM_W]).toBe("tee");
    expect(JUNCTION_SHAPES[ARM_N | ARM_E | ARM_S | ARM_W]).toBe("cross");
  });
});

describe("findPathJunctions", () => {
  it("finds a tee where a branch leaves the middle of a trunk, with three arms", () => {
    const trunk = spec("trunk", 40, [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    const branch = spec("branch", 16, [{ x: 100, y: 0 }, { x: 100, y: 80 }]);
    const [j] = findPathJunctions([trunk, branch]);
    expect(j.key).toBe("branch@trunk");
    expect(j.at).toEqual({ x: 100, y: 0 });
    expect(j.mask).toBe(ARM_S | ARM_E | ARM_W);
    expect(j.shape).toBe("tee");
    expect(j.arms.length).toBe(3);
    // A fillet on each side of the branch's root; none across the trunk's
    // own straight run.
    expect(j.fillets.length).toBe(2);
  });

  it("finds a straight coupler where a branch carries on from a trunk's end", () => {
    const trunk = spec("trunk", 40, [{ x: 0, y: 0 }, { x: 0, y: 100 }]);
    const on = spec("on", 40, [{ x: 0, y: 100 }, { x: 0, y: 200 }]);
    const [j] = findPathJunctions([trunk, on]);
    expect(j.mask).toBe(ARM_N | ARM_S);
    expect(j.shape).toBe("straight");
    expect(j.fillets).toEqual([]);
  });

  it("turns a corner at a trunk vertex rather than carrying straight through it", () => {
    const trunk = spec("trunk", 40, [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]);
    const branch = spec("branch", 16, [{ x: 0, y: 100 }, { x: -80, y: 100 }]);
    const [j] = findPathJunctions([trunk, branch]);
    expect(j.mask).toBe(ARM_N | ARM_E | ARM_W);
    expect(j.shape).toBe("tee");
  });

  it("ignores a path that starts on open ground", () => {
    const trunk = spec("trunk", 40, [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    const loose = spec("loose", 16, [{ x: 100, y: 60 }, { x: 100, y: 120 }]);
    expect(findPathJunctions([trunk, loose])).toEqual([]);
  });
});

describe("junction fillets", () => {
  it("rounds a right-angle corner with an arc tangent to both edges, inset inside each body", () => {
    const at = { x: 0, y: 0 };
    const arms = [
      { angle: 0, width: 40, bit: ARM_E, key: "e" },
      { angle: Math.PI / 2, width: 40, bit: ARM_S, key: "s" },
    ];
    const [f] = junctionFillets(at, arms, "corner");
    const edge = 20 - FILLET_EDGE_INSET;
    expect(f.corner.x).toBeCloseTo(edge);
    expect(f.corner.y).toBeCloseTo(edge);
    // Tangent points sit further along each arm's edge, on that edge.
    expect(f.a.y).toBeCloseTo(edge);
    expect(f.a.x).toBeGreaterThan(edge);
    expect(f.b.x).toBeCloseTo(edge);
    expect(f.b.y).toBeGreaterThan(edge);
  });

  it("gives a straight coupler and a cap nothing to round", () => {
    const at = { x: 0, y: 0 };
    expect(
      junctionFillets(
        at,
        [
          { angle: 0, width: 40, bit: ARM_E, key: "e" },
          { angle: Math.PI, width: 40, bit: ARM_W, key: "w" },
        ],
        "straight",
      ),
    ).toEqual([]);
    expect(junctionFillets(at, [{ angle: 0, width: 40, bit: ARM_E, key: "e" }], "cap")).toEqual([]);
  });
});

describe("the farm's own junctions", () => {
  it("has one junction per path that forks off another, inside the trunk's own body", () => {
    // One path forks off nothing and so has no junction: `lane`, the yard's
    // own trunk, which starts at the barn door. Every spoke of the
    // hub-and-spoke road network (see paths.ts's own header) chains off it,
    // directly or by way of another spoke.
    const trunks = ["lane"];
    for (const key of trunks) {
      expect(FARM_JUNCTIONS.some((j) => j.key.startsWith(`${key}@`)), key).toBe(false);
    }
    expect(FARM_JUNCTIONS.length).toBe(ALL_FARM_PATHS.length - trunks.length);
    for (const j of FARM_JUNCTIONS) {
      const [branch, trunk] = j.key.split("@");
      const trunkSpec = ALL_FARM_PATHS.find((p) => p.key === trunk)!;
      expect(distanceToPath(j.at.x, j.at.y, trunkSpec), j.key).toBeLessThan(trunkSpec.width / 2);
      expect(ALL_FARM_PATHS.findIndex((p) => p.key === branch)).toBeGreaterThan(ALL_FARM_PATHS.findIndex((p) => p.key === trunk));
    }
  });

  it("reads the yard's junctions as the shapes the layout intends", () => {
    const byKey = (key: string) => FARM_JUNCTIONS.find((j) => j.key === key)!;
    // The yard road leaves the lane's corner heading east; the lane arrives
    // from the barn door (north) and turns west: a tee.
    expect(byKey("yardRoad@lane").shape).toBe("tee");
    // The dock spur leaves the lane's verge leg at right angles: also a tee.
    expect(byKey("dockSpur@lane").shape).toBe("tee");
    // Every fork off a road is a tee; nothing on the farm is a crossroads.
    for (const j of FARM_JUNCTIONS) expect(["tee", "straight", "corner"]).toContain(j.shape);
  });

  it("keeps every junction's bake inside a modest square, with the fillets inside it", () => {
    for (const j of FARM_JUNCTIONS) {
      expect(j.reach, j.key).toBeLessThanOrEqual(80);
      for (const f of j.fillets) {
        for (const p of [f.a, f.b, f.corner]) {
          expect(Math.hypot(p.x - j.at.x, p.y - j.at.y), j.key).toBeLessThan(j.reach);
        }
      }
    }
  });

  it("is derived from FARM_PATHS' order, not from a hand-written list", () => {
    // Same one trunk as above: `lane` forks off nothing.
    expect(findPathJunctions(FARM_PATHS).length).toBe(FARM_PATHS.length - 1);
  });
});

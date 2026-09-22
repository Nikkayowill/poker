import { describe, expect, it } from "vitest";
import {
  CLEARABLE_SECTORS,
  LAND_OBSTACLES,
  LAND_OBSTACLE_DEFS,
  demolishLandObstacle,
  demolitionPrice,
  freshLandObstacleState,
  isClearableSector,
  landClearingProgress,
  landObstacle,
  landObstacleSnapshot,
  swingAtLandObstacle,
  type LandObstacleKind,
} from "./land-clearing";
import { STACKACRES_SECTORS } from "./sectors";

const NOW = new Date("2026-09-22T12:00:00.000Z");

/** Every swing it takes to break one, and what they paid. */
function workToClear(kind: LandObstacleKind, sweet = false) {
  let state = freshLandObstacleState(kind);
  let gained = 0;
  let swings = 0;
  for (;;) {
    const swing = swingAtLandObstacle(kind, state, NOW, sweet);
    if (!swing) break;
    swings += 1;
    gained += swing.quantity;
    state = swing.nextState;
    if (swing.cleared) break;
  }
  return { swings, gained, state };
}

describe("what stands on a sector", () => {
  it("only lists the two sectors that are taken by clearing", () => {
    expect(CLEARABLE_SECTORS).toEqual(["wallow", "oxfields"]);
    for (const id of CLEARABLE_SECTORS) expect(STACKACRES_SECTORS[id].state).toBe("claimable");
    expect(isClearableSector("oak")).toBe(false);
  });

  it("makes each one a job of several sittings, the later field the longer one", () => {
    const swings = (sector: (typeof CLEARABLE_SECTORS)[number]) =>
      LAND_OBSTACLES[sector].reduce((total, o) => total + LAND_OBSTACLE_DEFS[o.kind].hits, 0);
    expect(LAND_OBSTACLES.wallow.length).toBe(24);
    expect(LAND_OBSTACLES.oxfields.length).toBe(30);
    expect(swings("wallow")).toBeGreaterThan(60);
    expect(swings("oxfields")).toBeGreaterThan(swings("wallow"));
  });

  it("gives every obstacle its own id, and finds it again by that id", () => {
    const ids = CLEARABLE_SECTORS.flatMap((sector) => LAND_OBSTACLES[sector].map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(landObstacle("wallow-01")?.sector).toBe("wallow");
    expect(landObstacle("not-a-thing")).toBeNull();
  });

  it("scatters the kinds rather than laying them out in blocks", () => {
    const kinds = LAND_OBSTACLES.wallow.map((o) => o.kind);
    const runs = kinds.filter((kind, i) => i > 0 && kind === kinds[i - 1]).length;
    expect(runs).toBeLessThan(kinds.length / 2);
  });
});

describe("working an obstacle by hand", () => {
  it("pays materials all the way down, and more for the last swing", () => {
    const tree = workToClear("tree");
    expect(tree.swings).toBe(LAND_OBSTACLE_DEFS.tree.hits);
    expect(tree.gained).toBe(LAND_OBSTACLE_DEFS.tree.hits + LAND_OBSTACLE_DEFS.tree.clearBonus);
    expect(tree.state.clearedAt).toBe(NOW.toISOString());
  });

  it("pays Stone for a boulder and Wood for a tree", () => {
    const boulder = swingAtLandObstacle("boulder", freshLandObstacleState("boulder"), NOW, false);
    expect(boulder?.item).toBe("stone");
    const tree = swingAtLandObstacle("tree", freshLandObstacleState("tree"), NOW, false);
    expect(tree?.item).toBe("wood");
  });

  it("pays a timed swing more, the same way a chopped tree does", () => {
    expect(workToClear("tree", true).gained).toBeGreaterThan(workToClear("tree").gained);
  });

  it("refuses a swing at something already down, because nothing grows back", () => {
    const { state } = workToClear("scrub");
    expect(swingAtLandObstacle("scrub", state, NOW, false)).toBeNull();
  });
});

describe("demolition, which is where Gold leaves", () => {
  it("prices what is left to do, so work already done is never wasted", () => {
    const fresh = freshLandObstacleState("boulder");
    const full = demolitionPrice("boulder", fresh);
    const swung = swingAtLandObstacle("boulder", fresh, NOW, false)!.nextState;
    expect(demolitionPrice("boulder", swung)).toBeLessThan(full);
    expect(full).toBe(LAND_OBSTACLE_DEFS.boulder.hits * LAND_OBSTACLE_DEFS.boulder.goldPerHit);
  });

  /**
   * The whole point of the price: clearing a field with Gold alone has to
   * cost more than the field used to, or paying is just the old purchase
   * with extra steps.
   */
  it("costs more to buy a field outright than the field used to be sold for", () => {
    for (const sector of CLEARABLE_SECTORS) {
      const total = LAND_OBSTACLES[sector].reduce(
        (gold, o) => gold + demolitionPrice(o.kind, freshLandObstacleState(o.kind)),
        0,
      );
      expect(total).toBeGreaterThan(STACKACRES_SECTORS[sector].clearCost);
    }
  });

  it("pays nothing into the barn, and cannot be done twice", () => {
    const state = freshLandObstacleState("tree");
    const blown = demolishLandObstacle(state, NOW);
    expect(blown).toEqual({ hitsRemaining: 0, clearedAt: NOW.toISOString() });
    expect(demolishLandObstacle(blown!, NOW)).toBeNull();
    expect(demolitionPrice("tree", blown!)).toBe(0);
  });
});

describe("how far the job has got", () => {
  it("counts an untouched obstacle as standing, and opens only on the last one", () => {
    const all = LAND_OBSTACLES.wallow;
    expect(landClearingProgress("wallow", [])).toEqual({ cleared: 0, total: all.length, done: false });

    const down = all.map((obstacle) =>
      landObstacleSnapshot(obstacle, { hitsRemaining: 0, clearedAt: NOW.toISOString() }),
    );
    expect(landClearingProgress("wallow", down).done).toBe(true);
    expect(landClearingProgress("wallow", down.slice(1)).done).toBe(false);
  });

  it("ignores an id that is not part of this sector", () => {
    const stranger = landObstacleSnapshot(LAND_OBSTACLES.oxfields[0], {
      hitsRemaining: 0,
      clearedAt: NOW.toISOString(),
    });
    expect(landClearingProgress("wallow", [stranger]).cleared).toBe(0);
  });
});

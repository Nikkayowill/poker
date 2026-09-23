import { describe, expect, it } from "vitest";
import {
  CLEARABLE_SECTORS,
  LAND_OBSTACLES,
  LAND_OBSTACLE_DEFS,
  freshLandObstacleState,
  isClearableSector,
  landClearingProgress,
  landObstacle,
  landObstacleSnapshot,
  landObstacleStateOf,
  swingAtLandObstacle,
  withLandObstacleState,
  type LandObstacleKind,
} from "./land-clearing";
import { STACKACRES_SECTORS } from "./sectors";

const NOW = new Date("2026-09-22T12:00:00.000Z");

/** Every swing it takes to break one, and what they paid. */
function workToClear(kind: LandObstacleKind) {
  let state = freshLandObstacleState(kind);
  let gained = 0;
  let swings = 0;
  for (;;) {
    const swing = swingAtLandObstacle(kind, state, NOW);
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
    expect(landObstacle("wallow-01")?.ground).toBe("wallow");
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
    expect(tree.gained).toBe(LAND_OBSTACLE_DEFS.tree.hits * LAND_OBSTACLE_DEFS.tree.perHit + LAND_OBSTACLE_DEFS.tree.clearBonus);
    expect(tree.state.clearedAt).toBe(NOW.toISOString());
  });

  it("pays Stone for a boulder and Wood for a tree", () => {
    const boulder = swingAtLandObstacle("boulder", freshLandObstacleState("boulder"), NOW);
    expect(boulder?.item).toBe("stone");
    const tree = swingAtLandObstacle("tree", freshLandObstacleState("tree"), NOW);
    expect(tree?.item).toBe("wood");
  });

  it("pays 2 per swing, what a well-timed swing used to pay", () => {
    expect(workToClear("tree").gained).toBe(10);
    expect(workToClear("boulder").gained).toBe(12);
    expect(workToClear("scrub").gained).toBe(4);
  });

  it("refuses a swing at something already down, because nothing grows back", () => {
    const { state } = workToClear("scrub");
    expect(swingAtLandObstacle("scrub", state, NOW)).toBeNull();
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

describe("what the client holds between reads", () => {
  const obstacle = LAND_OBSTACLES.wallow[0];

  it("reads an obstacle nobody has touched as standing and full", () => {
    expect(landObstacleStateOf([], obstacle)).toEqual(freshLandObstacleState(obstacle.kind));
  });

  it("reads the swings left off the snapshot it was handed", () => {
    const snapshot = landObstacleSnapshot(obstacle, { hitsRemaining: 2, clearedAt: null });
    expect(landObstacleStateOf([snapshot], obstacle).hitsRemaining).toBe(2);
    expect(landObstacleStateOf([snapshot], obstacle).clearedAt).toBeNull();
  });

  it("reads a cleared one as cleared", () => {
    const snapshot = landObstacleSnapshot(obstacle, { hitsRemaining: 0, clearedAt: NOW.toISOString() });
    expect(landObstacleStateOf([snapshot], obstacle).clearedAt).not.toBeNull();
  });

  it("adds an obstacle the list had never seen", () => {
    const next = withLandObstacleState([], obstacle, { hitsRemaining: 3, clearedAt: null });
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(landObstacleSnapshot(obstacle, { hitsRemaining: 3, clearedAt: null }));
  });

  it("replaces one it had, and leaves the rest alone", () => {
    const other = LAND_OBSTACLES.wallow[1];
    const before = [
      landObstacleSnapshot(obstacle, freshLandObstacleState(obstacle.kind)),
      landObstacleSnapshot(other, freshLandObstacleState(other.kind)),
    ];
    const next = withLandObstacleState(before, obstacle, { hitsRemaining: 0, clearedAt: NOW.toISOString() });
    expect(next).toHaveLength(2);
    expect(next[0].cleared).toBe(true);
    expect(next[1]).toEqual(before[1]);
  });
});

import { describe, expect, it } from "vitest";

import {
  CONTRACT_DROP,
  contractWantsWheat,
  planFarmhandWork,
  plotsWorthCutting,
  wheatStillNeeded,
  type FarmhandPlanInput,
} from "./farmhand-plan";
import type { StackAcresContractRow } from "./contracts";
import { MACHINE_CATALOGUE, type StackAcresMachineSnapshot } from "./machines";
import { WHEAT_YIELD_QUANTITY } from "./wheat-plot";
import { FARMHAND_SPEED, tileOf } from "./farmhand-path";
import { FARMHAND_BASE } from "./farmhand";
import { nearPath } from "./paths";
import { inPondZone } from "./water";
import {
  BARN_FOOTPRINT,
  FARM_ZONE,
  WHEAT_FIELD,
  barnHitAt,
  growAreaAt,
  inFarmZone,
  wheatPlotSpot,
} from "./world";

const MILL = MACHINE_CATALOGUE.mill;

function contract(over: Partial<StackAcresContractRow> = {}): StackAcresContractRow {
  return {
    id: "c1",
    item: "flour",
    quantity: 4,
    goldReward: 300,
    influenceReward: 25,
    status: "open",
    createdAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

function plot(id: string, ready: boolean, readyAt = "2026-09-04T00:00:00.000Z") {
  return { id, startedAt: "2026-09-03T00:00:00.000Z", readyAt, ready, progress: ready ? 1 : 0.5 };
}

function machine(status: "idle" | "working"): Pick<StackAcresMachineSnapshot, "kind" | "status"> {
  return { kind: "mill", status };
}

function input(over: Partial<FarmhandPlanInput> = {}): FarmhandPlanInput {
  return { contract: null, inventory: {}, machines: [], wheatPlots: [], ...over };
}

/* ------------------------------------------------------------------ */

describe("CONTRACT_DROP", () => {
  it("stands on clear farmstead ground, not on the barn, a path, the pond or a pen", () => {
    expect(inFarmZone(CONTRACT_DROP.x, CONTRACT_DROP.y)).toBe(true);
    expect(barnHitAt(CONTRACT_DROP.x, CONTRACT_DROP.y)).toBe(false);
    expect(growAreaAt(CONTRACT_DROP.x, CONTRACT_DROP.y)).toBeNull();
    expect(inPondZone(CONTRACT_DROP.x, CONTRACT_DROP.y)).toBe(false);
    expect(nearPath(CONTRACT_DROP.x, CONTRACT_DROP.y)).toBe(false);
  });

  it("stands east of the barn, the silo, the hay and both crates", () => {
    expect(CONTRACT_DROP.x).toBeGreaterThan(BARN_FOOTPRINT.x + BARN_FOOTPRINT.width);
    expect(CONTRACT_DROP.x).toBeGreaterThan(211);
  });

  it("stops short of the well, so he is not handing sacks down it", () => {
    expect(CONTRACT_DROP.x).toBeLessThan(238);
  });

  it("is a short enough errand to watch: under ten seconds from his post", () => {
    const away = Math.hypot(CONTRACT_DROP.x - FARMHAND_BASE.x, CONTRACT_DROP.y - FARMHAND_BASE.y);
    expect(away / FARMHAND_SPEED).toBeLessThan(10);
  });
});

describe("the wheat field", () => {
  it("sits outside every district's grow area, so the Gold sweep can never reach it", () => {
    for (const dx of [0, WHEAT_FIELD.width / 2, WHEAT_FIELD.width]) {
      for (const dy of [0, WHEAT_FIELD.height / 2, WHEAT_FIELD.height]) {
        expect(growAreaAt(WHEAT_FIELD.x + dx, WHEAT_FIELD.y + dy)).toBeNull();
      }
    }
  });

  it("fits inside the farmstead's kept-clear rectangle", () => {
    expect(inFarmZone(WHEAT_FIELD.x, WHEAT_FIELD.y)).toBe(true);
    expect(inFarmZone(WHEAT_FIELD.x + WHEAT_FIELD.width, WHEAT_FIELD.y + WHEAT_FIELD.height)).toBe(
      true,
    );
    expect(WHEAT_FIELD.x + WHEAT_FIELD.width).toBeLessThanOrEqual(FARM_ZONE.x + FARM_ZONE.width);
  });

  it("places a plot by its row id, so collecting a neighbour never moves it", () => {
    const before = wheatPlotSpot("plot-b");
    // "plot-a" is gone; "plot-b" must not have slid into its place.
    expect(wheatPlotSpot("plot-b")).toEqual(before);
    expect(wheatPlotSpot("plot-a")).not.toEqual(before);
  });

  it("puts every plot inside the field", () => {
    for (let i = 0; i < 200; i += 1) {
      const at = wheatPlotSpot(`plot-${i}`);
      expect(at.x).toBeGreaterThanOrEqual(WHEAT_FIELD.x);
      expect(at.x).toBeLessThanOrEqual(WHEAT_FIELD.x + WHEAT_FIELD.width);
      expect(at.y).toBeGreaterThanOrEqual(WHEAT_FIELD.y);
      expect(at.y).toBeLessThanOrEqual(WHEAT_FIELD.y + WHEAT_FIELD.height);
    }
  });
});

describe("wheatStillNeeded", () => {
  it("is zero with no contract open at all", () => {
    expect(wheatStillNeeded(null, {}, [])).toBe(0);
    expect(wheatStillNeeded(contract({ status: "fulfilled" }), {}, [])).toBe(0);
  });

  it("asks for whole mill batches, since two thirds of a run makes no flour", () => {
    // Needs 4 flour, holds none: 4 batches of 3 wheat at 1 flour a batch.
    expect(wheatStillNeeded(contract({ quantity: 4 }), {}, [])).toBe(4 * MILL.input.quantity);
    // One flour short is still a whole batch of wheat.
    expect(wheatStillNeeded(contract({ quantity: 4 }), { flour: 3 }, [])).toBe(MILL.input.quantity);
  });

  it("counts flour already held", () => {
    expect(wheatStillNeeded(contract({ quantity: 4 }), { flour: 4 }, [])).toBe(0);
    expect(wheatStillNeeded(contract({ quantity: 4 }), { flour: 9 }, [])).toBe(0);
  });

  it("counts raw wheat already in the barn against the batches it owes", () => {
    const needed = wheatStillNeeded(contract({ quantity: 2 }), { wheat: 4 }, []);
    // 2 flour wants 2 batches = 6 wheat; 4 are already held.
    expect(needed).toBe(2 * MILL.input.quantity - 4);
  });

  it("counts a running mill's batch as good as milled", () => {
    // Needs 1 flour and a mill is twenty seconds from making one: nothing to cut.
    expect(wheatStillNeeded(contract({ quantity: 1 }), {}, [machine("working")])).toBe(0);
    // An IDLE mill has taken nothing out of inventory, so it counts for nothing.
    expect(wheatStillNeeded(contract({ quantity: 1 }), {}, [machine("idle")])).toBe(
      MILL.input.quantity,
    );
  });

  it("never goes negative when the barn is already overfull", () => {
    expect(wheatStillNeeded(contract({ quantity: 1 }), { wheat: 99 }, [])).toBe(0);
  });
});

describe("plotsWorthCutting", () => {
  it("rounds a part-plot shortfall up to a whole plot", () => {
    expect(plotsWorthCutting(0)).toBe(0);
    expect(plotsWorthCutting(1)).toBe(1);
    expect(plotsWorthCutting(WHEAT_YIELD_QUANTITY)).toBe(1);
    expect(plotsWorthCutting(WHEAT_YIELD_QUANTITY + 1)).toBe(2);
  });
});

describe("planFarmhandWork", () => {
  it("stands him down when there is nothing ripe and nothing to pay", () => {
    expect(planFarmhandWork(input({ wheatPlots: [plot("a", false)] }))).toBeNull();
  });

  it("pays a fulfillable contract before cutting anything", () => {
    const job = planFarmhandWork(
      input({
        contract: contract({ quantity: 2 }),
        inventory: { flour: 2 },
        wheatPlots: [plot("a", true)],
      }),
    );
    expect(job).toEqual({
      kind: "deliver",
      contractId: "c1",
      tile: tileOf(CONTRACT_DROP),
      at: CONTRACT_DROP,
    });
  });

  it("does not set out to pay a contract it cannot cover", () => {
    const job = planFarmhandWork(
      input({ contract: contract({ quantity: 2 }), inventory: { flour: 1 } }),
    );
    expect(job).toBeNull();
  });

  it("cuts ripe wheat even with no contract open, so a plot never sits on its ground", () => {
    const job = planFarmhandWork(input({ wheatPlots: [plot("a", true)] }));
    expect(job).toMatchObject({ kind: "harvest", plotId: "a" });
  });

  it("names a tile, and that tile is the one the plot's own spot falls in", () => {
    const job = planFarmhandWork(input({ wheatPlots: [plot("a", true)] }));
    expect(job?.kind).toBe("harvest");
    expect(job?.tile).toEqual(tileOf(wheatPlotSpot("a")));
    expect(job?.at).toEqual(wheatPlotSpot("a"));
  });

  it("takes the plot that ripened first, not the nearest one", () => {
    const job = planFarmhandWork(
      input({
        wheatPlots: [
          plot("late", true, "2026-09-04T02:00:00.000Z"),
          plot("early", true, "2026-09-04T01:00:00.000Z"),
        ],
      }),
    );
    expect(job).toMatchObject({ plotId: "early" });
  });

  it("skips a plot already cut whose refetch has not landed", () => {
    const plots = [plot("a", true, "2026-09-04T01:00:00.000Z"), plot("b", true, "2026-09-04T02:00:00.000Z")];
    expect(planFarmhandWork(input({ wheatPlots: plots }))).toMatchObject({ plotId: "a" });
    expect(
      planFarmhandWork(input({ wheatPlots: plots, claimed: new Set(["a"]) })),
    ).toMatchObject({ plotId: "b" });
    expect(planFarmhandWork(input({ wheatPlots: plots, claimed: new Set(["a", "b"]) }))).toBeNull();
  });

  it("ignores an unripe plot however old it is", () => {
    expect(planFarmhandWork(input({ wheatPlots: [plot("a", false, "1999-01-01T00:00:00.000Z")] }))).toBeNull();
  });
});

describe("contractWantsWheat", () => {
  it("separates urgent cutting from tidying up", () => {
    expect(contractWantsWheat(input({ wheatPlots: [plot("a", true)] }))).toBe(false);
    expect(
      contractWantsWheat(input({ contract: contract({ quantity: 4 }), wheatPlots: [plot("a", true)] })),
    ).toBe(true);
  });
});

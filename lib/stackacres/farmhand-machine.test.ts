import { describe, expect, it, vi } from "vitest";

import {
  CONTRACT_DROP,
  FARMHAND_DELIVER_MS,
  FarmhandStateMachine,
  OVERLAY_PATIENCE,
  automationWalking,
  spawnFarmhandAutomation,
  stepFarmhandAutomation,
  type FarmhandAutoState,
  type FarmhandAutomation,
  type FarmhandEffect,
} from "./farmhand-machine";
import { planFarmhandWork, type FarmhandJob, type FarmhandPlanInput } from "./farmhand-plan";
import { FARMHAND_BASE, FARMHAND_WORK_MS } from "./farmhand";
import { tileOf, withinReach } from "./farmhand-path";
import type { StackAcresContractRow } from "./contracts";
import { WHEAT_YIELD_QUANTITY } from "./wheat-plot";
import { wheatPlotSpot } from "./world";

const FRAME = 16;

function contract(over: Partial<StackAcresContractRow> = {}): StackAcresContractRow {
  return {
    id: "c1",
    item: "flour",
    quantity: 2,
    goldReward: 140,
    influenceReward: 10,
    status: "open",
    createdAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

function plot(id: string, ready = true) {
  return {
    id,
    startedAt: "2026-09-03T00:00:00.000Z",
    readyAt: "2026-09-04T00:00:00.000Z",
    ready,
    progress: 1,
  };
}

function harvestJob(plotId: string): FarmhandJob {
  const at = wheatPlotSpot(plotId);
  return { kind: "harvest", plotId, tile: tileOf(at), at };
}

const deliverJob: FarmhandJob = {
  kind: "deliver",
  contractId: "c1",
  tile: tileOf(CONTRACT_DROP),
  at: CONTRACT_DROP,
};

/** Run frames until `done`, collecting every state entered and effect emitted. */
function run(
  hand: FarmhandAutomation,
  job: (hand: FarmhandAutomation) => FarmhandJob | null,
  done: (hand: FarmhandAutomation) => boolean,
  limit = 5000,
): { hand: FarmhandAutomation; states: FarmhandAutoState[]; effects: FarmhandEffect[]; frames: number } {
  let current = hand;
  const states: FarmhandAutoState[] = [current.state];
  const effects: FarmhandEffect[] = [];
  for (let frames = 1; frames <= limit; frames += 1) {
    const step = stepFarmhandAutomation(current, job(current), FRAME);
    current = step.hand;
    if (step.effect) effects.push(step.effect);
    if (states[states.length - 1] !== current.state) states.push(current.state);
    if (done(current)) return { hand: current, states, effects, frames };
  }
  throw new Error(`never settled: stuck in ${current.state}`);
}

/* ------------------------------------------------------------------ */
/* The pure machine                                                    */
/* ------------------------------------------------------------------ */

describe("spawnFarmhandAutomation", () => {
  it("starts idle at his post, aimed at nothing", () => {
    const hand = spawnFarmhandAutomation();
    expect(hand.state).toBe("IDLE");
    expect(hand).toMatchObject({ x: FARMHAND_BASE.x, y: FARMHAND_BASE.y, plotId: null, workMs: 0 });
    expect(hand.tile).toEqual(tileOf(FARMHAND_BASE));
    expect(automationWalking(hand)).toBe(false);
  });
});

describe("the harvest cycle", () => {
  it("walks the four states in order and emits exactly one effect", () => {
    const trip = run(
      spawnFarmhandAutomation(),
      (hand) => (hand.state === "IDLE" && hand.plotId === null ? harvestJob("a") : harvestJob("a")),
      (hand) => hand.state === "IDLE" && hand.plotId === null,
      // Give him one job then let him finish; the closure above keeps
      // offering it, so stop on the first return to IDLE after a harvest.
    );
    expect(trip.states.slice(0, 3)).toEqual(["IDLE", "WALKING_TO_PLOT", "HARVESTING"]);
    expect(trip.effects).toEqual([
      { kind: "harvested", plotId: "a", item: "wheat", delta: WHEAT_YIELD_QUANTITY },
    ]);
  });

  it("arrives at the plot's own spot, not the tile's centre", () => {
    const at = wheatPlotSpot("a");
    const trip = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.state === "HARVESTING",
    );
    expect(trip.hand.x).toBeCloseTo(at.x);
    expect(trip.hand.y).toBeCloseTo(at.y);
    expect(trip.hand.tile).toEqual(tileOf(at));
  });

  it("spends FARMHAND_WORK_MS bent over it, give or take a frame", () => {
    const arrived = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.state === "HARVESTING",
    );
    const cutting = run(
      arrived.hand,
      () => harvestJob("a"),
      (hand) => hand.state !== "HARVESTING",
    );
    expect(cutting.frames * FRAME).toBeGreaterThanOrEqual(FARMHAND_WORK_MS);
    expect(cutting.frames * FRAME).toBeLessThan(FARMHAND_WORK_MS + FRAME * 2);
  });

  it("moves on the frame he is given the job, so a long delta loses nothing", () => {
    const step = stepFarmhandAutomation(spawnFarmhandAutomation(), harvestJob("a"), 200);
    expect(step.hand.state).toBe("WALKING_TO_PLOT");
    expect(step.hand.travelled).toBeGreaterThan(0);
  });

  it("does not count as walking while cutting", () => {
    const trip = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.state === "HARVESTING",
    );
    expect(automationWalking(trip.hand)).toBe(false);
  });
});

describe("interruption", () => {
  it("abandons a walk when the plot goes, and heads home", () => {
    const going = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.travelled > 20,
    );
    const step = stepFarmhandAutomation(going.hand, null, FRAME);
    expect(step.hand.state).toBe("IDLE");
    expect(step.hand.plotId).toBeNull();
    expect(step.effect).toBeNull();
    expect(step.hand.target).toEqual(FARMHAND_BASE);
  });

  it("switches mid-walk to a different plot without going home first", () => {
    const going = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.travelled > 20,
    );
    const step = stepFarmhandAutomation(going.hand, harvestJob("b"), FRAME);
    expect(step.hand.state).toBe("WALKING_TO_PLOT");
    expect(step.hand.plotId).toBe("b");
  });

  it("turns around mid-amble home rather than finishing a trip nobody wants", () => {
    // Cut a plot, then let him start back with nothing else offered.
    const cut = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.state === "IDLE",
    );
    const ambling = run(cut.hand, () => null, (hand) => !withinReach(hand, FARMHAND_BASE));
    expect(ambling.hand.state).toBe("IDLE");
    expect(automationWalking(ambling.hand)).toBe(true);

    const step = stepFarmhandAutomation(ambling.hand, harvestJob("b"), FRAME);
    expect(step.hand.state).toBe("WALKING_TO_PLOT");
    expect(step.hand.plotId).toBe("b");
  });

  it("CANNOT be interrupted mid-cut -- that frame is the one the effect rides on", () => {
    const cutting = run(
      spawnFarmhandAutomation(),
      () => harvestJob("a"),
      (hand) => hand.state === "HARVESTING",
    );
    // The snapshot lands and the plot is already gone from it. He finishes.
    const trip = run(cutting.hand, () => null, (hand) => hand.state !== "HARVESTING");
    expect(trip.effects).toHaveLength(1);
    expect(trip.effects[0]).toMatchObject({ kind: "harvested", plotId: "a" });
  });
});

describe("the delivery cycle", () => {
  it("walks to the drop, dwells, and emits one delivery naming the contract", () => {
    const trip = run(
      spawnFarmhandAutomation(),
      () => deliverJob,
      (hand) => hand.state === "IDLE" && hand.contractId === null,
    );
    expect(trip.states.slice(0, 2)).toEqual(["IDLE", "DELIVERING_TO_CONTRACT"]);
    expect(trip.effects).toEqual([{ kind: "delivered", contractId: "c1" }]);
  });

  it("dwells for FARMHAND_DELIVER_MS once it arrives, not before", () => {
    const arrived = run(
      spawnFarmhandAutomation(),
      () => deliverJob,
      (hand) => hand.workMs > 0,
    );
    expect(arrived.hand.workMs).toBe(FARMHAND_DELIVER_MS);
    expect(arrived.hand.x).toBeCloseTo(CONTRACT_DROP.x);
  });

  it("pays the contract that is open on arrival, not the one it set out for", () => {
    const arrived = run(
      spawnFarmhandAutomation(),
      () => deliverJob,
      (hand) => hand.state === "DELIVERING_TO_CONTRACT" && hand.travelled > 20,
    );
    const replaced: FarmhandJob = { ...deliverJob, contractId: "c2" };
    const trip = run(arrived.hand, () => replaced, (hand) => hand.state === "IDLE");
    expect(trip.effects).toEqual([{ kind: "delivered", contractId: "c2" }]);
  });

  it("gives up the walk when the contract stops being payable", () => {
    const going = run(
      spawnFarmhandAutomation(),
      () => deliverJob,
      (hand) => hand.travelled > 20,
    );
    const step = stepFarmhandAutomation(going.hand, null, FRAME);
    expect(step.hand.state).toBe("IDLE");
    expect(step.effect).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The class                                                           */
/* ------------------------------------------------------------------ */

function world(over: Partial<FarmhandPlanInput> = {}) {
  return {
    profileId: "p1",
    contract: null as StackAcresContractRow | null,
    inventory: {},
    machines: [],
    wheatPlots: [],
    ...over,
  };
}

/** Step the machine until `done`, or blow up. */
function drive(machine: FarmhandStateMachine, done: () => boolean, limit = 5000): number {
  for (let frames = 1; frames <= limit; frames += 1) {
    machine.update(FRAME);
    if (done()) return frames;
  }
  throw new Error(`never settled: stuck in ${machine.state}`);
}

describe("FarmhandStateMachine", () => {
  it("stands still with nothing to plan against", () => {
    const machine = new FarmhandStateMachine();
    for (let i = 0; i < 50; i += 1) machine.update(FRAME);
    expect(machine.state).toBe("IDLE");
    expect(machine.hand.travelled).toBe(0);
  });

  it("walks farther per frame at a higher speedMultiplier passed to update()", () => {
    const base = new FarmhandStateMachine();
    base.setWorld(world({ wheatPlots: [plot("a")] }));
    base.update(FRAME);

    const boosted = new FarmhandStateMachine();
    boosted.setWorld(world({ wheatPlots: [plot("a")] }));
    boosted.update(FRAME, 1.15);

    expect(boosted.hand.travelled).toBeCloseTo(base.hand.travelled * 1.15);
  });

  it("cuts a ripe plot and calls the inventory hook with (profileId, item, delta)", async () => {
    const adjustInventory = vi.fn().mockResolvedValue(WHEAT_YIELD_QUANTITY);
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));

    drive(machine, () => adjustInventory.mock.calls.length > 0);
    expect(adjustInventory).toHaveBeenCalledExactlyOnceWith("p1", "wheat", WHEAT_YIELD_QUANTITY);
  });

  it("credits the optimistic overlay on the frame of the cut, before the request lands", () => {
    let settle: (value: number) => void = () => {};
    const adjustInventory = vi.fn(() => new Promise<number | null>((res) => (settle = res)));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));

    expect(machine.inventory).toEqual({});
    drive(machine, () => adjustInventory.mock.calls.length > 0);
    // Nothing has resolved: the number is already up.
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });
    settle(WHEAT_YIELD_QUANTITY);
  });

  it("holds the overlay through a snapshot that was READ before the write committed", async () => {
    let settle: (value: number | null) => void = () => {};
    const adjustInventory = vi.fn(() => new Promise<number | null>((res) => (settle = res)));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    // A stale snapshot lands mid-flight -- the poker table's own refetch, say.
    // It still shows no wheat, and must not flicker the number backwards.
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });

    // Confirmed, but the base still has not caught up. Still holding.
    settle(WHEAT_YIELD_QUANTITY);
    await Promise.resolve();
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });
  });

  it("retires the moment the base catches up, and never shows the credit twice", async () => {
    let settle: (value: number | null) => void = () => {};
    const adjustInventory = vi.fn(() => new Promise<number | null>((res) => (settle = res)));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    settle(WHEAT_YIELD_QUANTITY);
    await Promise.resolve();
    machine.setWorld(world({ wheatPlots: [], inventory: { wheat: WHEAT_YIELD_QUANTITY } }));
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });
  });

  it("never reads HIGH once confirmed, whichever order the snapshot arrives in", async () => {
    // The response is applied as a snapshot BEFORE its own promise resolves.
    // Adding the delta on top of a base that already contains it would show
    // four wheat as eight.
    let settle: (value: number | null) => void = () => {};
    const adjustInventory = vi.fn(() => new Promise<number | null>((res) => (settle = res)));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    machine.setWorld(world({ wheatPlots: [], inventory: { wheat: WHEAT_YIELD_QUANTITY } }));
    settle(WHEAT_YIELD_QUANTITY);
    await Promise.resolve();
    // Confirmed, base already caught up: the gap is nil and nothing is added.
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });

    machine.setWorld(world({ wheatPlots: [], inventory: { wheat: WHEAT_YIELD_QUANTITY } }));
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });
  });

  it("shows only the part of a confirmed credit the base has not caught up to", async () => {
    let settle: (value: number | null) => void = () => {};
    const adjustInventory = vi.fn(() => new Promise<number | null>((res) => (settle = res)));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    settle(WHEAT_YIELD_QUANTITY);
    await Promise.resolve();
    // Base is halfway there: show the truth, not the truth plus the delta.
    machine.setWorld(world({ wheatPlots: [], inventory: { wheat: 1 } }));
    expect(machine.inventory).toEqual({ wheat: WHEAT_YIELD_QUANTITY });
  });

  it("gives up on a credit whose base will never catch up, rather than stranding it", async () => {
    let settle: (value: number | null) => void = () => {};
    const adjustInventory = vi.fn(() => new Promise<number | null>((res) => (settle = res)));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    settle(WHEAT_YIELD_QUANTITY);
    await Promise.resolve();
    // The player fed the wheat to a mill on another device: the base never
    // reaches 4. Without patience this credit sits on screen forever.
    for (let i = 0; i < OVERLAY_PATIENCE; i += 1) machine.setWorld(world({ wheatPlots: [] }));
    expect(machine.inventory).toEqual({});
  });

  it("rolls the overlay back when the server refuses, and never counts it as credited", async () => {
    const adjustInventory = vi.fn().mockResolvedValue(null);
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    await Promise.resolve();
    await Promise.resolve();
    expect(machine.inventory).toEqual({});
  });

  it("rolls back on a thrown request too", async () => {
    const adjustInventory = vi.fn().mockRejectedValue(new Error("offline"));
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    await Promise.resolve();
    await Promise.resolve();
    expect(machine.inventory).toEqual({});
  });

  it("does not re-cut a plot the server has not stopped reporting yet", () => {
    const adjustInventory = vi.fn().mockResolvedValue(WHEAT_YIELD_QUANTITY);
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    // The plot is still in the snapshot, still marked ripe. He must not go back.
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    for (let i = 0; i < 500; i += 1) machine.update(FRAME);
    expect(adjustInventory).toHaveBeenCalledTimes(1);
    expect(machine.state).toBe("IDLE");
  });

  it("takes the plot again once a refetch has genuinely re-sown one", () => {
    const adjustInventory = vi.fn().mockResolvedValue(WHEAT_YIELD_QUANTITY);
    const machine = new FarmhandStateMachine({ adjustInventory });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => adjustInventory.mock.calls.length > 0);

    machine.setWorld(world({ wheatPlots: [] })); // gone: the claim is released
    machine.setWorld(world({ wheatPlots: [plot("a")] })); // re-sown, same id
    drive(machine, () => adjustInventory.mock.calls.length > 1);
    expect(adjustInventory).toHaveBeenCalledTimes(2);
  });

  it("fulfils a payable contract without predicting anything about the money", () => {
    const fulfillContract = vi.fn().mockResolvedValue(undefined);
    const machine = new FarmhandStateMachine({ fulfillContract });
    machine.setWorld(world({ contract: contract({ quantity: 2 }), inventory: { flour: 2 } }));

    drive(machine, () => fulfillContract.mock.calls.length > 0);
    expect(fulfillContract).toHaveBeenCalledTimes(1);
    // No optimistic credit: the goods out and the Gold in settle together.
    expect(machine.inventory).toEqual({ flour: 2 });
  });

  it("drops the prediction rather than leave it stranded when nothing is wired to send it", () => {
    const machine = new FarmhandStateMachine({});
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => machine.state === "IDLE" && machine.hand.travelled > 0);
    for (let i = 0; i < 200; i += 1) machine.update(FRAME);
    expect(machine.inventory).toEqual({});
  });

  it("reports the plot it is working, for a highlight ring", () => {
    const machine = new FarmhandStateMachine({ adjustInventory: vi.fn().mockResolvedValue(4) });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => machine.state === "WALKING_TO_PLOT");
    expect(machine.workingPlotId).toBe("a");
  });

  it("stops dead when told to, and picks up where it stood", () => {
    const machine = new FarmhandStateMachine({ adjustInventory: vi.fn().mockResolvedValue(4) });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    drive(machine, () => machine.hand.travelled > 20);

    machine.setRunning(false);
    const held = { ...machine.hand };
    for (let i = 0; i < 100; i += 1) machine.update(FRAME);
    expect(machine.hand).toEqual(held);

    machine.setRunning(true);
    machine.update(FRAME);
    expect(machine.hand.travelled).toBeGreaterThan(held.travelled);
  });

  it("survives a hook that throws, rather than taking the frame down", () => {
    const machine = new FarmhandStateMachine({
      onEffect: () => {
        throw new Error("bad cue");
      },
      adjustInventory: vi.fn().mockResolvedValue(4),
    });
    machine.setWorld(world({ wheatPlots: [plot("a")] }));
    expect(() => drive(machine, () => machine.state === "IDLE" && machine.hand.travelled > 0)).not.toThrow();
  });

  it("plans exactly what planFarmhandWork does -- one priority list, not two", () => {
    const state = world({ contract: contract({ quantity: 2 }), inventory: { flour: 2 }, wheatPlots: [plot("a")] });
    const machine = new FarmhandStateMachine();
    machine.setWorld(state);
    machine.update(FRAME);
    // Delivery outranks the ripe plot, in the class as in the plan.
    expect(planFarmhandWork({ ...state, claimed: new Set() })?.kind).toBe("deliver");
    expect(machine.state).toBe("DELIVERING_TO_CONTRACT");
  });
});

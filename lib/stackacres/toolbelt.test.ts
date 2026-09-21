import { describe, expect, it } from "vitest";
import { beltAnimation, resolveBeltAction, type BeltContext, type BeltTarget } from "./toolbelt";
import type { StackAcresUnitSnapshot } from "./units";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function unit(over: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id: "u1",
    stock: "carrot",
    state: "working",
    progress: 0.5,
    readyAt: new Date(NOW + 60_000).toISOString(),
    permanent: false,
    soilSlot: 0,
    housedIn: null,
    muckFee: null,
    seed: false,
    ...over,
  } as StackAcresUnitSnapshot;
}

function ctx(over: Partial<BeltContext> = {}): BeltContext {
  return {
    water: 5,
    feed: 5,
    gold: 1000,
    nowMs: NOW,
    seed: "carrot",
    seedsHeld: 4,
    ...over,
  };
}

const bareBed: BeltTarget = { unit: null, tile: { tx: 4, ty: 7 }, bedded: true };
const bareGround: BeltTarget = { unit: null, tile: { tx: 4, ty: 7 }, bedded: false };
const offField: BeltTarget = { unit: null, tile: null, bedded: false };

describe("the watering can", () => {
  it("waters a dry crop", () => {
    const target: BeltTarget = { ...bareBed, unit: unit({ state: "dry" }) };
    expect(resolveBeltAction("can", target, ctx())).toEqual({ kind: "water", unitId: "u1" });
  });

  it("stays quiet on a crop that is not thirsty, rather than knocking on wood", () => {
    const target: BeltTarget = { ...bareBed, unit: unit({ state: "working" }) };
    const action = resolveBeltAction("can", target, ctx());
    expect(action).toMatchObject({ kind: "nothing", why: "waiting" });
  });

  it("says to refill when the can is empty", () => {
    const target: BeltTarget = { ...bareBed, unit: unit({ state: "dry" }) };
    const action = resolveBeltAction("can", target, ctx({ water: 0 }));
    expect(action).toMatchObject({ kind: "nothing", why: "blocked" });
    expect(action).toHaveProperty("reason", expect.stringContaining("well"));
  });
});

describe("the hand", () => {
  it("picks a ready crop", () => {
    const target: BeltTarget = { ...bareBed, unit: unit({ state: "ready", progress: 1 }) };
    expect(resolveBeltAction("hand", target, ctx())).toEqual({ kind: "collect", unitId: "u1" });
  });

  it("sends a thirsty crop to the can instead of watering it", () => {
    const target: BeltTarget = { ...bareBed, unit: unit({ state: "dry" }) };
    const action = resolveBeltAction("hand", target, ctx());
    expect(action).toMatchObject({ kind: "nothing", why: "blocked" });
    expect(action).toHaveProperty("reason", expect.stringContaining("watering can"));
  });

  it("treats empty ground as a plain walk, with nothing floated", () => {
    expect(resolveBeltAction("hand", bareGround, ctx())).toEqual({ kind: "idle" });
    expect(resolveBeltAction("hand", offField, ctx())).toEqual({ kind: "idle" });
  });
});

describe("the hoe", () => {
  it("lays a bed on bare field ground", () => {
    expect(resolveBeltAction("hoe", bareGround, ctx())).toEqual({ kind: "till", tx: 4, ty: 7 });
  });

  it("asks before lifting a bed that is already down, then lifts it", () => {
    expect(resolveBeltAction("hoe", bareBed, ctx())).toEqual({
      kind: "arm-lift",
      tx: 4,
      ty: 7,
      reason: "Press again to lift this bed.",
    });
    expect(resolveBeltAction("hoe", { ...bareBed, armed: true }, ctx())).toEqual({ kind: "lift", tx: 4, ty: 7 });
  });

  it("never lifts a bed with something growing on it, armed or not", () => {
    const planted: BeltTarget = { ...bareBed, armed: true, unit: unit() };
    expect(resolveBeltAction("hoe", planted, ctx())).toMatchObject({ kind: "nothing", why: "blocked" });
  });

  it("refuses off the paddocks and the Crop Fields, where there is no bed to lay", () => {
    expect(resolveBeltAction("hoe", offField, ctx())).toMatchObject({ kind: "nothing", why: "blocked" });
  });

  it("digs with nothing else in hand: the hoe is free", () => {
    expect(resolveBeltAction("hoe", bareGround, ctx({ gold: 0, seedsHeld: 0 }))).toEqual({
      kind: "till",
      tx: 4,
      ty: 7,
    });
  });
});

describe("the seed pouch", () => {
  it("sows the crop on the wheel onto the tapped bed", () => {
    expect(resolveBeltAction("seeds", bareBed, ctx())).toEqual({ kind: "plant", tx: 4, ty: 7, stock: "carrot" });
  });

  it("sends the player to the hoe when the ground is not broken", () => {
    const action = resolveBeltAction("seeds", bareGround, ctx());
    expect(action).toHaveProperty("reason", expect.stringContaining("hoe"));
  });

  it("refuses a bed that already has something growing on it", () => {
    const target: BeltTarget = { ...bareBed, unit: unit() };
    expect(resolveBeltAction("seeds", target, ctx())).toMatchObject({ kind: "nothing", why: "blocked" });
  });

  it("asks the player to pick a seed when the wheel is empty", () => {
    const action = resolveBeltAction("seeds", bareBed, ctx({ seed: null }));
    expect(action).toHaveProperty("reason", expect.stringContaining("pouch"));
  });

  it("names the crop it has run out of", () => {
    const action = resolveBeltAction("seeds", bareBed, ctx({ seedsHeld: 0 }));
    expect(action).toHaveProperty("reason", expect.stringContaining("Carrot"));
  });
});

describe("beltAnimation", () => {
  it("acts out everything that is sent, and nothing that is not", () => {
    expect(beltAnimation({ kind: "water", unitId: "u1" })).toBe("water");
    expect(beltAnimation({ kind: "collect", unitId: "u1" })).toBe("harvest");
    expect(beltAnimation({ kind: "clear", unitId: "u1" })).toBe("harvest");
    expect(beltAnimation({ kind: "till", tx: 0, ty: 0 })).toBe("hoe");
    expect(beltAnimation({ kind: "lift", tx: 0, ty: 0 })).toBe("hoe");
    expect(beltAnimation({ kind: "plant", tx: 0, ty: 0, stock: "carrot" })).toBe("plant");
    expect(beltAnimation({ kind: "nothing", reason: "no", why: "blocked" })).toBeNull();
    expect(beltAnimation({ kind: "idle" })).toBeNull();
  });
});

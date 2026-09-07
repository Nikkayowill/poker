import { describe, expect, it } from "vitest";
import { juiceStyleFor } from "./juice";
import { crossbreedFlashLabel, crossbreedFlashStyleFor } from "./crossbreed-juice";

describe("crossbreedFlashStyleFor", () => {
  it("scales both parents' own shard styles up rather than inventing new numbers", () => {
    const style = crossbreedFlashStyleFor("carrot", "corn");
    const carrotBase = juiceStyleFor("carrot");
    const cornBase = juiceStyleFor("corn");

    expect(style.parentA.ramp).toBe(carrotBase.ramp);
    expect(style.parentA.shardCount).toBeGreaterThan(carrotBase.shardCount);
    expect(style.parentB.ramp).toBe(cornBase.ramp);
    expect(style.parentB.shardCount).toBeGreaterThan(cornBase.shardCount);

    // Every other physics number (speed, gravity, lifetime) is untouched --
    // only count and radius scale.
    expect(style.parentA.speed).toEqual(carrotBase.speed);
    expect(style.parentA.gravity).toBe(carrotBase.gravity);
    expect(style.parentA.lifeMs).toEqual(carrotBase.lifeMs);
  });

  it("reads two different pairs as visually distinct (different ramps)", () => {
    const cropCross = crossbreedFlashStyleFor("carrot", "corn");
    const livestockCross = crossbreedFlashStyleFor("hen", "pig");
    expect([cropCross.parentA.ramp, cropCross.parentB.ramp]).not.toEqual([
      livestockCross.parentA.ramp,
      livestockCross.parentB.ramp,
    ]);
  });

  it("fires the second burst on a short delay, never simultaneous", () => {
    const style = crossbreedFlashStyleFor("pig", "cattle");
    expect(style.secondBurstDelayMs).toBeGreaterThan(0);
  });
});

describe("crossbreedFlashLabel", () => {
  it("names the exact hybrid produced", () => {
    expect(crossbreedFlashLabel("golden_maize")).toBe("CROSS! Golden Maize");
    expect(crossbreedFlashLabel("custard_curd")).toBe("CROSS! Custard Curd");
  });
});

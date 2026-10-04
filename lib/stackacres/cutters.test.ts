import { describe, expect, it } from "vitest";
import {
  STACKACRES_BUYABLE_CUTTERS,
  STACKACRES_CUTTERS,
  STACKACRES_CUTTER_DEFS,
  STACKACRES_STARTING_CUTTER,
  heldStackAcresCutter,
  isStackAcresBuyableCutter,
  ownedStackAcresCutters,
} from "./cutters";

describe("the cutters", () => {

  it("sells every cutter but the Scythe, and gates the Mower on the Crop Fields", () => {
    expect(STACKACRES_BUYABLE_CUTTERS).not.toContain(STACKACRES_STARTING_CUTTER);
    for (const cutter of STACKACRES_BUYABLE_CUTTERS) {
      expect(STACKACRES_CUTTER_DEFS[cutter].price, cutter).toBeGreaterThan(0);
    }
    expect(STACKACRES_CUTTER_DEFS.mower.requiredQuestFlag).toBe("crop_fields_unlocked");
    expect(isStackAcresBuyableCutter("scythe")).toBe(false);
    expect(isStackAcresBuyableCutter("mower")).toBe(true);
  });

  it("gives every cutter its own icon, and none of them a spade", () => {
    const icons = STACKACRES_CUTTERS.map((cutter) => STACKACRES_CUTTER_DEFS[cutter].icon);
    expect(new Set(icons).size).toBe(STACKACRES_CUTTERS.length);
    for (const icon of icons) expect(icon).not.toMatch(/^tool/);
  });

});

describe("ownedStackAcresCutters", () => {
  it("always includes the Scythe, first", () => {
    expect(ownedStackAcresCutters([])).toEqual(["scythe"]);
    expect(ownedStackAcresCutters(["mower"])).toEqual(["scythe", "mower"]);
  });

  it("drops junk and repeats rather than throwing", () => {
    expect(ownedStackAcresCutters(["mower", "mower", "scythe", "combine", null, 3])).toEqual([
      "scythe",
      "mower",
    ]);
  });
});

describe("heldStackAcresCutter", () => {
  it("keeps the one the player picked while they own it", () => {
    expect(heldStackAcresCutter("scythe", ["scythe", "mower"])).toBe("scythe");
    expect(heldStackAcresCutter("mower", ["scythe", "mower"])).toBe("mower");
  });

  it("falls back to the best one owned when the pick is missing or not owned", () => {
    expect(heldStackAcresCutter(null, ["scythe", "mower"])).toBe("mower");
    expect(heldStackAcresCutter("mower", ["scythe"])).toBe("scythe");
    expect(heldStackAcresCutter("golden-spade", ["scythe"])).toBe("scythe");
    expect(heldStackAcresCutter(undefined, [])).toBe("scythe");
  });
});


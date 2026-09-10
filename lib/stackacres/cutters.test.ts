import { describe, expect, it } from "vitest";
import {
  STACKACRES_BUYABLE_CUTTERS,
  STACKACRES_CUTTERS,
  STACKACRES_CUTTER_DEFS,
  STACKACRES_STARTING_CUTTER,
  cutterRank,
  cutterReach,
  cutterRegrowMs,
  heldStackAcresCutter,
  isStackAcresBuyableCutter,
  ownedStackAcresCutters,
  strokesToClearWidth,
  toStackAcresCutter,
} from "./cutters";
import { MEADOW_REGROW_MS, SCYTHE_REACH } from "./zones";

describe("the cutters", () => {
  it("leaves the Scythe exactly as the meadow already played", () => {
    // A player who never buys the Mower must see no change at all.
    expect(cutterReach("scythe")).toBe(SCYTHE_REACH);
    expect(cutterRegrowMs("scythe")).toBe(MEADOW_REGROW_MS);
    expect(STACKACRES_CUTTER_DEFS.scythe.price).toBeNull();
  });

  it("makes the Mower's cut stay down three times as long, as its blurb says", () => {
    expect(cutterRegrowMs("mower")).toBe(cutterRegrowMs("scythe") * 3);
    expect(STACKACRES_CUTTER_DEFS.mower.blurb).toMatch(/three times as long/);
  });

  it("never gives the Mower a narrower cut than the Scythe", () => {
    expect(cutterReach("mower")).toBeGreaterThanOrEqual(cutterReach("scythe"));
  });

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

  it("ranks the Scythe first", () => {
    expect(cutterRank("scythe")).toBe(0);
    expect(cutterRank("mower")).toBe(1);
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

describe("toStackAcresCutter", () => {
  it("reads real names back and degrades anything else to the Scythe", () => {
    expect(toStackAcresCutter("mower")).toBe("mower");
    for (const junk of [null, undefined, "", "golden-spade", 3, {}]) {
      expect(toStackAcresCutter(junk), String(junk)).toBe("scythe");
    }
  });
});

describe("strokesToClearWidth", () => {
  it("never takes the Mower more passes than the Scythe", () => {
    const band = 1_000;
    expect(strokesToClearWidth(band, "mower")).toBeLessThanOrEqual(strokesToClearWidth(band, "scythe"));
  });

  it("rounds up, and asks for nothing over no ground", () => {
    const reach = cutterReach("scythe");
    expect(strokesToClearWidth(reach * 2 * 2.5, "scythe")).toBe(3);
    expect(strokesToClearWidth(reach * 2, "scythe")).toBe(1);
    expect(strokesToClearWidth(0, "scythe")).toBe(0);
    expect(strokesToClearWidth(-40, "scythe")).toBe(0);
    expect(strokesToClearWidth(Number.NaN, "scythe")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { buildCost, costSummary, buildShortfall, shortLines, buildPlace } from "./build-cost";
import { MACHINE_CATALOGUE, MACHINE_KINDS } from "./machines";

describe("buildCost", () => {
  it("counts Gold and every material the machine spends", () => {
    const cost = buildCost("mill", 500, { wood: 6 });
    expect(cost.lines).toEqual([
      { label: "Gold", have: 500, need: 200, met: true, source: null },
      { label: "Wood", have: 6, need: 15, met: false, source: "Chop the trees around the farm" },
    ]);
    expect(cost.affordable).toBe(false);
  });

  it("is affordable only when every line is met", () => {
    expect(buildCost("mill", 200, { wood: 15 }).affordable).toBe(true);
    expect(buildCost("mill", 199, { wood: 15 }).affordable).toBe(false);
    expect(buildCost("mill", 200, { wood: 14 }).affordable).toBe(false);
  });

  it("treats a machine with no materials as Gold alone", () => {
    const cost = buildCost("oven", 500, {});
    expect(cost.lines).toHaveLength(1);
    expect(cost.affordable).toBe(true);
  });

  it("reads a missing inventory entry as none, not as enough", () => {
    expect(buildCost("feed_silo", 99_999, {}).affordable).toBe(false);
  });

  it("says where each machine is built", () => {
    expect(buildPlace("mill")).toBe("Workshop");
    expect(buildPlace("oven")).toBe("House");
    expect(buildCost("cellar", 0, {}).place).toBe("House");
  });

  it("covers every machine in the catalogue", () => {
    for (const kind of MACHINE_KINDS) {
      const cost = buildCost(kind, 0, {});
      expect(cost.place).toMatch(/^(Workshop|House)$/);
      expect(cost.name).toBe(MACHINE_CATALOGUE[kind].label);
      expect(cost.lines[0].need).toBe(MACHINE_CATALOGUE[kind].placeCost);
      expect(cost.lines).toHaveLength(1 + (MACHINE_CATALOGUE[kind].materials?.length ?? 0));
    }
  });

  it("gives every material a source a player can act on", () => {
    for (const kind of MACHINE_KINDS) {
      for (const line of buildCost(kind, 0, {}).lines) {
        if (line.label !== "Gold") expect(line.source, `${kind} ${line.label}`).toBeTruthy();
      }
    }
  });
});

describe("costSummary", () => {
  it("names everything the build spends", () => {
    expect(costSummary(buildCost("mill", 0, {}))).toBe("200 Gold + 15 Wood");
    expect(costSummary(buildCost("oven", 0, {}))).toBe("500 Gold");
    expect(costSummary(buildCost("feed_silo", 0, {}))).toBe("12,000 Gold + 20 Stone");
  });
});

describe("buildShortfall", () => {
  it("is null when the player can build it", () => {
    expect(buildShortfall(buildCost("mill", 200, { wood: 15 }))).toBeNull();
  });

  it("names the shortfall and where to get it", () => {
    expect(buildShortfall(buildCost("mill", 200, { wood: 6 }))).toBe(
      "You need 9 more Wood. Chop the trees around the farm.",
    );
  });

  it("names both when Gold and material are short", () => {
    // Both are at none of what they need, so the tie keeps the listed order.
    expect(buildShortfall(buildCost("mill", 0, {}))).toBe(
      "You need 200 more Gold and 15 more Wood. Chop the trees around the farm.",
    );
  });

  it("leaves out a source when only Gold is short", () => {
    expect(buildShortfall(buildCost("oven", 100, {}))).toBe("You need 400 more Gold.");
  });

  it("leads with the line furthest from done", () => {
    // Half the Gold, none of the Wood: the Wood is what is really blocking.
    expect(shortLines(buildCost("mill", 100, { wood: 0 }))[0].label).toBe("Wood");
  });
});

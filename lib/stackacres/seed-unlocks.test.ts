import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS } from "./catalogue";
import { MACHINE_KINDS, type MachineKind } from "./machines";
import { SEED_UNLOCKS, isSeedUnlocked, seedLockLine, seedsOpenedBy, seedsOpenedLine } from "./seed-unlocks";

const built = (...kinds: MachineKind[]) => new Set<MachineKind>(kinds);

describe("seed locks", () => {
  it("keeps wheat open from the start, since the Mill runs on it", () => {
    expect(isSeedUnlocked("wheat", built())).toBe(true);
    expect(seedLockLine("wheat", built())).toBeNull();
  });

  it("gates every other crop behind at least one real building", () => {
    for (const crop of STACKACRES_CROPS) {
      if (crop === "wheat") continue;
      expect(SEED_UNLOCKS[crop].length).toBeGreaterThan(0);
      for (const kind of SEED_UNLOCKS[crop]) expect(MACHINE_KINDS).toContain(kind);
    }
  });

  it("opens a crop only once every building it needs is built", () => {
    expect(isSeedUnlocked("potato", built())).toBe(false);
    expect(isSeedUnlocked("potato", built("stew_pot"))).toBe(true);
    expect(isSeedUnlocked("tomato", built("stew_pot"))).toBe(false);
    expect(isSeedUnlocked("tomato", built("stew_pot", "counter"))).toBe(true);
    expect(isSeedUnlocked("corn", built("mill"))).toBe(true);
    expect(isSeedUnlocked("eggplant", built("oven"))).toBe(true);
  });

  it("names only the buildings still missing", () => {
    expect(seedLockLine("tomato", built())).toBe("Build the Stew Pot and the Kitchen Counter to unlock");
    expect(seedLockLine("tomato", built("counter"))).toBe("Build the Stew Pot to unlock");
    expect(seedLockLine("lettuce", built("counter"))).toBeNull();
  });

  it("tells a building's card which seeds it opens", () => {
    expect(seedsOpenedLine("mill")).toBe("Opens Corn and Green Bean seeds");
    expect(seedsOpenedLine("oven")).toBe("Opens Eggplant and Broccoli seeds");
    expect(seedsOpenedLine("dairy")).toBeNull();
  });
});

describe("seedsOpenedBy", () => {
  it("lists only the seeds that are actually open now", () => {
    expect(seedsOpenedBy(["stew_pot"], new Set<MachineKind>(["stew_pot"]))).toBe("Opens Potato, Carrot and Onion seeds");
  });

  it("adds the seeds that needed two buildings once the second one is built", () => {
    const line = seedsOpenedBy(["counter"], new Set<MachineKind>(["stew_pot", "counter"]));
    expect(line).toContain("Lettuce");
    expect(line).toContain("Tomato");
    expect(line).not.toContain("Potato");
  });

  it("is null when the buildings open nothing", () => {
    expect(seedsOpenedBy(["dairy"], new Set<MachineKind>(["dairy"]))).toBeNull();
  });
});

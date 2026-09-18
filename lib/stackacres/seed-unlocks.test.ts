import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS } from "./catalogue";
import { MACHINE_KINDS, type MachineKind } from "./machines";
import { STACKACRES_RETIRED_CROPS } from "./scope";
import { SEED_UNLOCKS, isSeedUnlocked, seedLockLine, seedsOpenedLine } from "./seed-unlocks";

const built = (...kinds: MachineKind[]) => new Set<MachineKind>(kinds);

describe("seed locks", () => {
  it("gates every crop still sold behind at least one real building", () => {
    for (const crop of STACKACRES_CROPS) {
      if (STACKACRES_RETIRED_CROPS.includes(crop)) continue;
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

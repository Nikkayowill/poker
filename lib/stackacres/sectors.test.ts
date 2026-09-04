import { describe, expect, it } from "vitest";
import {
  HOME_SECTOR,
  SECTOR_IDS,
  SECTOR_LADDER,
  STACKACRES_SECTORS,
  isSectorUnlocked,
  lockedSectors,
  sectorClearCheck,
  sectorLabel,
  sectorOvergrowth,
  unlockedPlotCount,
  unlockedSectors,
  type SectorId,
} from "./sectors";
import { STACKACRES_UPKEEP_FREE_PLOTS } from "./upkeep";
import { STACKACRES_STOCK, capFor, type StackAcresStock } from "./catalogue";
import { nearPath } from "./paths";
import { stockZone } from "./world";
import { STACKACRES_ZONES, ZONE_IDS } from "./zones";

/** A stand-in for a unit snapshot: `unlockedSectors` only ever reads `stock`. */
function owning(...stocks: StackAcresStock[]) {
  return stocks.map((stock) => ({ stock }));
}

describe("the sector ladder", () => {
  it("covers every district exactly once, home first", () => {
    expect([...SECTOR_IDS].sort()).toEqual([...ZONE_IDS].sort());
    expect(SECTOR_IDS[0]).toBe(HOME_SECTOR);
    expect(SECTOR_LADDER).not.toContain(HOME_SECTOR);
    expect(new Set(SECTOR_LADDER).size).toBe(SECTOR_LADDER.length);
  });

  it("names each rung's prerequisite as the rung before it", () => {
    expect(STACKACRES_SECTORS[SECTOR_LADDER[0]].requires).toBeNull();
    for (let i = 1; i < SECTOR_LADDER.length; i += 1) {
      expect(STACKACRES_SECTORS[SECTOR_LADDER[i]].requires).toBe(SECTOR_LADDER[i - 1]);
    }
  });

  it("charges nothing for home and rises with every rung after it", () => {
    expect(STACKACRES_SECTORS[HOME_SECTOR].clearCost).toBe(0);
    expect(STACKACRES_SECTORS[HOME_SECTOR].requiresUnits).toBe(0);
    const costs = SECTOR_LADDER.map((id) => STACKACRES_SECTORS[id].clearCost);
    const units = SECTOR_LADDER.map((id) => STACKACRES_SECTORS[id].requiresUnits);
    for (let i = 1; i < costs.length; i += 1) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1]);
      expect(units[i]).toBeGreaterThan(units[i - 1]);
    }
  });

  it("never asks for more stock than the already-cleared land can hold", () => {
    // The trap this catches: raising a rung's `requiresUnits` past the number
    // of slots the previous rungs actually give you makes it unreachable, and
    // there is no error anywhere to notice that -- the modal just never ticks.
    let reachable = 0;
    for (const id of [HOME_SECTOR, ...SECTOR_LADDER]) {
      if (id !== HOME_SECTOR) {
        expect(STACKACRES_SECTORS[id].requiresUnits).toBeLessThanOrEqual(reachable);
      }
      reachable += STACKACRES_STOCK.filter((stock) => stockZone(stock) === id).length * capFor(0);
    }
  });
});

describe("unlockedSectors", () => {
  it("always includes home, even with nothing cleared and nothing owned", () => {
    expect(unlockedSectors([], [])).toEqual([HOME_SECTOR]);
  });

  it("includes what was explicitly cleared", () => {
    const open = unlockedSectors(["meadow"], []);
    expect(open).toContain("meadow");
    expect(open).not.toContain("oxfields");
  });

  it("treats stock standing in a district as proof that district is yours", () => {
    // The live-farm clause: a player who already keeps cattle keeps Ox Fields
    // without any backfill having to get it right.
    expect(unlockedSectors([], owning("cattle"))).toContain("oxfields");
    expect(unlockedSectors([], owning("pig"))).toContain("wallow");
    expect(unlockedSectors([], owning("sprout"))).toContain("meadow");
  });

  it("does not double-count a district both cleared and stocked", () => {
    const open = unlockedSectors(["oxfields"], owning("cattle", "cattle"));
    expect(open.filter((id) => id === "oxfields")).toHaveLength(1);
  });

  it("returns a stable SECTOR_IDS order whatever order the inputs arrive in", () => {
    const a = unlockedSectors(["oxfields", "meadow"], owning("pig"));
    const b = unlockedSectors(["meadow", "oxfields"], owning("pig"));
    expect(a).toEqual(b);
    expect(a).toEqual(SECTOR_IDS.filter((id) => a.includes(id)));
  });

  it("splits cleanly against lockedSectors", () => {
    const open = unlockedSectors(["meadow"], []);
    const shut = lockedSectors(open);
    expect([...open, ...shut].sort()).toEqual([...SECTOR_IDS].sort());
    for (const id of shut) expect(isSectorUnlocked(id, open)).toBe(false);
  });
});

describe("sectorClearCheck", () => {
  const noUnits = { unlocked: [HOME_SECTOR] as SectorId[], unitCount: 0 };

  it("reports land you already hold as nothing to buy", () => {
    const check = sectorClearCheck("farmstead", noUnits);
    expect(check.alreadyOpen).toBe(true);
    expect(check.ok).toBe(false);
    expect(check.requirements).toEqual([]);
  });

  it("quotes the price even when the requirements are not met yet", () => {
    // A player saving up needs the number before they qualify for it.
    const check = sectorClearCheck("meadow", noUnits);
    expect(check.ok).toBe(false);
    expect(check.cost).toBe(STACKACRES_SECTORS.meadow.clearCost);
    expect(check.requirements.some((requirement) => !requirement.met)).toBe(true);
  });

  it("opens the first rung once enough stock is going", () => {
    const check = sectorClearCheck("meadow", {
      unlocked: [HOME_SECTOR],
      unitCount: STACKACRES_SECTORS.meadow.requiresUnits,
    });
    expect(check.ok).toBe(true);
    expect(check.requirements.every((requirement) => requirement.met)).toBe(true);
  });

  it("holds a later rung shut until the one before it is cleared", () => {
    const plenty = { unlocked: [HOME_SECTOR] as SectorId[], unitCount: 99 };
    const second = SECTOR_LADDER[1];
    const blocked = sectorClearCheck(second, plenty);
    expect(blocked.ok).toBe(false);
    expect(blocked.requirements[0].label).toContain(sectorLabel(SECTOR_LADDER[0]));

    const open = sectorClearCheck(second, {
      unlocked: [HOME_SECTOR, SECTOR_LADDER[0]],
      unitCount: 99,
    });
    expect(open.ok).toBe(true);
  });

  it("says how many units the player has, not just how many are wanted", () => {
    const check = sectorClearCheck("meadow", { unlocked: [HOME_SECTOR], unitCount: 1 });
    const line = check.requirements.find((requirement) => requirement.label.includes("going"));
    expect(line?.label).toContain("you have 1");
  });
});

describe("unlockedPlotCount", () => {
  it("counts only slots standing on cleared ground", () => {
    // Home alone is the Hen Coop's own three free slots, which is exactly the
    // free base -- so a brand-new farm owes nothing.
    const home = unlockedPlotCount([HOME_SECTOR], {});
    expect(home).toBe(capFor(0));
    // Exactly the free base, so a brand-new farm owes nothing. The fee itself
    // now lives in ./upkeep.ts; upkeep.test.ts holds that half.
    expect(home).toBe(STACKACRES_UPKEEP_FREE_PLOTS);
  });

  it("grows as land is cleared", () => {
    const home = unlockedPlotCount([HOME_SECTOR], {});
    const plusMeadow = unlockedPlotCount([HOME_SECTOR, "meadow"], {});
    // The Long Meadow holds two crop kinds, so it is worth two kinds' slots.
    expect(plusMeadow).toBe(home + 2 * capFor(0));
  });

  it("grows as capacity is bought on cleared ground", () => {
    const before = unlockedPlotCount([HOME_SECTOR], {});
    const after = unlockedPlotCount([HOME_SECTOR], { hen: 2 });
    expect(after).toBe(before + 2);
  });

  it("ignores capacity bought for a kind whose land is still wild", () => {
    // Nothing stops a player having capacity rows from before the land was
    // gated; they must not be billed for slots they cannot reach.
    expect(unlockedPlotCount([HOME_SECTOR], { cattle: 3 })).toBe(
      unlockedPlotCount([HOME_SECTOR], {}),
    );
  });
});

describe("sectorOvergrowth", () => {
  it("grows something on every locked sector", () => {
    for (const id of SECTOR_LADDER) {
      expect(sectorOvergrowth(id).length).toBeGreaterThan(20);
    }
  });

  it("is deterministic, so panning away and back finds the same trees", () => {
    expect(sectorOvergrowth("meadow")).toEqual(sectorOvergrowth("meadow"));
  });

  it("gives each sector its own growth", () => {
    expect(sectorOvergrowth("meadow")).not.toEqual(sectorOvergrowth("oxfields"));
  });

  it("stays inside the sector's own bounds", () => {
    for (const id of SECTOR_LADDER) {
      const bounds = STACKACRES_ZONES[id].bounds;
      for (const item of sectorOvergrowth(id)) {
        expect(item.x).toBeGreaterThanOrEqual(bounds.x);
        expect(item.x).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(item.y).toBeGreaterThanOrEqual(bounds.y);
        expect(item.y).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    }
  });

  it("never grows over a road", () => {
    // The lane south and the road east both run through locked ground, and a
    // wood across the road breaks the one promise the map makes about where
    // you can go.
    for (const id of SECTOR_LADDER) {
      for (const item of sectorOvergrowth(id)) {
        expect(nearPath(item.x, item.y)).toBe(false);
      }
    }
  });

  it("mixes canopy, scrub and ground cover rather than one repeated tree", () => {
    const kinds = new Set(sectorOvergrowth("meadow").map((item) => item.kind));
    expect(kinds.size).toBeGreaterThan(4);
  });

  it("varies its heights, so a stand has a skyline", () => {
    const scales = new Set(sectorOvergrowth("wallow").map((item) => item.scale));
    expect(scales.size).toBeGreaterThan(10);
  });
});

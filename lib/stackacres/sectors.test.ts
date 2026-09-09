import { describe, expect, it } from "vitest";
import {
  HOME_SECTOR,
  HOME_SECTORS,
  SECTOR_IDS,
  OVERGROWTH_SPACING,
  SECTOR_LADDER,
  STACKACRES_SECTORS,
  cropFieldOvergrowth,
  isSectorUnlocked,
  lockedSectors,
  sectorClearCheck,
  sectorLabel,
  sectorOvergrowth,
  unlockedPlotCount,
  unlockedSectors,
  type SectorId,
} from "./sectors";
import { CROP_FIELD } from "./yard";
import { STACKACRES_UPKEEP_FREE_PLOTS } from "./upkeep";
import { STACKACRES_CROPS, STACKACRES_STOCK, capFor, type StackAcresStock } from "./catalogue";
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
    for (const id of [...HOME_SECTORS, ...SECTOR_LADDER]) {
      if (!HOME_SECTORS.includes(id)) {
        expect(STACKACRES_SECTORS[id].requiresUnits).toBeLessThanOrEqual(reachable);
      }
      reachable += STACKACRES_STOCK.filter((stock) => stockZone(stock) === id).length * capFor(0);
    }
  });
});

describe("unlockedSectors", () => {
  it("always includes home, even with nothing cleared and nothing owned", () => {
    // Two home sectors since the 2026-09-07 re-lay: the hens moved out of the
    // Farmstead into Hen Haven, and gating the only affordable animal behind
    // Gold would leave a new farm with no first move.
    expect(unlockedSectors([], [])).toEqual([...HOME_SECTORS]);
  });

  it("includes what was explicitly cleared", () => {
    const open = unlockedSectors(["wallow"], []);
    expect(open).toContain("wallow");
    expect(open).not.toContain("oxfields");
  });

  it("treats stock standing in a district as proof that district is yours", () => {
    // The live-farm clause: a player who already keeps cattle keeps Ox Fields
    // without any backfill having to get it right. Crops don't test this any
    // more -- they're zoned to the Farmstead (a HOME sector) since the
    // 2026-09-08 merge, so owning one proves nothing about a paid sector.
    expect(unlockedSectors([], owning("cattle"))).toContain("oxfields");
    expect(unlockedSectors([], owning("pig"))).toContain("wallow");
  });

  it("does not double-count a district both cleared and stocked", () => {
    const open = unlockedSectors(["oxfields"], owning("cattle", "cattle"));
    expect(open.filter((id) => id === "oxfields")).toHaveLength(1);
  });

  it("returns a stable SECTOR_IDS order whatever order the inputs arrive in", () => {
    const a = unlockedSectors(["oxfields", "wallow"], owning("pig"));
    const b = unlockedSectors(["wallow", "oxfields"], owning("pig"));
    expect(a).toEqual(b);
    expect(a).toEqual(SECTOR_IDS.filter((id) => a.includes(id)));
  });

  it("splits cleanly against lockedSectors", () => {
    const open = unlockedSectors(["wallow"], []);
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
    const check = sectorClearCheck("wallow", noUnits);
    expect(check.ok).toBe(false);
    expect(check.cost).toBe(STACKACRES_SECTORS.wallow.clearCost);
    expect(check.requirements.some((requirement) => !requirement.met)).toBe(true);
  });

  it("opens the first rung once enough stock is going", () => {
    const check = sectorClearCheck("wallow", {
      unlocked: [HOME_SECTOR],
      unitCount: STACKACRES_SECTORS.wallow.requiresUnits,
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
    const check = sectorClearCheck("wallow", { unlocked: [HOME_SECTOR], unitCount: 1 });
    const line = check.requirements.find((requirement) => requirement.label.includes("going"));
    expect(line?.label).toContain("you have 1");
  });
});

describe("unlockedPlotCount", () => {
  // `cropFieldsUnlocked: false` throughout except the one test that varies
  // it on purpose -- see that function's own header on why the flag has to
  // be passed at all: `farmstead` never leaves the unlocked list (it is a
  // HOME sector), so every crop kind's slots would otherwise count against a
  // farm that has never spent the Gold to unlock the Crop Fields.
  it("counts only slots standing on cleared ground", () => {
    // Home is the Hen Coop's own three free slots, which is exactly the free
    // base -- so a brand-new farm owes nothing. Those slots stand at Hen Haven
    // now rather than in the Farmstead's yard, so the count is over both home
    // sectors; the number it produces is unchanged.
    const home = unlockedPlotCount([...HOME_SECTORS], {}, false);
    expect(home).toBe(capFor(0));
    // Exactly the free base, so a brand-new farm owes nothing. The fee itself
    // now lives in ./upkeep.ts; upkeep.test.ts holds that half.
    expect(home).toBe(STACKACRES_UPKEEP_FREE_PLOTS);
  });

  it("grows as land is cleared", () => {
    const home = unlockedPlotCount([...HOME_SECTORS], {}, false);
    const plusWallow = unlockedPlotCount([...HOME_SECTORS, "wallow"], {}, false);
    // Only the pig is zoned to the Fold (wallow), so clearing it alone is
    // worth exactly one stock kind's slots. The Crop Fields' own 22 kinds
    // do not add to this at all while their own flag is unset, even though
    // they stand inside the Farmstead (a HOME sector, already counted in
    // `home`) -- see the next test.
    expect(plusWallow).toBe(home + capFor(0));
  });

  it("grows as capacity is bought on cleared ground", () => {
    const before = unlockedPlotCount([...HOME_SECTORS], {}, false);
    const after = unlockedPlotCount([...HOME_SECTORS], { hen: 2 }, false);
    expect(after).toBe(before + 2);
  });

  it("ignores capacity bought for a kind whose land is still wild", () => {
    // Nothing stops a player having capacity rows from before the land was
    // gated; they must not be billed for slots they cannot reach.
    expect(unlockedPlotCount([HOME_SECTOR], { cattle: 3 }, false)).toBe(
      unlockedPlotCount([HOME_SECTOR], {}, false),
    );
  });

  it("counts the Crop Fields' own 22 kinds only once their standalone flag is set", () => {
    // The regression this guards: the Farmstead is a HOME sector and never
    // leaves the unlocked list, so a naive sector-only check would count
    // every crop kind's slots against a farm that has never unlocked the
    // Crop Fields at all (see ./crop-fields.ts).
    const locked = unlockedPlotCount([...HOME_SECTORS], {}, false);
    const unlocked = unlockedPlotCount([...HOME_SECTORS], {}, true);
    expect(unlocked).toBe(locked + STACKACRES_CROPS.length * capFor(0));
  });
});

describe("sectorOvergrowth", () => {
  it("grows something on every locked sector", () => {
    // Measured against the district's own size rather than a fixed count:
    // the Grid Bench layout made a district its pen plus 16, so the Fold is
    // 160 square now, and what "overgrown" means is that most of the
    // lattice `overgrowthOver` walks actually grew something.
    for (const id of SECTOR_LADDER) {
      const b = STACKACRES_ZONES[id].bounds;
      const lattice = Math.ceil(b.width / OVERGROWTH_SPACING) * Math.ceil(b.height / OVERGROWTH_SPACING);
      expect(sectorOvergrowth(id).length, id).toBeGreaterThan(lattice * 0.4);
    }
  });

  it("is deterministic, so panning away and back finds the same trees", () => {
    expect(sectorOvergrowth("wallow")).toEqual(sectorOvergrowth("wallow"));
  });

  it("gives each sector its own growth", () => {
    expect(sectorOvergrowth("wallow")).not.toEqual(sectorOvergrowth("oxfields"));
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
    const kinds = new Set(sectorOvergrowth("oxfields").map((item) => item.kind));
    expect(kinds.size).toBeGreaterThan(4);
  });

  it("varies its heights, so a stand has a skyline", () => {
    const scales = new Set(sectorOvergrowth("wallow").map((item) => item.scale));
    expect(scales.size).toBeGreaterThan(10);
  });
});

describe("cropFieldOvergrowth", () => {
  it("is deterministic, so panning away and back finds the same trees", () => {
    expect(cropFieldOvergrowth()).toEqual(cropFieldOvergrowth());
  });

  it("differs from an ordinary sector's growth", () => {
    expect(cropFieldOvergrowth()).not.toEqual(sectorOvergrowth("wallow"));
  });

  it("stays inside the Crop Fields' own bounds", () => {
    for (const item of cropFieldOvergrowth()) {
      expect(item.x).toBeGreaterThanOrEqual(CROP_FIELD.x);
      expect(item.x).toBeLessThanOrEqual(CROP_FIELD.x + CROP_FIELD.width);
      expect(item.y).toBeGreaterThanOrEqual(CROP_FIELD.y);
      expect(item.y).toBeLessThanOrEqual(CROP_FIELD.y + CROP_FIELD.height);
    }
  });

  it("never grows over a road", () => {
    for (const item of cropFieldOvergrowth()) {
      expect(nearPath(item.x, item.y)).toBe(false);
    }
  });

  it("mixes canopy, scrub and ground cover rather than one repeated tree", () => {
    const kinds = new Set(cropFieldOvergrowth().map((item) => item.kind));
    expect(kinds.size).toBeGreaterThan(4);
  });
});

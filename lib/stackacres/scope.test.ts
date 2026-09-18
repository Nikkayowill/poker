import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS, STACKACRES_STOCK } from "./catalogue";
import { MACHINE_KINDS } from "./machines";
import { buyOptionsForZone } from "./district-panel";
import { ZONE_IDS } from "./zones";
import {
  STACKACRES_ACTIVE_LIVESTOCK,
  STACKACRES_RETIRED_CROPS,
  STACKACRES_WORKSHOP_SHELF_ITEMS,
  isActiveMachine,
  isActiveStock,
} from "./scope";
import { isMachineItem } from "./machine-items";

describe("isActiveStock", () => {
  it("is true for every crop but the Wheat Sheaf, plus hens and cattle this pass", () => {
    expect(STACKACRES_STOCK.filter(isActiveStock).sort()).toEqual(
      [...STACKACRES_CROPS.filter((crop) => crop !== "wheatsheaf"), "cattle", "hen"].sort(),
    );
    expect([...STACKACRES_ACTIVE_LIVESTOCK].sort()).toEqual(["cattle", "hen"]);
  });

  it("shows every crop but the retired Wheat Sheaf, hides the pig pen", () => {
    for (const crop of STACKACRES_CROPS) {
      expect(isActiveStock(crop), crop).toBe(!STACKACRES_RETIRED_CROPS.includes(crop));
    }
    expect(STACKACRES_RETIRED_CROPS).toEqual(["wheatsheaf"]);
    expect(isActiveStock("pig")).toBe(false);
  });
});

describe("isActiveMachine", () => {
  it("keeps the Mill, the Dairy and the three kitchen machines, collapses the Loom and the Vat", () => {
    expect(MACHINE_KINDS.filter(isActiveMachine)).toEqual(["mill", "dairy", "oven", "stew_pot", "counter"]);
  });
});

describe("the Workshop shelf", () => {
  it("lists only real inventory items, the ones the active loop makes", () => {
    expect([...STACKACRES_WORKSHOP_SHELF_ITEMS]).toEqual(["eggs", "milk", "wheat", "flour", "cake", "bread", "stew", "salad"]);
    for (const item of STACKACRES_WORKSHOP_SHELF_ITEMS) expect(isMachineItem(item)).toBe(true);
  });
});

describe("buyOptionsForZone under the active scope", () => {
  it("never offers a hidden stock kind, in any district", () => {
    for (const zone of ZONE_IDS) {
      for (const option of buyOptionsForZone(zone, { units: [], gold: 1_000_000, capacity: {} })) {
        expect(isActiveStock(option.stock), `${zone}/${option.stock}`).toBe(true);
      }
    }
  });

  it("offers hens at Hen Haven, cattle at the Ox Fields, every shelved crop at the Farmstead, and nothing at the Fold", () => {
    const ctx = { units: [], gold: 1_000_000, capacity: {} };
    expect(buyOptionsForZone("henhaven", ctx).map((o) => o.stock)).toEqual(["hen"]);
    expect(buyOptionsForZone("oxfields", ctx).map((o) => o.stock)).toEqual(["cattle"]);
    expect(buyOptionsForZone("farmstead", ctx).map((o) => o.stock).sort()).toEqual(
      STACKACRES_CROPS.filter((crop) => crop !== "wheatsheaf").sort(),
    );
    expect(buyOptionsForZone("wallow", ctx)).toEqual([]);
  });
});

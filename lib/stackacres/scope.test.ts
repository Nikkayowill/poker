import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS, STACKACRES_STOCK } from "./catalogue";
import { MACHINE_KINDS } from "./machines";
import { buyOptionsForZone } from "./district-panel";
import { ZONE_IDS } from "./zones";
import {
  STACKACRES_ACTIVE_LIVESTOCK,
  STACKACRES_WORKSHOP_SHELF_ITEMS,
  isActiveMachine,
  isActiveStock,
} from "./scope";
import { isMachineItem } from "./machine-items";

describe("isActiveStock", () => {
  it("is true for exactly hens and cattle this pass", () => {
    expect(STACKACRES_STOCK.filter(isActiveStock).sort()).toEqual(["cattle", "hen"]);
    expect([...STACKACRES_ACTIVE_LIVESTOCK].sort()).toEqual(["cattle", "hen"]);
  });

  it("hides every crop and the sheep pen", () => {
    for (const crop of STACKACRES_CROPS) expect(isActiveStock(crop), crop).toBe(false);
    expect(isActiveStock("pig")).toBe(false);
  });
});

describe("isActiveMachine", () => {
  it("keeps the Mill and the Dairy, collapses the Loom and the Vat", () => {
    expect(MACHINE_KINDS.filter(isActiveMachine)).toEqual(["mill", "dairy"]);
  });
});

describe("the Workshop shelf", () => {
  it("lists only real inventory items, the ones the active loop makes", () => {
    expect([...STACKACRES_WORKSHOP_SHELF_ITEMS]).toEqual(["eggs", "milk", "wheat", "flour", "cake"]);
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

  it("offers hens at Hen Haven, cattle at the Ox Fields, and nothing at the Farmstead or the Fold", () => {
    const ctx = { units: [], gold: 1_000_000, capacity: {} };
    expect(buyOptionsForZone("henhaven", ctx).map((o) => o.stock)).toEqual(["hen"]);
    expect(buyOptionsForZone("oxfields", ctx).map((o) => o.stock)).toEqual(["cattle"]);
    expect(buyOptionsForZone("farmstead", ctx)).toEqual([]);
    expect(buyOptionsForZone("wallow", ctx)).toEqual([]);
  });
});

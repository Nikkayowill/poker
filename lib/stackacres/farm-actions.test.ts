import { describe, expect, it } from "vitest";
import { intentOf, purchaseCueText } from "./farm-actions";

describe("intentOf: the processing track", () => {
  it("keeps two recipes and two machine kinds apart", () => {
    expect(intentOf({ action: "process", recipe: "cheese" })).toBe("process:cheese");
    expect(intentOf({ action: "process", recipe: "cloth" })).toBe("process:cloth");
    expect(intentOf({ action: "place-machine", kind: "mill" })).toBe("place-machine:mill");
    expect(intentOf({ action: "place-machine", kind: "dairy" })).toBe("place-machine:dairy");
  });

  it("keys a sale on its item and quantity, so selling eggs never blocks selling milk", () => {
    expect(intentOf({ action: "sell", item: "eggs", quantity: 4 })).toBe("sell:eggs:4");
    expect(intentOf({ action: "sell", item: "milk", quantity: 4 })).toBe("sell:milk:4");
    expect(intentOf({ action: "sell", item: "cake", quantity: 1 })).toBe("sell:cake:1");
  });

  it("keys the field-wide passes on the action alone", () => {
    expect(intentOf({ action: "sow-wheat" })).toBe("sow-wheat");
    expect(intentOf({ action: "work" })).toBe("work");
    expect(intentOf({ action: "seal-vat" })).toBe("seal-vat");
    expect(intentOf({ action: "collect-vat" })).toBe("collect-vat");
  });

  it("still keys a pipe on its tile, not on its kind", () => {
    expect(intentOf({ action: "place-pipe", tx: 3, ty: -2, kind: "well" })).toBe("place-pipe:3,-2");
  });

  it("keys an aim on its tile too, never on the direction", () => {
    expect(intentOf({ action: "aim-pipe", tx: 3, ty: -2, facing: 4 })).toBe("aim-pipe:3,-2");
    expect(intentOf({ action: "aim-pipe", tx: 3, ty: -2, facing: 8 })).toBe("aim-pipe:3,-2");
  });
});

describe("purchaseCueText: the instant toast a spend gets", () => {
  it("names the catalogue label for livestock, either way it's bought", () => {
    expect(purchaseCueText({ action: "stock", stock: "hen" })).toBe("Bought a Hen Coop!");
    expect(purchaseCueText({ action: "buy-stock", stock: "hen" })).toBe("Bought a Hen Coop!");
  });

  it("says 'Seeded', not 'Bought', for an open-air crop", () => {
    expect(purchaseCueText({ action: "stock", stock: "corn" })).toBe("Seeded Corn!");
  });

  it("has a cue for every action that spends Gold or shelf stock with no toast of its own", () => {
    expect(purchaseCueText({ action: "expand-capacity", stock: "hen" })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-feed", itemId: "grain", quantity: 1 })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-soil", tier: "enriched", quantity: 1 })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-seed", crop: "corn", quantity: 1 })).toBeTruthy();
    expect(purchaseCueText({ action: "upgrade-tool" })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-cutter", cutter: "mower" })).toBeTruthy();
    expect(purchaseCueText({ action: "unlock-synergy-perk", archetype: "sunlight_harvester" })).toBeTruthy();
    expect(purchaseCueText({ action: "midnight-merchant-buy", itemId: "lucky_horseshoe" })).toBeTruthy();
    expect(purchaseCueText({ action: "clear-sector", sector: "mine" })).toBeTruthy();
    expect(purchaseCueText({ action: "unlock-crop-fields" })).toBeTruthy();
    expect(purchaseCueText({ action: "build-greenhouse" })).toBeTruthy();
    expect(purchaseCueText({ action: "forge-enchantment", itemId: "gilded-tine" })).toBeTruthy();
    expect(purchaseCueText({ action: "deploy-drone" })).toBeTruthy();
  });

  // These five already set their own, more specific toast right at the call
  // site (stackacres-farm.tsx's `onPlaceSoilTile` and its siblings) a beat
  // before `act()` runs -- a second, generic one here would silently
  // overwrite it in the same render. See this function's own header.
  it("stays out of the way of the tile actions' own toasts", () => {
    expect(purchaseCueText({ action: "place-soil-tile", tx: 0, ty: 0 })).toBeNull();
    expect(purchaseCueText({ action: "remove-soil-tile", tx: 0, ty: 0 })).toBeNull();
    expect(purchaseCueText({ action: "move-soil-tile-group", tx: 0, ty: 0, toTx: 1, toTy: 0 })).toBeNull();
    expect(purchaseCueText({ action: "place-pipe", tx: 0, ty: 0, kind: "pipe" })).toBeNull();
    expect(purchaseCueText({ action: "remove-pipe", tx: 0, ty: 0 })).toBeNull();
  });

  it("has no cue for an action that moves no Gold or shelf stock", () => {
    expect(purchaseCueText({ action: "collect" })).toBeNull();
    expect(purchaseCueText({ action: "feed", unitId: "u1" })).toBeNull();
    expect(purchaseCueText({ action: "water", unitId: "u1" })).toBeNull();
    expect(purchaseCueText({ action: "retire", unitId: "u1" })).toBeNull();
  });
});

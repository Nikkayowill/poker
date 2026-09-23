import { describe, expect, it } from "vitest";
import { intentOf, purchaseCueText, unitsBeingCollected } from "./farm-actions";

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
    expect(intentOf({ action: "work" })).toBe("work");
    expect(intentOf({ action: "seal-vat" })).toBe("seal-vat");
    expect(intentOf({ action: "collect-vat" })).toBe("collect-vat");
  });

});

describe("intentOf: farm taps that must not swallow each other", () => {
  it("keeps harvests of two different crops apart", () => {
    expect(intentOf({ action: "collect", unitIds: ["a"] })).not.toBe(intentOf({ action: "collect", unitIds: ["b"] }));
    expect(intentOf({ action: "collect", unitIds: ["b", "a"] })).toBe(intentOf({ action: "collect", unitIds: ["a", "b"] }));
    expect(intentOf({ action: "collect" })).toBe("collect");
  });

  it("keeps sowings of one crop on two beds apart", () => {
    const here = intentOf({ action: "stock", stock: "carrot", tx: 1, ty: 2 });
    const there = intentOf({ action: "stock", stock: "carrot", tx: 3, ty: 2 });
    expect(here).not.toBe(there);
    expect(intentOf({ action: "stock", stock: "carrot", inGreenhouse: true })).not.toBe(intentOf({ action: "stock", stock: "carrot" }));
    expect(intentOf({ action: "stock", stock: "carrot", tiles: [{ tx: 1, ty: 2 }, { tx: 2, ty: 2 }] })).not.toBe(here);
  });

  it("reads back which crops an in-flight harvest already names", () => {
    const intents = [
      intentOf({ action: "collect", unitIds: ["a", "b"] }),
      intentOf({ action: "collect", unitIds: ["c"] }),
      intentOf({ action: "collect" }),
      "collect-vat",
      "water:d",
    ];
    expect([...unitsBeingCollected(intents)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("purchaseCueText: the instant toast a spend gets", () => {
  it("tells a one-cycle stock apart from buying the animal outright", () => {
    expect(purchaseCueText({ action: "stock", stock: "hen" })).toBe("Started a Hen Coop cycle!");
    expect(purchaseCueText({ action: "buy-stock", stock: "hen" })).toBe("Bought a Hen Coop!");
  });

  it("has no toast for sowing a crop", () => {
    expect(purchaseCueText({ action: "stock", stock: "corn" })).toBeNull();
  });

  it("has a cue for every action that spends Gold or shelf stock with no toast of its own", () => {
    expect(purchaseCueText({ action: "expand-capacity", stock: "hen" })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-feed", itemId: "grain", quantity: 1 })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-seed", crop: "corn", quantity: 1 })).toBeTruthy();
    expect(purchaseCueText({ action: "upgrade-tool" })).toBeTruthy();
    expect(purchaseCueText({ action: "buy-cutter", cutter: "mower" })).toBeTruthy();
    expect(purchaseCueText({ action: "unlock-synergy-perk", archetype: "sunlight_harvester" })).toBeTruthy();
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
  });

  it("has no cue for an action that moves no Gold or shelf stock", () => {
    expect(purchaseCueText({ action: "collect" })).toBeNull();
    expect(purchaseCueText({ action: "feed", unitId: "u1" })).toBeNull();
    expect(purchaseCueText({ action: "water", unitId: "u1" })).toBeNull();
    expect(purchaseCueText({ action: "retire", unitId: "u1" })).toBeNull();
  });
});

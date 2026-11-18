import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MACHINE_ITEM_IDS } from "./machine-items";
import {
  TOWN_BUYERS,
  TOWN_BUYER_IDS,
  buyerTakes,
  itemsBoughtBy,
  townBuyerFor,
  townBuyerOfNpc,
  whoBuysLine,
} from "./town-buyers";

/** What the farm builds with and nobody in town buys. */
const KEPT_FOR_BUILDING = ["stone", "iron_ore", "metal"] as const;

describe("town buyers", () => {
  it("gives every sellable item exactly one buyer", () => {
    const sellable = [...new Set(ALL_MACHINE_ITEM_IDS)].filter(
      (item) => !(KEPT_FOR_BUILDING as readonly string[]).includes(item),
    );
    for (const item of sellable) {
      const takers = TOWN_BUYER_IDS.filter((buyer) => buyerTakes(buyer, item));
      expect(takers, item).toEqual([townBuyerFor(item)]);
    }
    const listed = TOWN_BUYER_IDS.flatMap((buyer) => itemsBoughtBy(buyer));
    expect(listed.length).toBe(new Set(listed).size);
    expect(new Set(listed)).toEqual(new Set(sellable));
  });

  it("buys no Stone, Iron Ore or Metal anywhere, so the farm keeps it for building", () => {
    for (const item of KEPT_FOR_BUILDING) {
      expect(townBuyerFor(item), item).toBeNull();
      for (const buyer of TOWN_BUYER_IDS) expect(buyerTakes(buyer, item), `${buyer} ${item}`).toBe(false);
      expect(whoBuysLine(item)).toBe("Nobody in town buys this. Keep it for building.");
    }
    expect(whoBuysLine("wood")).toBe("Iris buys this at the general store in town.");
  });

  it("sends grain to the elevator and eggs, milk and garden crops to the store", () => {
    for (const item of ["wheat", "corn", "flour"] as const) expect(townBuyerFor(item)).toBe("grain-elevator");
    for (const item of ["eggs", "milk", "wool", "lettuce", "tomato", "cake"] as const) {
      expect(townBuyerFor(item)).toBe("general-store");
    }
  });

  it("has the sale barn waiting on animals, so it takes no item yet", () => {
    expect(itemsBoughtBy("sale-barn")).toEqual([]);
  });

  it("is three different people who all stand in the City", () => {
    const city = JSON.parse(
      readFileSync(join(process.cwd(), "public/stackacres-td/areas/city/area.json"), "utf8"),
    ) as { npcs: { name: string }[] };
    const there = new Set(city.npcs.map((npc) => npc.name));
    const npcs = TOWN_BUYER_IDS.map((id) => TOWN_BUYERS[id].npc);
    expect(new Set(npcs).size).toBe(npcs.length);
    for (const npc of npcs) expect(there.has(npc), npc).toBe(true);
    for (const id of TOWN_BUYER_IDS) expect(townBuyerOfNpc(TOWN_BUYERS[id].npc)).toBe(id);
    expect(townBuyerOfNpc("cora")).toBeNull();
  });
});

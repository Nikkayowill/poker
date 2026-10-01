import { describe, expect, it } from "vitest";
import {
  CONTRACT_BOARD_SIZE,
  CONTRACT_EXCLUDED_ITEMS,
  CONTRACT_PREMIUM,
  CONTRACT_REPLACEMENTS_PER_DAY,
  CROSSBREED_CONTRACT_VALUE,
  buildContract,
  canFulfillContract,
  contractItemValue,
  contractKey,
  contractProgress,
  contractQuantityLadder,
  contractReplacementSpent,
  contractSourceHint,
  contractableItems,
  drawBoard,
  drawContract,
  isStackAcresContractStatus,
  parseContractRequirements,
  pinnedContract,
  type ContractFarm,
  type ContractItem,
  type StackAcresContractRow,
} from "./contracts";
import { CROSSBREED_ITEMS } from "./crossbreed-items";
import { ALL_MACHINE_ITEM_IDS, machineItemSellPrice } from "./machine-items";

/** A random source that walks a fixed list, then repeats it. */
function rolls(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const bare: ContractFarm = { machineKinds: [], ownedStocks: [], inventory: {}, hybrids: {} };
const farm = (over: Partial<ContractFarm>): ContractFarm => ({ ...bare, ...over });

const row = (over: Partial<StackAcresContractRow> = {}): StackAcresContractRow => ({
  id: "c1",
  title: "4 Flour for the town",
  requirements: [{ item: "flour", quantity: 4 }],
  goldReward: 83,
  influenceReward: 5,
  status: "open",
  pinned: false,
  createdAt: "2026-09-30T00:00:00.000Z",
  ...over,
});

describe("contractableItems", () => {
  it("offers only Wheat and Wood-free goods to a bare farm: every other seed is locked behind a machine", () => {
    // Wheat seed is always on sale; every other crop waits on a kitchen or a Mill.
    expect(contractableItems(bare)).toEqual(["wheat"]);
  });

  it("opens a crop once the machine that unlocks its seed stands", () => {
    const items = contractableItems(farm({ machineKinds: ["stew_pot"] }));
    expect(items).toEqual(expect.arrayContaining(["potato", "carrot", "onion", "stew"]));
    // Tomato seed wants the Counter as well, so Sauce stays out of reach too.
    expect(items).not.toContain("lettuce");
    expect(items).not.toContain("tomato");
    expect(items).not.toContain("sauce");
    expect(contractableItems(farm({ machineKinds: ["stew_pot", "counter"] }))).toEqual(
      expect.arrayContaining(["tomato", "sauce", "salsa", "lettuce"]),
    );
  });

  it("opens a crop the shelf already holds even with its seed locked", () => {
    expect(contractableItems(farm({ inventory: { lettuce: 2 } }))).toContain("lettuce");
  });

  it("offers produce only for animals the farm keeps, or already holds", () => {
    expect(contractableItems(bare)).not.toContain("eggs");
    expect(contractableItems(farm({ ownedStocks: ["hen"] }))).toContain("eggs");
    expect(contractableItems(farm({ inventory: { milk: 1 } }))).toContain("milk");
  });

  it("holds a machine good back until every input is within reach", () => {
    expect(contractableItems(farm({ machineKinds: ["dairy"] }))).not.toContain("cheese");
    expect(contractableItems(farm({ machineKinds: ["dairy"], ownedStocks: ["cattle"] }))).toContain("cheese");
    expect(contractableItems(farm({ machineKinds: ["loom"], ownedStocks: ["cattle"] }))).not.toContain("cloth");
    expect(contractableItems(farm({ machineKinds: ["loom"], ownedStocks: ["pig"] }))).toContain("cloth");
  });

  it("follows a chain: Cake needs Flour, so a Dairy alone cannot make it, but a Dairy and a Mill can", () => {
    const kept = { ownedStocks: ["hen", "cattle"] as const };
    expect(contractableItems(farm({ ...kept, machineKinds: ["dairy"] }))).not.toContain("cake");
    expect(contractableItems(farm({ ...kept, machineKinds: ["dairy", "mill"] }))).toContain("cake");
  });

  it("asks for Wood, Stone and fish only once some has been brought in", () => {
    expect(contractableItems(bare)).not.toContain("wood");
    const items = contractableItems(farm({ inventory: { wood: 3, stone: 1, trout: 1 } }));
    expect(items).toEqual(expect.arrayContaining(["wood", "stone", "trout"]));
    expect(items).not.toContain("bluegill");
  });

  it("asks for a hybrid only once one is held", () => {
    expect(contractableItems(farm({ machineKinds: ["mill"], ownedStocks: ["corn"] }))).not.toContain("golden_maize");
    expect(contractableItems(farm({ hybrids: { golden_maize: 1 } }))).toContain("golden_maize");
  });

  it("never offers feed, building materials or hunting keepsakes", () => {
    const everything: Record<string, number> = {};
    for (const item of ALL_MACHINE_ITEM_IDS) everything[item] = 5;
    const items = contractableItems(farm({ inventory: everything }));
    for (const excluded of CONTRACT_EXCLUDED_ITEMS) expect(items).not.toContain(excluded);
  });

  it("never lists an item twice", () => {
    const items = contractableItems(farm({ machineKinds: ["mill", "mill", "dairy"], ownedStocks: ["cattle", "cattle"] }));
    expect(new Set(items).size).toBe(items.length);
  });
});

describe("buildContract", () => {
  it("pays a flat premium over the Sell value of every line", () => {
    const order = buildContract([
      { item: "flour", quantity: 4 },
      { item: "eggs", quantity: 4 },
    ]);
    const raw = machineItemSellPrice("flour") * 4 + machineItemSellPrice("eggs") * 4;
    expect(order.goldReward).toBe(Math.round(raw * CONTRACT_PREMIUM));
    expect(order.influenceReward).toBeGreaterThan(0);
  });

  it("values a hybrid off the town's own table, since it has no Sell price", () => {
    for (const item of CROSSBREED_ITEMS) {
      expect(contractItemValue(item)).toBe(CROSSBREED_CONTRACT_VALUE[item]);
      expect(buildContract([{ item, quantity: 1 }]).goldReward).toBe(Math.round(CROSSBREED_CONTRACT_VALUE[item] * CONTRACT_PREMIUM));
    }
  });

  it("titles a one-line order for the town and a two-line order for the market", () => {
    expect(buildContract([{ item: "flour", quantity: 2 }]).title).toBe("2 Flour for the town");
    expect(
      buildContract([
        { item: "eggs", quantity: 4 },
        { item: "cheese", quantity: 2 },
      ]).title,
    ).toBe("Eggs and Cheese for the market");
  });

  it("keys an order on its lines, in any order", () => {
    const a = buildContract([
      { item: "eggs", quantity: 4 },
      { item: "flour", quantity: 2 },
    ]);
    const b = buildContract([
      { item: "flour", quantity: 2 },
      { item: "eggs", quantity: 4 },
    ]);
    expect(a.key).toBe(b.key);
    expect(contractKey(a.requirements)).toBe("eggs:4|flour:2");
  });

  it("refuses an empty, overlong or non-positive order", () => {
    expect(() => buildContract([])).toThrow();
    expect(() =>
      buildContract([
        { item: "eggs", quantity: 1 },
        { item: "milk", quantity: 1 },
        { item: "flour", quantity: 1 },
      ]),
    ).toThrow();
    expect(() => buildContract([{ item: "eggs", quantity: 0 }])).toThrow();
    expect(() => buildContract([{ item: "eggs", quantity: 1.5 }])).toThrow();
  });

  it("pays more the more it asks for, on every ladder", () => {
    const items = contractableItems(farm({ inventory: { wood: 1, stone: 1, bluegill: 1, trout: 1, catfish: 1 }, hybrids: { golden_maize: 1 } }));
    for (const item of items) {
      const ladder = contractQuantityLadder(item);
      for (let i = 1; i < ladder.length; i += 1) {
        expect(buildContract([{ item, quantity: ladder[i] }]).goldReward).toBeGreaterThan(
          buildContract([{ item, quantity: ladder[i - 1] }]).goldReward,
        );
      }
    }
  });
});

describe("drawContract", () => {
  const reachable: ContractItem[] = ["wheat", "flour", "eggs"];

  it("is deterministic under an injected random source", () => {
    expect(drawContract(reachable, [], rolls([0.2, 0.5, 0.9]))).toEqual(drawContract(reachable, [], rolls([0.2, 0.5, 0.9])));
  });

  it("only ever asks for what the farm can make, across the whole roll range", () => {
    for (let roll = 0; roll < 1; roll += 0.01) {
      const order = drawContract(["cheese"], [], () => roll);
      expect(order).not.toBeNull();
      for (const line of order!.requirements) expect(line.item).toBe("cheese");
    }
  });

  it("refuses rather than drawing when the farm can make nothing", () => {
    expect(drawContract([], [], () => 0)).toBeNull();
  });

  it("never draws past the end of a ladder or the item list on a roll near 1", () => {
    const order = drawContract(reachable, [], () => 0.999999);
    expect(order).not.toBeNull();
    for (const line of order!.requirements) expect(reachable).toContain(line.item);
  });

  it("adds a second line only from a different item, at that item's first rung", () => {
    // item roll, ladder roll, second-line roll (under the 0.35 chance), second item roll.
    const order = drawContract(["wheat", "flour"], [], rolls([0, 0, 0.1, 0]));
    expect(order!.requirements).toHaveLength(2);
    expect(order!.requirements[0].item).toBe("wheat");
    expect(order!.requirements[1]).toEqual({ item: "flour", quantity: contractQuantityLadder("flour")[0] });
  });

  it("never draws a second line on a farm with one thing to make", () => {
    for (let roll = 0; roll < 1; roll += 0.01) {
      expect(drawContract(["wheat"], [], () => roll)!.requirements).toHaveLength(1);
    }
  });

  it("skips orders already on the board, and gives up rather than repeating one", () => {
    const first = drawContract(["wheat"], [], () => 0)!;
    const second = drawContract(["wheat"], [first.key], () => 0);
    // Rolling 0 forever lands on the same rung every time, so nothing new can come up.
    expect(second).toBeNull();
    const varied = drawContract(["wheat"], [first.key], rolls([0, 0.99, 0.99]));
    expect(varied).not.toBeNull();
    expect(varied!.key).not.toBe(first.key);
  });
});

describe("drawBoard", () => {
  it("fills every empty slot with a distinct order", () => {
    const random = rolls([0.1, 0.9, 0.7, 0.3, 0.55, 0.2, 0.8, 0.45, 0.05, 0.65, 0.35]);
    const board = drawBoard(["wheat", "flour", "eggs", "cheese"], [], random);
    expect(board).toHaveLength(CONTRACT_BOARD_SIZE);
    expect(new Set(board.map((order) => order.key)).size).toBe(CONTRACT_BOARD_SIZE);
  });

  it("only tops the board up to its size", () => {
    const open = ["wheat:8", "wheat:16", "flour:2"];
    const random = rolls([0.1, 0.9, 0.7, 0.3, 0.55, 0.2, 0.8, 0.45]);
    const board = drawBoard(["wheat", "flour", "eggs"], open, random);
    expect(board).toHaveLength(CONTRACT_BOARD_SIZE - open.length);
    for (const order of board) expect(open).not.toContain(order.key);
  });

  it("stops short when a farm cannot fill a whole board with distinct orders", () => {
    // Only Wheat, only two rungs, and no second line possible: two orders, not four.
    const board = drawBoard(["wheat"], [], rolls([0, 0, 0.99, 0.99, 0.5, 0.5]));
    expect(board.length).toBeLessThanOrEqual(2);
    expect(board.length).toBeGreaterThan(0);
  });

  it("draws nothing for a farm that can make nothing", () => {
    expect(drawBoard([], [], () => 0)).toEqual([]);
  });
});

describe("contractSourceHint", () => {
  it("names where each kind of item comes from", () => {
    expect(contractSourceHint("carrot")).toBe("Grown in a bed from Carrot seed");
    expect(contractSourceHint("eggs")).toBe("Laid by your hens");
    expect(contractSourceHint("flour")).toBe("Made at the Mill from 3 Wheat");
    expect(contractSourceHint("cake")).toBe("Made at the Dairy from 2 Eggs, 1 Milk, 1 Flour");
    expect(contractSourceHint("wood")).toBe("Chopped from the treeline");
    expect(contractSourceHint("catfish")).toContain("pond");
    expect(contractSourceHint("golden_maize")).toBe("Bred at the Crossbreeding Bed: Corn beside Wheat");
  });

  it("has a hint for everything the town can ask for", () => {
    const everything: Record<string, number> = {};
    for (const item of ALL_MACHINE_ITEM_IDS) everything[item] = 1;
    const hybrids: Partial<Record<(typeof CROSSBREED_ITEMS)[number], number>> = {};
    for (const item of CROSSBREED_ITEMS) hybrids[item] = 1;
    for (const item of contractableItems(farm({ inventory: everything, hybrids }))) {
      expect(contractSourceHint(item).length).toBeGreaterThan(0);
    }
  });
});

describe("canFulfillContract", () => {
  it("requires the order still open and every line held in full", () => {
    const order = row({
      requirements: [
        { item: "flour", quantity: 4 },
        { item: "eggs", quantity: 2 },
      ],
    });
    const shelf = (stock: Record<string, number>) => (item: ContractItem) => stock[item] ?? 0;
    expect(canFulfillContract(shelf({ flour: 4, eggs: 2 }), order)).toBe(true);
    expect(canFulfillContract(shelf({ flour: 4, eggs: 1 }), order)).toBe(false);
    expect(canFulfillContract(shelf({ flour: 9, eggs: 9 }), { ...order, status: "fulfilled" })).toBe(false);
  });
});

describe("contractProgress", () => {
  it("is the plain fraction between empty and full, clamped", () => {
    expect(contractProgress(0, 4)).toBe(0);
    expect(contractProgress(1, 4)).toBe(0.25);
    expect(contractProgress(4, 4)).toBe(1);
    expect(contractProgress(9, 4)).toBe(1);
    expect(contractProgress(0, 0)).toBe(1);
  });
});

describe("pinnedContract", () => {
  it("finds the one pinned open order, and nothing when none is", () => {
    const board = [row({ id: "a" }), row({ id: "b", pinned: true }), row({ id: "c", pinned: true, status: "fulfilled" })];
    expect(pinnedContract(board)?.id).toBe("b");
    expect(pinnedContract([row({ id: "a" })])).toBeNull();
  });
});

describe("parseContractRequirements", () => {
  it("reads the lines a row stores", () => {
    expect(parseContractRequirements([{ item: "flour", quantity: "4" }])).toEqual([{ item: "flour", quantity: 4 }]);
  });

  it("throws on an unknown item, a bad count or an empty list rather than guessing", () => {
    expect(() => parseContractRequirements([])).toThrow();
    expect(() => parseContractRequirements([{ item: "gold_bar", quantity: 1 }])).toThrow();
    expect(() => parseContractRequirements([{ item: "flour", quantity: 0 }])).toThrow();
    expect(() => parseContractRequirements("flour")).toThrow();
  });
});

describe("swapping an order out", () => {
  it("is spent for the rest of the day once used, and free again tomorrow", () => {
    expect(contractReplacementSpent(null, "2026-09-30")).toBe(false);
    expect(contractReplacementSpent("2026-09-30", "2026-09-30")).toBe(true);
    expect(contractReplacementSpent("2026-09-29", "2026-09-30")).toBe(false);
  });

  it("allows exactly one a day", () => {
    expect(CONTRACT_REPLACEMENTS_PER_DAY).toBe(1);
  });

  it("recognises the three terminal states and nothing else", () => {
    for (const status of ["open", "fulfilled", "passed"]) expect(isStackAcresContractStatus(status)).toBe(true);
    for (const status of ["cancelled", "PASSED", ""]) expect(isStackAcresContractStatus(status)).toBe(false);
  });
});

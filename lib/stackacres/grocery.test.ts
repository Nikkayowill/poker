import { describe, expect, it } from "vitest";
import room from "@/public/stackacres-td/areas/grocery/area.json";
import { STARTING_CREW, STORE_PEOPLE, STORE_STAFF } from "@/lib/stackacres-td/store-cast";
import { marketLayout, type MarketArea } from "@/lib/stackacres-td/worksite";
import { applicantsFor, hiringFee, hourlyWage, workRate } from "./grocery-crew";
import { GROCERY_ECONOMY, bankTill, freshTill, groceryRates, readTill } from "./grocery-economy";
import {
  DEFAULT_GROCERY_LAYOUT,
  GROCERY_ITEMS,
  GROCERY_ITEM_KINDS,
  GROCERY_SHELL,
  OWNER_SQUARES,
  composeGroceryRoom,
  itemAt,
  itemVariants,
  layoutCapacity,
  layoutProblem,
  withItem,
  type GroceryPlacement,
} from "./grocery-layout";
import { noPostFor } from "./grocery";

const ROOM = room as unknown as { blocked: [number, number][]; zones: { tag: string; x: number; y: number }[] };
const moved = (id: string, tx: number | null, ty: number | null) => {
  const item = DEFAULT_GROCERY_LAYOUT.find((i) => i.id === id)!;
  return withItem(DEFAULT_GROCERY_LAYOUT, { ...item, tx, ty });
};
const added = (kind: GroceryPlacement["kind"], tx: number, ty: number) => withItem(DEFAULT_GROCERY_LAYOUT, { id: "new", kind, tx, ty });

describe("the grocery's floor", () => {
  it("as it comes, blocks exactly the squares the room was built with, and passes its own rules", () => {
    const composed = composeGroceryRoom(GROCERY_SHELL, DEFAULT_GROCERY_LAYOUT);
    const key = ([tx, ty]: [number, number]) => `${tx},${ty}`;
    expect(new Set(composed.blocked.map(key))).toEqual(new Set(ROOM.blocked.map(key)));
    expect(layoutProblem(DEFAULT_GROCERY_LAYOUT)).toBeNull();
  });

  it("keeps every working square the floor plan had, under the shelves' own names", () => {
    const composed = composeGroceryRoom(GROCERY_SHELL, DEFAULT_GROCERY_LAYOUT);
    const at = (z: { x: number; y: number }) => `${z.x},${z.y}`;
    const now = new Set(composed.zones.map(at));
    for (const zone of ROOM.zones) expect(now.has(at(zone)), `${zone.tag} at ${at(zone)}`).toBe(true);
    // Non-shelf squares keep their tags exactly: the simulation reads tills and the produce counter by name.
    const tags = new Set(composed.zones.map((z) => `${z.tag}@${at(z)}`));
    for (const zone of ROOM.zones.filter((z) => !z.tag.startsWith("shelf:"))) expect(tags.has(`${zone.tag}@${at(zone)}`), zone.tag).toBe(true);
  });

  it("gives the simulation four tills, three places at the produce counter, and a way in and out", () => {
    const layout = marketLayout(composeGroceryRoom(GROCERY_SHELL, DEFAULT_GROCERY_LAYOUT) as unknown as MarketArea);
    expect(layout.tills).toHaveLength(4);
    expect(layout.counters).toHaveLength(3);
    expect(layout.entrances.length).toBeGreaterThan(0);
    expect(layout.exits.length).toBeGreaterThan(0);
  });

  it("has a picture for everything that can be bought", () => {
    for (const kind of GROCERY_ITEM_KINDS) expect(itemVariants(kind)[0].length, kind).toBeGreaterThan(0);
  });

  it("keeps the desk and the Help Wanted board walkable to", () => {
    const blocked = new Set(GROCERY_SHELL.blocked.map(([tx, ty]) => `${tx},${ty}`));
    for (const c of [...OWNER_SQUARES.desk, ...OWNER_SQUARES.board]) expect(blocked.has(`${c.tx},${c.ty}`)).toBe(false);
    expect(GROCERY_SHELL.props.some((p) => p.tag === "desk")).toBe(true);
    expect(GROCERY_SHELL.props.some((p) => p.tag === "jobboard")).toBe(true);
  });

  it("refuses a shelf on top of another fixture or a square people shop from", () => {
    expect(added("fern", 2, 13)).toSatisfy((layout: GroceryPlacement[]) => layoutProblem(layout) === "taken");
    // On the first aisle's browsing row.
    expect(layoutProblem(added("fern", 4, 8))).toBe("taken");
  });

  it("refuses to wall shoppers off from a shelf", () => {
    // Fern boxes across both ends of the aisle between the two runs of shelving.
    let layout = DEFAULT_GROCERY_LAYOUT as GroceryPlacement[];
    layout = withItem(layout, { id: "a", kind: "fern", tx: 1, ty: 8 });
    layout = withItem(layout, { id: "b", kind: "fern", tx: 1, ty: 9 });
    layout = withItem(layout, { id: "c", kind: "fern", tx: 10, ty: 8 });
    layout = withItem(layout, { id: "d", kind: "fern", tx: 10, ty: 9 });
    expect(layoutProblem(layout)).toBe("path");
  });

  it("keeps the doorway and the desk clear", () => {
    expect(layoutProblem(added("fern", 13, 15))).toBe("door");
    expect(layoutProblem(added("fern", 21, 16))).toBe("door");
  });

  it("puts wall shelving only against the back wall", () => {
    expect(layoutProblem(moved("wallshelf-1", 5, 5))).toBe("wall");
  });

  it("leaves room below a checkout lane to walk out", () => {
    // A fern where the first lane's shoppers step out.
    expect(layoutProblem(added("fern", 1, 15))).toBe("lane");
  });

  it("never stores the last till, and counts what can be bought", () => {
    let layout = DEFAULT_GROCERY_LAYOUT as GroceryPlacement[];
    for (const id of ["lane-2", "lane-3", "lane-4"]) layout = withItem(layout, { ...layout.find((i) => i.id === id)!, tx: null, ty: null });
    expect(layoutProblem(layout)).toBeNull();
    expect(layoutProblem(withItem(layout, { id: "lane-1", kind: "lane", tx: null, ty: null }))).toBe("last-till");
    expect(layoutProblem(withItem(DEFAULT_GROCERY_LAYOUT, { id: "p2", kind: "produce", tx: null, ty: null }))).toBe("max");
  });

  it("lets a rug go under things, but not over another rug", () => {
    expect(layoutProblem(added("rug-small", 2, 12))).toBeNull();
    expect(layoutProblem(added("rug-small", 15, 8))).toBe("taken");
  });

  it("finds the thing under a tap, standing things before rugs", () => {
    expect(itemAt(DEFAULT_GROCERY_LAYOUT, { tx: 16, ty: 7 })?.kind).toBe("produce");
    expect(itemAt(DEFAULT_GROCERY_LAYOUT, { tx: 14, ty: 8 })?.kind).toBe("rug-large");
  });
});

describe("hiring", () => {
  it("shows four people a day who aren't on the staff, the same all day, different another day", () => {
    const today = applicantsFor("p1", "2026-09-30", STARTING_CREW);
    expect(today).toHaveLength(4);
    expect(today.some((p) => STARTING_CREW.includes(p.name))).toBe(false);
    expect(applicantsFor("p1", "2026-09-30", STARTING_CREW)).toEqual(today);
    const week = new Set(["2026-10-01", "2026-10-02", "2026-10-03"].map((day) => applicantsFor("p1", day, STARTING_CREW).map((p) => p.name).join()));
    expect(week.size).toBeGreaterThan(1);
  });

  it("keeps the rest of the board where it was when someone is hired off it", () => {
    const before = applicantsFor("p1", "2026-09-30", STARTING_CREW).map((p) => p.name);
    const after = applicantsFor("p1", "2026-09-30", [...STARTING_CREW, before[1]]).map((p) => p.name);
    expect(after.slice(0, 3)).toEqual([before[0], before[2], before[3]]);
    expect(after).toHaveLength(4);
    expect(after).not.toContain(before[1]);
  });

  it("asks more of the quicker, steadier worker, and charges a fee on top", () => {
    for (const person of STORE_PEOPLE) {
      expect(hourlyWage(person)).toBeGreaterThanOrEqual(6);
      expect(hiringFee(person)).toBe(hourlyWage(person) * 20);
    }
    const ravi = STORE_PEOPLE.find((p) => p.name === "ravi")!;
    const lucia = STORE_PEOPLE.find((p) => p.name === "lucia")!;
    expect(workRate(ravi)).toBeGreaterThan(workRate(lucia));
    expect(hourlyWage(ravi)).toBeGreaterThan(hourlyWage(lucia));
  });

  it("won't take on a cashier with no till for them", () => {
    const ravi = STORE_PEOPLE.find((p) => p.name === "ravi")!;
    const staff = STORE_STAFF.map((s) => s.name);
    expect(noPostFor(ravi, { staff, layout: DEFAULT_GROCERY_LAYOUT })).toMatch(/checkout lane/);
    expect(noPostFor(ravi, { staff: [...STARTING_CREW], layout: DEFAULT_GROCERY_LAYOUT })).toBeNull();
  });
});

describe("what the store earns", () => {
  const capacity = layoutCapacity(DEFAULT_GROCERY_LAYOUT);

  it("sells more as the crew fills out, and a full crew serves nearly everyone", () => {
    const start = groceryRates(STARTING_CREW, capacity);
    const full = groceryRates(STORE_STAFF.map((s) => s.name), capacity);
    expect(full.soldPerHour).toBeGreaterThan(start.soldPerHour * 1.8);
    expect(full.service).toBeGreaterThan(0.95);
    expect(start.holdUp).not.toBeNull();
    expect(full.netPerHour).toBeGreaterThan(start.netPerHour);
    expect(start.netPerHour).toBeGreaterThan(0);
  });

  it("sells nothing without a cashier, and still pays whoever's hired", () => {
    const rates = groceryRates(["rosa", "dale"], capacity);
    expect(rates.soldPerHour).toBe(0);
    expect(rates.wagesPerHour).toBeGreaterThan(0);
    expect(rates.holdUp).toBe("hire-cashier");
  });

  it("brings in more shoppers with decor, up to a limit", () => {
    const plain = groceryRates(STORE_STAFF.map((s) => s.name), capacity);
    const dressed = groceryRates(STORE_STAFF.map((s) => s.name), { ...capacity, appeal: 10_000 });
    expect(dressed.appealBonus).toBe(GROCERY_ECONOMY.appealMax);
    expect(dressed.demandPerHour).toBeGreaterThan(plain.demandPerHour);
  });

  it("points at what's holding the shop back", () => {
    // Two cashiers, three produce clerks and two stockers: the tills can't keep up, and there's a free till.
    const rates = groceryRates(["june", "omar", "rosa", "ines", "kofi", "dale", "cole"], capacity);
    expect(rates.holdUp).toBe("hire-cashier");
  });

  it("fills the till by the hour, holds a day, and banks at the old rate", () => {
    const t0 = new Date("2026-09-30T00:00:00Z");
    const rates = { takingsPerHour: 100, wagesPerHour: 40 };
    const till = freshTill(t0);
    expect(readTill(till, rates, new Date(t0.getTime() + 2 * 3_600_000)).pay).toBe(120);
    const later = readTill(till, rates, new Date(t0.getTime() + 40 * 3_600_000));
    expect(later.full).toBe(true);
    expect(later.pay).toBe(60 * GROCERY_ECONOMY.tillHoldsHours);
    const banked = bankTill(till, rates, new Date(t0.getTime() + 3_600_000));
    expect(readTill(banked, { takingsPerHour: 0, wagesPerHour: 0 }, new Date(t0.getTime() + 5 * 3_600_000)).pay).toBe(60);
  });

  it("never pays below nothing", () => {
    const t0 = new Date("2026-09-30T00:00:00Z");
    expect(readTill(freshTill(t0), { takingsPerHour: 10, wagesPerHour: 50 }, new Date(t0.getTime() + 3_600_000)).pay).toBe(0);
  });

  it("prices every item", () => {
    for (const kind of GROCERY_ITEM_KINDS) expect(GROCERY_ITEMS[kind].gold, kind).toBeGreaterThan(0);
  });
});

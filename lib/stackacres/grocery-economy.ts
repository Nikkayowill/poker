/**
 * What the city grocery earns and what it pays out, per real hour, and the till that holds it.
 *
 * WHERE GOLD ENTERS: the takings, collected from the till at the manager's desk. WHERE IT LEAVES: wages, taken
 * off the top of those takings when they're collected, never from the wallet, and never below nothing (the
 * same shape as Land Maintenance, lib/stackacres/upkeep.ts). Hiring fees and fixtures are paid from the wallet
 * when bought (lib/server/stackacres-service.ts).
 *
 * The store runs whether or not anyone is there. Nothing ticks: the till is worked out from the time since it
 * was last emptied, at the rate the store has now, and a change of staff or layout banks what was earned at the
 * old rate first. The till holds a day's takings (the farm's offline limit, docs/stackacres-direction.md §21);
 * after that the shop waits to be emptied, and the staff aren't paid for the wait either.
 *
 * The rate is a plain model of the store simulation (lib/stackacres-td/worksite.ts), tuned so the two agree on
 * which crew sells more: shoppers come in for what the shelves and produce tables hold (more with a nicer
 * shop), the produce clerks and stockers get it to them, and the cashiers ring it up. A shop that turns people
 * away gets fewer of them. The simulation is the picture of it; the money comes from here.
 */

import { staffAtPosts, storePerson } from "@/lib/stackacres-td/store-cast";
import type { Job } from "@/lib/stackacres-td/work-board";
import { hourlyWage, workRate } from "./grocery-crew";
import type { GroceryCapacity } from "./grocery-layout";

// A first pass for the economy tuning to revisit (docs/stackacres-second-map-direction.md).
export const GROCERY_ECONOMY = {
  /** What the store keeps from each thing sold, in Gold. */
  goldPerItem: 4,
  /** Things an hour shoppers come in wanting, for each square of shelf they browse from. */
  shelfDemandPerSpot: 0.6,
  /** And for each square of produce on the market tables. */
  produceDemandPerSpot: 4.2,
  /** Things an hour an ordinary worker gets through, by job. */
  perWorker: { cashier: 22, produce: 14, stocker: 20 } satisfies Record<Job, number>,
  /** The share of shoppers who stay away from a shop that let them down. */
  wordOfMouth: 0.3,
  /** Appeal points for each extra 1% of shoppers, and the most decor can add. */
  appealPerPercent: 4,
  appealMax: 0.5,
  /** The till holds this many hours of takings. */
  tillHoldsHours: 24,
} as const;

/** What's holding the shop back most, as the next thing to do about it. */
export type HoldUp = "hire-cashier" | "add-lane" | "hire-produce" | "add-produce" | "hire-stocker" | "add-shelves";

export interface GroceryRates {
  /** Things an hour shoppers come in wanting, and how many of them the shop gets to them. */
  demandPerHour: number;
  soldPerHour: number;
  takingsPerHour: number;
  wagesPerHour: number;
  /** Takings less wages; below nothing when the crew costs more than it sells. */
  netPerHour: number;
  /** The share of what shoppers wanted that they got, 0 to 1. */
  service: number;
  /** The share decor adds to the shoppers who come in, 0 to `appealMax`. */
  appealBonus: number;
  holdUp: HoldUp | null;
  /** Hired, but with no till or place at the counter to work. They're still paid. */
  idle: string[];
}

export function groceryRates(staff: readonly string[], capacity: GroceryCapacity): GroceryRates {
  const E = GROCERY_ECONOMY;
  const working = staffAtPosts(staff, capacity.tills, capacity.counters);
  const onDuty = new Set(working.map((w) => w.name));
  const capacityOf = (job: Job) =>
    working.filter((w) => w.job === job).reduce((sum, w) => sum + E.perWorker[job] * workRate(w), 0);
  const tills = capacityOf("cashier");
  const produce = capacityOf("produce");
  const stock = capacityOf("stocker");
  const count = (job: Job) => working.filter((w) => w.job === job).length;

  const appealBonus = Math.min(E.appealMax, capacity.appeal / E.appealPerPercent / 100);
  const baseShelf = E.shelfDemandPerSpot * capacity.shelfSpots * (1 + appealBonus);
  const baseProduce = (capacity.counters > 0 ? E.produceDemandPerSpot * capacity.produceSpots : 0) * (1 + appealBonus);

  // Word gets round: a shop that lets people down sees fewer of them, which lets it serve the rest better.
  let service = 1;
  let shelf = baseShelf;
  let fresh = baseProduce;
  let sold = 0;
  for (let i = 0; i < 12; i++) {
    const draw = 1 - E.wordOfMouth + E.wordOfMouth * service;
    shelf = baseShelf * draw;
    fresh = baseProduce * draw;
    sold = Math.min(Math.min(fresh, produce) + Math.min(shelf, stock), tills);
    const demand = shelf + fresh;
    service = demand > 0 ? sold / demand : 0;
  }
  const demandPerHour = shelf + fresh;

  const short = {
    tills: Math.max(0, Math.min(fresh, produce) + Math.min(shelf, stock) - tills),
    produce: Math.max(0, fresh - produce),
    shelves: Math.max(0, shelf - stock),
  };
  let holdUp: HoldUp | null = null;
  const worst = Math.max(short.tills, short.produce, short.shelves);
  if (worst >= 1) {
    if (worst === short.tills) holdUp = count("cashier") < capacity.tills ? "hire-cashier" : "add-lane";
    else if (worst === short.produce) holdUp = count("produce") < capacity.counters ? "hire-produce" : "add-produce";
    else holdUp = count("stocker") < 3 ? "hire-stocker" : "add-shelves";
  }
  if (capacity.counters === 0 && holdUp === null) holdUp = "add-produce";

  const wagesPerHour = staff.reduce((sum, name) => {
    const person = storePerson(name);
    return sum + (person ? hourlyWage(person) : 0);
  }, 0);
  const takingsPerHour = sold * E.goldPerItem;
  return {
    demandPerHour,
    soldPerHour: sold,
    takingsPerHour,
    wagesPerHour,
    netPerHour: takingsPerHour - wagesPerHour,
    service,
    appealBonus,
    holdUp,
    idle: staff.filter((name) => storePerson(name) && !onDuty.has(name)),
  };
}

export const HOLD_UP_ADVICE: Readonly<Record<HoldUp, string>> = {
  "hire-cashier": "Shoppers are queueing at the tills. Hire a cashier.",
  "add-lane": "Every till is busy. Add a checkout lane, then hire a cashier for it.",
  "hire-produce": "The produce counter can't keep up. Hire a produce clerk.",
  "add-produce": "There's no produce island, so nobody can buy fruit and veg.",
  "hire-stocker": "Shelves are running empty. Hire a stocker.",
  "add-shelves": "The stockers can't keep up. More shelves won't help until they can.",
};

/** The till: what it had banked when the rate last changed, and when it was last emptied. */
export interface GroceryTill {
  takings: number;
  wages: number;
  /** When the banked amounts were worked out (ISO). */
  since: string;
  /** When the till was last emptied, or the shop taken over (ISO). It fills for a day from here. */
  openedAt: string;
}

export interface TillReading {
  takings: number;
  wages: number;
  /** What emptying it now pays: takings less wages, whole Gold, never below nothing. */
  pay: number;
  full: boolean;
  /** When it fills (ISO). */
  fullAt: string;
}

const HOUR_MS = 3_600_000;

export function readTill(till: GroceryTill, rates: Pick<GroceryRates, "takingsPerHour" | "wagesPerHour">, now: Date): TillReading {
  const fullAt = Date.parse(till.openedAt) + GROCERY_ECONOMY.tillHoldsHours * HOUR_MS;
  const until = Math.min(now.getTime(), fullAt);
  const hours = Math.max(0, until - Date.parse(till.since)) / HOUR_MS;
  const takings = till.takings + rates.takingsPerHour * hours;
  const wages = till.wages + rates.wagesPerHour * hours;
  return { takings, wages, pay: Math.max(0, Math.floor(takings - wages)), full: now.getTime() >= fullAt, fullAt: new Date(fullAt).toISOString() };
}

/** The till with what it's earned so far banked, ready for the rate to change. */
export function bankTill(till: GroceryTill, rates: Pick<GroceryRates, "takingsPerHour" | "wagesPerHour">, now: Date): GroceryTill {
  const { takings, wages } = readTill(till, rates, now);
  return { ...till, takings, wages, since: now.toISOString() };
}

/** An empty till, filling from now. */
export function freshTill(now: Date): GroceryTill {
  return { takings: 0, wages: 0, since: now.toISOString(), openedAt: now.toISOString() };
}

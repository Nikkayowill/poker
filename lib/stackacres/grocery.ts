/**
 * The city grocery as the owner sees it: who works there, what stands where, today's applicants, and the till.
 * Built by the server from the saved store (lib/server/stackacres-grocery-store.ts) and read by the store's
 * sheets and the scene.
 *
 * The purchase story (deliveries for the manager, then buying the store from them) isn't built yet, so for
 * now the store is taken over for free, and only in development (docs/stackacres-second-map-direction.md).
 */

import { MAX_STOCKERS, STARTING_CREW, storePerson, type StorePerson } from "@/lib/stackacres-td/store-cast";
import { applicantsFor } from "./grocery-crew";
import { freshTill, groceryRates, type GroceryRates, type GroceryTill } from "./grocery-economy";
import { DEFAULT_GROCERY_LAYOUT, layoutCapacity, type GroceryPlacement } from "./grocery-layout";

/** Owning the grocery is development-only until the purchase story exists. */
export function groceryOwnershipEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** The store as it's saved. */
export interface GroceryState {
  staff: string[];
  layout: GroceryPlacement[];
  till: GroceryTill;
  /** Everything ever collected from the till, in Gold. */
  collected: number;
  version: number;
}

export interface GroceryView {
  owned: boolean;
  staff: string[];
  layout: GroceryPlacement[];
  /** Today's Help Wanted board, by name. */
  applicants: string[];
  rates: GroceryRates;
  till: GroceryTill;
  collected: number;
  version: number;
}

/** The store a new owner takes over: the floor plan it was built with, and its crew of four. */
export function newGroceryState(now: Date): Omit<GroceryState, "version"> {
  return {
    staff: [...STARTING_CREW],
    layout: DEFAULT_GROCERY_LAYOUT.map((item) => ({ ...item })),
    till: freshTill(now),
    collected: 0,
  };
}

export function groceryView(state: GroceryState | null, profileId: string, now: Date): GroceryView {
  const shown = state ?? { ...newGroceryState(now), version: 0 };
  return {
    owned: state !== null,
    staff: shown.staff,
    layout: shown.layout,
    applicants: applicantsFor(profileId, now.toISOString().slice(0, 10), shown.staff).map((person) => person.name),
    rates: groceryRates(shown.staff, layoutCapacity(shown.layout)),
    till: shown.till,
    collected: shown.collected,
    version: shown.version,
  };
}

/** Why `person` couldn't start at a store staffed and laid out like this, or null when they could. */
export function noPostFor(person: StorePerson, state: { staff: readonly string[]; layout: readonly GroceryPlacement[] }): string | null {
  const capacity = layoutCapacity(state.layout);
  const alike = state.staff.filter((name) => storePerson(name)?.job === person.job).length;
  if (person.job === "cashier" && alike >= capacity.tills) return "Every till has a cashier. Add a checkout lane first.";
  if (person.job === "produce" && alike >= capacity.counters) {
    return capacity.counters === 0 ? "There's no produce island to work." : "Every place at the produce counter is taken.";
  }
  if (person.job === "stocker" && alike >= MAX_STOCKERS) return `The stockroom has room for ${MAX_STOCKERS} stockers.`;
  return null;
}

/**
 * Who works at the grocery and who shops there. Each name is also their character sheet
 * (public/stackacres-td/characters/<name>.png, built by art/stackacres-td/lpc/cast.py).
 *
 * Staff wear the store's colours so a player can tell them from shoppers at a glance: a forest-green
 * apron over a white shirt for the cashiers, the same apron with a straw cap for the produce clerks, who
 * work the market floor, and green overalls with a cap for the stockers, who carry the crates. Each is
 * their own person underneath (face, hair, build), and has a name.
 *
 * `STORE_PEOPLE` is everyone who works there or wants to. The store comes with a crew of four
 * (`STARTING_CREW`); the rest turn up on the Help Wanted board (lib/stackacres/grocery-crew.ts). It takes
 * nine to run the shop through a lunch or dinner rush: a cashier on each of the four lanes, a clerk at each
 * of the three places at the produce counter, and two stockers to keep up with the shelves (`STORE_STAFF`).
 *
 * Thirty shoppers, so a full shop at the height of a rush (thirty-odd people) is nearly all different faces.
 */

import type { Job } from "./work-board";
import type { WorkerProfile } from "./work-crew";
import type { Post } from "./worksite";

export interface StorePerson {
  name: string;
  /** How they're introduced: first name and what they do. */
  label: string;
  job: Job;
  profile: WorkerProfile;
}

export interface StaffMember extends StorePerson {
  post: Post;
}

export const STORE_PEOPLE: readonly StorePerson[] = [
  { name: "june", label: "June, cashier", job: "cashier", profile: { walk: 1, hands: 0.9, endurance: 140_000, traits: ["steady"] } },
  { name: "omar", label: "Omar, cashier", job: "cashier", profile: { walk: 1, hands: 1, endurance: 110_000, traits: ["brisk"] } },
  { name: "nell", label: "Nell, cashier", job: "cashier", profile: { walk: 0.9, hands: 1, endurance: 120_000, traits: [] } },
  { name: "theo", label: "Theo, cashier", job: "cashier", profile: { walk: 1.05, hands: 1.05, endurance: 115_000, traits: [] } },
  { name: "ravi", label: "Ravi, cashier", job: "cashier", profile: { walk: 1, hands: 0.85, endurance: 100_000, traits: ["brisk"] } },
  { name: "noor", label: "Noor, cashier", job: "cashier", profile: { walk: 1, hands: 1, endurance: 160_000, traits: ["steady"] } },
  { name: "lucia", label: "Lucia, cashier", job: "cashier", profile: { walk: 1, hands: 1.15, endurance: 120_000, traits: [] } },
  { name: "rosa", label: "Rosa, produce", job: "produce", profile: { walk: 0.95, hands: 1, endurance: 120_000, traits: [] } },
  { name: "ines", label: "Ines, produce", job: "produce", profile: { walk: 1, hands: 0.95, endurance: 140_000, traits: ["steady"] } },
  { name: "kofi", label: "Kofi, produce", job: "produce", profile: { walk: 1, hands: 1.1, endurance: 110_000, traits: [] } },
  { name: "sade", label: "Sade, produce", job: "produce", profile: { walk: 0.9, hands: 0.95, endurance: 130_000, traits: [] } },
  { name: "otto", label: "Otto, produce", job: "produce", profile: { walk: 1.2, hands: 1, endurance: 150_000, traits: ["dawdler"] } },
  { name: "dale", label: "Dale, stock", job: "stocker", profile: { walk: 1.1, hands: 1, endurance: 150_000, traits: ["overworker"] } },
  { name: "cole", label: "Cole, stock", job: "stocker", profile: { walk: 1, hands: 1, endurance: 130_000, traits: [] } },
  { name: "wren", label: "Wren, stock", job: "stocker", profile: { walk: 0.9, hands: 0.9, endurance: 120_000, traits: ["overworker"] } },
  { name: "zeke", label: "Zeke, stock", job: "stocker", profile: { walk: 1.05, hands: 1.1, endurance: 100_000, traits: [] } },
];

const BY_NAME = new Map(STORE_PEOPLE.map((person) => [person.name, person]));

export function storePerson(name: string): StorePerson | undefined {
  return BY_NAME.get(name);
}

/** The crew the store comes with: two cashiers, a produce clerk and a stocker. */
export const STARTING_CREW: readonly string[] = ["june", "omar", "rosa", "dale"];

/** Most stockers the stockroom has room to wait by. */
export const MAX_STOCKERS = 3;

/**
 * Where each of `names` works in a store with this many tills and places at the produce counter: cashiers
 * take the tills in order, produce clerks the places at the counter, stockers wait by the stockroom. Anyone
 * without a post (more cashiers than tills) is left off, in the order given.
 */
export function staffAtPosts(names: readonly string[], tills: number, counters: number): StaffMember[] {
  const out: StaffMember[] = [];
  let till = 0;
  let counter = 0;
  let stockers = 0;
  for (const name of names) {
    const person = BY_NAME.get(name);
    if (!person) continue;
    if (person.job === "cashier" && till < tills) out.push({ ...person, post: { at: "till", till: till++ } });
    else if (person.job === "produce" && counter < counters) out.push({ ...person, post: { at: "produce", counter: counter++ } });
    else if (person.job === "stocker" && stockers < MAX_STOCKERS) {
      stockers++;
      out.push({ ...person, post: { at: "stockroom" } });
    }
  }
  return out;
}

/** The full rush crew the grocery was tuned with. */
export const STORE_STAFF: readonly StaffMember[] = staffAtPosts(["june", "omar", "nell", "theo", "rosa", "ines", "kofi", "dale", "cole"], 4, 3);

/** The townsfolk who come in to shop, in their own clothes. */
export const STORE_SHOPPERS: readonly string[] = [
  "mabel", "priya", "gus", "hank", "lena", "tomas", "ada", "bruno", "cora", "dev", "elsie", "felix", "gemma", "hugo", "iris",
  "jonah", "kiko", "luis", "maya", "ned", "olive", "pablo", "quinn", "rhea", "sam", "tilly", "uma", "vince", "winnie", "yusuf",
];

export const STAFF_SPRITES: readonly string[] = STORE_PEOPLE.map((s) => s.name);

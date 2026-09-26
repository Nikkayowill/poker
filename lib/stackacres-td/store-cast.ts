/**
 * Who works at the grocery and who shops there. Each name is also their character sheet
 * (public/stackacres-td/characters/<name>.png, built by art/stackacres-td/lpc/cast.py).
 *
 * Staff wear the store's colours so a player can tell them from shoppers at a glance: a forest-green
 * apron over a white shirt for the cashiers, the same apron with a straw cap for the produce clerks, who
 * work the market floor, and green overalls with a cap for the stockers, who carry the crates. Each is
 * their own person underneath (face, hair, build), and has a name. It takes this many to run the shop
 * through a lunch or dinner rush: a cashier on each of the four lanes, a clerk at each of the three places
 * at the produce counter, and two stockers to keep up with the shelves.
 *
 * Thirty shoppers, so a full shop at the height of a rush (thirty-odd people) is nearly all different faces.
 */

import type { Job } from "./work-board";
import type { WorkerProfile } from "./work-crew";
import type { Post } from "./worksite";

export interface StaffMember {
  name: string;
  /** How they're introduced: first name and what they do. */
  label: string;
  job: Job;
  post: Post;
  profile: WorkerProfile;
}

export const STORE_STAFF: readonly StaffMember[] = [
  { name: "june", label: "June, cashier", job: "cashier", post: { at: "till", till: 0 }, profile: { walk: 1, hands: 0.9, endurance: 140_000, traits: ["steady"] } },
  { name: "omar", label: "Omar, cashier", job: "cashier", post: { at: "till", till: 1 }, profile: { walk: 1, hands: 1, endurance: 110_000, traits: ["brisk"] } },
  { name: "nell", label: "Nell, cashier", job: "cashier", post: { at: "till", till: 2 }, profile: { walk: 0.9, hands: 1, endurance: 120_000, traits: [] } },
  { name: "theo", label: "Theo, cashier", job: "cashier", post: { at: "till", till: 3 }, profile: { walk: 1.05, hands: 1.05, endurance: 115_000, traits: [] } },
  { name: "rosa", label: "Rosa, produce", job: "produce", post: { at: "produce", counter: 0 }, profile: { walk: 0.95, hands: 1, endurance: 120_000, traits: [] } },
  { name: "ines", label: "Ines, produce", job: "produce", post: { at: "produce", counter: 1 }, profile: { walk: 1, hands: 0.95, endurance: 140_000, traits: ["steady"] } },
  { name: "kofi", label: "Kofi, produce", job: "produce", post: { at: "produce", counter: 2 }, profile: { walk: 1, hands: 1.1, endurance: 110_000, traits: [] } },
  { name: "dale", label: "Dale, stock", job: "stocker", post: { at: "stockroom" }, profile: { walk: 1.1, hands: 1, endurance: 150_000, traits: ["overworker"] } },
  { name: "cole", label: "Cole, stock", job: "stocker", post: { at: "stockroom" }, profile: { walk: 1, hands: 1, endurance: 130_000, traits: [] } },
];

/** The townsfolk who come in to shop, in their own clothes. */
export const STORE_SHOPPERS: readonly string[] = [
  "mabel", "priya", "gus", "hank", "lena", "tomas", "ada", "bruno", "cora", "dev", "elsie", "felix", "gemma", "hugo", "iris",
  "jonah", "kiko", "luis", "maya", "ned", "olive", "pablo", "quinn", "rhea", "sam", "tilly", "uma", "vince", "winnie", "yusuf",
];

export const STAFF_SPRITES: readonly string[] = STORE_STAFF.map((s) => s.name);

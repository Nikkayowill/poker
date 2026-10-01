/**
 * Who works the barnyard (barnsite.ts). Each name is also their character sheet, built by
 * art/stackacres-td/lpc/cast.py in farm work clothes: overalls, work shirts, kerchiefs and caps.
 *
 * Four stock hands do the feeding, watering and mucking out, three in the dairy milk the cows and bring in
 * the eggs, three in the field keep the wheat and corn coming that the feed store runs on, and two in the
 * stable see to the horses and keep their paddock. A farm starts with one of each (`BARN_STARTING_CREW`) and can get by, just,
 * until the troughs run ahead of one pair of hands.
 */

import type { FarmJob } from "./work-board";
import type { WorkerProfile } from "./work-crew";

export interface FarmHand {
  name: string;
  /** How they're introduced: first name and what they do. */
  label: string;
  job: FarmJob;
  profile: WorkerProfile;
}

export const BARN_CREW: readonly FarmHand[] = [
  { name: "abe", label: "Abe, stock hand", job: "hand", profile: { walk: 1.05, hands: 0.9, endurance: 150_000, traits: ["steady"] } },
  { name: "jed", label: "Jed, stock hand", job: "hand", profile: { walk: 0.9, hands: 1, endurance: 110_000, traits: ["brisk"] } },
  { name: "rufus", label: "Rufus, stock hand", job: "hand", profile: { walk: 1.15, hands: 0.95, endurance: 180_000, traits: [] } },
  { name: "silas", label: "Silas, stock hand", job: "hand", profile: { walk: 1, hands: 1.05, endurance: 130_000, traits: ["steady"] } },
  { name: "hattie", label: "Hattie, dairy", job: "dairy", profile: { walk: 1, hands: 0.85, endurance: 140_000, traits: ["steady"] } },
  { name: "etta", label: "Etta, dairy", job: "dairy", profile: { walk: 1, hands: 1, endurance: 120_000, traits: [] } },
  { name: "nora", label: "Nora, dairy", job: "dairy", profile: { walk: 0.95, hands: 0.9, endurance: 115_000, traits: ["brisk"] } },
  { name: "clem", label: "Clem, field hand", job: "field", profile: { walk: 1, hands: 1, endurance: 130_000, traits: ["overworker"] } },
  { name: "wyatt", label: "Wyatt, field hand", job: "field", profile: { walk: 1.1, hands: 1.05, endurance: 120_000, traits: ["dawdler"] } },
  // A teenager: quick on his feet, still learning the work, and done in sooner than the grown hands.
  { name: "cal", label: "Cal, field hand", job: "field", profile: { walk: 0.8, hands: 1.1, endurance: 85_000, traits: [] } },
  { name: "ruby", label: "Ruby, stable hand", job: "stable", profile: { walk: 0.95, hands: 0.9, endurance: 140_000, traits: ["steady"] } },
  { name: "amos", label: "Amos, stable hand", job: "stable", profile: { walk: 1.1, hands: 1, endurance: 160_000, traits: [] } },
];

export const BARN_STARTING_CREW: readonly string[] = ["abe", "hattie", "clem", "ruby"];

export function farmHand(name: string): FarmHand | undefined {
  return BARN_CREW.find((h) => h.name === name);
}

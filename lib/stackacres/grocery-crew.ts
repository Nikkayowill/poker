/**
 * Hiring at the city grocery: what each person asks to be paid, what taking them on costs, how they rate,
 * and who is on the Help Wanted board today.
 *
 * Money here is a price list only. The server charges the hiring fee (lib/server/stackacres-service.ts) and
 * takes wages off the takings when they're collected (./grocery-economy.ts), never from the wallet.
 *
 * The board shows four people a day who aren't on the staff, drawn from everyone who works there or wants to
 * (lib/stackacres-td/store-cast.ts). The draw is seeded by the player and the UTC day, so the server and the
 * browser agree on it without storing anything, and a new day brings new faces.
 */

import { hashString, mulberry32 } from "@/lib/seeded-random";
import type { Job } from "@/lib/stackacres-td/work-board";
import { TRAITS, type Trait, type WorkerProfile } from "@/lib/stackacres-td/work-crew";
import { STORE_PEOPLE, type StorePerson } from "@/lib/stackacres-td/store-cast";

export const JOB_LABELS: Readonly<Record<Job, { one: string; many: string; does: string }>> = {
  cashier: { one: "Cashier", many: "Cashiers", does: "Rings up shoppers at a till." },
  produce: { one: "Produce clerk", many: "Produce clerks", does: "Serves fruit and veg over the produce counter." },
  stocker: { one: "Stocker", many: "Stockers", does: "Carries crates out and fills the shelves." },
};

/** Gold an hour at an ordinary pace, by job. */
const BASE_WAGE: Readonly<Record<Job, number>> = { cashier: 12, produce: 14, stocker: 10 };

/** What a trait adds to (or takes off) someone's hourly wage. */
const TRAIT_WAGE: Readonly<Record<Trait, number>> = { overworker: 3, brisk: 2, steady: 1, dawdler: -3 };

/** How much each job leans on quick hands against a quick walk. A cashier barely moves. */
const LEANS: Readonly<Record<Job, { hands: number; walk: number }>> = {
  cashier: { hands: 1, walk: 0.1 },
  produce: { hands: 0.6, walk: 0.4 },
  stocker: { hands: 0.4, walk: 0.6 },
};

/** The rest a worn-out worker takes (lib/stackacres-td/worksite.ts `restMs`), for the share of the day they work. */
const REST_MS = 20_000;
const ORDINARY_ENDURANCE = 120_000;

/**
 * How much work someone gets through against an ordinary worker in the same job, 1 being ordinary: quicker
 * hands and feet (weighted by what the job needs), and less time off on breaks. Brisk is a tenth quicker;
 * a dawdler walks a fifth slower; an overworker never stops; steady tires a third slower.
 */
export function workRate(person: Pick<StorePerson, "job" | "profile">): number {
  const { profile, job } = person;
  const lean = LEANS[job];
  const has = (trait: Trait) => profile.traits.includes(trait);
  const hands = profile.hands * (has("brisk") ? 0.9 : 1);
  const walk = profile.walk * (has("dawdler") ? 1.2 : 1);
  const pace = 1 / (Math.pow(hands, lean.hands) * Math.pow(walk, lean.walk));
  const on = (endurance: number) => endurance / (endurance + REST_MS);
  const lasts = has("overworker") ? 0.95 : on(profile.endurance / (has("steady") ? 0.7 : 1));
  return pace * (lasts / on(ORDINARY_ENDURANCE));
}

/** Gold an hour, taken off the takings. */
export function hourlyWage(person: Pick<StorePerson, "job" | "profile">): number {
  const base = BASE_WAGE[person.job];
  const skill = Math.round(base * (workRate(person) - 1) * 1.5);
  const traits = person.profile.traits.reduce((sum, trait) => sum + TRAIT_WAGE[trait], 0);
  return Math.max(6, base + skill + traits);
}

/** A one-off fee to take someone on, paid from the wallet when they're hired. */
export function hiringFee(person: Pick<StorePerson, "job" | "profile">): number {
  return hourlyWage(person) * 20;
}

export interface Rating {
  label: string;
  /** 1 to 5. */
  stars: number;
}

const stars = (value: number, from: number, to: number) => Math.max(1, Math.min(5, Math.round(1 + ((value - from) / (to - from)) * 4)));

/** Three plain ratings for a candidate card: how fast they work, how fast they walk, how long they last. */
export function ratings(profile: WorkerProfile): Rating[] {
  const has = (trait: Trait) => profile.traits.includes(trait);
  const hands = profile.hands * (has("brisk") ? 0.9 : 1);
  const walk = profile.walk * (has("dawdler") ? 1.2 : 1);
  const endurance = has("overworker") ? 240_000 : profile.endurance / (has("steady") ? 0.7 : 1);
  return [
    { label: "Quick hands", stars: stars(1 / hands, 1 / 1.2, 1 / 0.8) },
    { label: "On their feet", stars: stars(1 / walk, 1 / 1.3, 1 / 0.85) },
    { label: "Stamina", stars: stars(endurance, 90_000, 220_000) },
  ];
}

export interface TraitNote {
  trait: Trait;
  label: string;
  blurb: string;
  /** Whether it reads as good news on a card; mixed blessings count as good. */
  good: boolean;
}

export function traitNotes(profile: WorkerProfile): TraitNote[] {
  return profile.traits.map((trait) => ({ trait, ...TRAITS[trait], good: trait !== "dawdler" }));
}

/** How many people the Help Wanted board shows at once. */
export const BOARD_SIZE = 4;

/**
 * Today's applicants for this player: the first four of the day's line-up who aren't on the staff. The line-up
 * is everyone, in an order drawn for this player and UTC day, so the board keeps its faces all day: hiring one
 * brings the next in line onto the board, and nobody else moves.
 */
export function applicantsFor(profileId: string, utcDay: string, staff: readonly string[]): StorePerson[] {
  const onStaff = new Set(staff);
  const random = mulberry32(hashString(`grocery-board:${profileId}:${utcDay}`));
  // Fisher-Yates on a copy, so the roster's own order never matters.
  const lineUp = [...STORE_PEOPLE];
  for (let i = lineUp.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [lineUp[i], lineUp[j]] = [lineUp[j], lineUp[i]];
  }
  return lineUp.filter((person) => !onStaff.has(person.name)).slice(0, BOARD_SIZE);
}

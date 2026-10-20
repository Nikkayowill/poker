/**
 * The hired hand: Earl, hired at Ray's for a daily wage, who walks the farm
 * watering dry beds and bringing in ripe ones while the player is playing. A
 * bed he picks he sows again with the same crop, from the player's seed.
 *
 * The wage is charged by the chores pass, once per game day (lib/stackacres/
 * clock.ts), and only while the farm is open: days spent away are never
 * billed, because Earl does nothing while nobody is there. A day the wage
 * can't be paid, he quits.
 *
 * Pure, so the server and the client share the rules (hired-hand.test.ts).
 */

import { isStackAcresCrop } from "./catalogue";
import { isStackAcresUnitDry, isStackAcresUnitReady, type StackAcresUnitRow } from "./units";

export const HIRED_HAND_NAME = "Earl";

/** Gold per game day. A game day is 13 real minutes. */
export const HIRED_HAND_DAILY_WAGE = 60;

/** Earl only hires on with a farm that has this many beds to work. */
export const HIRED_HAND_BEDS_TO_HIRE = 6;

/** How often the chores pass runs, in real ms. */
export const HIRED_HAND_CHORES_EVERY_MS = 20_000;

/** Beds Earl works in one pass, watering first, then harvesting. */
export const HIRED_HAND_BEDS_PER_PASS = 4;

export const HIRED_HAND_BLURB = "Waters your dry beds, picks the ripe ones and sows them again from your seed while you play.";
export const HIRED_HAND_ALREADY = `${HIRED_HAND_NAME} already works for you.`;
export const HIRED_HAND_NOT_ENOUGH_BEDS = `${HIRED_HAND_NAME} wants ${HIRED_HAND_BEDS_TO_HIRE} beds to work before he signs on.`;
export const HIRED_HAND_CANT_PAY = `${HIRED_HAND_NAME} wants his first day's ${HIRED_HAND_DAILY_WAGE} Gold up front.`;
export const HIRED_HAND_QUIT = `${HIRED_HAND_NAME} quit. You couldn't pay his ${HIRED_HAND_DAILY_WAGE} Gold wage.`;

/** What the browser sees of the hand. */
export interface HiredHandView {
  name: string;
  wage: number;
  /** The last game day his wage covers. */
  paidThroughDay: number;
}

/** What one chores pass did, for the scene to walk him through. */
export interface HiredHandChores {
  watered: string[];
  harvested: string[];
  /** Gold taken for today's wage on this pass, 0 if it was already paid. */
  wagePaid: number;
  /** He left on this pass because the wage couldn't be paid. */
  quit: boolean;
}

export const NO_HAND_CHORES: HiredHandChores = { watered: [], harvested: [], wagePaid: 0, quit: false };

/** Whether this game day still needs paying. */
export function hiredHandWageDue(paidThroughDay: number, today: number): boolean {
  return today > paidThroughDay;
}

/** Whether enough time has passed since the last pass for another. */
export function hiredHandChoresDue(choresAtMs: number, nowMs: number): boolean {
  return nowMs - choresAtMs >= HIRED_HAND_CHORES_EVERY_MS;
}

type ChoreRow = Pick<
  StackAcresUnitRow,
  "id" | "status" | "stock" | "startedAt" | "readyAt" | "lastFedAt" | "lastWateredAt"
>;

/**
 * Which crop beds Earl works this pass. Dry beds come first, since a dry
 * crop stops growing, and longest dry first. Ripe beds fill what is left,
 * longest ripe first. Animals are never his: feeding and the sale barn stay
 * the player's.
 */
export function pickHiredHandChores(
  rows: readonly ChoreRow[],
  now: Date,
  irrigated: ReadonlySet<string>,
  limit = HIRED_HAND_BEDS_PER_PASS,
): { water: string[]; harvest: string[] } {
  const crops = rows.filter((row) => row.status === "working" && isStackAcresCrop(row.stock));
  const dry = crops
    .filter((row) => isStackAcresUnitDry(row, now, irrigated.has(row.id)))
    .sort((a, b) => Date.parse(a.lastWateredAt ?? a.startedAt) - Date.parse(b.lastWateredAt ?? b.startedAt));
  const water = dry.slice(0, limit).map((row) => row.id);
  const ripe = crops
    .filter((row) => isStackAcresUnitReady(row, now, irrigated.has(row.id)))
    .sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt));
  const harvest = ripe.slice(0, Math.max(0, limit - water.length)).map((row) => row.id);
  return { water, harvest };
}

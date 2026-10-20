/**
 * "While you were away": what changed on the farm since the player last looked.
 *
 * Read-only and client-side. It compares timestamps already on the snapshot
 * against the moment the player was last here, so it never touches Gold or
 * writes anything. The farm itself already ran on those timestamps; this only
 * says so out loud when the player comes back.
 */

import { STACKACRES_CATALOGUE, isLivestock } from "./catalogue";
import { herdNightStartMs } from "./herd-risk";
import { MACHINE_CATALOGUE, type StackAcresMachineSnapshot } from "./machines";
import { RECIPE_CATALOGUE } from "./recipes";
import type { StackAcresUnitSnapshot } from "./units";

/** Shorter than this and the player never really left. */
export const AWAY_REPORT_MIN_MS = 10 * 60 * 1000;

export interface AwayReport {
  awayMs: number;
  lines: string[];
}

type AwayUnit = Pick<StackAcresUnitSnapshot, "stock" | "state" | "readyAt" | "hungryAt" | "thirstyAt"> &
  Partial<Pick<StackAcresUnitSnapshot, "away">>;
type AwayMachine = Pick<
  StackAcresMachineSnapshot,
  "kind" | "status" | "readyAt" | "recipeId" | "standingRecipe" | "kitchenSince"
>;

function within(iso: string | null, fromMs: number, toMs: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at > fromMs && at <= toMs;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "3 Wheat" style tally, biggest group first, ties by name so the order is stable. */
function tally(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
}

export function awayDurationLabel(awayMs: number): string {
  const minutes = Math.round(awayMs / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(awayMs / 3_600_000);
  if (hours < 24) return `${hours} ${plural(hours, "hour", "hours")}`;
  const days = Math.round(awayMs / 86_400_000);
  return `${days} ${plural(days, "day", "days")}`;
}

/**
 * Null when the player was only gone a moment, or nothing happened. Only counts
 * things that turned over inside the window, so a crop that was already ripe
 * the last time they looked is not announced twice.
 */
export function buildAwayReport(input: {
  units: readonly AwayUnit[];
  machines: readonly AwayMachine[];
  lastSeenMs: number;
  nowMs: number;
}): AwayReport | null {
  const { units, machines, lastSeenMs, nowMs } = input;
  const awayMs = nowMs - lastSeenMs;
  if (!Number.isFinite(awayMs) || awayMs < AWAY_REPORT_MIN_MS) return null;

  const lines: string[] = [];

  const ripeCrops: string[] = [];
  let readyAnimals = 0;
  let hungry = 0;
  const dry: string[] = [];
  // Only a night that began after the player last looked is news; one that was
  // already on screen when they left is not announced again.
  const newNight = herdNightStartMs(nowMs) > lastSeenMs;
  let wandered = 0;
  let spooked = 0;
  for (const unit of units) {
    if (unit.state === "mucked") continue;
    if (unit.away) {
      if (newNight) {
        if (unit.away === "predator") spooked += 1;
        else wandered += 1;
      }
      continue;
    }
    const label = STACKACRES_CATALOGUE[unit.stock].label;
    if (within(unit.readyAt, lastSeenMs, nowMs)) {
      if (isLivestock(unit.stock)) readyAnimals += 1;
      else ripeCrops.push(label);
    } else if (isLivestock(unit.stock) && within(unit.hungryAt, lastSeenMs, nowMs)) {
      hungry += 1;
    } else if (!isLivestock(unit.stock) && within(unit.thirstyAt, lastSeenMs, nowMs)) {
      dry.push(label);
    }
  }
  if (ripeCrops.length > 0) lines.push(`Ripe and ready to pick: ${tally(ripeCrops)}.`);
  if (readyAnimals > 0) lines.push(`${readyAnimals} ${plural(readyAnimals, "animal has", "animals have")} something to collect.`);

  for (const machine of machines) {
    if (machine.status === "working" && machine.recipeId && within(machine.readyAt, lastSeenMs, nowMs)) {
      lines.push(`The ${MACHINE_CATALOGUE[machine.kind].label} finished ${RECIPE_CATALOGUE[machine.recipeId].label}.`);
    }
  }

  if (wandered > 0) {
    lines.push(
      `${wandered} ${plural(wandered, "animal", "animals")} wandered off last night. Make sure to enclose your livestock.`,
    );
  }
  if (spooked > 0) {
    lines.push(`Something got at ${spooked} ${plural(spooked, "animal", "animals")} last night. A fence keeps them safe.`);
  }
  if (hungry > 0) lines.push(`${hungry} ${plural(hungry, "animal is", "animals are")} hungry.`);
  if (dry.length > 0) lines.push(`Crops that dried out: ${tally(dry)}.`);

  return lines.length > 0 ? { awayMs, lines } : null;
}

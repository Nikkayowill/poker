/**
 * What a bad layout costs the herd.
 *
 * A sheep or a cow standing loose in the yard can wander off in the night, or
 * be got at by something. A fenced animal cannot. An animal that is away
 * cannot be collected from until the next day, and then it is simply back.
 *
 * NEVER A DEBIT. Nothing is taken from the player: no Gold, no animal, no
 * product. The cycle the animal finished is still waiting when it returns. The
 * cost is the day it loses.
 *
 * THE ROLL IS A FACT, NOT A DICE THROW. Whether an animal is away on a night
 * depends only on its id and the server's UTC day, so a reload, a second tab
 * or a sleep cannot reroll it. The animal's number for that night is fixed; the
 * layout only moves the line it has to clear. Fencing it in drops the line to
 * zero (it comes straight home) and unfencing it again brings the same number
 * back, so shuffling fences never buys a better roll.
 *
 * WHAT COUNTS AS FENCED. A square with fence pieces all the way round it, where
 * "all the way round" means a flood fill from the animal's square over its
 * four neighbours cannot get further than PEN_TILE_CAP squares before it hits a
 * fence. Anything bigger is open ground. Diagonal gaps do not leak.
 *
 * CROWDED. A pen with two or more animals that is more than half full still
 * loses the odd one: the crowding risk below. A pen with one animal is never
 * crowded.
 *
 * Crop trampling from the herd plan is not here: it needs the crops to be
 * damaged, which is a separate write. Hens in Hen Haven are not herd animals
 * and are never at risk.
 *
 * Pure: the server and the client both import this.
 */

import { herdKey, isPlaced, type HerdUnit } from "./herd";

/** How a night went wrong for an animal. */
export type HerdAway = "wandered" | "predator";

/** A pen bigger than this many squares is open ground, not a pen. */
export const PEN_TILE_CAP = 36;

/** Share of nights an animal on open ground is lost. */
export const OPEN_RISK = 0.2;

/** Share of nights an animal in a crowded pen is lost. */
export const CROWDED_RISK = 0.1;

/** Of the nights an animal is lost, the share it was a predator rather than a wander. */
export const PREDATOR_SHARE = 0.4;

export type HerdShelter = "open" | "pen" | "crowded";

const DAY_MS = 86_400_000;

/** The night an instant belongs to: the UTC day it falls in. The server's clock only. */
export function herdNight(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

/** The moment `herdNight(nowMs)` began. */
export function herdNightStartMs(nowMs: number): number {
  return herdNight(nowMs) * DAY_MS;
}

/** FNV-1a of a string, as a number in [0, 1). */
function unitInterval(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

/** This animal's fixed number for this night, and which way a bad night goes for it. */
export function herdNightRoll(unitId: string, night: number): { loss: number; kind: HerdAway } {
  const loss = unitInterval(`${unitId}:${night}:loss`);
  const kind = unitInterval(`${unitId}:${night}:kind`) < PREDATOR_SHARE ? "predator" : "wandered";
  return { loss, kind };
}

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The squares this animal can walk to without crossing a fence, or null when
 * that is more than PEN_TILE_CAP of them (open ground).
 */
export function penOf(tx: number, ty: number, fences: ReadonlySet<string>): Set<string> | null {
  const seen = new Set<string>([herdKey(tx, ty)]);
  const queue: Array<readonly [number, number]> = [[tx, ty]];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of STEPS) {
      const key = herdKey(x + dx, y + dy);
      if (seen.has(key) || fences.has(key)) continue;
      seen.add(key);
      if (seen.size > PEN_TILE_CAP) return null;
      queue.push([x + dx, y + dy]);
    }
  }
  return seen;
}

/** How exposed one placed animal is, from the fences and the animals around it. */
export function herdShelter(
  unit: HerdUnit,
  fences: ReadonlySet<string>,
  placed: readonly HerdUnit[],
): HerdShelter {
  if (!isPlaced(unit)) return "pen";
  const pen = penOf(unit.mapTx as number, unit.mapTy as number, fences);
  if (!pen) return "open";
  let animals = 0;
  for (const other of placed) {
    if (isPlaced(other) && pen.has(herdKey(other.mapTx as number, other.mapTy as number))) animals += 1;
  }
  return animals >= 2 && animals * 2 > pen.size ? "crowded" : "pen";
}

/** The share of nights an animal this sheltered is lost. */
export function herdRisk(shelter: HerdShelter): number {
  if (shelter === "open") return OPEN_RISK;
  if (shelter === "crowded") return CROWDED_RISK;
  return 0;
}

/**
 * Which placed animals are away at `nowMs`, and how they went. Animals that are
 * not set down, and everything that is not a herd animal, are never in it.
 */
export function herdAway(
  units: readonly HerdUnit[],
  fences: ReadonlySet<string>,
  nowMs: number,
): Map<string, HerdAway> {
  const away = new Map<string, HerdAway>();
  const placed = units.filter(isPlaced);
  if (placed.length === 0) return away;
  const night = herdNight(nowMs);
  for (const unit of placed) {
    const risk = herdRisk(herdShelter(unit, fences, placed));
    if (risk === 0) continue;
    const roll = herdNightRoll(unit.id, night);
    if (roll.loss < risk) away.set(unit.id, roll.kind);
  }
  return away;
}

export const HERD_AWAY_MESSAGES: Record<HerdAway, string> = {
  wandered: "That one wandered off in the night. It will be back tomorrow.",
  predator: "Something spooked that one in the night. It will be back tomorrow.",
};

/**
 * Clearing land, which is how land is taken: you walk onto it and cut down
 * what is standing there. Nobody sells you a field.
 *
 * Each claimable sector carries a fixed set of obstacles. Every swing pays
 * out what it breaks (Wood from trees and scrub, Stone from boulders) and
 * costs a little energy, so an area is several sittings of real work. The
 * whole sector opens the moment its last obstacle goes down, for no Gold at
 * all.
 *
 * Gold's way in is demolition: any obstacle can be blown instead of worked,
 * at a price per swing it would have taken. Paying is always dearer than the
 * land used to cost outright, because what it buys is the afternoon, not the
 * field.
 *
 * Pure, same split as ./wood.ts: this knows one obstacle's stored state and
 * `now`. The guarded write in lib/server/stackacres-store.ts decides what
 * actually landed, and the scene decides where each obstacle stands.
 */

import type { MachineRawItem } from "./machine-items";
import type { SectorId } from "./sectors";
import { seededRandom } from "./world";

/** Energy one swing costs. A full waiting-regen bar (50) is 25 swings, so a
 *  sector is a few sittings unless the player eats. */
export const LAND_SWING_ENERGY = 2;

export const TOO_TIRED_TO_CLEAR = "You're worn out. Eat something before you swing again.";

export type LandObstacleKind = "tree" | "boulder" | "scrub";

interface LandObstacleDef {
  /** Swings to break it. */
  readonly hits: number;
  /** What breaking it pays into the barn, or null for nothing. */
  readonly item: MachineRawItem | null;
  /** Per landed swing. */
  readonly perHit: number;
  /** Extra on the swing that finishes it. */
  readonly clearBonus: number;
  /** Gold to demolish, per swing still owed. */
  readonly goldPerHit: number;
  /** What the popup calls it. */
  readonly label: string;
}

export const LAND_OBSTACLE_DEFS: Readonly<Record<LandObstacleKind, LandObstacleDef>> = {
  tree: { hits: 4, item: "wood", perHit: 1, clearBonus: 2, goldPerHit: 900, label: "Tree" },
  boulder: { hits: 5, item: "stone", perHit: 1, clearBonus: 2, goldPerHit: 1_400, label: "Boulder" },
  scrub: { hits: 2, item: "wood", perHit: 1, clearBonus: 0, goldPerHit: 500, label: "Scrub" },
};

export interface LandObstacle {
  readonly id: string;
  readonly kind: LandObstacleKind;
  readonly sector: ClearableSectorId;
}

/** The sectors that are taken by clearing them. The wild places (the Oak,
 *  the Coast, the Mine, the Town) open when their traveler arrives instead,
 *  and are not cleared at all. */
export const CLEARABLE_SECTORS = ["wallow", "oxfields"] as const satisfies readonly SectorId[];
export type ClearableSectorId = (typeof CLEARABLE_SECTORS)[number];

export function isClearableSector(value: string): value is ClearableSectorId {
  return (CLEARABLE_SECTORS as readonly string[]).includes(value);
}

/** How much stands on each one, and in what mix. The Pasture is the bigger
 *  field and the later rung, so it is the longer job. */
const SECTOR_MIX: Readonly<Record<ClearableSectorId, Readonly<Record<LandObstacleKind, number>>>> = {
  wallow: { tree: 12, boulder: 6, scrub: 6 },
  oxfields: { tree: 16, boulder: 9, scrub: 5 },
};

/**
 * The obstacle list for one sector: ids and kinds only, shuffled by a seed of
 * the sector's own name so the mix is scattered rather than sorted into
 * blocks. Where each one STANDS is the scene's business (it is the only
 * thing that knows which tiles are free), and the server never needs to know.
 */
function dealObstacles(sector: ClearableSectorId): LandObstacle[] {
  const mix = SECTOR_MIX[sector];
  const kinds: LandObstacleKind[] = [];
  for (const kind of ["tree", "boulder", "scrub"] as const) {
    for (let i = 0; i < mix[kind]; i += 1) kinds.push(kind);
  }
  const random = seededRandom(sector.length * 0x9e3779b1 + kinds.length);
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds.map((kind, i) => ({
    id: `${sector}-${String(i + 1).padStart(2, "0")}`,
    kind,
    sector,
  }));
}

export const LAND_OBSTACLES: Readonly<Record<ClearableSectorId, readonly LandObstacle[]>> = {
  wallow: dealObstacles("wallow"),
  oxfields: dealObstacles("oxfields"),
};

const BY_ID = new Map<string, LandObstacle>(
  CLEARABLE_SECTORS.flatMap((sector) => LAND_OBSTACLES[sector].map((obstacle) => [obstacle.id, obstacle] as const)),
);

export function landObstacle(id: string): LandObstacle | null {
  return BY_ID.get(id) ?? null;
}

/** One obstacle's stored state, as much as the pure math needs. */
export interface LandObstacleState {
  readonly hitsRemaining: number;
  readonly clearedAt: string | null;
}

export function freshLandObstacleState(kind: LandObstacleKind): LandObstacleState {
  return { hitsRemaining: LAND_OBSTACLE_DEFS[kind].hits, clearedAt: null };
}

export function isLandObstacleCleared(state: LandObstacleState): boolean {
  return state.clearedAt !== null;
}

export interface LandSwingResult {
  readonly nextState: LandObstacleState;
  readonly item: MachineRawItem | null;
  readonly quantity: number;
  readonly cleared: boolean;
}

/** What one swing does. Null when the obstacle is already down: unlike a
 *  tree, nothing here grows back, so there is no second cycle to start. */
export function swingAtLandObstacle(
  kind: LandObstacleKind,
  state: LandObstacleState,
  now: Date,
  sweet: boolean,
): LandSwingResult | null {
  if (isLandObstacleCleared(state)) return null;
  const def = LAND_OBSTACLE_DEFS[kind];
  const hitsRemaining = state.hitsRemaining - 1;
  const cleared = hitsRemaining <= 0;
  const quantity = def.item === null ? 0 : def.perHit + (sweet ? 1 : 0) + (cleared ? def.clearBonus : 0);
  return {
    nextState: cleared ? { hitsRemaining: 0, clearedAt: now.toISOString() } : { hitsRemaining, clearedAt: null },
    item: def.item,
    quantity,
    cleared,
  };
}

/** What blowing it up costs right now: the swings still owed, priced by kind.
 *  An obstacle already half worked is cheaper, so effort is never wasted. */
export function demolitionPrice(kind: LandObstacleKind, state: LandObstacleState): number {
  if (isLandObstacleCleared(state)) return 0;
  return Math.max(0, state.hitsRemaining) * LAND_OBSTACLE_DEFS[kind].goldPerHit;
}

/** Demolition pays no materials: there is nothing left to pick up. */
export function demolishLandObstacle(state: LandObstacleState, now: Date): LandObstacleState | null {
  if (isLandObstacleCleared(state)) return null;
  return { hitsRemaining: 0, clearedAt: now.toISOString() };
}

/** What one obstacle looks like to the client. */
export interface LandObstacleSnapshot {
  readonly id: string;
  readonly sector: ClearableSectorId;
  readonly kind: LandObstacleKind;
  readonly hitsRemaining: number;
  readonly cleared: boolean;
  /** Gold to blow it now, for the popup's second button. */
  readonly demolitionPrice: number;
}

export function landObstacleSnapshot(obstacle: LandObstacle, state: LandObstacleState): LandObstacleSnapshot {
  return {
    id: obstacle.id,
    sector: obstacle.sector,
    kind: obstacle.kind,
    hitsRemaining: state.hitsRemaining,
    cleared: isLandObstacleCleared(state),
    demolitionPrice: demolitionPrice(obstacle.kind, state),
  };
}

/** How far a sector's clearing has got, off whatever snapshots exist. An
 *  obstacle with no row yet has never been touched, so it counts as standing. */
export function landClearingProgress(
  sector: ClearableSectorId,
  snapshots: readonly Pick<LandObstacleSnapshot, "id" | "cleared">[],
): { readonly cleared: number; readonly total: number; readonly done: boolean } {
  const down = new Set(snapshots.filter((snapshot) => snapshot.cleared).map((snapshot) => snapshot.id));
  const total = LAND_OBSTACLES[sector].length;
  const cleared = LAND_OBSTACLES[sector].filter((obstacle) => down.has(obstacle.id)).length;
  return { cleared, total, done: cleared >= total };
}

/** The whole job in one phrase: "9 of 24 cleared". */
export function landClearingLine(progress: { cleared: number; total: number }): string {
  return `${progress.cleared} of ${progress.total} cleared`;
}

/** One obstacle's state as the client holds it: off the snapshot list it was
 *  last handed, or fresh when it has never been touched. Same "an obstacle
 *  with no row yet is standing" rule `landClearingProgress` takes. */
export function landObstacleStateOf(
  snapshots: readonly LandObstacleSnapshot[],
  obstacle: LandObstacle,
): LandObstacleState {
  const snapshot = snapshots.find((candidate) => candidate.id === obstacle.id);
  if (!snapshot) return freshLandObstacleState(obstacle.kind);
  return { hitsRemaining: snapshot.hitsRemaining, clearedAt: snapshot.cleared ? "optimistic" : null };
}

/** The same list with one obstacle moved on, for an optimistic guess. */
export function withLandObstacleState(
  snapshots: readonly LandObstacleSnapshot[],
  obstacle: LandObstacle,
  next: LandObstacleState,
): LandObstacleSnapshot[] {
  const updated = landObstacleSnapshot(obstacle, next);
  const known = snapshots.some((candidate) => candidate.id === obstacle.id);
  if (!known) return [...snapshots, updated];
  return snapshots.map((candidate) => (candidate.id === obstacle.id ? updated : candidate));
}

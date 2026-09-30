/**
 * Which parts of the farm a guess still in the air is holding, and how a
 * server answer is laid underneath them.
 *
 * Every answer is the whole farm as the server read it at one moment. With
 * several taps in the air at once, an answer can be read before a sibling's
 * write landed, so painting it whole takes that sibling's guess off the
 * screen until the sibling's own answer puts it back: a bed hoed a moment
 * ago flicks back to grass, a harvested crop pops back up. So each guess
 * claims exactly what it changed (one crop, one bed, one seed count, the can)
 * and an answer only paints what nobody is still holding.
 *
 * When a guess lets go (its answer landed, was refused, or never came), the
 * parts it held go back to the last answer the farm accepted. That one rule
 * covers all three: a success already put its own answer there, a refusal
 * never wrote anything, and an answer dropped as stale was beaten by a newer
 * one that already includes it.
 */

import type { PlayerProfile } from "@/lib/profile/types";
import type { FarmPredictContext, FarmStatePatch } from "./optimistic-actions";
import { soilTilesEqual, type SoilTile } from "./soil";
import { touchedUnitIds } from "./unit-merge";

/** Everything a guess can touch, as the farm holds it. */
export type FarmFields = Required<FarmStatePatch>;
export type GuessField = keyof FarmFields;

/** One field (`water`), or one thing inside one (`soilTiles:3,4`). */
export type ClaimKey = string;

type EntityField = "units" | "soilTiles" | "forageNodes" | "landObstacles" | "fences";
type CountField = "seedStock" | "inventory" | "capacity";

const ENTITY_ID: { [F in EntityField]: (entity: FarmFields[F][number]) => string } = {
  units: (unit) => unit.id,
  soilTiles: (tile) => `${tile.tx},${tile.ty}`,
  forageNodes: (node) => node.nodeId,
  landObstacles: (obstacle) => obstacle.id,
  fences: (piece) => `${piece.tx},${piece.ty}`,
};

const ENTITY_FIELDS = new Set<GuessField>(Object.keys(ENTITY_ID) as EntityField[]);
const COUNT_FIELDS = new Set<GuessField>(["seedStock", "inventory", "capacity"] satisfies CountField[]);
const GOLD_KEY: ClaimKey = "profile:gold";

function claimKey(field: GuessField, id?: string): ClaimKey {
  return id === undefined ? field : `${field}:${id}`;
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** `prev` when `next` holds the same data, so an unchanged answer keeps the
 *  old identity and nothing downstream redraws. */
export function sameOrNext<T>(prev: T, next: T): T {
  return sameJson(prev, next) ? prev : next;
}

/** The farm a guess was made against, for telling what it changed. */
export type GuessBase = Pick<FarmPredictContext, EntityField | CountField | "profile">;

/** What a guess changed, as claim keys, deduped. */
export function guessClaims(before: GuessBase, patch: FarmStatePatch): ClaimKey[] {
  const keys = new Set<ClaimKey>();
  for (const field of Object.keys(patch) as GuessField[]) {
    const after = patch[field];
    if (after === undefined) continue;
    if (field === "units") {
      for (const id of touchedUnitIds(before.units, after as FarmFields["units"])) keys.add(claimKey(field, id));
    } else if (ENTITY_FIELDS.has(field)) {
      const idOf = ENTITY_ID[field as EntityField] as (entity: unknown) => string;
      const was = new Map((before[field as EntityField] as readonly unknown[]).map((e) => [idOf(e), e]));
      const now = new Map((after as readonly unknown[]).map((e) => [idOf(e), e]));
      for (const id of new Set([...was.keys(), ...now.keys()])) {
        if (!sameJson(was.get(id), now.get(id))) keys.add(claimKey(field, id));
      }
    } else if (COUNT_FIELDS.has(field)) {
      const was = before[field as CountField] as Partial<Record<string, number>>;
      const now = after as Partial<Record<string, number>>;
      for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if ((was[id] ?? 0) !== (now[id] ?? 0)) keys.add(claimKey(field, id));
      }
    } else if (field === "profile") {
      const now = after as PlayerProfile | null;
      if (before.profile?.goldBalance !== now?.goldBalance) keys.add(GOLD_KEY);
    } else {
      keys.add(claimKey(field));
    }
  }
  return [...keys];
}

/** Whether a claim names a unit id this browser made up. */
export function isClaimOnUnit(key: ClaimKey, test: (unitId: string) => boolean): boolean {
  return key.startsWith("units:") && test(key.slice("units:".length));
}

/** The ids `keys` name inside one field. */
function idsIn(keys: ReadonlySet<ClaimKey>, field: GuessField): Set<string> {
  const prefix = `${field}:`;
  const ids = new Set<string>();
  for (const key of keys) if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  return ids;
}

/**
 * `base` with the entities `ids` names taken from `over` instead: replaced
 * where both have one, dropped where only `base` does, added where only
 * `over` does.
 */
export function overlayEntities<T>(
  base: readonly T[],
  over: readonly T[],
  idOf: (entity: T) => string,
  ids: ReadonlySet<string>,
): T[] {
  if (ids.size === 0) return [...base];
  const fromOver = new Map(over.filter((e) => ids.has(idOf(e))).map((e) => [idOf(e), e]));
  const out: T[] = [];
  for (const entity of base) {
    const id = idOf(entity);
    if (!ids.has(id)) out.push(entity);
    else if (fromOver.has(id)) {
      out.push(fromOver.get(id)!);
      fromOver.delete(id);
    }
  }
  return [...out, ...fromOver.values()];
}

/** `base` with the counts `ids` names taken from `over` instead. */
export function overlayCounts<K extends string>(
  base: Partial<Record<K, number>>,
  over: Partial<Record<K, number>>,
  ids: ReadonlySet<string>,
): Partial<Record<K, number>> {
  if (ids.size === 0) return base;
  const out: Partial<Record<K, number>> = { ...base };
  for (const id of ids as ReadonlySet<K>) {
    if (over[id] === undefined) delete out[id];
    else out[id] = over[id];
  }
  return out;
}

/** `base` with the claimed parts of one field taken from `over`. */
function overlayField<F extends GuessField>(
  field: F,
  base: FarmFields[F],
  over: FarmFields[F],
  keys: ReadonlySet<ClaimKey>,
): FarmFields[F] {
  if (ENTITY_FIELDS.has(field)) {
    const idOf = ENTITY_ID[field as EntityField] as (entity: unknown) => string;
    return overlayEntities(base as readonly unknown[], over as readonly unknown[], idOf, idsIn(keys, field)) as FarmFields[F];
  }
  if (COUNT_FIELDS.has(field)) {
    return overlayCounts(
      base as Partial<Record<string, number>>,
      over as Partial<Record<string, number>>,
      idsIn(keys, field),
    ) as FarmFields[F];
  }
  if (field === "profile") {
    if (!keys.has(GOLD_KEY)) return base;
    const b = base as PlayerProfile | null;
    const o = over as PlayerProfile | null;
    return (b && o ? { ...b, goldBalance: o.goldBalance } : o) as FarmFields[F];
  }
  return keys.has(field) ? over : base;
}

/**
 * How one field is laid:
 *   - `next` is an answer, `prev` what is on screen: the answer wins except
 *     where `keys` (what siblings still hold) says to keep the screen.
 *   - `prev` is the screen, `next` a guess or the last accepted answer: the
 *     screen stays except where `keys` says to take `next`.
 */
export interface LayMode {
  readonly base: "next" | "prev";
  readonly keys: ReadonlySet<ClaimKey>;
}

/**
 * One field of the farm after laying `next` over `prev`. Hands back `prev`
 * itself when nothing actually changed, so an unrelated answer never gives
 * the map a new array to redraw.
 */
export function layFarmField<F extends GuessField>(
  field: F,
  prev: FarmFields[F],
  next: FarmFields[F],
  mode: LayMode,
): FarmFields[F] {
  const laid = mode.base === "next" ? overlayField(field, next, prev, mode.keys) : overlayField(field, prev, next, mode.keys);
  if (field === "soilTiles") {
    return soilTilesEqual(prev as SoilTile[], laid as SoilTile[]) ? prev : laid;
  }
  return sameJson(prev, laid) ? prev : laid;
}

/** Whether a whole-field value (one with no parts to claim) takes `next`. */
export function takesNext(field: GuessField, mode: LayMode): boolean {
  return mode.base === "next" ? !mode.keys.has(field) : mode.keys.has(field);
}

/**
 * Refcounted claims, since two guesses can hold the same thing at once
 * (watering a crop, then picking it).
 */
export class GuessClaims {
  private readonly counts = new Map<ClaimKey, number>();

  claim(keys: Iterable<ClaimKey>): void {
    for (const key of keys) this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Lets go of `keys` and returns the ones nobody holds any more. */
  release(keys: Iterable<ClaimKey>): Set<ClaimKey> {
    const freed = new Set<ClaimKey>();
    for (const key of keys) {
      const count = this.counts.get(key) ?? 0;
      if (count <= 1) {
        this.counts.delete(key);
        freed.add(key);
      } else {
        this.counts.set(key, count - 1);
      }
    }
    return freed;
  }

  /** What is held by anyone other than `own`. */
  heldBesides(own: ReadonlySet<ClaimKey>): Set<ClaimKey> {
    const held = new Set<ClaimKey>();
    for (const [key, count] of this.counts) {
      if (count - (own.has(key) ? 1 : 0) > 0) held.add(key);
    }
    return held;
  }
}

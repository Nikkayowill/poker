/**
 * Foraged seed: where a crop seed comes from before anyone has Gold to buy
 * one.
 *
 * A seed used to have exactly one door -- Ray's shop, paid for in Gold, and
 * gated behind whichever building uses the crop (./seed-unlocks.ts). That
 * made the first hour "earn Gold, then farm". Foraging is the other door,
 * and deliberately the FIRST one: you walk the farmyard, pick over the
 * bushes already drawn there, and plant what you found.
 *
 * NOT GATED BY ./seed-unlocks.ts, on purpose. The building ladder still
 * decides what Ray will SELL you in bulk; it does not decide what the land
 * hands you. A picked bush can give Radish before a Kitchen Counter exists,
 * which is the whole reason finding one reads as a find. Nothing enforces
 * this here -- planting spends a seed off the shelf and never re-checks the
 * ladder (see `stockStackAcres`), so a foraged seed is plantable by
 * construction.
 *
 * A FIXED WORLD NODE, same shape ./tree-nodes.ts and ./stone-nodes.ts take:
 * four of the Homestead's own berry bushes, already drawn, tagged
 * `forage:<id>` in public/stackacres-td/areas/homestead/area.json. Every
 * other bush on every map stays scenery.
 *
 * WHAT A BUSH GIVES IS FIXED, NEVER ROLLED. `forageCrop` is a pure function
 * of the node and how many times it has been picked, so the client can show
 * the right seed the instant a bush is tapped (./optimistic-actions.ts) and
 * a retried request can never pay out a different crop than the one it
 * already paid. Varied without dice: each pick advances that bush one step
 * along the tier-1 list, so a bush is a different seed next time it comes
 * back, and all seven crops come round.
 *
 * Pure and renderer-free, same split every other StackAcres model file
 * keeps: `now` always arrives as a parameter, nothing here reads a clock or
 * touches the database.
 */

import { STACKACRES_CATALOGUE, type StackAcresCrop } from "./catalogue";

/** The four Homestead bushes that carry berries in the art (`p128_0`,
 *  `p129_0`, `p131_0`, `p135_0`): the bare four stay scenery, so "has
 *  something on it" is readable off the drawing without a badge. Hand-picked
 *  rather than derived from art metadata, the same posture
 *  ./tree-nodes.ts states at length. */
export const FORAGE_NODE_IDS = [
  "homestead-1",
  "homestead-2",
  "homestead-3",
  "homestead-4",
] as const;

export type ForageNodeId = (typeof FORAGE_NODE_IDS)[number];

export function isForageNodeId(value: string): value is ForageNodeId {
  return (FORAGE_NODE_IDS as readonly string[]).includes(value);
}

/**
 * What the bushes carry, in the order a bush walks through them: the seven
 * tier-1 crops, the ones that cost 1 Gold and ripen in 15 seconds
 * (./catalogue.ts's TIER1). Tier 2 and 3 are never foraged -- a 120-Gold
 * Eggplant seed found in a hedge would make Ray's shop pointless, and the
 * slow tiers are what Gold is FOR.
 *
 * Wheat is not here either, even though it is the other cheap seed: it is
 * the one crop Ray sells unlocked from the start, so it needs no second
 * door.
 */
export const FORAGE_CROPS: readonly StackAcresCrop[] = [
  "lettuce",
  "spinach",
  "radish",
  "onion",
  "carrot",
  "potato",
  "cabbage",
];

/** Seeds one pick yields. Two, so a single bush is worth the walk over:
 *  one seed per bush would make the opening a tour of the whole yard for
 *  one bed's worth of planting. */
export const FORAGE_SEEDS_PER_PICK = 2;

/** How long a picked bush takes to carry seed again. Under wood's 8 minutes
 *  (./wood.ts) on purpose: seed is the cheapest thing on the farm and the
 *  opening loop stalls outright without it, where running dry of Wood only
 *  delays a building. */
export const FORAGE_REGROW_MS = 6 * 60 * 1000;

/** One bush's persisted state. `picks` only ever counts up; it is what
 *  `forageCrop` reads to decide which seed is on the bush now, so it must
 *  survive a regrow rather than resetting with one. */
export interface ForageNodeState {
  /** How many times this bush has been picked, ever. */
  readonly picks: number;
  /** When it was last picked, or null for a bush nobody has touched. */
  readonly pickedAt: string | null;
}

/** An untouched bush, carrying its first seed. */
export function freshForageNodeState(): ForageNodeState {
  return { picks: 0, pickedAt: null };
}

/**
 * Which seed `nodeId` is carrying after `picks` pickings.
 *
 * The node's own index offsets the walk, so the four bushes never all carry
 * the same crop at once -- a fresh farm has Lettuce, Spinach, Radish and
 * Onion standing in the yard, and Potato and Cabbage come round as the
 * bushes are worked.
 */
export function forageCrop(nodeId: ForageNodeId, picks: number): StackAcresCrop {
  const index = FORAGE_NODE_IDS.indexOf(nodeId);
  // `picks` is a stored count and should never be negative; a corrupt row is
  // folded back into range rather than throwing, the same "refuse or
  // normalise, never crash a read" posture ./soil.ts takes for a tier it
  // does not recognise.
  const step = Math.max(0, Math.trunc(picks));
  return FORAGE_CROPS[(index + step) % FORAGE_CROPS.length];
}

/**
 * The seed a bush will carry after the one it is carrying now.
 *
 * The same one-step walk `forageCrop` takes, expressed without the node or
 * its pick count -- the node's index only ever offsets where the walk
 * STARTS, so advancing from a known crop needs neither. This is what lets
 * the client advance a bush it has only a snapshot of
 * (./optimistic-actions.ts) and land on the answer the server will write.
 */
export function nextForageCrop(crop: StackAcresCrop): StackAcresCrop {
  const index = FORAGE_CROPS.indexOf(crop);
  // A crop that is not on the forage list has no next; leave it be rather
  // than silently moving the bush to Lettuce.
  if (index === -1) return crop;
  return FORAGE_CROPS[(index + 1) % FORAGE_CROPS.length];
}

/** The instant a picked bush carries seed again, or null while it never has
 *  been picked. */
export function forageNodeReadyAt(state: ForageNodeState): number | null {
  if (state.pickedAt === null) return null;
  const picked = Date.parse(state.pickedAt);
  return Number.isFinite(picked) ? picked + FORAGE_REGROW_MS : null;
}

/** Whether this bush can be picked right now. */
export function isForageNodeReady(state: ForageNodeState, now: Date): boolean {
  const readyAt = forageNodeReadyAt(state);
  return readyAt === null || readyAt <= now.getTime();
}

/** 0..1 while a picked bush is coming back, 1 once it is ready, null for one
 *  that was never picked -- the same three-way answer
 *  ./wood.ts's `woodNodeRespawnProgress` gives. */
export function forageNodeRespawnProgress(state: ForageNodeState, now: Date): number | null {
  if (state.pickedAt === null) return null;
  const picked = Date.parse(state.pickedAt);
  if (!Number.isFinite(picked)) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - picked) / FORAGE_REGROW_MS));
}

export interface ForagePickResult {
  readonly nextState: ForageNodeState;
  readonly crop: StackAcresCrop;
  readonly quantity: number;
}

/**
 * What one pick takes off `nodeId`, or null when the bush is bare right now.
 *
 * Null is a refusal, not an error, exactly like `swingAtWoodNode` returning
 * null on a felled tree: the server treats it as a tap that landed a moment
 * too late and answers with an unchanged farm.
 */
export function pickForageNode(
  nodeId: ForageNodeId,
  state: ForageNodeState,
  now: Date,
): ForagePickResult | null {
  if (!isForageNodeReady(state, now)) return null;
  return {
    nextState: { picks: state.picks + 1, pickedAt: now.toISOString() },
    // The crop the bush is carrying NOW, which is the one the count names
    // before this pick advances it -- so what the client predicted off the
    // same snapshot is what it gets.
    crop: forageCrop(nodeId, state.picks),
    quantity: FORAGE_SEEDS_PER_PICK,
  };
}

/** What the client needs to draw one bush: whether it can be picked, what
 *  seed is on it, and how far along its regrow clock is. */
export interface ForageNodeSnapshot {
  readonly nodeId: ForageNodeId;
  readonly ready: boolean;
  /** The seed this bush is carrying -- shown before the pick, not after, so
   *  a player can see what is on offer without picking to find out. */
  readonly crop: StackAcresCrop;
  readonly respawnProgress: number | null;
}

export function forageNodeSnapshot(
  nodeId: ForageNodeId,
  state: ForageNodeState,
  now: Date,
): ForageNodeSnapshot {
  return {
    nodeId,
    ready: isForageNodeReady(state, now),
    crop: forageCrop(nodeId, state.picks),
    respawnProgress: forageNodeRespawnProgress(state, now),
  };
}

/** "2 Radish seeds", for the pick's own toast. */
export function forageYieldLabel(crop: StackAcresCrop, quantity: number): string {
  const label = STACKACRES_CATALOGUE[crop].label;
  return `${quantity} ${label} seed${quantity === 1 ? "" : "s"}`;
}

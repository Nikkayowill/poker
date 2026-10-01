/**
 * The guard dog: an animal that keeps the herd near it home at night.
 *
 * A sheep or a cow in the open is lost some nights (./herd-risk.ts). A dog
 * standing within GUARD_DOG_RANGE squares of it keeps it where it is, the way a
 * fence does, without the fence. A dog does nothing for a crowded pen: too many
 * animals in too little room is a layout problem a dog cannot bark away.
 *
 * GOLD LEAVES ONCE, when the dog is bought, and it is spent before the dog
 * exists (lib/server/stackacres-service.ts's `buyStackAcresGuardDog`). Moving a
 * dog is free. There is no selling a dog back.
 *
 * A dog stands on a Homestead map square under the same rules as a herd animal
 * (./herd.ts): open yard grass, not a bed, a fence or another animal. It is set
 * down where it is bought and moved by lifting it, like the herd.
 *
 * Pure: the server, the scene and the herd bar all import this.
 */

import { herdKey, herdPlacementProblem, type HerdPlacementProblem } from "./herd";

/** What a dog costs. Between a sheep slot and a cattle slot: a real choice against 8 Wood of fence. */
export const GUARD_DOG_GOLD = 20_000;

/** How many dogs one farm keeps. */
export const GUARD_DOG_CAP = 2;

/** A dog keeps every herd animal within this many squares, in any direction, home at night. */
export const GUARD_DOG_RANGE = 3;

export interface GuardDog {
  id: string;
  /** The Homestead map square the dog stands on. */
  tx: number;
  ty: number;
}

export interface Square {
  readonly tx: number;
  readonly ty: number;
}

/** Whether a dog stands close enough to (tx, ty) to keep an animal there home. */
export function isGuarded(tx: number, ty: number, dogs: readonly Square[]): boolean {
  return dogs.some((dog) => Math.abs(dog.tx - tx) <= GUARD_DOG_RANGE && Math.abs(dog.ty - ty) <= GUARD_DOG_RANGE);
}

/** The squares every dog other than `exceptId` stands on, as herd keys. */
export function dogSquares(dogs: readonly GuardDog[], exceptId: string | null = null): Set<string> {
  const squares = new Set<string>();
  for (const dog of dogs) if (dog.id !== exceptId) squares.add(herdKey(dog.tx, dog.ty));
  return squares;
}

export type DogPlacementProblem = HerdPlacementProblem | "full";

export const DOG_PLACEMENT_MESSAGES: Record<DogPlacementProblem, string> = {
  off_yard: "Your dog goes on open grass in the yard.",
  bed: "There's a bed there.",
  fence: "There's a fence there.",
  occupied: "Something is already standing there.",
  full: `Two dogs is enough for one farm.`,
};

export const GUARD_DOG_COSTS = `A dog costs ${GUARD_DOG_GOLD.toLocaleString()} Gold.`;

/**
 * Why a dog may not be set down on (tx, ty), or null when it may. `taken` holds
 * the beds, the fences and every OTHER animal's and dog's square, so moving a
 * dog onto its own square is fine.
 */
export function dogPlacementProblem(
  tx: number,
  ty: number,
  taken: { beds: ReadonlySet<string>; fences: ReadonlySet<string>; animals: ReadonlySet<string> },
): DogPlacementProblem | null {
  return herdPlacementProblem(tx, ty, taken);
}

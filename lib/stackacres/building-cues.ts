/**
 * What is finished and waiting INSIDE a building, so its door can say so.
 *
 * The Workshop and the kitchen are walked into, so a finished Mill run, a
 * ready vat batch, aged jars and banked kitchen batches were all invisible
 * from the farm until the player happened to walk in.
 *
 * One answer, two renderings: journal.ts reads this for its "collect" line
 * and the map reads it for the badge over the door, so they cannot disagree.
 * Pure and clock-free, same as ./machines.ts.
 */

import type { VatContainer } from "./aging";
import { buildPlace, type BuildPlace } from "./build-cost";
import { farmKitchenBanked } from "./farm-kitchen";
import { isMachineDone, type MachineKind, type StackAcresMachineSnapshot } from "./machines";

/** A building with a door on the Homestead map. The prop tags the scene
 *  already draws these under, so a cue needs no second name for them. */
export type BuildingDoor = "workshop" | "farmhouse";

/** Which door each build place is behind. `BuildPlace` is the words the
 *  build costs already use ("Workshop", "House"), kept as the cue's own
 *  place chip so the Journal says it the same way everywhere. */
const DOOR: Readonly<Record<BuildPlace, BuildingDoor>> = { Workshop: "workshop", House: "farmhouse" };

/** The vat and the cellar hold their readiness on their own container, not
 *  on the machine row, so they get their own lines below and are left out of
 *  the finished-run count to avoid saying it twice. */
const OWN_LINE: ReadonlySet<MachineKind> = new Set<MachineKind>(["vat", "cellar"]);

export interface BuildingCue {
  readonly door: BuildingDoor;
  /** Ray's voice, one sentence. */
  readonly line: string;
  /** The place chip: "Workshop" or "House". */
  readonly where: BuildPlace;
}

export interface BuildingCueInput {
  readonly machines: readonly StackAcresMachineSnapshot[];
  readonly vat: Pick<VatContainer, "status"> | null;
  readonly cellar: Pick<VatContainer, "status"> | null;
  readonly nowMs: number;
}

/** How many runs have finished in one room. The vat and the cellar are left
 *  out: their readiness lives on their container, so they get their own line. */
export function finishedRunCount(
  machines: readonly StackAcresMachineSnapshot[],
  place: BuildPlace,
  nowMs: number,
): number {
  const now = new Date(nowMs);
  return machines.filter(
    (machine) => !OWN_LINE.has(machine.kind) && buildPlace(machine.kind) === place && isMachineDone(machine, now),
  ).length;
}

/** Whether any machine at all stands in a room, so a row about it is honest. */
export function roomHasMachines(machines: readonly StackAcresMachineSnapshot[], place: BuildPlace): boolean {
  return machines.some((machine) => !OWN_LINE.has(machine.kind) && buildPlace(machine.kind) === place);
}

/**
 * Everything waiting behind a door right now, worst first: a loss-free but
 * finished thing before a merely banked one.
 */
export function buildingCues(input: BuildingCueInput): readonly BuildingCue[] {
  const cues: BuildingCue[] = [];
  const now = new Date(input.nowMs);

  if (input.cellar?.status === "collectible") {
    cues.push({ door: "farmhouse", where: "House", line: "The jars in the cellar have finished aging." });
  }
  if (input.vat?.status === "collectible") {
    cues.push({ door: "workshop", where: "Workshop", line: "There's a batch sitting ready in the vat." });
  }

  for (const place of ["Workshop", "House"] as const) {
    const finished = finishedRunCount(input.machines, place, input.nowMs);
    if (finished === 0) continue;
    const room = place === "Workshop" ? "the Workshop" : "the kitchen";
    cues.push({
      door: DOOR[place],
      where: place,
      line:
        finished === 1
          ? `Something in ${room} has finished and is waiting to be taken.`
          : `${finished} things in ${room} have finished and are waiting to be taken.`,
    });
  }

  const kitchen = input.machines.find((machine) => machine.kind === "farm_kitchen");
  const banked = kitchen ? farmKitchenBanked(kitchen.kitchenSince, now) : 0;
  if (banked > 0) {
    cues.push({
      door: "farmhouse",
      where: "House",
      line:
        banked === 1
          ? "The Farm Kitchen has a batch banked."
          : `The Farm Kitchen has ${banked} batches banked.`,
    });
  }

  return cues;
}

/** One flag per door with something behind it, for the scene's badges. A
 *  missing key means nothing is waiting there. */
export function buildingCueDoors(input: BuildingCueInput): Readonly<Partial<Record<BuildingDoor, true>>> {
  const doors: Partial<Record<BuildingDoor, true>> = {};
  for (const cue of buildingCues(input)) doors[cue.door] = true;
  return doors;
}

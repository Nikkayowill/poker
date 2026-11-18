/**
 * The opening a new farm gets once: a few cards, then the bus from town, Ray at the stop, and the
 * walk up to the house. The player watches it and takes the farmer back when Ray says to.
 *
 * Everything the scene needs to stage it (where things stand, how long a line is held) and
 * everything the shell needs to show it (the cards, Ray's words) lives here, so the words can be
 * changed without opening the engine. The choreography itself is components/arcade/stackacres-td/
 * opening-director.ts.
 *
 * "Seen" is not stored on its own: Ray's seed pouch is handed over when the opening ends (or is
 * skipped), and that claim is already a once-per-farm flag (./starter-seeds.ts). A wiped farm has
 * no claim, so it sees the opening again.
 */

import type { Point } from "@/lib/stackacres-td/movement";

/**
 * Whether a farm is owed the opening on this visit. `seen` is the server's answer, or null when it has
 * not given one (an offline copy of the farm never does, so offline is never owed it). `replay` is the
 * `?opening=1` address, which plays it for anyone, and `off` is how the specs skip it.
 */
export function openingOwed(input: { seen: boolean | null; replay: boolean; off: boolean }): boolean {
  return input.replay || (input.seen === false && !input.off);
}

export interface OpeningCard {
  readonly text: string;
  /** Ray's letter is on screen above this card's words. It stays up across consecutive cards that have it. */
  readonly letter?: true;
}

/** Black cards before the scene, one at a time. */
export const OPENING_CARDS: readonly OpeningCard[] = [
  { text: "Ray worked these acres most of his life." },
  { text: "He wasn't a man for letters. He wrote one anyway.", letter: true },
  { text: "It said: come on out. There's work here, and it's yours.", letter: true },
];

/** How long a card is held before the next one comes up on its own. */
export const OPENING_CARD_MS = 3400;

/** Homestead map points, in the same units as area.json. The bus comes in along the west corridor, the same
 *  strip the gate to the city opens onto, and stops where no tree, rock or bush stands over it
 *  (lib/stackacres/opening.test.ts checks the bus against the map's props). */
export const OPENING_BUS_FROM: Point = { x: -64, y: 476 };
export const OPENING_BUS_STOP: Point = { x: 200, y: 476 };
/** The bus stop's post stands just past the bus's nose, a step behind the path he walks (it is drawn behind him). */
export const OPENING_SIGN: Point = { x: 268, y: 477 };
/** Where he steps off the bus: just in front of its open door, which is at the bus's front end. */
export const OPENING_DOOR: Point = { x: 216, y: 480 };
/** Ray waits down the corridor, facing the bus. */
export const OPENING_RAY_WAIT: Point = { x: 330, y: 486 };
/** The two stand a few steps apart to talk. */
export const OPENING_MEET_FARMER: Point = { x: 296, y: 486 };
/** The porch of the house, where Ray leaves him. Ray stands at the well's far spot, which is where
 *  his morning round has him, so handing him back to the schedule is not a jump. */
export const OPENING_PORCH_RAY: Point = { x: 452, y: 322 };
export const OPENING_PORCH_FARMER: Point = { x: 496, y: 344 };

/** Walking pace for the walk up to the house, map units a second. Ray's own is half the farmer's. */
export const OPENING_WALK_SPEED = 44;

export const OPENING_BUS_MS = 4200;
export const OPENING_DOOR_PAUSE_MS = 700;
/** The door swings open this long before he steps through it, and shuts again this long after it opened. */
export const OPENING_DOOR_OPEN_MS = 450;
export const OPENING_DOOR_CLOSE_AFTER_MS = 1500;
/** The farmer sets off this long after Ray, so he follows rather than walking in step. */
export const OPENING_FOLLOW_LAG_MS = 650;

export interface OpeningBeat {
  /** Where the line is said: the stop, the walk or the porch. Only the order matters to the engine. */
  readonly at: "stop" | "porch";
  readonly text: string;
}

/** Ray's words, in order. The last one hands the farmer back. */
export const OPENING_LINES: readonly OpeningBeat[] = [
  { at: "stop", text: "Well, look at you. Got here in one piece." },
  { at: "stop", text: "Not much to carry. Good. You'll pick things up." },
  { at: "stop", text: "Come on. The house is just up past the trees." },
  { at: "porch", text: "This is it. House, barn, the old workshop. All of it's yours now." },
  { at: "porch", text: "Roof leaks over the kitchen. Bed's good. Well's better." },
  { at: "porch", text: "Go on and have a look round. Nobody's going to tell you where to start." },
  { at: "porch", text: "When you're ready, come find me in the city. I'll be there." },
];

/** How long a line stays up: a beat to start, then the time it takes to read, within a floor and a ceiling. */
export function openingLineMs(text: string): number {
  return Math.min(6500, Math.max(2400, 900 + text.length * 55));
}

export type OpeningFacing = "up" | "down" | "left" | "right";

/** The way to face to look from one point toward another. */
export function facingToward(from: Point, to: Point): OpeningFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up";
}

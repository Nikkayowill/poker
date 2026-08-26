/**
 * The handoff between the layers that know where things are and the seam
 * that reports it.
 *
 * `window.__stackchipsScene` has to answer for chips that no React state
 * holds: `chip-instanced-layer.tsx` writes InstancedMesh matrices straight
 * from a per-frame `write()` pass, because pushing sixty matrix updates a
 * second through the reconciler is what that file exists to avoid. Those
 * positions are real, on screen, and invisible to every ordinary React path
 * a seam component could read.
 *
 * So the writer publishes here and the seam reads here. Module scope rather
 * than a context, for two reasons: the writer is inside a `useFrame`
 * callback where a context read would be a re-render per frame, and exactly
 * one room is ever mounted (the renderer is chosen by a single ternary in
 * `poker-table.tsx`), so there is no second scene to collide with.
 *
 * Everything is stored in world space. Projection belongs to the seam,
 * which is the only piece with a camera; keeping it out of here is what
 * lets this module be plain data with no three.js import, reachable by
 * `npm test`.
 */

import type { Vec3 } from "./scene-projection";

export interface SceneRegistrySnapshot {
  /** Every chip currently in the air, world space. */
  flightChips: readonly Vec3[];
  /** Chips resting in the centre pot pile. Bets in front of seats are not counted. */
  potPileChips: number;
  /** Ring slots the last payout was aimed at. */
  lastFunnel: readonly number[];
  /**
   * Whether the room still has animation to show, and therefore whether the
   * demand loop stays awake.
   *
   * This is pending work, not recent paint, the same thing the Canvas-2D
   * room's scheduler flag means. See the note at the foot of
   * ./scene-projection.ts: under software rendering the room drew twice a
   * second, so a frame-recency check narrow enough to prove a loop had
   * settled reported a visibly animating room as asleep.
   */
  animating: boolean;
}

const EMPTY: SceneRegistrySnapshot = {
  flightChips: [],
  potPileChips: 0,
  lastFunnel: [],
  animating: false,
};

let state: SceneRegistrySnapshot = EMPTY;

/**
 * Replace the airborne set. Called once per rendered frame while anything is
 * flying, so it takes the array it is given rather than copying: the caller
 * builds a fresh one each pass, and a defensive copy here would allocate on
 * every frame of every flight to protect against an aliasing bug that the
 * one caller does not have.
 */
export function publishFlightChips(chips: readonly Vec3[]): void {
  state = { ...state, flightChips: chips };
}

export function publishPotPileChips(count: number): void {
  state = { ...state, potPileChips: count };
}

export function publishFunnel(slots: readonly number[]): void {
  state = { ...state, lastFunnel: slots };
}

export function publishAnimating(animating: boolean): void {
  state = { ...state, animating };
}

export function readSceneRegistry(): SceneRegistrySnapshot {
  return state;
}

/**
 * Drop everything back to empty.
 *
 * The seam calls this on unmount. Without it a torn-down room leaves its
 * last frame's chips readable through a `window` object that outlives it,
 * and a test that raced the teardown would assert against a room no longer
 * on screen. That fails in the one direction that wastes the most time: by
 * passing.
 */
export function resetSceneRegistry(): void {
  state = EMPTY;
}

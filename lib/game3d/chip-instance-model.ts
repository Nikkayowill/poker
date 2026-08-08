/**
 * Pure chip-pose math for the InstancedMesh chip layer
 * (components/game3d/chips/chip-instanced-layer.tsx).
 *
 * WHY THIS EXISTS SEPARATELY FROM chip-stack.tsx / chip-field.tsx. Those two
 * files render the individual-mesh way: each pile or flight owns a React
 * component that emits its own <mesh> elements, and three.js tracks each
 * chip as its own draw call. Instancing inverts that — ONE component owns
 * six InstancedMeshes (one per denomination) and has to write every chip on
 * the felt into those shared buffers in a single pass, so there has to be
 * one function that answers "given this pile, or this flight at this
 * moment, where is each of its chips" without also deciding how — or
 * whether — to render it. That's this file: no three.js import, so
 * `npm test` reaches it, exactly like chip-trajectory.ts and
 * denominations.ts already do. It is arithmetic ONLY: chip-instanced-
 * layer.tsx is the thin three.js shell that calls this every write pass and
 * pushes the results into `InstancedMesh.setMatrixAt`.
 *
 * Both functions below are built from chip-trajectory.ts's
 * pileChipJitter/pileChipRotationY and sampleChipFlight — the same math
 * the room's individual-mesh chip renderer used before it was replaced by
 * the InstancedMesh layer (see chip-instanced-layer.tsx and chip-stack.tsx's
 * own header), so the choreography a bet or a sweep produces did not
 * change shape when the rendering underneath it did.
 */

import { chipBreakdown, type ChipDenomination } from "./denominations";
import {
  landingOffset,
  pileChipJitter,
  pileChipRotationY,
  sampleChipFlight,
} from "./chip-trajectory";
import { CHIP } from "./dimensions";
import type { Vec3 } from "./seat-layout";

export interface ChipPose {
  /** Stable per-chip identity within one write pass — not read by three.js,
   * only used by callers/tests that want to tell chips apart. */
  key: string;
  /** Which InstancedMesh (denomination tier) this chip belongs in. */
  denom: number;
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/**
 * Every chip in a single RESTING pile — stacked flush (i-th chip at
 * i * CHIP.thickness) and jittered exactly as ChipStack draws it.
 */
export function restingPileChipPoses(
  amount: number,
  position: Vec3,
  seed: number,
  keyPrefix: string,
): ChipPose[] {
  const chips = chipBreakdown(amount);
  return chips.map((denom, i) => {
    const { dx, dz } = pileChipJitter(i, seed);
    return {
      key: `${keyPrefix}-${i}`,
      denom: denom.value,
      x: position.x + dx,
      y: position.y + CHIP.thickness / 2 + i * CHIP.thickness,
      z: position.z + dz,
      rotationY: pileChipRotationY(i, seed),
    };
  });
}

export interface FlightPoseResult {
  poses: ChipPose[];
  /** True once every chip in the flight has finished its bounce — the
   * write pass uses this to retire the flight, the same as FlightGroup's
   * own `doneRef`/`onDone` contract. */
  done: boolean;
}

/**
 * Every chip in one in-flight group, sampled at `elapsedMs` since launch.
 * Mirrors FlightGroup's useFrame body: per-chip landing target is the
 * flight's `to` plus that chip's landingOffset scatter, and airborne chips
 * stack loosely by `i % 3` the same way a poured-out group does.
 */
export function flightChipPoses(
  chips: ChipDenomination[],
  from: Vec3,
  to: Vec3,
  elapsedMs: number,
  keyPrefix: string,
): FlightPoseResult {
  if (chips.length === 0) return { poses: [], done: true };

  let done = true;
  const poses: ChipPose[] = chips.map((denom, i) => {
    const off = landingOffset(i);
    const target: Vec3 = { x: to.x + off.dx, y: to.y, z: to.z + off.dz };
    const sample = sampleChipFlight(from, target, elapsedMs, i);
    if (!sample.done) done = false;
    return {
      key: `${keyPrefix}-${i}`,
      denom: denom.value,
      x: sample.position.x,
      y: sample.position.y + CHIP.thickness / 2 + (i % 3) * CHIP.thickness,
      z: sample.position.z,
      rotationY: 0,
    };
  });

  return { poses, done };
}

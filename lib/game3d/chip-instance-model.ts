/**
 * Pure chip-pose math for the InstancedMesh chip layer
 * (components/game3d/chips/chip-instanced-layer.tsx).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE COMPONENTS. Instancing means ONE
 * component owns six InstancedMeshes (one per denomination) and has to
 * write every chip on the felt into those shared buffers in a single pass,
 * so there has to be one function that answers "given this pile, or this
 * push at this moment, where is each of its chips" without also deciding
 * how — or whether — to render it. That's this file: no three.js import, so
 * `npm test` reaches it, exactly like chip-trajectory.ts and
 * denominations.ts already do. It is arithmetic ONLY: chip-instanced-
 * layer.tsx is the thin three.js shell that calls this every write pass and
 * pushes the results into `InstancedMesh.setMatrixAt`.
 *
 * `pileSlot` BELOW IS THE WHOLE DESIGN. A chip on this felt is only ever
 * in one of two states: resting in a numbered slot of some pile, or on its
 * way to a numbered slot of some pile. Both read the same function, so a
 * chip's landing IS its resting place — not a scattered approximation of
 * it that snaps on arrival. That is what makes "settle exactly into the
 * final stack position" true by construction rather than by tuning, and it
 * is what the old spray could not do: it aimed a whole group at one point
 * and let a golden-angle wave strew them around it, which is why chips
 * ended up sitting inside one another.
 */

import { chipBreakdown, type ChipDenomination } from "./denominations";
import { CHIP } from "./dimensions";
import {
  chipStackY,
  effectivePushStyle,
  pileChipJitter,
  pileChipRotationY,
  sampleChipPush,
  type PushStyle,
} from "./chip-trajectory";
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
  /** Landing rock, on the two ground axes. Zero for anything at rest. */
  tiltX: number;
  tiltZ: number;
}

/** A numbered place in a pile: where the `index`-th chip of the pile based
 * at `position` sits, and which way round it lies. */
export interface PileSlot extends Vec3 {
  rotationY: number;
}

/**
 * How many chips a single column holds before the next one starts beside it.
 *
 * 20 is what a dealer counts into a stack, and it is also about where a
 * column stops looking like a stack: 20 discs is 66 mm against a 39 mm
 * diameter, so 1.7 times as tall as it is wide. Past that a single column
 * is a tower, which is the thing a real table never has.
 */
export const CHIPS_PER_COLUMN = 20;

/**
 * Gap between column centres, as a fraction of a chip's diameter. Just over
 * 1 so neighbouring columns stand clear of each other rather than merging
 * into one blur at a distance.
 */
const COLUMN_PITCH = 1.18;

/**
 * The direction a pile's columns march in, given where the pile sits.
 *
 * The tangent to the ellipse through that point — so a bet in front of a
 * seat spreads ALONG the rail rather than toward or away from the player,
 * which is both what a real bet looks like and what keeps a side seat's
 * chips on the cloth instead of walking them over the rail. Derived from the
 * position rather than passed in, so every existing caller of `pileSlot`
 * gets the right axis without knowing there is one.
 *
 * The pot sits near the centre line, where the radial is along -Z, so its
 * columns run across the table in a row — again what a dealer does.
 */
function columnAxis(position: Vec3): { x: number; z: number } {
  const length = Math.hypot(position.x, position.z);
  // A pile exactly at the centre has no tangent; the table's long axis is
  // the only sensible answer and is also the one with room for columns.
  if (length < 1e-6) return { x: 1, z: 0 };
  return { x: -position.z / length, z: position.x / length };
}

/**
 * THE definition of where a chip lives. Height is exact
 * (chipStackY — flush discs, no gaps and no interpenetration); the lateral
 * offset is the bounded pile jitter, and the spin keeps eight moulded
 * inserts from lining up into a seam down the column.
 *
 * COLUMNS, NOT A TOWER. Chips past `CHIPS_PER_COLUMN` start a new column
 * beside the last rather than continuing up, the way a dealer breaks a pot
 * into stacks.
 *
 * The columns fan out ALTERNATELY — 0, +1, -1, +2, -2 — and that is a
 * correctness requirement, not a look. A slot is a pure function of its
 * index and nothing else: if the offset depended on how many columns the
 * pile currently has, then adding the chip that opens a new column would
 * silently re-place every chip already resting, and they would teleport
 * sideways mid-hand. Alternating keeps the pile visually centred on its own
 * position as it grows while leaving every existing chip exactly where it
 * was.
 *
 * Because this is also what a flight aims at, a chip pushed into a pile
 * that is already two columns deep flies to the correct slot of the correct
 * column — the landing IS the resting place, which is the property this
 * whole module is built around.
 */
export function pileSlot(position: Vec3, seed: number, index: number): PileSlot {
  const { dx, dz } = pileChipJitter(index, seed);
  const column = Math.floor(index / CHIPS_PER_COLUMN);
  const row = index % CHIPS_PER_COLUMN;

  // 0, +1, -1, +2, -2, ... — see the header on why this depends on `column`
  // alone and never on the pile's size.
  const step = Math.ceil(column / 2) * (column % 2 === 1 ? 1 : -1);
  const offset = step * CHIP.radius * 2 * COLUMN_PITCH;
  const axis = columnAxis(position);

  return {
    x: position.x + axis.x * offset + dx,
    y: chipStackY(position.y, row),
    z: position.z + axis.z * offset + dz,
    rotationY: pileChipRotationY(index, seed),
  };
}

/**
 * Jitter seeds, one per pile the felt can hold. A seed only phases the
 * bounded wave in `pileChipJitter` — it does not change how far a chip can
 * sit out of true — so its whole job is keeping two piles of the same size
 * from stacking identically.
 */
export const POT_PILE_SEED = 101;

export function seatPileSeed(slot: number): number {
  return slot * 7;
}

/** How many physical chips an amount is drawn as — the displayed count, which
 * is what a pile's height, its shadow and any stack landing on top of it all
 * have to agree on. */
export function pileChipCount(amount: number): number {
  return chipBreakdown(amount).length;
}

/**
 * Every chip in a single RESTING pile, stacked flush from the pile's base.
 */
export function restingPileChipPoses(
  amount: number,
  position: Vec3,
  seed: number,
  keyPrefix: string,
): ChipPose[] {
  return chipBreakdown(amount).map((denom, i) => {
    const slot = pileSlot(position, seed, i);
    return {
      key: `${keyPrefix}-${i}`,
      denom: denom.value,
      x: slot.x,
      y: slot.y,
      z: slot.z,
      rotationY: slot.rotationY,
      tiltX: 0,
      tiltZ: 0,
    };
  });
}

/**
 * One chip's journey: the exact slot it leaves and the exact slot it takes.
 * Built by `buildPushLegs`, never by hand — the two ends have to be real
 * pile slots or the chip departs from, or arrives at, thin air.
 */
export interface ChipPushLeg {
  source: Vec3;
  target: Vec3;
  /** The destination slot's spin, carried through the flight so nothing
   * rotates on touchdown. */
  rotationY: number;
}

/**
 * A stack of chips being taken off something. `position`/`seed` name the
 * pile they are lifted from — a bettor's hand is modelled as a pile too,
 * held at hand height, so there is one shape here rather than two.
 */
export interface PushOrigin {
  position: Vec3;
  seed: number;
  /** Index of the lowest slot this group occupies. */
  startIndex: number;
  /** Take the top chip first, the way a hand or a dealer actually peels one
   * off. False stacks the group out from the bottom up. */
  topFirst: boolean;
}

/** Where a pushed group is going, and which slot the first chip takes. */
export interface PushDestination {
  position: Vec3;
  seed: number;
  /** Chips already resting there — the group lands ON TOP of them, which is
   * the difference between a stack and a heap. */
  startIndex: number;
}

/**
 * Resolve a group of `count` chips into explicit per-chip legs.
 *
 * The i-th chip to LAUNCH takes the i-th slot up from `destination.
 * startIndex`, so a group builds its stack bottom-up in launch order — the
 * domino read. Sources run the other way when `topFirst`, because that is
 * where a hand or a dealer's fingers actually take chips from.
 */
export function buildPushLegs(
  count: number,
  origin: PushOrigin,
  destination: PushDestination,
): ChipPushLeg[] {
  const legs: ChipPushLeg[] = [];
  for (let i = 0; i < count; i += 1) {
    const sourceIndex = origin.startIndex + (origin.topFirst ? count - 1 - i : i);
    const target = pileSlot(destination.position, destination.seed, destination.startIndex + i);
    legs.push({
      source: pileSlot(origin.position, origin.seed, sourceIndex),
      target: { x: target.x, y: target.y, z: target.z },
      rotationY: target.rotationY,
    });
  }
  return legs;
}

export interface FlightPoseResult {
  poses: ChipPose[];
  /** True once every chip in the group has settled flat — the write pass
   * uses this to retire the flight. */
  done: boolean;
}

/**
 * Every chip of one pushed group, sampled `elapsedMs` after it launched.
 *
 * `reducedMotion` puts every chip straight into its final slot. Because
 * those slots are explicit rather than integrated, that is the *same*
 * arrangement the animation would have produced — a player who asked for
 * less motion sees the identical felt, just without the travel.
 */
export function pushChipPoses(
  chips: ChipDenomination[],
  legs: ChipPushLeg[],
  style: PushStyle,
  elapsedMs: number,
  keyPrefix: string,
  reducedMotion = false,
): FlightPoseResult {
  const count = Math.min(chips.length, legs.length);
  if (count === 0) return { poses: [], done: true };

  // The group's cadence, resolved against the wall-clock budget once for the
  // whole push — see effectivePushStyle. For an ordinary bet this IS the
  // authored style; only a group big enough to overrun the next deal is
  // compressed.
  const flownStyle = effectivePushStyle(count, style);

  let done = true;
  const poses: ChipPose[] = [];
  for (let i = 0; i < count; i += 1) {
    const leg = legs[i];
    const sample = sampleChipPush(leg.source, leg.target, elapsedMs, i, flownStyle, reducedMotion);
    if (!sample.done) done = false;
    poses.push({
      key: `${keyPrefix}-${i}`,
      denom: chips[i].value,
      x: sample.position.x,
      y: sample.position.y,
      z: sample.position.z,
      rotationY: leg.rotationY,
      tiltX: sample.tiltX,
      tiltZ: sample.tiltZ,
    });
  }

  return { poses, done };
}

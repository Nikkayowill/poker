"use client";

/**
 * Every chip on the felt, drawn in exactly CHIP_DENOMINATIONS.length (6)
 * draw calls, one InstancedMesh per denomination tier, no matter how many
 * piles or flights are on screen. This is the rendering half of the pure
 * math in lib/game3d/chip-instance-model.ts: this file owns the GPU buffers
 * and the one write pass that fills them, and the math file only ever
 * answers "where is this chip right now".
 *
 * One component owns every chip rather than each pile/flight owning its
 * own because an InstancedMesh's buffer is shared, imperative GPU state: a
 * denomination's mesh has to contain every $5 chip on the table (spread
 * across six seats' piles, the pot, and any mid-air flight) in one array,
 * written in one pass. Two separate React components each calling
 * `setMatrixAt` on the same mesh in their own `useFrame` would race on
 * write order with no ordering guarantee between them; neither three.js
 * nor React serializes that. So chip-field.tsx keeps owning which piles and
 * flights exist (the choreography state machine, with its hand-boundary/
 * sweep/award contract, is untouched); this file is the single writer that
 * turns "here is the current set of piles and flights" into six meshes'
 * worth of matrices, once per frame.
 *
 * Chips render shadow-free here; see fake-shadows.tsx for what grounds
 * them instead of a per-chip shadow-map draw.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { ChipDenomination } from "@/lib/game3d/denominations";
import { CHIP_DENOMINATIONS } from "@/lib/game3d/denominations";
import {
  pushChipPoses,
  restingPileChipPoses,
  type ChipPose,
  type ChipPushLeg,
} from "@/lib/game3d/chip-instance-model";
import type { PushStyle } from "@/lib/game3d/chip-trajectory";
import type { Vec3 } from "@/lib/game3d/seat-layout";
import {
  publishAnimating,
  publishFlightChips,
  publishPotPileChips,
} from "@/lib/game3d/scene-registry";
import { chipGeometry, chipMaterials } from "./chip-stack";
import { useDemandFrame } from "../scene/demand-loop";

/**
 * Per-denomination instance cap. Derived, not guessed: a six-max table has
 * at most 6 seat piles + 1 pot pile resting at once, each capped at
 * MAX_CHIPS_PER_PILE (14, and rarely anywhere near that many of a single
 * denomination since the greedy breakdown favours large chips first), plus
 * headroom for two flight groups landing at once during fast action
 * (an all-in call racing a side-pot sweep). 7 piles x 14 + 2 flights x 14
 * = 126; rounded up for margin rather than trimmed to the exact worst case.
 */
const MAX_INSTANCES_PER_DENOMINATION = 128;

/** Scratch object reused for every `setMatrixAt` call across every mesh.
 * Written and immediately read back (`updateMatrix()` then `toArray` inside
 * three's own `setMatrixAt`) within the same synchronous pass, so one
 * shared instance is safe: the same "one shared X, never per-chip
 * allocation" contract chipGeometry and chipMaterials already keep. */
const dummy = new THREE.Object3D();

/**
 * The centre pile's key. Exported so `chip-field.tsx` names it and the
 * `write()` pass below recognises it from one definition rather than two
 * copies of the string "pile-pot" that only agree by luck. The seam's
 * `pileSize()` counts this pile specifically, and a rename on one side
 * alone would make it silently report zero.
 */
export const POT_PILE_KEY = "pile-pot";

export interface RestingChipPile {
  key: string;
  amount: number;
  position: Vec3;
  seed: number;
}

export interface ChipFlightInput {
  key: string;
  chips: ChipDenomination[];
  /** Per-chip source and destination, index-aligned with `chips`. Explicit
   * rather than a single `to` point with scatter around it; see
   * chip-instance-model.ts's header for what that scatter cost. */
  legs: ChipPushLeg[];
  style: PushStyle;
}

export interface ChipInstancedLayerProps {
  piles: RestingChipPile[];
  flights: ChipFlightInput[];
  /** Called exactly once, the frame a flight's last chip finishes settling. */
  onFlightDone: (key: string) => void;
}

function pushPose(byDenom: Map<number, ChipPose[]>, pose: ChipPose) {
  let bucket = byDenom.get(pose.denom);
  if (!bucket) {
    bucket = [];
    byDenom.set(pose.denom, bucket);
  }
  bucket.push(pose);
}

export function ChipInstancedLayer({ piles, flights, onFlightDone }: ChipInstancedLayerProps) {
  const meshesRef = useRef(new Map<number, THREE.InstancedMesh>());
  const launchedAtRef = useRef(new Map<string, number>());
  // The Canvas's own clock, selected once. The object reference is stable
  // for the Canvas's whole lifetime (R3F creates it once in the store), so
  // this selector never triggers a re-render on its own; it exists purely
  // to read `.elapsedTime` from the layout effect below without a second,
  // mismatched time source. Reading `performance.now()` here instead would
  // be a real bug, not a style choice: it counts from page navigation,
  // while `state.clock.elapsedTime` (what useDemandFrame's tick uses)
  // counts from whenever the Canvas mounted. Two different epochs feeding
  // the same `launchedAtRef` map means a flight's elapsed time gets
  // computed against the wrong origin, staying negative forever, which is
  // exactly the "chip hovers, holding the render loop awake" failure this
  // file's design is meant to prevent.
  const clock = useThree((state) => state.clock);
  // Refs, not closures: `write` below is recreated every render (it closes
  // over this render's `piles`/`flights`/`onFlightDone`), but useDemandFrame
  // itself decides when to call it, driven by `flights.length > 0`. The
  // launch-time bookkeeping has to survive across renders regardless of how
  // often the callback identity changes, so it lives in a ref, not state.
  const onFlightDoneRef = useRef(onFlightDone);
  useEffect(() => {
    onFlightDoneRef.current = onFlightDone;
  }, [onFlightDone]);

  // A ref, not state: `write()` reads it inside a frame callback, and a
  // preference that changes mid-session must not re-render the whole chip
  // layer to take effect. Read once at mount and kept current by the media
  // query, the same shape components/table/scene/table-scene.tsx uses for
  // the 2D room, so both renderers honour the OS setting identically.
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    const onChange = () => {
      reducedMotionRef.current = query.matches;
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const write = (nowMs: number) => {
    const byDenom = new Map<number, ChipPose[]>();
    // Gathered for the e2e seam, which cannot see any of this: these poses
    // go straight into InstancedMesh matrices and never touch React state.
    // See lib/game3d/scene-registry.ts.
    let potPileChips = 0;
    const airborne: Vec3[] = [];

    for (const pile of piles) {
      if (pile.amount <= 0) continue;
      const poses = restingPileChipPoses(pile.amount, pile.position, pile.seed, pile.key);
      if (pile.key === POT_PILE_KEY) potPileChips = poses.length;
      for (const pose of poses) pushPose(byDenom, pose);
    }

    for (const flight of flights) {
      let launchedAt = launchedAtRef.current.get(flight.key);
      if (launchedAt === undefined) {
        launchedAt = nowMs;
        launchedAtRef.current.set(flight.key, launchedAt);
      }
      const elapsed = nowMs - launchedAt;
      const { poses, done } = pushChipPoses(
        flight.chips,
        flight.legs,
        flight.style,
        elapsed,
        flight.key,
        reducedMotionRef.current,
      );
      for (const pose of poses) pushPose(byDenom, pose);
      // A settled flight's chips are at their destination and this pile is
      // about to own them, so they stop counting as in flight the same frame
      // they arrive, matching what the 2D room's `moving` set does.
      if (!done) {
        for (const pose of poses) airborne.push({ x: pose.x, y: pose.y, z: pose.z });
      }
      if (done) {
        launchedAtRef.current.delete(flight.key);
        onFlightDoneRef.current(flight.key);
      }
    }

    publishFlightChips(airborne);
    publishPotPileChips(potPileChips);

    for (const denom of CHIP_DENOMINATIONS) {
      const mesh = meshesRef.current.get(denom.value);
      if (!mesh) continue;
      const poses = byDenom.get(denom.value) ?? [];
      const count = Math.min(poses.length, MAX_INSTANCES_PER_DENOMINATION);
      for (let i = 0; i < count; i += 1) {
        const pose = poses[i];
        dummy.position.set(pose.x, pose.y, pose.z);
        // Tilt is the landing rock and is exactly 0 for anything at rest, so
        // a settled pile is still a column of flat discs.
        dummy.rotation.set(pose.tiltX, pose.rotationY, pose.tiltZ);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  // Resting-pile changes arrive as ordinary React props (a new bet landed,
  // a hand boundary cleared the felt); that alone already invalidates the
  // demand loop for one frame (see demand-loop.ts's header), so an effect
  // is enough to keep the buffers in step with piles that aren't currently
  // airborne. Layout-timed, not a plain effect: every InstancedMesh starts
  // life with `count` at its full constructor arg and every instance
  // matrix at identity (three.js's own constructor), which reads as a
  // phantom stack of chips sitting at the world origin. A plain
  // `useEffect` runs after paint, so demand mode's own auto-invalidate-on-
  // mount would draw that garbage frame before this ever ran;
  // `useLayoutEffect` clears it before the browser paints.
  // `write` is intentionally omitted from the deps array below: it is
  // recreated fresh every render (closing over that render's piles/
  // flights), so listing it would make this effect run on every render
  // regardless of whether `piles` itself changed, exactly what depending
  // only on `[piles]` is meant to avoid.
  //
  // `clock.elapsedTime` here, not a fresh read of "now" some other way, and
  // it's safe because of where a new flight can originate: chip-field.tsx
  // only ever launches one from inside its own `useFrame` (see that file's
  // comment on why), which only runs during an actual rendered tick, i.e.
  // exactly when R3F has just recomputed `clock.elapsedTime` for "now". The
  // `setFlights` that follows commits synchronously before the next tick,
  // so this layout effect's read of `clock.elapsedTime` is still that same
  // tick's fresh value, not a stale one frozen from whenever the demand
  // loop last slept.
  useLayoutEffect(() => {
    write(clock.elapsedTime * 1000);
  }, [piles]); // eslint-disable-line react-hooks/exhaustive-deps

  const animating = flights.length > 0;

  useDemandFrame(
    (state) => write(state.clock.elapsedTime * 1000),
    animating,
  );

  // The seam's `awake()`. Published from the very flag that decides whether
  // the demand loop is kept alive above, so the two cannot disagree. An
  // effect rather than a render-body call because this is an external
  // store, and keyed on the boolean so it also fires on the falling edge,
  // when `write()` may never run again to report the room has settled.
  useEffect(() => {
    publishAnimating(animating);
  }, [animating]);

  return (
    <>
      {CHIP_DENOMINATIONS.map((denom) => (
        <instancedMesh
          key={denom.value}
          ref={(mesh) => {
            if (mesh) meshesRef.current.set(denom.value, mesh);
            else meshesRef.current.delete(denom.value);
          }}
          args={[chipGeometry, undefined, MAX_INSTANCES_PER_DENOMINATION]}
          material={chipMaterials(denom)}
          // `count` is not a declarative prop here: `write()` owns it
          // imperatively every pass, and a JSX prop would fight that on
          // every re-render (three's InstancedMesh has no dirty-check
          // against "did this prop actually change", so a literal
          // `count={0}` would zero it straight back out the next time this
          // component re-renders with new `piles`/`flights`, independent
          // of what write() just set).
          // The working volume (felt + the chip flight arcs above it) sits
          // fully inside the fixed camera framing at every viewport this
          // room supports, so there is nothing to cull. Skipping three's
          // automatic bounding-sphere recompute (which setMatrixAt would
          // otherwise require after every write) is a real cost saved, not
          // just a risk avoided.
          frustumCulled={false}
        />
      ))}
    </>
  );
}

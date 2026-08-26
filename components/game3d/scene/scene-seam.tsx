"use client";

/**
 * `window.__stackchipsScene` for the R3F room.
 *
 * The contract is `lib/scene/seam-contract.ts`, the same one the Canvas-2D
 * room answers, so the specs that check where a payout lands or whether the
 * loop sleeps run against whichever renderer the preference happens to have
 * mounted. What changes here is not the questions but how they can be
 * answered at all, and two of them stop being derivable:
 *
 * - **There is no single scale.** Orthography gave the 2D room one number
 *   for CSS-pixels-per-world-unit, solved in closed form. A perspective
 *   camera covers more pixels with a near unit than a far one, so this
 *   *measures* across the felt's centre and the contract says the reading
 *   only means anything there.
 * - **The felt is not an ellipse on screen.** Projected, its near edge is
 *   wider than its far edge. `roomFelt` samples the rim, projects every
 *   sample, and reports the bounding box, the honest reduction and the
 *   one a test comparing against a DOM rect wants.
 *
 * Mounted inside `<Canvas>` because that is the only place `useThree` can
 * reach the live camera. It renders nothing.
 *
 * Shipped in production, not dev-gated, matching the 2D room's own decision:
 * everything it exposes, projected chip positions, a frame counter, is
 * already on screen for anyone looking at it.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { StackchipsSceneSeam } from "@/lib/scene/seam-contract";
import {
  ellipseRimSamples,
  ndcToViewport,
  scaleBetween,
  screenExtent,
  type Point2,
  type Vec3,
} from "@/lib/game3d/scene-projection";
import { readSceneRegistry, resetSceneRegistry } from "@/lib/game3d/scene-registry";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  betSpotPosition,
  seatPosition,
} from "@/lib/game3d/seat-layout";

/**
 * How many points to walk around the felt's rim for `roomFelt`.
 *
 * The sampled hull is inscribed, so it can only understate the silhouette.
 * At 64 the worst-case understatement is under a tenth of a percent of the
 * radius, comfortably inside the pixel that any consumer rounds to, while
 * still being a single cheap loop on a call nobody makes per frame.
 */
const RIM_SAMPLES = 64;

/** A world unit either side of centre, to measure the felt-plane scale over. */
const SCALE_PROBE = 1;

export function SceneSeam() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const framesRef = useRef(0);

  /*
   * The live room renders continuously so skeletal mixers can breathe and
   * gesture between game-state mutations. This counter lets the browser test
   * prove that frames continue even when the chip scheduler's `awake()` flag
   * is false. `useFrame` only observes the loop; it does not create one.
   */
  useFrame(() => {
    framesRef.current += 1;
  });

  useEffect(() => {
    // Scratch vectors, reused. `project()` mutates in place, and `chips()`
    // can be called with a hundred chips in the air.
    const scratch = new THREE.Vector3();

    const canvasRect = () => gl.domElement.getBoundingClientRect();

    /** World point to viewport CSS pixels, through the live camera. */
    const toViewport = (point: Vec3, rect: DOMRect): Point2 => {
      scratch.set(point.x, point.y, point.z).project(camera);
      return ndcToViewport({ x: scratch.x, y: scratch.y }, rect);
    };

    const seam: StackchipsSceneSeam = {
      chips: () => {
        const rect = canvasRect();
        return readSceneRegistry().flightChips.map((chip) => toViewport(chip, rect));
      },
      pileSize: () => readSceneRegistry().potPileChips,
      seat: (slot: number) => toViewport(seatPosition(slot), canvasRect()),
      betSpot: (slot: number) => toViewport(betSpotPosition(slot), canvasRect()),
      roomScale: () => {
        // Measured across the felt's centre, on the felt plane. Under
        // perspective this is a reading at one depth, not a property of the
        // scene; see the contract.
        const rect = canvasRect();
        const left = toViewport({ x: -SCALE_PROBE, y: FELT_TOP_Y, z: 0 }, rect);
        const right = toViewport({ x: SCALE_PROBE, y: FELT_TOP_Y, z: 0 }, rect);
        return scaleBetween(left, right, SCALE_PROBE * 2);
      },
      roomFelt: () => {
        const rect = canvasRect();
        const rim = ellipseRimSamples(FELT_RADIUS_X, FELT_RADIUS_Z, FELT_TOP_Y, RIM_SAMPLES);
        return screenExtent(rim.map((point) => toViewport(point, rect)));
      },
      roomLift: () => {
        // Canvas-local by contract, so the rect's own top is subtracted back
        // off rather than being left in.
        const rect = canvasRect();
        return toViewport({ x: 0, y: 0, z: 0 }, rect).y - rect.top;
      },
      lastFunnel: () => [...readSceneRegistry().lastFunnel],
      awake: () => readSceneRegistry().animating,
      framesRendered: () => framesRef.current,
    };

    window.__stackchipsScene = seam;

    return () => {
      // Only tear down what this mount installed. If a second mount has
      // already published its own seam, clearing here would leave the live
      // room with no seam and an emptied registry, which reads exactly like
      // a room that never arrived and is a far more confusing failure than
      // the leak it would be guarding against.
      if (window.__stackchipsScene !== seam) return;
      delete window.__stackchipsScene;
      resetSceneRegistry();
    };
  }, [camera, gl]);

  return null;
}

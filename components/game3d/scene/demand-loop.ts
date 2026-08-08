"use client";

/**
 * On-demand rendering. The Canvas mounts with frameloop="demand"
 * (poker-scene.tsx), so react-three-fiber only renders a frame when
 * something calls `invalidate()` — it does not run a bare requestAnimation-
 * Frame loop the way `frameloop="always"` (the default) does. Two things
 * follow from that, both verified against the installed
 * @react-three/fiber source rather than assumed:
 *
 * 1. An ordinary React-driven change already wakes it for free. Every
 *    commit that goes through R3F's own reconciler — a prop changing on a
 *    JSX element, a child mounting or unmounting — calls
 *    `invalidateInstance()` internally, which schedules exactly one frame.
 *    So the HUD, the camera framing, a seat's cosmetic swapping: none of
 *    that needs anything from this file.
 * 2. Imperative per-frame work does NOT wake it, and never will on its own.
 *    Writing an InstancedMesh's buffer in a useFrame callback, or
 *    stepping a chip along `sampleChipFlight`, mutates three.js objects
 *    directly — it never touches the reconciler, so demand mode has no way
 *    to know a new frame is worth drawing. That gap is what `useDemandFrame`
 *    below closes: while `active`, it calls `invalidate()` on every tick it
 *    runs, which schedules the next tick, so the loop keeps itself awake
 *    for exactly as long as there is real animation to show and falls
 *    silent — no fan, no battery drain — the instant there is not.
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree, type RootState } from "@react-three/fiber";

export type DemandFrameCallback = (state: RootState, deltaSeconds: number) => void;

/**
 * `useFrame`, but scoped to a window of real activity instead of firing on
 * whatever the ambient frameloop happens to be. `active` flips per render
 * (e.g. "any chip flights in the air", "any card still tweening") — the
 * hook itself owns keeping the loop alive for exactly that window.
 *
 * `active` is read from a ref rather than closed over directly so the
 * subscribed `useFrame` callback (stable identity across renders, per
 * fiber's own `useMutableCallback`) always sees this render's latest flag
 * without needing to resubscribe.
 */
export function useDemandFrame(callback: DemandFrameCallback, active: boolean): void {
  const invalidate = useThree((state) => state.invalidate);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
    // The rising edge is the one moment a demand loop can miss entirely:
    // if nothing else invalidates this exact frame, the callback below
    // never gets a first tick to start self-sustaining from. Waking it
    // here is what makes flipping `active` alone — no caller-side
    // invalidate() required — sufficient to start an animation.
    if (active) invalidate();
  }, [active, invalidate]);

  useFrame((state, delta) => {
    if (!activeRef.current) return;
    callback(state, delta);
    // Re-arm for (at least) one more tick. An animation that finishes on
    // THIS tick flips `active` false via its own state update, which lands
    // after this commit — so the loop takes one harmless extra frame and
    // then genuinely sleeps, never fewer (a dropped last frame) and never
    // more (nothing here re-arms itself once activeRef reads false).
    invalidate();
  });
}

/**
 * Escape hatch for anything outside this component tree that needs to wake
 * the scene once — a HUD control, a resize, a future camera-drag handler.
 * The chip/card layers don't use this themselves (they drive entirely
 * through `useDemandFrame` above); it exists so a caller never has to reach
 * into `useThree` directly to learn the invalidate API's shape.
 */
export function useTriggerRender(): () => void {
  return useThree((state) => state.invalidate);
}

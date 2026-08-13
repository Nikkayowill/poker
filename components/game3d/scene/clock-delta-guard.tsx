"use client";

/**
 * Mounts once, patches `THREE.Clock.getDelta` on the scene clock, and does
 * nothing else — see `lib/game3d/clock-delta.ts` for why. This is the one
 * place R3F reads a frame's delta, so patching it here bounds it for every
 * consumer (the avatar mixers, the gesture watchdog) transparently, with no
 * changes needed anywhere else in the render loop.
 *
 * Renders nothing; must be mounted inside the `<Canvas>` so `useThree` can
 * reach the clock.
 */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { clampDelta, MAX_FRAME_DELTA_S } from "@/lib/game3d/clock-delta";

export function ClockDeltaGuard() {
  const clock = useThree((state) => state.clock);

  /* THREE.Clock is three.js's imperative timing handle, the same class of
     object glb-avatar.tsx's own eslint-disable note describes for
     AnimationAction — not React-owned data, so patching its `getDelta`
     method here is the public API, not a state mutation React needs to
     track. */
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const originalGetDelta = clock.getDelta.bind(clock);
    clock.getDelta = () => {
      const raw = originalGetDelta();
      const { delta, elapsedCorrection } = clampDelta(raw, MAX_FRAME_DELTA_S);
      if (elapsedCorrection > 0) clock.elapsedTime -= elapsedCorrection;
      return delta;
    };
    return () => {
      clock.getDelta = originalGetDelta;
    };
  }, [clock]);
  /* eslint-enable react-hooks/immutability */

  return null;
}

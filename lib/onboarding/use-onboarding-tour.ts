"use client";

import "driver.js/dist/driver.css";
import { useEffect, useRef } from "react";
import type { DriveStep } from "driver.js";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Fires a driver.js spotlight tour once per player, waits for every target
 * element to actually be on screen first, and marks it done server-side on
 * finish or skip so it never repeats -- see profile-store.ts's
 * completeOnboardingTour. The CSS import above is the only place driver's
 * base stylesheet is pulled in; app/styles/56-onboarding-tour.css overrides
 * it to match the app's chrome tokens.
 *
 * driver.js itself is dynamically imported: it reaches for `document` at
 * call time, and this hook already only runs client-side, but there is no
 * reason to make it part of the initial client bundle for players who never
 * see a step (tour already completed).
 *
 * `enabled` lets a caller gate on more than "profile loaded" -- the lobby
 * only wants this once entryComplete is true, the table only once a hand is
 * actually in play, not on an empty-table mount.
 */
export function useOnboardingTour(
  profile: PlayerProfile | null,
  steps: DriveStep[],
  enabled: boolean,
): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !profile || profile.onboardingTourCompletedAt || firedRef.current) return;
    if (steps.length === 0) return;
    if (steps.some((step) => !document.querySelector(step.element as string))) return;

    firedRef.current = true;
    let cancelled = false;

    const complete = () => {
      fetch("/api/profile/onboarding", { method: "POST" }).catch(() => {
        // Best-effort: a failed flag flip just means the tour can fire again
        // next session, not a broken experience right now.
      });
    };

    import("driver.js").then(({ driver }) => {
      if (cancelled) return;
      driver({
        showProgress: true,
        allowClose: true,
        overlayColor: "#0a0512",
        onDestroyed: complete,
        steps,
      }).drive();
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, profile, steps]);
}

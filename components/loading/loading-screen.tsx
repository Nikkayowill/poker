"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { StackChipsLogo } from "@/components/brand/stackchips-logo";
import { useMinHoldFade } from "@/components/loading/use-min-hold-fade";

/**
 * The app-shell loading beat -- the cold-boot wait before a profile exists
 * to render the lobby from (lobby.tsx's `!profile` branch), and anywhere
 * else a genuine "nothing to show yet" gap needs more than bare text.
 *
 * There's no real byte-level progress to report here (no asset manifest,
 * just "is the profile back yet"), so the fill bar below is a fake-but-honest
 * progress indicator: it eases toward 92% while still waiting and only
 * completes to 100% once `active` actually goes false, the same trick most
 * apps use for a load with no real progress events. The wordmark stands in
 * for the old dealer cutout at Kayo's request -- no character art here now.
 */

const MIN_VISIBLE_MS = 450;
const FADE_MS = 350;
const PROGRESS_TICK_MS = 120;
const PROGRESS_CEILING = 92;
const PROGRESS_EASE = 0.06;

export function LoadingScreen({ active = true, error }: { active?: boolean; error?: string | null }) {
  const phase = useMinHoldFade(active, { minMs: MIN_VISIBLE_MS, fadeMs: FADE_MS });
  const [progress, setProgress] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (phase === "hidden") {
      doneRef.current = false;
      const timer = window.setTimeout(() => setProgress(0), 0);
      return () => window.clearTimeout(timer);
    }
    if (!active) {
      doneRef.current = true;
      const timer = window.setTimeout(() => setProgress(100), 0);
      return () => window.clearTimeout(timer);
    }
    doneRef.current = false;
    const timer = setInterval(() => {
      setProgress((current) => {
        if (doneRef.current) return current;
        return current + (PROGRESS_CEILING - current) * PROGRESS_EASE;
      });
    }, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [phase, active]);

  if (phase === "hidden") return null;

  const displayProgress = Math.round(progress);

  return (
    <div
      className={clsx("app-loading-screen", phase === "hiding" && "app-loading-screen-hiding")}
      role="status"
      aria-live="polite"
    >
      <StackChipsLogo className="app-loading-logo" />
      <div
        className="app-loading-bar-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayProgress}
      >
        <div className="app-loading-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="app-loading-percent">{displayProgress}%</p>
      {error && <p className="app-loading-error"><X size={14} aria-hidden="true" /> {error}</p>}
    </div>
  );
}

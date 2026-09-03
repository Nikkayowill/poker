"use client";

import type { CSSProperties, ReactNode } from "react";
import clsx from "clsx";
import { useMinHoldFade } from "./use-min-hold-fade";

/**
 * Crossfades a skeleton into real content once `ready`, instead of the
 * content just popping in (or the skeleton popping out from under it). Both
 * layers are stacked in one CSS grid cell rather than one unmounting before
 * the other mounts, so the crossfade genuinely overlaps -- there's no gap
 * where neither is visible -- and the grid track sizes to whichever layer is
 * tallest, so a skeleton whose footprint doesn't match the real content to
 * the pixel still doesn't jump the page around it.
 *
 * Goes through useMinHoldFade so a fetch that resolves in a handful of
 * milliseconds still holds the skeleton for a beat rather than skipping
 * straight to content -- see that hook for why.
 */
export function FadeSwap({
  ready,
  skeleton,
  children,
  minMs = 350,
  fadeMs = 220,
  className,
}: {
  ready: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  minMs?: number;
  fadeMs?: number;
  className?: string;
}) {
  const phase = useMinHoldFade(!ready, { minMs, fadeMs });
  const showSkeleton = phase !== "hidden";
  // Once the hold has elapsed (phase left "visible"), the crossfade starts:
  // the skeleton fades out and, if content is already ready, it fades in at
  // the same time.
  const revealing = phase !== "visible";

  return (
    <div className={clsx("fade-swap", className)} style={{ "--fade-ms": `${fadeMs}ms` } as CSSProperties}>
      {showSkeleton && (
        <div className={clsx("fade-swap-layer", "fade-swap-skeleton", revealing && "fade-swap-hidden")} aria-hidden="true">
          {skeleton}
        </div>
      )}
      {ready && (
        <div className={clsx("fade-swap-layer", "fade-swap-content", revealing && "fade-swap-shown")}>
          {children}
        </div>
      )}
    </div>
  );
}

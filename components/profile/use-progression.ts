"use client";

import { useEffect, useRef, useState } from "react";
import type { ProgressionPayload } from "@/lib/progression/types";

/**
 * Fetches `/api/progression` once, client-side, and hands back whatever
 * lands -- `null` until then and on any failure. Shared by every surface
 * that reads a player's level/XP/streak (the lobby's RankStrip, the 3D
 * table's corner HUD) so there is one fetch-and-forget contract instead of
 * each caller re-deciding how to fail quietly.
 *
 * Deferred through a timer rather than fired from the effect body, matching
 * the profile load in poker-app.tsx and the friends drawer: a fetch started
 * synchronously here sets state during the same commit.
 */
export function useProgression(): ProgressionPayload | null {
  const [data, setData] = useState<ProgressionPayload | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/progression", { cache: "no-store" });
        if (!response.ok || !mounted.current) return;
        setData((await response.json()) as ProgressionPayload);
      } catch {
        // Silent. This is a readout beside working controls -- an error
        // banner over "you are level 4" is worse than no readout at all.
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, []);

  return data;
}

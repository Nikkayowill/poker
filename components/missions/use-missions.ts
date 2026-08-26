"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionsPayload, MissionView } from "@/lib/missions/types";

/**
 * Polled, not fetch-once like useProgression -- a mission finished at the
 * table a moment ago should show up in the lobby soon after, matching
 * friends-drawer.tsx's INVITE_POLL_MS pattern rather than the rank strip's
 * single load.
 */
const POLL_MS = 15_000;

interface MissionsState {
  data: MissionsPayload | null;
  /** Missions that flipped to completed since the last successful poll. */
  justCompleted: MissionView[];
  /** Call once justCompleted has been consumed, so the next poll starts clean. */
  clearCompleted: () => void;
}

export function useMissions(): MissionsState {
  const [data, setData] = useState<MissionsPayload | null>(null);
  const [justCompleted, setJustCompleted] = useState<MissionView[]>([]);
  const mounted = useRef(true);
  // Not state: this is bookkeeping for the diff, not something that should
  // itself trigger a render.
  const previousCompleted = useRef<Map<string, boolean>>(new Map());

  const clearCompleted = useCallback(() => setJustCompleted([]), []);

  useEffect(() => {
    mounted.current = true;

    const load = async () => {
      try {
        const response = await fetch("/api/missions", { cache: "no-store" });
        if (!response.ok || !mounted.current) return;
        const next = (await response.json()) as MissionsPayload;

        const newlyCompleted: MissionView[] = [];
        for (const mission of [...next.daily, ...next.weekly]) {
          // Only a mission this hook has already SEEN as incomplete counts --
          // one that was already done before this session started must not
          // toast on the first load.
          if (mission.completed && previousCompleted.current.get(mission.code) === false) {
            newlyCompleted.push(mission);
          }
          previousCompleted.current.set(mission.code, mission.completed);
        }

        setData(next);
        if (newlyCompleted.length > 0) {
          setJustCompleted((current) => [...current, ...newlyCompleted]);
        }
      } catch {
        // Silent, same contract as useProgression: a readout beside working
        // controls should fail quietly rather than show an error banner.
      }
    };

    // Deferred through a timer rather than fired from the effect body,
    // matching useProgression and friends-drawer.tsx.
    const timer = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, []);

  return { data, justCompleted, clearCompleted };
}

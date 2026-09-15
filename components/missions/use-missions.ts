"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionsPayload, MissionView } from "@/lib/missions/types";
import { subscribeHub } from "@/lib/hub/hub-poller";

/**
 * Polled, not fetch-once like useProgression -- a mission finished at the
 * table a moment ago should show up in the lobby soon after.
 *
 * The poll itself is no longer this hook's: it rides lib/hub/hub-poller.ts's
 * shared request alongside notifications and achievements, which is what took
 * an idle lobby from three invocations a tick to one a minute. The cadence
 * lives there too.
 */

export interface MissionsState {
  data: MissionsPayload | null;
  /** Missions that flipped to completed since the last successful poll. */
  justCompleted: MissionView[];
  /** Call once justCompleted has been consumed, so the next poll starts clean. */
  clearCompleted: () => void;
}

export function useMissions(): MissionsState {
  const [data, setData] = useState<MissionsPayload | null>(null);
  const [justCompleted, setJustCompleted] = useState<MissionView[]>([]);
  // Not state: this is bookkeeping for the diff, not something that should
  // itself trigger a render.
  const previousCompleted = useRef<Map<string, boolean>>(new Map());

  const clearCompleted = useCallback(() => setJustCompleted([]), []);

  useEffect(() => {
    return subscribeHub(["missions"], (payload) => {
      const next = payload.missions;
      if (!next) return;

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
    });
  }, []);

  return { data, justCompleted, clearCompleted };
}

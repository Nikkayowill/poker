"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AchievementsPayload, AchievementView } from "@/lib/achievements/types";

/** Same cadence as components/missions/use-missions.ts's POLL_MS. */
const POLL_MS = 15_000;

export interface AchievementsState {
  data: AchievementsPayload | null;
  /** Achievements that flipped to unlocked since the last successful poll. */
  justUnlocked: AchievementView[];
  /** Call once justUnlocked has been consumed, so the next poll starts clean. */
  clearUnlocked: () => void;
}

export function useAchievements(): AchievementsState {
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<AchievementView[]>([]);
  const mounted = useRef(true);
  // Not state: this is bookkeeping for the diff, not something that should
  // itself trigger a render.
  const previousUnlocked = useRef<Map<string, boolean>>(new Map());

  const clearUnlocked = useCallback(() => setJustUnlocked([]), []);

  useEffect(() => {
    mounted.current = true;

    const load = async () => {
      try {
        const response = await fetch("/api/achievements", { cache: "no-store" });
        if (!response.ok || !mounted.current) return;
        const next = (await response.json()) as AchievementsPayload;

        const newlyUnlocked: AchievementView[] = [];
        for (const achievement of next.achievements) {
          // Only an achievement this hook has already SEEN as locked counts --
          // one already unlocked before this session started must not toast
          // on the first load.
          if (achievement.unlocked && previousUnlocked.current.get(achievement.code) === false) {
            newlyUnlocked.push(achievement);
          }
          previousUnlocked.current.set(achievement.code, achievement.unlocked);
        }

        setData(next);
        if (newlyUnlocked.length > 0) {
          setJustUnlocked((current) => [...current, ...newlyUnlocked]);
        }
      } catch {
        // Silent, same contract as useMissions: a readout beside working
        // controls should fail quietly rather than show an error banner.
      }
    };

    // Deferred through a timer rather than fired from the effect body,
    // matching useMissions.
    const timer = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, []);

  return { data, justUnlocked, clearUnlocked };
}

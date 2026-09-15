"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AchievementsPayload, AchievementView } from "@/lib/achievements/types";
import { subscribeHub } from "@/lib/hub/hub-poller";

/**
 * Same shape and same contract as components/missions/use-missions.ts, and
 * the same shared poll: see lib/hub/hub-poller.ts for why neither owns an
 * interval of its own any more.
 */

interface AchievementsState {
  data: AchievementsPayload | null;
  /** Achievements that flipped to unlocked since the last successful poll. */
  justUnlocked: AchievementView[];
  /** Call once justUnlocked has been consumed, so the next poll starts clean. */
  clearUnlocked: () => void;
}

export function useAchievements(): AchievementsState {
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<AchievementView[]>([]);
  // Not state: this is bookkeeping for the diff, not something that should
  // itself trigger a render.
  const previousUnlocked = useRef<Map<string, boolean>>(new Map());

  const clearUnlocked = useCallback(() => setJustUnlocked([]), []);

  useEffect(() => {
    return subscribeHub(["achievements"], (payload) => {
      const next = payload.achievements;
      if (!next) return;

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
    });
  }, []);

  return { data, justUnlocked, clearUnlocked };
}

"use client";

import { useEffect, useRef } from "react";
import {
  initStackAcresMusic,
  playStackAcresMusic,
  stopStackAcresMusic,
  timeOfDay,
} from "@/lib/audio/stackacres-music";

/**
 * Manages StackAcres background music for the current game session.
 *
 * - Initializes the music system on first mount
 * - Checks every 30 seconds if the time of day has changed, and switches
 *   tracks if needed (avoids the cost of checking on every render)
 * - Stops music cleanly on unmount
 * - Respects the global app mute (via setGlobalMute from the app shell)
 *
 * @param shouldPlay If false, music won't start (e.g., before tap-to-play)
 */
export function useStackAcresMusic(shouldPlay = true): void {
  const lastTimeOfDayRef = useRef<string>(timeOfDay());
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    initStackAcresMusic();

    if (shouldPlay) {
      void playStackAcresMusic();
    }

    // Check every 30s if time of day changed (e.g., midnight, 6pm)
    checkIntervalRef.current = setInterval(() => {
      const current = timeOfDay();
      if (current !== lastTimeOfDayRef.current && shouldPlay) {
        lastTimeOfDayRef.current = current;
        void playStackAcresMusic(current);
      }
    }, 30_000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      stopStackAcresMusic();
    };
  }, [shouldPlay]);
}

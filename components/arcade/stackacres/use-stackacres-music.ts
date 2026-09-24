"use client";

import { useEffect, useRef } from "react";
import {
  initStackAcresMusic,
  playStackAcresMusic,
  stopStackAcresMusic,
  timeOfDay,
} from "@/lib/audio/stackacres-music";

/** A game day is 13 minutes, so dusk lasts about 100 seconds: look often. */
const CHECK_MS = 5_000;

/**
 * Manages StackAcres background music for the current game session.
 *
 * - Initializes the music system on first mount
 * - Checks every 5 seconds whether the farm clock has moved into another part
 *   of the day, and switches tracks if it has
 * - Stops music cleanly on unmount
 * - Respects the global app mute (via setGlobalMute from the app shell)
 *
 * @param shouldPlay If false, music won't start (e.g., before tap-to-play)
 * @param gameHour The farm clock's hour right now (the shell's `gameHourNow`)
 */
export function useStackAcresMusic(shouldPlay: boolean, gameHour: () => number): void {
  const lastTimeOfDayRef = useRef<string>("");
  const hourRef = useRef(gameHour);
  useEffect(() => {
    hourRef.current = gameHour;
  }, [gameHour]);

  useEffect(() => {
    initStackAcresMusic();

    const current = timeOfDay(hourRef.current());
    lastTimeOfDayRef.current = current;
    if (shouldPlay) {
      void playStackAcresMusic(current);
    }

    const timer = setInterval(() => {
      const next = timeOfDay(hourRef.current());
      if (next !== lastTimeOfDayRef.current && shouldPlay) {
        lastTimeOfDayRef.current = next;
        void playStackAcresMusic(next);
      }
    }, CHECK_MS);

    return () => {
      clearInterval(timer);
      stopStackAcresMusic();
    };
  }, [shouldPlay]);
}

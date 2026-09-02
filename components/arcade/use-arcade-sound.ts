"use client";

import { useCallback, useEffect } from "react";
import { playSound, primeTableSounds, type SoundEffect } from "@/lib/audio/sound-effects";

/**
 * Lets an arcade machine make a noise without ignoring the player's mute.
 *
 * The mute is one preference for the whole app. It used to need re-syncing
 * here because the module-level flag in lib/audio/sound-effects.ts defaults
 * to `true` and only components/poker-app.tsx ever applied the stored value
 * -- and poker-app isn't mounted on an arcade route. Now that the persistent
 * shell (components/shell/app-shell.tsx) is the single, always-mounted owner
 * of that flag, there is nothing left for an arcade screen to sync: by the
 * time this hook runs, the shell has already applied it.
 */
export function useArcadeSound(
  { gameSounds = false }: { gameSounds?: boolean } = {},
): (effect: SoundEffect) => void {
  // A machine plays the deal/chip/win cues, so it fetches them on mount
  // rather than mid-round. A menu, like the arcade floor or the lobby, does
  // not and must not: both are screens the phone shell renders on load, and
  // priming there would pull the whole sound set down before anyone had
  // started anything. See primeTableSounds in lib/audio/sound-effects.
  useEffect(() => {
    if (gameSounds) primeTableSounds();
  }, [gameSounds]);

  // Stable, so a caller can safely list it in an effect's dependencies,
  // which every machine does, since sounds fire as a reaction to the round
  // changing rather than inside a click handler.
  return useCallback((effect: SoundEffect) => playSound(effect), []);
}

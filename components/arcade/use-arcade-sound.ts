"use client";

import { useCallback, useEffect } from "react";
import {
  playSound,
  primeTableSounds,
  setSoundEnabled,
  type SoundEffect,
} from "@/lib/audio/sound-effects";
import {
  LEGACY_SOUND_STORAGE_KEY,
  SOUND_STORAGE_KEY,
} from "@/lib/audio/sound-preference";
import { browserPreferenceStorage, parseEnabledFlag, readStoredPreference } from "@/lib/profile/stored-preference";

/**
 * Lets an arcade machine make a noise without ignoring the player's mute.
 *
 * The mute is one preference for the whole app, but it was only ever applied
 * by components/poker-app.tsx, which is not mounted on an arcade route. The
 * module-level flag in lib/audio/sound-effects.ts defaults to `true`, so a
 * machine that simply called `playSound` would be loud for a player who had
 * turned sound off in the lobby, on a page with no control to turn it back
 * off. This reads the same key poker-app reads, including the legacy-key
 * migration, and applies it before anything can play.
 *
 * Read-only: there is no sound toggle on these pages, and one that wrote a
 * second opinion of the preference into the same key from a second place is
 * how the two would drift.
 */
export function useArcadeSound(
  { gameSounds = false }: { gameSounds?: boolean } = {},
): (effect: SoundEffect) => void {
  useEffect(() => {
    setSoundEnabled(
      readStoredPreference(browserPreferenceStorage(), {
        key: SOUND_STORAGE_KEY,
        legacyKey: LEGACY_SOUND_STORAGE_KEY,
        parse: parseEnabledFlag,
      }),
    );
  }, []);

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

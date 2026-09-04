"use client";

import { useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { setStackAcresMusicMuted } from "@/lib/audio/stackacres-music";
import { setAmbienceMuted } from "@/lib/audio/stackacres-ambience";
import { useStoredPreference } from "@/components/use-stored-preference";

/**
 * Mutes StackAcres' background sound: the music and the ambient farm bed
 * together, as one switch.
 *
 * They are deliberately one control and not two. Both are "the noise the
 * place makes while you are standing in it", and a player who wants quiet
 * wants quiet -- offering them a music slider and a separate ambience slider
 * is a settings screen, and this is one small button in a HUD. The farm's
 * ACTION sounds are not covered by it: those answer presses, and they follow
 * the app-wide SFX mute instead (see stackacres-farm.tsx).
 *
 * `useStoredPreference` rather than hand-rolled state, for the reason its own
 * header sets out: the server renders the default and the stored value is
 * only readable in the browser, so the restore has to land in a later commit
 * than hydration. Doing that by hand here is what the previous version got
 * wrong in two separate ways -- it never read the stored value at all, so a
 * player who had muted the farm came back to a speaker icon over silence,
 * and it negated the old toggle's return value twice, so a fresh press
 * painted the state it had just left.
 */
export function StackAcresMusicToggle() {
  const [muted, setMuted] = useStoredPreference<boolean>({
    key: "stackacresMusicMuted",
    fallback: false,
    parse: (raw) => raw === "true",
    // Runs for the restored value on mount and for every press after it, so
    // both modules are told the truth without a second effect to keep in step.
    apply: (value) => {
      setStackAcresMusicMuted(value);
      setAmbienceMuted(value);
    },
  });

  const handleClick = useCallback(() => {
    tapSound();
    setMuted((current) => !current);
  }, [setMuted]);

  const Icon = muted ? VolumeX : Volume2;

  return (
    <button
      type="button"
      className="sa-music-toggle"
      title={muted ? "Unmute the farm" : "Mute the farm"}
      aria-label={muted ? "Farm sound muted" : "Farm sound playing"}
      aria-pressed={muted}
      onClick={handleClick}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="sa-sr">{muted ? "Unmute" : "Mute"} the farm</span>
    </button>
  );
}

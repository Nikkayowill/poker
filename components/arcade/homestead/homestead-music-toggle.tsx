"use client";

import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { toggleHomesteadMusicMute } from "@/lib/audio/homestead-music";

/**
 * A small mute/unmute button for Homestead background music.
 * Lives in the HUD header alongside Bushels and Feed.
 */
export function HomesteadMusicToggle() {
  const [isMuted, setIsMuted] = useState(false);

  const handleClick = () => {
    tapSound();
    const nowMuted = !toggleHomesteadMusicMute();
    setIsMuted(!nowMuted);
  };

  const Icon = isMuted ? VolumeX : Volume2;

  return (
    <button
      type="button"
      className="hs-music-toggle"
      title={isMuted ? "Unmute music" : "Mute music"}
      aria-label={isMuted ? "Music muted" : "Music playing"}
      onClick={handleClick}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="hs-sr">{isMuted ? "Unmute" : "Mute"} music</span>
    </button>
  );
}

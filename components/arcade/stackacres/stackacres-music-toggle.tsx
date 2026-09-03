"use client";

import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { toggleStackAcresMusicMute } from "@/lib/audio/stackacres-music";

/**
 * A small mute/unmute button for StackAcres background music.
 * Lives in the HUD header alongside Bushels and Feed.
 */
export function StackAcresMusicToggle() {
  const [isMuted, setIsMuted] = useState(false);

  const handleClick = () => {
    tapSound();
    const nowMuted = !toggleStackAcresMusicMute();
    setIsMuted(!nowMuted);
  };

  const Icon = isMuted ? VolumeX : Volume2;

  return (
    <button
      type="button"
      className="sa-music-toggle"
      title={isMuted ? "Unmute music" : "Mute music"}
      aria-label={isMuted ? "Music muted" : "Music playing"}
      onClick={handleClick}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="sa-sr">{isMuted ? "Unmute" : "Mute"} music</span>
    </button>
  );
}

"use client";

import { useState } from "react";
import clsx from "clsx";
import { playStackAcresMusic } from "@/lib/audio/stackacres-music";
import { tapSound } from "@/lib/audio/ui-sounds";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { StackAcresCoverArt } from "./stackacres-cover-art";

interface StackAcresPlayScreenProps {
  onStart: () => void;
}

/**
 * A full-screen tap-to-play overlay that marks StackAcres as its own
 * distinct game experience within StackChips.
 *
 * On tap:
 * - Starts the background music
 * - Fades out this screen
 * - Calls onStart to begin the game
 *
 * The screen has a light pulse animation to draw attention and signal
 * that it's interactive.
 */
export function StackAcresPlayScreen({ onStart }: StackAcresPlayScreenProps) {
  const [isActive, setIsActive] = useState(true);

  const handleTap = async () => {
    tapSound();
    await playStackAcresMusic();
    setIsActive(false);
    // Let the fade animation finish before calling onStart
    setTimeout(onStart, 300);
  };

  return (
    <div
      className={clsx("sa-play-screen", {
        "is-fading": !isActive,
      })}
      onClick={handleTap}
      role="button"
      tabIndex={0}
      aria-label="Tap to start StackAcres"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void handleTap();
        }
      }}
    >
      <StackAcresCoverArt />
      <div className="sa-play-content">
        <h1 className="sr-only">StackAcres</h1>
        <StackAcresLogo className="sa-play-logo" aria-hidden="true" />
        <p className="sa-play-subtitle">
          After a long grind at the tables, put your gold to work. Build a
          farm and watch it grow.
        </p>

        <div className="sa-play-prompt">
          <span className="sa-play-text">Tap to play</span>
          <span className="sa-play-pulse" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

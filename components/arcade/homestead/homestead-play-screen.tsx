"use client";

import { useState } from "react";
import clsx from "clsx";
import { playHomesteadMusic } from "@/lib/audio/homestead-music";
import { tapSound } from "@/lib/audio/ui-sounds";

interface HomesteadPlayScreenProps {
  onStart: () => void;
}

/**
 * A full-screen tap-to-play overlay that marks Homestead as its own
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
export function HomesteadPlayScreen({ onStart }: HomesteadPlayScreenProps) {
  const [isActive, setIsActive] = useState(true);

  const handleTap = async () => {
    tapSound();
    await playHomesteadMusic();
    setIsActive(false);
    // Let the fade animation finish before calling onStart
    setTimeout(onStart, 300);
  };

  return (
    <div
      className={clsx("hs-play-screen", {
        "is-fading": !isActive,
      })}
      onClick={handleTap}
      role="button"
      tabIndex={0}
      aria-label="Tap to start the Homestead"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void handleTap();
        }
      }}
    >
      <div className="hs-play-content">
        <h1 className="hs-play-title">StackChips Homestead</h1>
        <p className="hs-play-subtitle">Build your farm, grow your harvest</p>

        <div className="hs-play-prompt">
          <span className="hs-play-text">Tap to play</span>
          <span className="hs-play-pulse" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

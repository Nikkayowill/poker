"use client";

import { useEffect, useState } from "react";

const CELEBRATION_MS = 2100;

/**
 * A one-shot win celebration: "You won! +<amount>" fades in centered, holds
 * a beat, then shrinks and funnels up toward the top-right of the screen,
 * where the header's GoldBadge lives -- so a payout reads as gold actually
 * traveling into the player's balance (which is already counting up there
 * via useCountUp) instead of a static number that was just quietly there
 * when you back out.
 *
 * Mount once per result screen, gated on `active` (pass `won && amount >
 * 0`) -- the caller's result panel mounts fresh exactly when the outcome is
 * decided, so `active` is read once, lazily, at that mount rather than
 * watched afterward: a later re-render with `active` still true must not
 * replay it. Renders nothing under prefers-reduced-motion.
 */
export function WinCelebration({ active, amount }: { active: boolean; amount: number }) {
  const [playing, setPlaying] = useState(() => {
    if (!active) return false;
    return !(
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  });

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setPlaying(false), CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [playing]);

  if (!playing) return null;

  return (
    <div className="win-celebration" aria-hidden="true">
      <span className="win-message">You won! +{amount.toLocaleString()}</span>
    </div>
  );
}

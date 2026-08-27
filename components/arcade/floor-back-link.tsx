"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * The "← Ante Up" link every arcade/duel shell header uses to leave a game.
 *
 * Hardcoding href="/games" always landed on the arcade floor *route*, even
 * for a player who opened the game from the floor already embedded at "/"
 * (the mobile shell's Ante Up swipe pane, components/lobby/mobile-shell.tsx)
 * — same UI, a second URL, and a "back" that didn't return them to where
 * they'd actually been. This goes back in the browser's own history when
 * the game was reached from within the app, so "back" means back; it only
 * falls through to the plain /games link for a direct/deep link that has
 * nowhere of ours to return to.
 */
export function FloorBackLink() {
  const router = useRouter();
  return (
    <Link
      className="floor-back"
      href="/games"
      onClick={(event) => {
        tapSound();
        if (typeof document === "undefined" || !document.referrer) return;
        try {
          if (new URL(document.referrer).origin === window.location.origin) {
            event.preventDefault();
            router.back();
          }
        } catch {
          // Malformed referrer: fall through to the plain /games navigation.
        }
      }}
    >
      ← Ante Up
    </Link>
  );
}

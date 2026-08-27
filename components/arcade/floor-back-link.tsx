"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { tapSound } from "@/lib/audio/ui-sounds";
import { browserSessionStorage } from "@/lib/profile/session-continuity";

/**
 * Set by ArcadeFloor right before it navigates away from its *embedded*
 * instance (the mobile shell's Ante Up swipe pane), and consumed here.
 *
 * `document.referrer` was the first attempt at telling embedded and direct
 * arrivals apart, and it doesn't work: it's stamped once when the document
 * itself loads and never changes for a client-side <Link> navigation, which
 * is how a player actually gets from the embedded floor to a game. So the
 * referrer check was almost always same as it was on first load — usually
 * empty or off-site — and fell through to the plain /games link every time,
 * which is the exact duplicate-page symptom this was meant to fix. A marker
 * stamped at the moment of the real navigation isn't guessing after the fact.
 */
const EMBEDDED_NAV_KEY = "stackchips:embedded-floor-nav";

/** Called by ArcadeFloor's own links, only when rendered embedded. */
export function markEmbeddedFloorNav(): void {
  try {
    browserSessionStorage()?.setItem(EMBEDDED_NAV_KEY, "1");
  } catch {
    // No storage, no marker; this link just falls back to /games below.
  }
}

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
        const store = browserSessionStorage();
        if (!store?.getItem(EMBEDDED_NAV_KEY)) return;
        store.removeItem(EMBEDDED_NAV_KEY);
        event.preventDefault();
        router.back();
      }}
    >
      ← Ante Up
    </Link>
  );
}

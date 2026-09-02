"use client";

/**
 * Decides what persistent chrome, if any, shows outside `/` -- which already
 * owns its own chrome (MobileShell's tab bar on phone, poker-app.tsx's full
 * header on desktop) and must never see a second copy stacked on top of it.
 * Rendered unconditionally from AppShell; returns null everywhere it has
 * nothing to add.
 */

import { usePathname, useRouter } from "next/navigation";
import { usePhoneViewport } from "@/components/use-phone-viewport";
import { browserSessionStorage } from "@/lib/profile/session-continuity";
import { useAppShell } from "./app-shell";
import { LOBBY_PANE_STORAGE_KEY, TabBar } from "./tab-bar";
import { DesktopHeader } from "./desktop-header";

export function PersistentChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const phone = usePhoneViewport();
  const { profile, immersive } = useAppShell();

  // `/` renders its own chrome already (MobileShell's bar, poker-app.tsx's
  // header); a signed-out visitor has nothing to navigate to yet; an
  // immersive screen (a hand, a game/duel in progress) hides chrome the same
  // way the table already does today -- see app-shell.tsx's own comment on
  // `setImmersive`.
  if (pathname === "/" || immersive || !profile) return null;

  if (phone) {
    // Ante Up and the leaderboard are real routes with an exact destination;
    // Play and Profile only exist as panes inside the `/` shell, so a tap on
    // either writes the pane it means before landing there, the same key
    // MobileShell already reads on its own mount.
    const activeIndex = pathname.startsWith("/games") ? 1
      : pathname === "/leaderboard" ? 2
      : null;

    const select = (index: number) => {
      if (index === 1) { router.push("/games"); return; }
      if (index === 2) { router.push("/leaderboard"); return; }
      try {
        browserSessionStorage()?.setItem(LOBBY_PANE_STORAGE_KEY, String(index));
      } catch {
        // Worst case this lands on whichever pane the shell last remembered.
      }
      router.push("/");
    };

    return <TabBar activeIndex={activeIndex} onSelect={select} profile={profile} />;
  }

  return <DesktopHeader profile={profile} />;
}

"use client";

/**
 * The persistent app shell.
 *
 * Rendered once, from app/layout.tsx, around every route in the app. It never
 * unmounts on navigation -- a Next.js layout only ever swaps `{children}`,
 * not itself -- which is the whole point: this is where state that used to
 * live in components/poker-app.tsx (and was stranded at `/` because of it)
 * moved to, so it survives a trip to /games, /collection, /leaderboard and
 * back instead of being torn down and rebuilt on every one of them.
 *
 * MUST stay a module-scope named export, never a function nested inside
 * another component. A nested function component gets a new type identity on
 * every parent render and React unmounts/remounts it -- a real,
 * historically-confirmed Next.js footgun that shows up in production builds
 * specifically (next dev won't reproduce it). This codebase has already hit
 * the same class of bug once, from the other direction: see the removed
 * `key={profile.updatedAt}` note on <Lobby> in poker-app.tsx -- "a key is for
 * telling two different things apart, not for pushing a new prop into stale
 * state." The same rule applies to this component's own identity.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";

import { useStoredPreference } from "@/components/use-stored-preference";
import { playSound, setSoundEnabled } from "@/lib/audio/sound-effects";
import { setMenuMusicEnabled, startMenuMusic, stopMenuMusic } from "@/lib/audio/menu-music";
import {
  LEGACY_SOUND_STORAGE_KEY,
  MUSIC_STORAGE_KEY,
  SOUND_STORAGE_KEY,
} from "@/lib/audio/sound-preference";
import { parseEnabledFlag } from "@/lib/profile/stored-preference";

type AppShellValue = {
  soundEnabled: boolean;
  toggleSound: () => void;
  musicEnabled: boolean;
  toggleMenuMusic: () => void;
  /**
   * True while an immersive screen -- a poker hand, a game/duel attempt --
   * is what's on screen. Ambient music pauses while this is true (see the
   * effect below); a later phase also hides the persistent nav chrome on it.
   * Screens opt in by calling `setImmersive`; the safe default is false, so
   * nothing has to change before a given screen wires itself up.
   */
  immersive: boolean;
  setImmersive: (active: boolean) => void;
};

const AppShellContext = createContext<AppShellValue | null>(null);

export function useAppShell(): AppShellValue {
  const value = useContext(AppShellContext);
  if (!value) throw new Error("useAppShell() was called outside <AppShell>.");
  return value;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [immersive, setImmersive] = useState(false);

  // Moved from components/poker-app.tsx verbatim -- see use-stored-preference.ts
  // for why the module-level `apply` and the React state are two separate
  // writes, and lib/audio/sound-preference.ts for why these specific keys
  // can never move without a migration.
  const [soundEnabled, setSoundEnabledState] = useStoredPreference<boolean>({
    key: SOUND_STORAGE_KEY,
    legacyKey: LEGACY_SOUND_STORAGE_KEY,
    fallback: true,
    parse: parseEnabledFlag,
    apply: (enabled, cause) => {
      setSoundEnabled(enabled);
      // Plays only as confirmation of an actual unmute, and only after the
      // line above has unmuted the channel it plays through.
      if (enabled && cause === "change") playSound("ui");
    },
  });
  const [musicEnabled, setMusicEnabledState] = useStoredPreference<boolean>({
    key: MUSIC_STORAGE_KEY,
    fallback: true,
    parse: parseEnabledFlag,
    apply: setMenuMusicEnabled,
  });

  const toggleSound = useCallback(() => {
    setSoundEnabledState((current) => !current);
  }, [setSoundEnabledState]);

  const toggleMenuMusic = useCallback(() => {
    setMusicEnabledState((current) => !current);
  }, [setMusicEnabledState]);

  useEffect(() => {
    // Moved from components/poker-app.tsx, which used to be the only place
    // that could reach this at all: the arcade (/games/*) plus /collection,
    // /leaderboard and /store were separate routes that unmounted it,
    // leaving the singleton <audio> element in lib/audio/menu-music.ts
    // playing behind a page that never asked for it. This component never
    // unmounts on navigation, so that cleanup keeps working as a backstop,
    // it just shouldn't normally have to fire from a route change any more --
    // only from music being muted or an immersive screen starting.
    //
    // Scope, changed on purpose from the original (which read `game`, a
    // poker-only signal): ambient music now plays on every non-immersive
    // screen -- Ante Up, Collection, duels between hands -- not just the
    // lobby/table. Nothing stopped this before except that poker-app.tsx was
    // the only thing that could ever call startMenuMusic. If it doesn't feel
    // right in practice, scope it back with one line:
    // `if (!isLobbyRoute || immersive || document.hidden)`.
    //
    // Tab visibility is the other half: a hidden tab (backgrounded window,
    // switched tab) has no in-app "leave" to hook, so it's read directly via
    // document.hidden. sync() is the single source of truth for both
    // immersive and visibility so the two conditions can't drift into two
    // separate start/stop call sites.
    setMenuMusicEnabled(musicEnabled);

    const sync = () => {
      if (!musicEnabled) return;
      if (immersive || document.hidden) stopMenuMusic();
      else startMenuMusic();
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stopMenuMusic();
    };
  }, [immersive, musicEnabled]);

  useEffect(() => {
    // Moved from components/poker-app.tsx verbatim. Mount-once either way,
    // since this component now only ever mounts once per app load -- this is
    // consolidation, not a behavior change.
    if (!("serviceWorker" in window.navigator)) return;
    // The native shell (Capacitor) is its own install/update mechanism; the
    // hand-rolled shell-caching SW is a web-PWA concern only and would just
    // double-cache against the WebView for no benefit.
    if (Capacitor.isNativePlatform()) return;
    if (process.env.NODE_ENV === "production") {
      void window.navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation is an enhancement; normal online play remains available.
      });
      return;
    }

    // A development service worker can serve stale shell responses while Fast
    // Refresh is rebuilding. Keep npm run dev as a plain network experience.
    void window.navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    });
  }, []);

  const value: AppShellValue = {
    soundEnabled,
    toggleSound,
    musicEnabled,
    toggleMenuMusic,
    immersive,
    setImmersive,
  };

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

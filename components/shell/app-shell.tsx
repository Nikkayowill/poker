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
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
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
import type { PlayerProfile } from "@/lib/profile/types";
import { PersistentChrome } from "@/components/shell/persistent-chrome";
import { useAndroidBackButton } from "@/components/shell/use-android-back-button";
import {
  browserSessionStorage,
  clearSessionContinuity,
  entryOpenedSnapshot,
  serverEntryOpenedSnapshot,
  serverProfileSnapshot,
  sessionProfileSnapshot,
  subscribeSessionCache,
  writeCachedProfile,
} from "@/lib/profile/session-continuity";

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
  /**
   * This browser's profile, or null before it's known/for a signed-out
   * visitor. `setProfile` is a raw setter, deliberately -- every call site
   * that already did `setProfile(data.profile)` after a game action, buy-in,
   * or claim keeps working unchanged, just reading it from here instead of a
   * local useState. See the state block below for how `profile` itself is
   * derived (a cache bridge, not a plain value).
   */
  profile: PlayerProfile | null;
  setProfile: Dispatch<SetStateAction<PlayerProfile | null>>;
  /** False once the initial GET /api/profile (success or failure) has settled. */
  profileLoading: boolean;
  /** Re-fetches the profile from the server. Exposed for the same explicit refresh poker-app.tsx already did. */
  loadProfile: () => Promise<void>;
  /** Set only by the initial mount-time load failing; cleared by the next attempt that doesn't. */
  profileError: string | null;
  /**
   * Whether this tab has cleared "Enter StackChips" (an account, guest, or a
   * completed sign-in) during its own lifetime. The gate screen itself still
   * only ever renders at `/` -- this is read-only state for everything else
   * that needs to know whether a player is past it, not a second gate.
   */
  entryComplete: boolean;
};

const AppShellContext = createContext<AppShellValue | null>(null);

export function useAppShell(): AppShellValue {
  const value = useContext(AppShellContext);
  if (!value) throw new Error("useAppShell() was called outside <AppShell>.");
  return value;
}

export function AppShell({ children }: { children: ReactNode }) {
  useAndroidBackButton();

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

  /*
   * Moved from components/poker-app.tsx, where this whole block was
   * duplicated by every navigation: the arcade, Collection and the
   * leaderboard were separate routes that unmounted it, so the signed-out
   * card painted for the length of one GET /api/profile on every single
   * arrival, once per navigation, for a player who had been signed in for an
   * hour. See lib/profile/session-continuity.ts for the full reasoning on
   * why the cache is sessionStorage-not-localStorage and why the entry gate
   * is a per-tab hint rather than something a profile's mere presence can
   * answer.
   *
   * `cachedProfile` reaches the first render synchronously via
   * useSyncExternalStore, which is the point: a value that arrives after the
   * first paint has already let the wrong screen show. `profileLoading` is
   * what keeps the cache honest -- the moment the real fetch settles,
   * `loadedProfile` is the answer even when the answer is null, so a player
   * whose session has expired doesn't keep seeing their old balance.
   */
  const [loadedProfile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const cachedProfile = useSyncExternalStore(
    subscribeSessionCache,
    useCallback(() => sessionProfileSnapshot(browserSessionStorage()), []),
    serverProfileSnapshot,
  );
  const profile = loadedProfile ?? (profileLoading ? cachedProfile : null);

  const entryComplete = useSyncExternalStore(
    subscribeSessionCache,
    useCallback(() => entryOpenedSnapshot(browserSessionStorage()), []),
    serverEntryOpenedSnapshot,
  );

  /** Keeps this tab's copy in step, so the next mount paints instantly. */
  useEffect(() => {
    if (loadedProfile) writeCachedProfile(browserSessionStorage(), loadedProfile);
  }, [loadedProfile]);

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load your profile.");
    setProfile(data.profile);
    // A profile came back, so this browser holds a session cookie and has
    // cleared the entry gate before in some earlier tab -- entryComplete is
    // its own per-tab hint (see above) and isn't set from here. No profile is
    // the other half: the session is gone, so this tab's cached copy is
    // stale and must not be shown to whoever arrives next.
    if (!data.profile) clearSessionContinuity(browserSessionStorage());
  }, []);

  // Unconditional and mount-once: this is what makes a returning player's
  // session resolve even if the very first screen they land on is a deep
  // link straight into a game, not `/`. Deferred a tick for the same reason
  // every use-stored-preference-style restore is: setting state during the
  // commit that's still hydrating would swap markup underneath it.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile()
        .then(() => setProfileError(null))
        .catch((caught) => {
          setProfileError(caught instanceof Error ? caught.message : "Could not load your profile.");
        })
        .finally(() => setProfileLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  const value: AppShellValue = {
    soundEnabled,
    toggleSound,
    musicEnabled,
    toggleMenuMusic,
    immersive,
    setImmersive,
    profile,
    setProfile,
    profileLoading,
    loadProfile,
    profileError,
    entryComplete,
  };

  return (
    <AppShellContext.Provider value={value}>
      {children}
      <PersistentChrome />
    </AppShellContext.Provider>
  );
}

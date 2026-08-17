"use client";

import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { GameSnapshot, PlayerAction } from "@/lib/game/types";
import { applyOptimisticAction } from "@/lib/game/optimistic-action";
import type { StakesTier } from "@/lib/game/tiers";
import { accountsEnabled, authClient } from "@/lib/auth/client";
import { oauthCallbackUrl } from "@/lib/auth/oauth-redirect";
import { reportOAuthStart, reportStrayAuthCode } from "@/lib/auth/oauth-diagnostics";
import {
  browserSupabase,
  readRememberAuthSession,
  setRememberAuthSession,
} from "@/lib/supabase/browser-client";
import { planTurnClock, type TurnClockInput } from "@/lib/game/turn-clock";
import {
  TABLE_STATE_CHANGED,
  parseTableStateChanged,
  tableChannelName,
} from "@/lib/game/table-channel";
import type { PlayerProfile } from "@/lib/profile/types";
import { dailyGoldState } from "@/lib/profile/daily-gold";
import { parseEnabledFlag } from "@/lib/profile/stored-preference";
import {
  browserSessionStorage,
  clearSessionContinuity,
  markAccountLinkAnnounced,
  serverProfileSnapshot,
  sessionProfileSnapshot,
  shouldAnnounceAccountLink,
  subscribeSessionCache,
  writeCachedProfile,
} from "@/lib/profile/session-continuity";
import { useStoredPreference } from "@/components/use-stored-preference";
import { playSound, setSoundEnabled } from "@/lib/audio/sound-effects";
import { gameOnSound } from "@/lib/audio/ui-sounds";
import {
  BET_STYLE_STORAGE_KEY,
  DEFAULT_BET_STYLE,
  nextBetStyle,
  normalizeBetStyle,
  type BetAnimationStyle,
} from "@/lib/scene/bet-style";
import {
  DEFAULT_TABLE_RENDERER,
  TABLE_RENDERER_STORAGE_KEY,
  nextTableRenderer,
  normalizeTableRenderer,
  type TableRenderer,
} from "@/lib/scene/table-renderer";
import {
  DEFAULT_ROOM_THEME_ID,
  ROOM_THEME_STORAGE_KEY,
  nextRoomThemeId,
  normalizeRoomThemeId,
  type RoomThemeId,
} from "@/lib/game3d/room-theme";
import { tableSounds } from "@/lib/audio/table-sounds";
import { setMenuMusicEnabled, startMenuMusic, stopMenuMusic } from "@/lib/audio/menu-music";
import { Coins, Gift, Layers, LogIn, LogOut, Music2, Settings2, Trophy, Video } from "lucide-react";
import { Lobby } from "@/components/lobby/lobby";
import { retireFirstRunStrip } from "@/components/lobby/first-run-strip";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { ProfileModal } from "@/components/profile/profile-modal";
import { Menu, type MenuItem } from "@/components/nav/menu";
import { DonateButton } from "@/components/nav/donate-button";
import { AuthButton } from "@/components/profile/auth-button";
import { GoldBadge } from "@/components/profile/gold-badge";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { RoomCreatedModal } from "@/components/table/room-created-modal";
import { useWebglSupport } from "@/components/table/use-webgl-support";
import { useLandscape } from "@/components/use-landscape";
import { RewardedAdModal } from "@/components/rewards/rewarded-ad-modal";
import { REWARDED_AD_ELIGIBLE_BELOW } from "@/lib/rewards/config";
import type { RewardTrigger } from "@/lib/rewards/triggers";
import { PokerTable, type ConnectionState } from "@/components/table/poker-table";
import { useTableReactions } from "@/lib/game/use-table-reactions";
import {
  LEGACY_SOUND_STORAGE_KEY,
  MUSIC_STORAGE_KEY,
  SOUND_STORAGE_KEY,
} from "@/lib/audio/sound-preference";

/**
 * How long a lobby notice stays up before it retires itself.
 *
 * These are confirmations -- "cashed out 4,200", "signed out" -- not decisions,
 * and a confirmation that waits to be acknowledged is a confirmation the player
 * has to clean up after. They used to sit at the top of the hub until the ×
 * was clicked, so a session accumulated a stack of banners about things that
 * had already happened. Long enough to read twice, and the × is still there
 * for anyone who wants it gone sooner.
 */
const NOTICE_VISIBLE_MS = 6_000;

const MAX_REFRESH_RETRIES = 4;
const REFRESH_RETRY_BASE_MS = 250;
const REFRESH_RETRY_MAX_MS = 2_000;

/**
 * The trigger shown when the player opens "Free Gold" from the lobby menu.
 *
 * This is the *only* way into RewardedAdModal now -- there used to also be an
 * automatic popup that watched for in-game moments (first win of the session,
 * a big pot, a win streak) and offered the same modal uninvited, mid-hand.
 * That surprised players too often and too often mid-game, so it is gone
 * (lib/rewards/triggers.ts's advanceRewardWatch and its call site); the
 * "Get Free Gold" row below -- lobby-only (see the `{!game && ...}` it lives
 * inside) and gated on `freeGoldEligible`'s below-cheapest-buy-in check -- is
 * what remains. `kind: "low-gold"` is the honest label; the modal never reads
 * `kind` for anything but bookkeeping this manual path doesn't use.
 */
const FREE_GOLD_TRIGGER: RewardTrigger = {
  kind: "low-gold",
  headline: "Free Gold",
  detail: `You need ${REWARDED_AD_ELIGIBLE_BELOW.toLocaleString("en-US")} Gold to sit down at the cheapest table.`,
};

export function PokerApp() {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  // A predicted view of `game` for the caller's own fold/call/raise/all-in,
  // so the felt reacts on the tap instead of on the round trip -- see
  // lib/game/optimistic-action.ts. Only ever rendered from, never treated
  // as truth: React reverts to `game` itself once the transition that
  // queued a prediction settles, whether or not the request succeeded.
  const [optimisticGame, addOptimisticAction] = useOptimistic(game, applyOptimisticAction);
  const [, startActionTransition] = useTransition();
  const [loadedProfile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  const [cashOutNotice, setCashOutNotice] = useState<number | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!accountsEnabled());

  /*
   * WHY THE PROFILE AND THE ENTRY GATE ARE DERIVED RATHER THAN PLAIN STATE
   *
   * The arcade, Collection and the leaderboard are their own routes, so "Back
   * to the lobby" unmounts this component and mounts a fresh one. Everything
   * below used to start empty on each of those arrivals, and the player watched
   * the app rediscover facts it already knew: the signed-out card painted for
   * the length of one `GET /api/profile`, then the hub's own "Preparing your
   * seat..." for the rest of it, then finally the hub. A login screen flashing
   * at somebody an hour into a session, once per navigation.
   *
   * `cachedProfile` is this tab's copy of the last profile the server sent
   * (see lib/profile/session-continuity.ts for why it is sessionStorage and
   * never localStorage). It reaches the first render synchronously through
   * `useSyncExternalStore`, which is the whole point -- `useStoredPreference`
   * defers by a tick, and a value that arrives after the first paint has
   * already let the wrong screen show. Same trade `first-run-strip.tsx` makes.
   *
   * It is a bridge, not an authority, and `profileLoading` is what keeps that
   * honest: the moment the real fetch settles, `loadedProfile` is the answer
   * even when the answer is null. That ordering is load-bearing -- read the
   * cache after the load settles and a player whose session has expired keeps
   * seeing their old balance and stays waved through the gate.
   */
  const readSessionProfile = useCallback(
    () => sessionProfileSnapshot(browserSessionStorage()),
    [],
  );
  const cachedProfile = useSyncExternalStore(
    subscribeSessionCache,
    readSessionProfile,
    serverProfileSnapshot,
  );
  const profile = loadedProfile ?? (profileLoading ? cachedProfile : null);

  /**
   * Entry is opened by choosing an account or Continue as guest, and is
   * *evidenced* by holding a profile at all -- the session cookie is the
   * durable record of having been through the gate, and a profile only comes
   * back when one exists. Deriving it rather than mirroring it into state is
   * what stops a remount asking the question again.
   */
  const [entryOpened, setEntryOpened] = useState(false);
  const entryComplete = entryOpened || profile !== null;

  /** Keeps this tab's copy in step, so the next mount paints instantly. */
  useEffect(() => {
    if (loadedProfile) writeCachedProfile(browserSessionStorage(), loadedProfile);
  }, [loadedProfile]);

  // Both notices retire themselves; see NOTICE_VISIBLE_MS. Keyed on the value
  // so a second cash-out restarts the clock rather than inheriting the tail of
  // the first one's.
  useEffect(() => {
    if (cashOutNotice === null) return;
    const timer = window.setTimeout(() => setCashOutNotice(null), NOTICE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [cashOutNotice]);

  useEffect(() => {
    if (authNotice === null) return;
    const timer = window.setTimeout(() => setAuthNotice(null), NOTICE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [authNotice]);

  const [rememberSession, setRememberSession] = useState(true);
  const [signInPending, setSignInPending] = useState(false);
  const [navShowing, setNavShowing] = useState(false);
  const [savePromptDismissed, setSavePromptDismissed] = useState(false);
  const [soundEnabled, setSoundEnabledState] = useStoredPreference<boolean>({
    key: SOUND_STORAGE_KEY,
    legacyKey: LEGACY_SOUND_STORAGE_KEY,
    fallback: true,
    parse: parseEnabledFlag,
    apply: (enabled, cause) => {
      setSoundEnabled(enabled);
      // Only ever as confirmation of a deliberate unmute, and only after the
      // line above has actually unmuted the channel it plays through.
      if (enabled && cause === "change") playSound("ui");
    },
  });
  const [musicEnabled, setMusicEnabledState] = useStoredPreference<boolean>({
    key: MUSIC_STORAGE_KEY,
    fallback: true,
    parse: parseEnabledFlag,
    apply: setMenuMusicEnabled,
  });
  const [betStyle, setBetStyleState] = useStoredPreference<BetAnimationStyle>({
    key: BET_STYLE_STORAGE_KEY,
    fallback: DEFAULT_BET_STYLE,
    parse: normalizeBetStyle,
  });
  // Same shape as betStyle above, and deliberately with no `apply`: the
  // consumer is a prop on <PokerTable>, not a module singleton, so there is
  // nothing to push the value into outside React.
  // The third member is the anti-flicker signal, and this is the one
  // preference in the app that needs it: it decides which of two renderers to
  // MOUNT, so acting on the fallback for a tick means building and discarding
  // a whole room. See the note on `settled` in use-stored-preference.ts.
  const [tableRenderer, setTableRendererState, tableRendererSettled] =
    useStoredPreference<TableRenderer>({
      key: TABLE_RENDERER_STORAGE_KEY,
      fallback: DEFAULT_TABLE_RENDERER,
      parse: normalizeTableRenderer,
    });
  // Same shape again, and no `settled` needed this time: unlike the renderer
  // above, a theme change never remounts anything -- it's just colour/light
  // props flowing into the already-mounted 3D room -- so a one-tick flicker
  // to the default before the stored value arrives is harmless.
  const [roomThemeId, setRoomThemeIdState] = useStoredPreference<RoomThemeId>({
    key: ROOM_THEME_STORAGE_KEY,
    fallback: DEFAULT_ROOM_THEME_ID,
    parse: normalizeRoomThemeId,
  });
  // Same probe poker-table.tsx uses to decide what the menu can offer;
  // asked here too now that the buy-in modal offers the same choice before
  // any table exists to mount it into.
  const webglAvailable = useWebglSupport();
  // The 2.5D table is landscape-only -- see `resolveTableRenderer`. Owned here
  // rather than in each consumer so the lobby's preselect and the table itself
  // can never disagree about which way up the device is.
  const landscape = useLandscape();

  // The lobby and signed-out form scroll inside their own viewport because
  // the table must remain a fixed-height screen. Listen to that scroller
  // rather than window: the header stays quiet over the room, then becomes a
  // readable surface when the player reverses direction and scrolls upward.
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.account-entry-page, .lobby-hub');
    if (!scroller) return;

    let previousTop = scroller.scrollTop;
    const onScroll = () => {
      const currentTop = scroller.scrollTop;
      setNavShowing(currentTop > 8 && currentTop < previousTop);
      previousTop = currentTop;
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [entryComplete, game]);
  const [claimingGold, setClaimingGold] = useState(false);
  const [goldFlash, setGoldFlash] = useState(false);
  // The lobby menu's own "Free Gold" entry -- the only way this modal opens.
  // Reopenable any time the row is eligible, up to the server's daily cap.
  const [freeGoldOpen, setFreeGoldOpen] = useState(false);
  // Learned from the server, not assumed: null means "hasn't been told
  // otherwise yet", so the row stays offered until a real 429 says the day's
  // cap is spent. Prevents the row reappearing after a claim if the balance
  // happens to still read under the threshold on a stale render.
  const [freeGoldRemainingToday, setFreeGoldRemainingToday] = useState<number | null>(null);
  // Set only by hostPrivate, cleared on dismiss: the share sheet is a
  // one-shot moment right after creating a room, not table state.
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const gameId = game?.id;
  const mySeatId = game?.seats.find((seat) => seat.isMine)?.id ?? null;
  const { reactions, sendReaction, onCooldown: reactionCooldown } =
    useTableReactions(gameId ?? null, mySeatId);
  const gameVersionRef = useRef(game?.version ?? 0);
  const previousGameRef = useRef<GameSnapshot | null>(null);
  // Deliberately its own ref rather than reading previousGameRef, which the
  // tableSounds effect below owns and overwrites. Sharing it would make the
  // "game on" cue depend on which of the two effects React declared first.
  const wasSeatedRef = useRef(false);
  const linkedAccountIdRef = useRef<string | null>(null);
  const accountLinkPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setRememberSession(readRememberAuthSession()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((current) => !current);
  }, [setSoundEnabledState]);

  const toggleMenuMusic = useCallback(() => {
    setMusicEnabledState((current) => !current);
  }, [setMusicEnabledState]);

  const cycleBetStyle = useCallback(() => {
    setBetStyleState(nextBetStyle);
  }, [setBetStyleState]);

  /**
   * Steps from the renderer that is actually MOUNTED, which the table passes
   * in, rather than from the stored preference.
   *
   * They differ whenever a preference has been resolved away -- the 3D room on
   * a device without WebGL, or the 2.5D table in portrait -- and stepping from
   * the stored value in that state produces a menu entry that visibly does
   * nothing. Concretely: stored 2.5D, held in portrait, so the classic table is
   * mounted and the entry reads "Table: Classic"; stepping from the stored
   * 2.5D lands on canvas_2d, which is what is already on screen, so the label
   * does not change and the tap looks broken.
   */
  const cycleTableRenderer = useCallback((mounted: TableRenderer) => {
    setTableRendererState(nextTableRenderer(mounted, webglAvailable, landscape));
  }, [setTableRendererState, webglAvailable, landscape]);

  const cycleRoomTheme = useCallback(() => {
    setRoomThemeIdState(nextRoomThemeId);
  }, [setRoomThemeIdState]);

  /**
   * The daily claim, moved off the navbar.
   *
   * It lives here rather than inside GoldBadge because the badge is now a
   * readout: the action belongs to the player menu, which is already the one
   * place in this app where "things you can do to your account" are listed,
   * and the credited profile has to land in this component's state either way.
   */
  const claimDailyGold = useCallback(async () => {
    if (claimingGold) return;
    setClaimingGold(true);
    try {
      const response = await fetch("/api/profile/gold/claim", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not claim your daily Gold.");
      setProfile(data.profile);
      // The one piece of feedback that survived the button: the balance
      // flashes, so a claim made from a menu that has already closed is still
      // visibly a claim.
      setGoldFlash(true);
      window.setTimeout(() => setGoldFlash(false), 900);
    } catch {
      // Best-effort, exactly as the old button was: the menu entry simply
      // stays offered so it can be tried again.
    } finally {
      setClaimingGold(false);
    }
  }, [claimingGold]);

  useEffect(() => {
    // The screen boundary is wider than just `game`: PokerApp only owns the
    // lobby/hub/table experience, and the arcade (`/games/*`) plus
    // /collection, /leaderboard and /store are separate routes that unmount
    // this whole component. Without a cleanup here, navigating to any of
    // them left the singleton <audio> element in lib/audio/menu-music.ts
    // playing behind a page that never asked for it -- nothing under those
    // routes imports stopMenuMusic. The cleanup below is what actually fixes
    // that: it fires on every unmount, which is every such navigation.
    //
    // Tab visibility is the other half: a hidden tab (backgrounded window,
    // switched tab) has no in-app "leave" to hook, so it's read directly via
    // document.hidden. sync() is the single source of truth for both game
    // and visibility so the two conditions can't drift into two separate
    // start/stop call sites.
    setMenuMusicEnabled(musicEnabled);

    const sync = () => {
      if (!musicEnabled) return;
      if (game || document.hidden) stopMenuMusic();
      else startMenuMusic();
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stopMenuMusic();
    };
  }, [game, musicEnabled]);

  useEffect(() => {
    // Every rule about what the table sounds like lives in tableSounds, where
    // it can be tested. This effect's only job is to hold the previous
    // snapshot and play what comes back.
    const previous = previousGameRef.current;
    previousGameRef.current = game;
    for (const effect of tableSounds(previous, game)) playSound(effect);
  }, [game]);

  /**
   * "Game on" -- the one cue that says you are actually at a table.
   *
   * Edge-triggered, and it has to be. `game` changes identity on every poll,
   * every server tick and every action, so the level-triggered shape the menu
   * music and first-run effects use below would fire this dozens of times a
   * hand. Those two get away with it because stopping music and writing a
   * localStorage flag are idempotent; playing a sound is not.
   *
   * It lives here rather than in the four handlers that can seat a player
   * (quickPlay, hostPrivate, joinByCode, and the ?table= deep link) because
   * three of those four used to call playSound("deal") and the fourth was
   * silent -- the deep link shares `refresh` with the poll loop, so nobody
   * ever added it. One edge covers all four, and covers the friend-invite
   * accept path for free the day onJoinedTable is finally wired up.
   *
   * tableSounds is deliberately silent on entry (it returns [] when there is
   * no previous snapshot to have changed from), so this does not collide with
   * it -- see the note at the top of lib/audio/table-sounds.ts.
   */
  useEffect(() => {
    const seated = Boolean(game);
    const was = wasSeatedRef.current;
    wasSeatedRef.current = seated;
    if (seated && !was) gameOnSound();
  }, [game]);
  useEffect(() => {
    gameVersionRef.current = game?.version ?? 0;
  }, [game?.version]);

  // Reaching a table retires the first-run strip, and this is written here
  // rather than inside the strip because the strip is not mounted at the
  // moment it happens -- Lobby is replaced by PokerTable, so FirstRunStrip is
  // gone. A player who ignored the guidance entirely and just tapped the hero
  // tile has answered its question better than finishing three steps would;
  // see the note on isFirstRunRetired in lib/lobby/first-run.ts.
  //
  // No React state here on purpose. Writing the flag is a side effect on an
  // external system (localStorage), which is exactly what an effect is for;
  // mirroring it into state as well would be the cascading-render shape
  // react-hooks/set-state-in-effect exists to stop, and it would buy nothing
  // -- the same swap that unmounts the strip is what makes it re-read the flag
  // when the player comes back to the lobby.
  useEffect(() => {
    if (game) retireFirstRunStrip();
  }, [game]);

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load your profile.");
    setProfile(data.profile);
    // A profile came back, so this browser holds a session cookie and has been
    // through the entry gate before -- which `entryComplete` now reads off the
    // profile directly rather than mirroring into state, so there is nothing
    // to set here. No profile is the other half of that: the session is gone,
    // so this tab's cached copy is stale and must not be shown to whoever
    // arrives next.
    if (!data.profile) clearSessionContinuity(browserSessionStorage());
  }, []);

  const ingest = useCallback((data: { game: GameSnapshot; persistence: string; profile?: PlayerProfile }) => {
    setGame((current) => (
      current && current.id === data.game.id && current.version > data.game.version
        ? current
        : data.game
    ));
    setConnectionState("connected");
    setError(null);
    // Present whenever the action spent or credited Gold (a buy-in, a
    // rebuy), so the navbar balance updates without a separate profile
    // re-fetch.
    if (data.profile) setProfile(data.profile);
  }, []);

  const refresh = useCallback(async (id: string) => {
    const response = await fetch(`/api/games/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not refresh the table.");
    ingest(data);
    return data as { game: GameSnapshot; persistence: string };
  }, [ingest]);

  const advanceTable = useCallback(async (id: string) => {
    const response = await fetch(`/api/games/${id}/advance`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not advance the table.");
    ingest(data);
    return data as { game: GameSnapshot; persistence: string; retryAfterMs: number | null };
  }, [ingest]);

  const joinByCode = useCallback(async (code: string, name?: string) => {
    const response = await fetch("/api/games/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not join that table.");
    // No sound here: the game-on edge above fires off `game` itself, so this
    // path and the ?table= deep link it rewrites to now sound the same.
    ingest(data);
    window.history.replaceState({}, "", `/?table=${data.game.id}`);
  }, [ingest]);

  useEffect(() => {
    const markOffline = () => setConnectionState("offline");
    const reconnect = () => {
      setConnectionState("reconnecting");
      if (gameId) {
        void refresh(gameId).catch(() => setConnectionState("reconnecting"));
      }
    };
    // A backgrounded tab's setTimeout (the turn clock) and its Realtime
    // socket are both fair game for the browser to throttle or suspend --
    // observed worst case, a table sat between hands while the player who'd
    // just busted had switched away, and nothing forced a check on return.
    // Rejoining the queue's own schedule fixes it eventually, but "eventually"
    // is exactly the frozen feeling this closes: a resync the instant the tab
    // is looked at again, same request the reconnect path above already uses.
    const resyncOnReturn = () => {
      if (document.hidden || !gameId) return;
      void refresh(gameId).catch(() => {});
    };
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", resyncOnReturn);
    window.addEventListener("focus", resyncOnReturn);
    if (!window.navigator.onLine) markOffline();
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", resyncOnReturn);
      window.removeEventListener("focus", resyncOnReturn);
    };
  }, [gameId, refresh]);

  useEffect(() => {
    if (!entryComplete) return;
    const params = new URLSearchParams(window.location.search);
    const tableId = params.get("table");
    const code = params.get("code");
    if (!tableId && !code) return;
    const timer = window.setTimeout(() => {
      const opened = tableId ? refresh(tableId) : joinByCode(code!);
      void opened.catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not open that table.");
        window.history.replaceState({}, "", "/");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [entryComplete, refresh, joinByCode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment !== "success" || !sessionId) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/stripe/checkout-session/verify?session_id=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not verify the payment.");
          if (data.profile) setProfile(data.profile);
          setAuthNotice(data.paid ? "Payment received — your rebuy Gold is ready." : "Payment is still processing.");
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not verify the payment."))
        .finally(() => {
          params.delete("payment");
          params.delete("session_id");
          const query = params.toString();
          window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile()
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : "Could not load your profile.");
        })
        .finally(() => setProfileLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  /**
   * Gives a first-time visitor an actual profile once they enter the lobby.
   *
   * The load above deliberately creates nothing -- 3bbc117 stopped read-only
   * routes minting a player per request -- and the session token itself is
   * not minted until POST /api/auth/session-preference, the first call
   * either entry path makes. So a brand-new browser reaches the lobby
   * holding a fresh cookie with nothing behind it: profile null, 0 Gold,
   * every stakes tier reading "Need N Gold", and the buy-in modal's confirm
   * disabled with no way to ever enable it.
   *
   * Deliberately its own effect rather than an await inside continueAsGuest.
   * Awaiting there fixes this path too, but it puts setEntryOpened behind
   * a network round trip and so changes when the ?table= effect below runs
   * -- and that effect is what puts you back at a table you were already
   * sitting at. Creating the profile alongside it instead leaves that timing
   * byte-for-byte unchanged and needs no edit to either entry handler.
   *
   * POST /api/profile is the only route that both mints the token and calls
   * ensureProfile, and it is idempotent per token, so arriving here with a
   * profile that already exists costs a lookup and nothing else. A failure
   * is not retried on a timer: the deps cannot change while profile stays
   * null, which is what keeps a dead network from becoming a request loop.
   */
  useEffect(() => {
    if (!entryComplete || profile || profileLoading) return;
    let active = true;
    void fetch("/api/profile", { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not start your profile.");
        if (!active) return;
        setProfile(data.profile);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not start your profile.");
      });
    return () => {
      active = false;
    };
  }, [entryComplete, profile, profileLoading]);

  useEffect(() => {
    if (!("serviceWorker" in window.navigator)) return;
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

  useEffect(() => {
    // The shared client, never a fresh one: a second createClient here means
    // a second GoTrueClient racing the first to refresh the same session.
    const supabase = browserSupabase();
    if (!gameId || !supabase) return;
    let disposed = false;
    let refreshRunning = false;
    let refreshQueued = false;
    let pendingVersion = gameVersionRef.current;
    let consecutiveRetries = 0;
    let retryTimer: number | null = null;

    const clearRefreshRetry = () => {
      if (retryTimer === null) return;
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleRefreshRetry = () => {
      if (disposed || retryTimer !== null) return;
      if (consecutiveRetries >= MAX_REFRESH_RETRIES) {
        refreshQueued = false;
        consecutiveRetries = 0;
        setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
        return;
      }
      const delay = Math.min(
        REFRESH_RETRY_BASE_MS * 2 ** consecutiveRetries,
        REFRESH_RETRY_MAX_MS,
      );
      consecutiveRetries += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        refreshLatest();
      }, delay);
    };

    const refreshLatest = () => {
      if (disposed) return;
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }
      clearRefreshRetry();
      refreshRunning = true;
      refreshQueued = false;
      void refresh(gameId)
        .then((data) => {
          if (data.game.version < pendingVersion) {
            refreshQueued = true;
            return;
          }
          consecutiveRetries = 0;
        })
        .catch(() => {
          refreshQueued = true;
          setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
        })
        .finally(() => {
          refreshRunning = false;
          if (disposed) return;
          if (refreshQueued) {
            scheduleRefreshRetry();
          } else {
            consecutiveRetries = 0;
          }
        });
    };

    let channel: RealtimeChannel | null = supabase
      .channel(tableChannelName(gameId))
      .on(
        "broadcast",
        { event: TABLE_STATE_CHANGED },
        (payload) => {
          const event = parseTableStateChanged(payload.payload);
          if (
            !event
            || event.version <= Math.max(pendingVersion, gameVersionRef.current)
          ) return;
          pendingVersion = event.version;
          refreshLatest();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnectionState("connected");
        if (
          status === "CHANNEL_ERROR"
          || status === "TIMED_OUT"
          || status === "CLOSED"
        ) {
          setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
        }
      });
    return () => {
      disposed = true;
      clearRefreshRetry();
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  }, [gameId, refresh]);

  // ---- The table clock -------------------------------------------------
  //
  // One request, at one deadline, from one browser. What this replaces:
  //
  //  - memory mode ran setInterval(advance, 1500) unconditionally. Measured
  //    idle at a table: 18 POST /advance in 30s with nobody doing anything.
  //  - the persistent path scheduled its timeout with Math.max(200, ...) and
  //    listed `game.seats` in its dependencies. `seats` is a fresh array on
  //    every snapshot, so every refresh rebuilt the timer, and an already-
  //    overdue deadline floored the delay to 200ms -- each advance changed
  //    `version`, which re-ran the effect, which scheduled another 200ms.
  //
  // The primitives below are all that decision needs, so the effect re-runs
  // only when one of them genuinely changes.
  const currentSeat = game?.seats.find((seat) => seat.isCurrent) ?? null;
  const humanSeats = (game?.seats ?? [])
    .filter((seat) => seat.isHuman)
    .sort((a, b) => a.position - b.position);
  const clockInput: TurnClockInput = {
    isSeated: Boolean(game?.isSeated),
    turnDeadlineAt: game?.turnDeadlineAt ?? null,
    nextHandAt: game?.nextHandAt ?? null,
    currentIsHuman: Boolean(currentSeat?.isHuman),
    currentIsMine: Boolean(currentSeat?.isMine),
    myHumanRank: humanSeats.findIndex((seat) => seat.isMine),
  };
  const {
    isSeated, turnDeadlineAt, nextHandAt, currentIsHuman, currentIsMine, myHumanRank,
  } = clockInput;

  useEffect(() => {
    if (!gameId) return;
    const plan = planTurnClock(
      { isSeated, turnDeadlineAt, nextHandAt, currentIsHuman, currentIsMine, myHumanRank },
      Date.now(),
    );
    if (plan.kind === "idle") return;

    let disposed = false;
    const timeout = window.setTimeout(() => {
      if (disposed) return;
      if (!window.navigator.onLine) {
        setConnectionState("offline");
        return;
      }
      // Deliberately no retry timer. The response updates `version`, which
      // re-runs this effect with the server's next deadline; a failure is
      // picked up by the next snapshot. Retrying on a timer here is what made
      // a stalled table generate traffic forever.
      void advanceTable(gameId).catch(() => {
        if (!disposed) setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
      });
    }, plan.delayMs);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [advanceTable, gameId, isSeated, turnDeadlineAt, nextHandAt, currentIsHuman, currentIsMine, myHumanRank]);

  const quickPlay = async (name: string, tier: StakesTier, buyIn: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/games/quick-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tier, buyIn }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not find you a table.");
      ingest(data);
      window.history.pushState({}, "", `/?table=${data.game.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not find you a table.");
    } finally {
      setLoading(false);
    }
  };

  const hostPrivate = async (name: string, tier: StakesTier, buyIn: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isPrivate: true, tier, buyIn }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not host a table.");
      ingest(data);
      if (data.game?.roomCode) setCreatedRoomCode(data.game.roomCode);
      window.history.pushState({}, "", `/?table=${data.game.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not host a table.");
    } finally {
      setLoading(false);
    }
  };

  const joinWithCode = async (name: string, code: string) => {
    setLoading(true);
    setError(null);
    try {
      await joinByCode(code, name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join that table.");
    } finally {
      setLoading(false);
    }
  };

  const act = (action: PlayerAction) => {
    if (!game || loading) return;
    const actionSound: Partial<Record<PlayerAction["type"], Parameters<typeof playSound>[0]>> = {
      fold: "fold",
      check: "check",
      call: "call",
      raise: "raise",
      "all-in": "all-in",
      "next-hand": "ui",
      "leave-seat": "ui",
      rebuy: "ui",
    };
    const effect = actionSound[action.type];
    if (effect) playSound(effect);
    setLoading(true);
    setError(null);
    // addOptimisticAction must fire inside the same transition as the
    // request it's predicting -- that's what makes React hold the
    // prediction until this settles and then always defer to whatever
    // ingest() actually writes, success or failure.
    startActionTransition(async () => {
      addOptimisticAction(action);
      await sendAction(action);
    });
  };

  const sendAction = async (action: PlayerAction) => {
    if (!game) return;
    try {
      const response = await fetch(`/api/games/${game.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The version this decision was made against. If the table moved on
        // between the click and the request, the server declines rather than
        // betting again on our behalf.
        body: JSON.stringify({ action, expectedVersion: game.version }),
      });
      const data = await response.json();
      if (response.status === 409 && data?.stale && data?.game) {
        // Already applied. Adopt the server's state; this is not an error the
        // player needs to see.
        ingest(data);
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "That action was not accepted.");
      ingest(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That action was not accepted.");
    } finally {
      setLoading(false);
    }
  };

  const leave = () => {
    setGame(null);
    setError(null);
    window.history.replaceState({}, "", "/");
  };

  const leaveSeat = async () => {
    if (!game) return;
    const tableId = game.id;
    setLoading(true);
    // Drop the table view up front rather than after the round trip: the
    // player has already decided to go, and it stops the refresh poll from
    // racing the seat release -- once they are no longer seated, a poll
    // against a private table is correctly rejected.
    leave();
    try {
      const response = await fetch(`/api/games/${tableId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "leave-seat" }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.profile) setProfile(data.profile);
      // Chips only become Gold when the player stands up, so this is the one
      // moment the loop is visible. Say it plainly instead of leaving them to
      // spot the balance change in the navbar. Unlimited profiles are neither
      // charged nor paid, so there is no balance change to announce.
      if (
        response.ok
        && typeof data?.cashedOut === "number"
        && data.cashedOut > 0
        && !data?.profile?.unlimitedGold
      ) {
        setCashOutNotice(data.cashedOut);
      }
    } catch {
      // Best effort: the seat still reverts to a bot server-side even if this
      // client never hears back, so there's nothing useful to show here.
    } finally {
      setLoading(false);
    }
  };

  const claimBackstop = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/gold/backstop", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not top up your Gold.");
      setProfile(data.profile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not top up your Gold.");
    } finally {
      setLoading(false);
    }
  };

  // Completes a sign-in: Supabase's session cookie already proves who this
  // browser is, so the server reads it directly (getUser()) and either
  // links this guest profile or restores the one the account already owns.
  // For Google this is a safety-net re-run of what the OAuth callback route
  // already did server-side before redirecting here; linkAuthenticatedUser
  // is idempotent, so a duplicate call just restores the same profile.
  //
  // The *call* being idempotent is why it is safe to re-run and why it must
  // not re-announce. `linkedAccountIdRef` below is a ref, so it empties on
  // every mount -- and this component remounts on every return from the
  // arcade -- which had this greeting the player again for the fourth time in
  // a minute. Whether to speak is therefore asked of the tab (which survives
  // those remounts) and not of the ref: a real sign-in and a switch to a
  // different account still announce, a re-link says nothing.
  const linkAccount = useCallback(async (accountId: string) => {
    try {
      const response = await fetch("/api/auth/link", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save your progress.");
      setProfile(data.profile);
      setSavePromptDismissed(false);
      const storage = browserSessionStorage();
      if (shouldAnnounceAccountLink(storage, accountId)) {
        markAccountLinkAnnounced(storage, accountId);
        setAuthNotice(
          data.restored
            ? "Welcome back — your Gold, profile, and collection are ready."
            : "Progress secured — this profile now travels with your account.",
        );
      }
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your progress.");
      return false;
    } finally {
      setSignInPending(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading) return;
    const client = authClient();
    if (!client) return;

    let active = true;
    const restore = async (session: Session | null) => {
      if (!active || !session?.access_token) {
        if (active) setAuthReady(true);
        return;
      }
      const accountId = session.user.id;
      if (linkedAccountIdRef.current === accountId) {
        if (accountLinkPromiseRef.current) await accountLinkPromiseRef.current;
        if (active) setAuthReady(true);
        return;
      }
      linkedAccountIdRef.current = accountId;
      const linkPromise = linkAccount(accountId);
      accountLinkPromiseRef.current = linkPromise;
      const linked = await linkPromise;
      if (accountLinkPromiseRef.current === linkPromise) accountLinkPromiseRef.current = null;
      if (!linked) linkedAccountIdRef.current = null;
      if (active) setAuthReady(true);
    };

    // getSession resolves the already-cached cookie/browser state without
    // changing layouts. Auth events use the same path for the OAuth return.
    void client.auth.getSession()
      .then(({ data }) => restore(data.session))
      .catch(() => {
        if (active) setAuthReady(true);
      });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        linkedAccountIdRef.current = null;
        if (active) setAuthReady(true);
        return;
      }
      void restore(session);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [linkAccount, profileLoading]);

  /**
   * An authorization code landing here rather than /auth/callback means the
   * flow recorded a bare origin as its destination -- something this code
   * never asks for, so the flow was begun by a stale bundle or an older
   * deployment. detectSessionInUrl still redeems it when the verifier belongs
   * to this origin, so the only job here is to report it and, when it cannot
   * be redeemed, say so instead of leaving a dead ?code= in the address bar.
   */
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("code")) return;
    if (window.location.pathname !== "/") return;
    const client = authClient();
    if (!client) return;

    let active = true;
    const timer = window.setTimeout(() => {
      void client.auth.getSession().then(({ data }) => {
        if (!active) return;
        reportStrayAuthCode(Boolean(data.session));
        window.history.replaceState(null, "", window.location.pathname);
        if (!data.session) {
          setError("That sign-in link was for a different address. Please sign in again.");
        }
      });
    }, 2_000);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  /**
   * The OAuth callback route handler redirects here with this flag when the
   * code exchange itself failed server-side (an expired or already-used
   * code, a Supabase outage). It already reported the specific reason to
   * Sentry -- this only has to surface that something went wrong and clean
   * the marker out of the address bar.
   */
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("authError")) return;
    window.history.replaceState(null, "", window.location.pathname);
    const timer = window.setTimeout(
      () => setError("Google sign-in could not be completed. Please try again."),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  const signIn = async (): Promise<void> => {
    const client = authClient();
    if (!client) return;
    setError(null);
    setSignInPending(true);
    setRememberAuthSession(rememberSession);
    try {
      await applySessionPreference();
      const callbackUrl = oauthCallbackUrl();
      reportOAuthStart(callbackUrl);
      const { error: signInError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Production is pinned to the canonical StackChips origin; a
          // loopback callback is used only when this browser is genuinely
          // running the local app. The dedicated path also keeps the OAuth
          // `code` parameter separate from poker room invite codes.
          redirectTo: callbackUrl,
        },
      });
      if (signInError) throw signInError;
    } catch (caught) {
      console.error(
        "Google OAuth sign-in failed:",
        caught instanceof Error ? caught.message : caught,
      );
      setSignInPending(false);
      setError("Could not open Google sign-in. Try again.");
    }
  };

  /**
   * Email/password sign-in and sign-up. Both end the same way Google does --
   * a Supabase session appears, the onAuthStateChange listener above notices
   * it, and linkAccount attaches it to whatever profile this browser is
   * already using. Neither function links anything itself.
   */
  const signInWithEmail = async (email: string, password: string, captchaToken?: string) => {
    const client = authClient();
    if (!client) return;
    setError(null);
    setSignInPending(true);
    try {
      await applySessionPreference();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });
      if (signInError) throw signInError;
    } catch (caught) {
      setSignInPending(false);
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    }
  };

  const signUpWithEmail = async (email: string, password: string, captchaToken?: string) => {
    const client = authClient();
    if (!client) return;
    setError(null);
    setSignInPending(true);
    try {
      await applySessionPreference();
      const { data, error: signUpError } = await client.auth.signUp({
        email,
        password,
        options: { captchaToken },
      });
      if (signUpError) throw signUpError;
      // A Supabase project with email confirmation turned on returns a user
      // but no session here -- onAuthStateChange never fires, so this is the
      // only place that outcome is visible.
      if (!data.session) {
        setSignInPending(false);
        setAuthNotice("Check your email to confirm your account, then sign in.");
      }
    } catch (caught) {
      setSignInPending(false);
      setError(caught instanceof Error ? caught.message : "Could not create your account.");
    }
  };

  const applySessionPreference = async () => {
    setRememberAuthSession(rememberSession);
    const response = await fetch("/api/auth/session-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remember: rememberSession }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? "Could not save your sign-in preference.");
  };

  const continueWithAccount = async () => {
    setError(null);
    setSignInPending(true);
    try {
      await applySessionPreference();
      setEntryOpened(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the lobby.");
    } finally {
      setSignInPending(false);
    }
  };

  const signOut = async () => {
    setError(null);
    // Clear the provider session and the session cookie. The cookie is the
    // credential the server trusts, so skipping it would leave this browser
    // still holding the signed-in profile while the UI claimed otherwise.
    await authClient()?.auth.signOut().catch(() => {});
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
    setGame(null);
    linkedAccountIdRef.current = null;
    setEntryOpened(false);
    // Both halves, together and before the reload below. `entryComplete` is
    // derived from holding a profile now, so leaving either the loaded copy or
    // this tab's cached one in place would keep the departing player's name and
    // balance on screen -- and waved through the gate -- until the refetch
    // landed. Clearing the tab also re-arms the greeting for the next account.
    setProfile(null);
    clearSessionContinuity(browserSessionStorage());
    setAuthNotice("Signed out — you can keep playing as a guest on this browser.");
    await loadProfile().catch(() => {});
  };

  const continueAsGuest = async () => {
    setError(null);
    setSignInPending(true);
    try {
      await applySessionPreference();
      // Nothing is awaited between minting the session and opening the lobby,
      // on purpose. The profile a first-time guest needs is created by the
      // effect near loadProfile above, which runs off `entryComplete` rather
      // than blocking it -- so the `?table=` effect below still fires on the
      // same tick it always did and resuming a table you were seated at is
      // untouched. Adding an await here is what breaks that.
      setEntryOpened(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the lobby.");
    } finally {
      setSignInPending(false);
    }
  };

  // Recomputed each render rather than stored: nothing else can change it, and
  // a claim that lands flips lastDailyClaimAt on the profile this reads.
  const dailyGold = dailyGoldState(profile, new Date());

  /**
   * Whether the "Get Free Gold" row belongs in the menu right now.
   *
   * Registered-only and never-unlimited for the same reason claimDailyGold's
   * row is: the server's eligibleProfile rejects both, and a row that always
   * 403s or 409s is worse than no row. Balance is read live off `profile`, so
   * a claim that credits the wallet past the threshold makes this row
   * disappear on that same render with no extra plumbing; the daily cap
   * cannot be read that way (the profile does not carry claims-today), so
   * `freeGoldRemainingToday` -- learned from the server the first time it
   * says so -- covers the one case balance alone can't.
   */
  const freeGoldEligible = profile !== null
    && profile.isRegistered
    && !profile.unlimitedGold
    && profile.goldBalance < REWARDED_AD_ELIGIBLE_BELOW
    && (freeGoldRemainingToday === null || freeGoldRemainingToday > 0);

  /**
   * When to offer a rewarded ad: only when the lobby's "Get Free Gold" row is
   * clicked. `!game` here is belt-and-suspenders -- the row itself only
   * renders inside the lobby's `{!game && ...}` block below -- but the point
   * of this feature is "never mid-hand", so the modal's own gate says that
   * directly rather than trusting the menu not to change shape later.
   */
  const activeRewardTrigger = freeGoldOpen && !game ? FREE_GOLD_TRIGGER : null;
  const closeRewardModal = () => setFreeGoldOpen(false);

  const lobbyMenuItems: MenuItem[] = [
    // First, and only for an account that can actually take either. A
    // guest's path to both is "Sign in" at the bottom of this same menu, so
    // offering a dead row here would be the navbar's old "Save to claim"
    // button moved rather than removed.
    ...(dailyGold === "ready" || dailyGold === "claimed" || freeGoldEligible
      ? [
        // Above the daily claim, on purpose: it is the row a player under a
        // buy-in actually needs first, and it is the one that can be used
        // more than once. Under the cheapest buy-in only -- see
        // freeGoldEligible. Opens the same RewardedAdModal an in-game moment
        // would, just requested instead of noticed, and it can be reopened
        // as many times as the daily cap allows rather than once per
        // session.
        ...(freeGoldEligible
          ? [{
            kind: "action" as const,
            label: "Get Free Gold",
            onSelect: () => setFreeGoldOpen(true),
            icon: <Video size={15} />,
          }]
          : []),
        ...(dailyGold === "ready" || dailyGold === "claimed"
          ? [{
            kind: "action" as const,
            label: dailyGold === "ready"
              ? (claimingGold ? "Claiming…" : "Claim daily Gold")
              : "Daily Gold claimed",
            onSelect: () => void claimDailyGold(),
            disabled: dailyGold === "claimed" || claimingGold,
            icon: <Gift size={15} />,
          }]
          : []),
        { kind: "separator" as const },
      ]
      : []),
    { kind: "link", label: "Collection", href: "/collection", icon: <Layers size={15} /> },
    // The main store entry -- Support StackChips used to sit right below this
    // as an equal-weight row, which read as two competing stores in one
    // dropdown. It now lives as the small heart button in the header instead
    // (DonateButton, below), so this is the only purchase path left here.
    { kind: "link", label: "Buy Gold", href: gameId ? `/store/gold?table=${gameId}` : "/store/gold", icon: <Coins size={15} /> },
    { kind: "link", label: "Leaderboard", href: "/leaderboard", icon: <Trophy size={15} /> },
    { kind: "separator" },
    {
      kind: "action",
      label: musicEnabled ? "Menu music: On" : "Menu music: Off",
      onSelect: toggleMenuMusic,
      icon: <Music2 size={15} />,
    },
    { kind: "separator" },
    ...(profile ? [{ kind: "action" as const, label: "Edit profile", onSelect: () => setProfileOpen(true), icon: <Settings2 size={15} /> }] : []),
    profile?.isRegistered
      ? { kind: "action", label: "Sign out", onSelect: () => void signOut(), icon: <LogOut size={15} /> }
      // "Sign in", not "Save progress": it is the same signIn() the header's
      // own AuthButton calls for a guest, and the two must say the same thing.
      : { kind: "action", label: "Sign in", onSelect: () => void signIn(), icon: <LogIn size={15} /> },
  ];

  /** Leaving the table while still seated cashes out first, so chips are never stranded. */
  const leaveTable = () => {
    if (game?.isSeated) {
      void leaveSeat();
      return;
    }
    leave();
  };

  return (
    <div className="app-root">
      <div className="entry-sky app-entry-sky" aria-hidden="true">
        <span className="entry-orb" />
        <span className="entry-orb" />
        <span className="entry-orb" />
        <span className="entry-orb" />
        <span className="entry-orb" />
      </div>
      {!game && (
        <header className={`lobby-header${navShowing ? " is-scrolling-up" : ""}`}>
          {/* The mark alone. The typeset name that used to sit beside it is
              gone from both headers -- the mark carries the brand and the two
              together were saying the same thing twice in a 44px row.
              Still the simplified mark rather than the full badge: at the
              ~50px this row allows, the badge's own banner type collapses
              into a smudge (checked on a real render), and with the wordmark
              removed there is no more vertical room, not less.
              The SVG is aria-hidden, so the label lives on the wrapper --
              otherwise the header's only content is invisible to a screen
              reader. */}
          <div className="wordmark wordmark-mark-only">
            <span className="wordmark-mark" role="img" aria-label="StackChips">
              <StackChipsMark size={50} />
            </span>
          </div>
          {/* The hub tiles already carry Collection and the leaderboard, so
              repeating them here was three chances to tap the same thing.
              Gold stays visible because it is the number a player checks
              before choosing stakes. The heart is the one persistent nav
              fixture Support StackChips gets now -- see DonateButton. */}
          <div className="header-actions">
            {entryComplete && profile && (
              <GoldBadge profile={profile} claimable={dailyGold === "ready"} justClaimed={goldFlash} />
            )}
            {entryComplete && <DonateButton />}
            {entryComplete
              ? (
                <Menu
                  label="Open player menu"
                  trigger={profile
          ? (
            <span className="app-menu-profile-trigger">
              <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
              <strong className="app-menu-player-name">{profile.displayName}</strong>
            </span>
          )
                    : <span className="app-menu-fallback"><Settings2 size={16} /></span>}
                  items={lobbyMenuItems}
                />
              )
              : <AuthButton profile={profile} onSignIn={() => void signIn()} onSignOut={() => void signOut()} />}
          </div>
        </header>
      )}
      {game
        ? (
          <PokerTable
            game={optimisticGame ?? game}
            pending={loading}
            error={error}
            onAction={act}
            onLeave={leaveTable}
            onLeaveSeat={leaveSeat}
            profile={profile}
            onClaimBackstop={claimBackstop}
            onCustomize={() => setProfileOpen(true)}
            connectionState={connectionState}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            betStyle={betStyle}
            onCycleBetStyle={cycleBetStyle}
            tableRenderer={tableRenderer}
            tableRendererSettled={tableRendererSettled}
            landscape={landscape}
            onCycleTableRenderer={cycleTableRenderer}
            roomThemeId={roomThemeId}
            onCycleRoomTheme={cycleRoomTheme}
            onSignIn={() => void signIn()}
            onSignOut={() => void signOut()}
            reactions={reactions}
            onSendReaction={sendReaction}
            reactionCooldown={reactionCooldown}
          />
        )
        : (
          /* Deliberately unkeyed. It used to carry `key={profile.updatedAt}`,
             which made every profile write -- every buy-in, every cash-out,
             every daily claim -- tear the whole hub down and rebuild it: the
             rank strip vanished and refetched, the grid jumped up and back as
             it returned, open drawers closed, and a half-typed name was lost.
             The one thing that needed the remount was the buy-in name field
             seeding itself from `profile.displayName`, which Lobby now derives
             instead. A key is for telling two different things apart, not for
             pushing a new prop into stale state. */
          <Lobby
            profile={profile}
            onQuickPlay={quickPlay}
            onHostPrivate={hostPrivate}
            onJoinCode={joinWithCode}
            loading={loading}
            sessionReady={!profileLoading}
            error={error}
            cashOutNotice={cashOutNotice}
            onDismissCashOut={() => setCashOutNotice(null)}
            onClaimBackstop={claimBackstop}
            authNotice={authNotice}
            onDismissAuthNotice={() => setAuthNotice(null)}
            onSaveProgress={signIn}
            onEmailSignIn={(email, password, captchaToken) => void signInWithEmail(email, password, captchaToken)}
            onEmailSignUp={(email, password, captchaToken) => void signUpWithEmail(email, password, captchaToken)}
            onDismissSaveProgress={() => setSavePromptDismissed(true)}
            savePromptDismissed={savePromptDismissed}
            entryComplete={entryComplete}
            authReady={authReady}
            signInPending={signInPending}
            rememberSession={rememberSession}
            onRememberSessionChange={setRememberSession}
            onContinueAccount={() => void continueWithAccount()}
            onContinueAsGuest={continueAsGuest}
            onSignOut={() => void signOut()}
            tableRenderer={tableRenderer}
            webglAvailable={webglAvailable}
            landscape={landscape}
            onTableRendererChange={setTableRendererState}
          />
        )}
      {createdRoomCode && (
        <RoomCreatedModal code={createdRoomCode} onClose={() => setCreatedRoomCode(null)} />
      )}
      {profileOpen && profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={setProfile}
        />
      )}
      {/* Last, and gated on entryComplete: the offer is for a player who is in
          the app, not for one still deciding whether to sign in. The credited
          profile lands in state the same way a buy-in's does, so the navbar
          balance updates without a re-fetch. */}
      {activeRewardTrigger && entryComplete && (
        <RewardedAdModal
          trigger={activeRewardTrigger}
          onClose={closeRewardModal}
          onCredited={(credited, remainingToday) => {
            setProfile(credited);
            setFreeGoldRemainingToday(remainingToday);
          }}
          onDailyLimitReached={() => setFreeGoldRemainingToday(0)}
          onSaveProgress={() => {
            closeRewardModal();
            void signIn();
          }}
        />
      )}
    </div>
  );
}

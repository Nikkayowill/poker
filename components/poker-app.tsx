"use client";

import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSnapshot, PlayerAction } from "@/lib/game/types";
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
import { useStoredPreference } from "@/components/use-stored-preference";
import { playSound, setSoundEnabled } from "@/lib/audio/sound-effects";
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
import { tableSounds } from "@/lib/audio/table-sounds";
import { setMenuMusicEnabled, startMenuMusic, stopMenuMusic } from "@/lib/audio/menu-music";
import { Coins, Gift, Layers, LogOut, Music2, Settings2, Trophy, UserPlus } from "lucide-react";
import { Lobby } from "@/components/lobby/lobby";
import { retireFirstRunStrip } from "@/components/lobby/first-run-strip";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { ProfileModal } from "@/components/profile/profile-modal";
import { Menu, type MenuItem } from "@/components/nav/menu";
import { AuthButton } from "@/components/profile/auth-button";
import { GoldBadge } from "@/components/profile/gold-badge";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { RoomCreatedModal } from "@/components/table/room-created-modal";
import { RewardedAdModal } from "@/components/rewards/rewarded-ad-modal";
import { useGameAchievements } from "@/components/rewards/use-game-achievements";
import { PokerTable, type ConnectionState } from "@/components/table/poker-table";
import {
  LEGACY_SOUND_STORAGE_KEY,
  MUSIC_STORAGE_KEY,
  SOUND_STORAGE_KEY,
} from "@/lib/audio/sound-preference";

const MAX_REFRESH_RETRIES = 4;
const REFRESH_RETRY_BASE_MS = 250;
const REFRESH_RETRY_MAX_MS = 2_000;

export function PokerApp() {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  const [cashOutNotice, setCashOutNotice] = useState<number | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [entryComplete, setEntryComplete] = useState(false);
  const [authReady, setAuthReady] = useState(!accountsEnabled());
  const [rememberSession, setRememberSession] = useState(true);
  const [signInPending, setSignInPending] = useState(false);
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
  const [tableRenderer, setTableRendererState] = useStoredPreference<TableRenderer>({
    key: TABLE_RENDERER_STORAGE_KEY,
    fallback: DEFAULT_TABLE_RENDERER,
    parse: normalizeTableRenderer,
  });
  const [claimingGold, setClaimingGold] = useState(false);
  const [goldFlash, setGoldFlash] = useState(false);
  // Set only by hostPrivate, cleared on dismiss: the share sheet is a
  // one-shot moment right after creating a room, not table state.
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);
  const gameId = game?.id;
  const gameVersionRef = useRef(game?.version ?? 0);
  const previousGameRef = useRef<GameSnapshot | null>(null);
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

  const cycleTableRenderer = useCallback(() => {
    setTableRendererState(nextTableRenderer);
  }, [setTableRendererState]);

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
    // The only screen boundary that actually exists in this app: `game` is
    // null for the whole entry/lobby/hub experience and non-null for the
    // whole time you're seated at a table, hand or no hand in progress. That
    // is also exactly "menu" vs. "in-game" as far as menu music is concerned.
    setMenuMusicEnabled(musicEnabled);
    if (!musicEnabled) return;
    if (game) stopMenuMusic();
    else startMenuMusic();
  }, [game, musicEnabled]);

  useEffect(() => {
    // Every rule about what the table sounds like lives in tableSounds, where
    // it can be tested. This effect's only job is to hold the previous
    // snapshot and play what comes back.
    const previous = previousGameRef.current;
    previousGameRef.current = game;
    for (const effect of tableSounds(previous, game)) playSound(effect);
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
    // A profile came back, so this browser already holds a session cookie --
    // it has been through the entry gate before. `entryComplete` is plain
    // component state, so every arrival at `/` starts it false, and the
    // arcade lives on its own routes (`/games/*`): tapping "Back to the
    // lobby" remounts this component and used to drop a signed-in player
    // back on the sign-in card. The cookie is the durable record of having
    // entered, and it is already scoped to the remember-me choice (a guest
    // session cookie dies with the browser), so reading it here restores the
    // gate exactly as far as the player asked it to persist.
    if (data.profile) setEntryComplete(true);
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
    ingest(data);
    playSound("deal");
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
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", reconnect);
    if (!window.navigator.onLine) markOffline();
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", reconnect);
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
   * Awaiting there fixes this path too, but it puts setEntryComplete behind
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
      playSound("deal");
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
      playSound("deal");
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

  // The in-game rebuy purchase used to live here. It posted for a Checkout
  // Session and treated every non-OK response the same way -- including the
  // 412 the route returns when the Terms have not been accepted, which it
  // surfaced as a bare error string with no way to accept from the table.
  // That is why buying Gold from the lobby worked and buying it after
  // busting did not. It now lives in components/table/rebuy-checkout.tsx,
  // next to the acceptance step that answers that 412 in place.

  const act = async (action: PlayerAction) => {
    if (!game || loading) return;
    const actionSound: Partial<Record<PlayerAction["type"], Parameters<typeof playSound>[0]>> = {
      fold: "fold",
      check: "check",
      call: "call",
      raise: "raise",
      "all-in": "all-in",
      "use-time-card": "time-card",
      "next-hand": "ui",
      "leave-seat": "ui",
      rebuy: "ui",
    };
    const effect = actionSound[action.type];
    if (effect) playSound(effect);
    setLoading(true);
    setError(null);
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
  const linkAccount = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/link", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save your progress.");
      setProfile(data.profile);
      setSavePromptDismissed(false);
      setAuthNotice(
        data.restored
          ? "Welcome back — your Gold, profile, and collection are ready."
          : "Progress secured — this profile now travels with your account.",
      );
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
      const linkPromise = linkAccount();
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
  const signInWithEmail = async (email: string, password: string) => {
    const client = authClient();
    if (!client) return;
    setError(null);
    setSignInPending(true);
    try {
      await applySessionPreference();
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    } catch (caught) {
      setSignInPending(false);
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const client = authClient();
    if (!client) return;
    setError(null);
    setSignInPending(true);
    try {
      await applySessionPreference();
      const { data, error: signUpError } = await client.auth.signUp({ email, password });
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
      setEntryComplete(true);
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
    setEntryComplete(false);
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
      setEntryComplete(true);
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
   * When to offer a rewarded ad.
   *
   * Everything this component knows about the feature is these two lines and
   * the modal at the bottom. The rules live in lib/rewards/triggers.ts, the
   * money in lib/server/rewarded-ad-service.ts, and the pages that have no
   * snapshot to diff reach it through lib/rewards/events.ts -- so adding a new
   * trigger never touches this file.
   */
  const { offer: rewardOffer, dismiss: dismissRewardOffer } = useGameAchievements(game, profile);

  const lobbyMenuItems: MenuItem[] = [
    // First, and only for an account that can actually take it. A guest's
    // path to the reward is "Save progress" at the bottom of this same menu,
    // so offering them a dead row here would be the navbar's old "Save to
    // claim" button moved rather than removed.
    ...(dailyGold === "ready" || dailyGold === "claimed"
      ? [{
        kind: "action" as const,
        label: dailyGold === "ready"
          ? (claimingGold ? "Claiming…" : "Claim daily Gold")
          : "Daily Gold claimed",
        onSelect: () => void claimDailyGold(),
        disabled: dailyGold === "claimed" || claimingGold,
        icon: <Gift size={15} />,
      }, { kind: "separator" as const }]
      : []),
    { kind: "link", label: "Collection", href: "/collection", icon: <Layers size={15} /> },
    { kind: "link", label: "Buy Gold", href: gameId ? `/store?table=${gameId}` : "/store", icon: <Coins size={15} /> },
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
      : { kind: "action", label: "Save progress", onSelect: () => void signIn(), icon: <UserPlus size={15} /> },
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
      {!game && (
        <header className="lobby-header">
          {/* The simplified mark, not the full badge: at the ~50px this row
              allows, the badge's own banner type is illegible (checked on a
              real render), and the wordmark beside it already spells the
              name. The in-game header in poker-table.tsx keeps its old "S"
              diamond -- the table was out of scope for the chrome reskin. */}
          <div className="wordmark">
            <span className="wordmark-mark"><StackChipsMark size={44} /></span>
            <span>StackChips<small>HIGH ROLLER ARCADE</small></span>
          </div>
          {/* The hub tiles already carry Collection, Buy Gold and the
              leaderboard, so repeating them here was three chances to tap the
              same thing. Gold stays visible because it is the number a player
              checks before choosing stakes. */}
          <div className="header-actions">
            {entryComplete && profile && (
              <GoldBadge profile={profile} claimable={dailyGold === "ready"} justClaimed={goldFlash} />
            )}
            {entryComplete
              ? (
                <Menu
                  label="Open player menu"
                  trigger={profile
                    ? <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />
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
            game={game}
            pending={loading}
            error={error}
            onAction={act}
            onLeave={leaveTable}
            onLeaveSeat={leaveSeat}
            profile={profile}
            onCustomize={() => setProfileOpen(true)}
            connectionState={connectionState}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            betStyle={betStyle}
            onCycleBetStyle={cycleBetStyle}
            tableRenderer={tableRenderer}
            onCycleTableRenderer={cycleTableRenderer}
            onSignIn={() => void signIn()}
            onSignOut={() => void signOut()}
          />
        )
        : (
          <Lobby
            key={profile?.updatedAt ?? "guest"}
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
            onEmailSignIn={(email, password) => void signInWithEmail(email, password)}
            onEmailSignUp={(email, password) => void signUpWithEmail(email, password)}
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
      {rewardOffer && entryComplete && (
        <RewardedAdModal
          trigger={rewardOffer}
          onClose={dismissRewardOffer}
          onCredited={setProfile}
          onSaveProgress={() => {
            dismissRewardOffer();
            void signIn();
          }}
        />
      )}
    </div>
  );
}

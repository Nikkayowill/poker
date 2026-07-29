"use client";

import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSnapshot, PlayerAction } from "@/lib/game/types";
import type { StakesTier } from "@/lib/game/tiers";
import { accountsEnabled, authClient } from "@/lib/auth/client";
import { oauthCallbackUrl } from "@/lib/auth/oauth-redirect";
import {
  browserSupabase,
  readRememberAuthSession,
  setRememberAuthSession,
} from "@/lib/supabase/browser-client";
import { planTurnClock, type TurnClockInput } from "@/lib/game/turn-clock";
import type { PlayerProfile } from "@/lib/profile/types";
import { playSound, setSoundEnabled } from "@/lib/audio/sound-effects";
import { Lobby } from "@/components/lobby/lobby";
import { ProfileModal } from "@/components/profile/profile-modal";
import Link from "next/link";
import { AuthButton } from "@/components/profile/auth-button";
import { GoldBadge } from "@/components/profile/gold-badge";
import { ProfileTrigger } from "@/components/profile/profile-avatar";
import { PokerTable, type ConnectionState } from "@/components/table/poker-table";

const SOUND_STORAGE_KEY = "river-room:sound-enabled";

export function PokerApp() {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [persistence, setPersistence] = useState("memory");
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
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const gameId = game?.id;
  const gameVersionRef = useRef(game?.version ?? 0);
  const previousGameRef = useRef<GameSnapshot | null>(null);
  const linkedAccountIdRef = useRef<string | null>(null);
  const accountLinkPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
    const enabled = stored !== "false";
    setSoundEnabled(enabled);
    const timer = window.setTimeout(() => setSoundEnabledState(enabled), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setRememberSession(readRememberAuthSession()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((current) => {
      const next = !current;
      setSoundEnabled(next);
      window.localStorage.setItem(SOUND_STORAGE_KEY, String(next));
      if (next) playSound("ui");
      return next;
    });
  }, []);

  useEffect(() => {
    const current = game;
    const previous = previousGameRef.current;
    previousGameRef.current = current;
    if (!current || !previous || current.id !== previous.id || current.version <= previous.version) return;

    if (current.handNumber > previous.handNumber) {
      playSound("deal");
    } else {
      const revealedCommunity = current.community.length - previous.community.length;
      if (revealedCommunity === 3 && previous.community.length === 0) playSound("flop");
      else if (revealedCommunity > 0) playSound("card");

      const chipsMoved = current.seats.some((seat) => {
        const priorSeat = previous.seats.find((candidate) => candidate.id === seat.id);
        return priorSeat && seat.streetBet > priorSeat.streetBet;
      });
      if (chipsMoved) playSound("chips");
    }

    if (current.status === "complete" && previous.status !== "complete") {
      const mineWon = current.winners.some((winner) =>
        current.seats.some((seat) => seat.isMine && seat.id === winner.seatId),
      );
      playSound(mineWon ? "win" : "lose");
    }

    const latestLog = current.log[0];
    if (latestLog && latestLog.id !== previous.log[0]?.id && latestLog.text.includes("ran out of time")) {
      playSound("timeout");
    }
  }, [game]);
  useEffect(() => {
    gameVersionRef.current = game?.version ?? 0;
  }, [game?.version]);

  const loadProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load your profile.");
    setProfile(data.profile);
    setPersistence(data.persistence);
  }, []);

  const ingest = useCallback((data: { game: GameSnapshot; persistence: string; profile?: PlayerProfile }) => {
    setGame((current) => (
      current && current.id === data.game.id && current.version > data.game.version
        ? current
        : data.game
    ));
    setPersistence(data.persistence);
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
    let pendingVersion = gameVersionRef.current;

    const refreshLatest = () => {
      if (disposed || refreshRunning) return;
      refreshRunning = true;
      void (async () => {
        try {
          while (!disposed) {
            const requestedVersion = pendingVersion;
            const data = await refresh(gameId);
            if (data.game.version >= pendingVersion) break;
            if (pendingVersion <= requestedVersion) break;
          }
        } catch {
          setConnectionState(window.navigator.onLine ? "reconnecting" : "offline");
        } finally {
          refreshRunning = false;
        }
      })();
    };

    let channel: RealtimeChannel | null = supabase
      .channel(`table:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_signals", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const version = Number((payload.new as { version?: unknown }).version);
          if (
            !Number.isFinite(version)
            || version <= Math.max(pendingVersion, gameVersionRef.current)
          ) return;
          pendingVersion = version;
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
    currentIsHuman: Boolean(currentSeat?.isHuman),
    currentIsMine: Boolean(currentSeat?.isMine),
    myHumanRank: humanSeats.findIndex((seat) => seat.isMine),
  };
  const { isSeated, turnDeadlineAt, currentIsHuman, currentIsMine, myHumanRank } = clockInput;

  useEffect(() => {
    if (!gameId) return;
    const plan = planTurnClock(
      { isSeated, turnDeadlineAt, currentIsHuman, currentIsMine, myHumanRank },
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
  }, [advanceTable, gameId, isSeated, turnDeadlineAt, currentIsHuman, currentIsMine, myHumanRank]);

  // Memory-mode development has no Realtime channel, so a second local browser
  // would never hear about a change. It gets a slow *read-only* refresh --
  // never /advance, which is a write and was the thing generating load.
  useEffect(() => {
    if (!gameId || persistence !== "memory") return;
    const interval = window.setInterval(() => {
      if (!window.navigator.onLine) return;
      void refresh(gameId).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [gameId, persistence, refresh]);

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

  const purchaseRebuy = async () => {
    if (!game || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: game.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start rebuy checkout.");
      window.location.assign(data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start rebuy checkout.");
      setLoading(false);
    }
  };

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

  // Completes a sign-in: Supabase has redirected back with a session, so
  // hand its access token to the server, which verifies it and either links
  // this guest profile or restores the one the account already owns.
  const linkAccount = useCallback(async (accessToken: string) => {
    try {
      const response = await fetch("/api/auth/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
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
      const linkPromise = linkAccount(session.access_token);
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

  const signIn = async (): Promise<void> => {
    const client = authClient();
    if (!client) return;
    setError(null);
    setSignInPending(true);
    setRememberAuthSession(rememberSession);
    try {
      await applySessionPreference();
      const { error: signInError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          // PKCE verifiers are origin-scoped, so return to the exact origin
          // that started sign-in. A dedicated callback path also keeps the
          // OAuth `code` parameter separate from poker room invite codes.
          redirectTo: oauthCallbackUrl(),
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
      // The entry card is enabled only after loadProfile has completed. That
      // GET has already created the guest profile and set its HttpOnly
      // session cookie, so a second profile request is unnecessary.
      setEntryComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the lobby.");
    } finally {
      setSignInPending(false);
    }
  };

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
          <div className="wordmark">
            <span className="mark">R</span>
            <span>River Room<small>NO LIMIT HOLD’EM</small></span>
          </div>
          <div className="header-actions">
            <div className="header-status">No-limit Hold’em · 6-max</div>
            {entryComplete && profile && <GoldBadge profile={profile} onClaimed={setProfile} />}
            <AuthButton profile={profile} onSignIn={() => void signIn()} onSignOut={() => void signOut()} />
            {entryComplete && <Link className="auth-button" href="/leaderboard">Leaderboard</Link>}
            {entryComplete && <Link className="auth-button" href="/collection">Collection</Link>}
            {entryComplete && (
              <Link className="auth-button" href={gameId ? `/store?table=${gameId}` : "/store"}>Buy Gold</Link>
            )}
            {entryComplete && profile && (
              <ProfileTrigger profile={profile} onClick={() => setProfileOpen(true)} />
            )}
          </div>
        </header>
      )}
      {game
        ? (
          <PokerTable
            game={game}
            persistence={persistence}
            pending={loading}
            error={error}
            onAction={act}
            onLeave={leaveTable}
            onLeaveSeat={leaveSeat}
            profile={profile}
            onCustomize={() => setProfileOpen(true)}
            onProfileChange={setProfile}
            connectionState={connectionState}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            onPurchaseRebuy={purchaseRebuy}
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
      {profileOpen && profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={setProfile}
        />
      )}
    </div>
  );
}

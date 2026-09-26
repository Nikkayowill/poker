"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, HelpCircle } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { maxAnteUpWager, type AnteUpGame } from "@/lib/arcade/ante-up-stakes";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  LIGHTS_OUT_BANDS,
  MIN_ANTE_UP_WAGER,
  lightsOutBandFor,
  lightsOutLadder,
  toggleLightsOut,
  wagerMultiplierForMoves,
  type BrainLightsOutSnapshot,
} from "@/lib/arcade/brain-lights-out";
import { StakePressureNote } from "@/components/arcade/stake-pressure-note";
import type { PlayerProfile } from "@/lib/profile/types";
import { useActionQueue } from "@/components/shared/use-action-queue";
import { createRequestSequence } from "@/lib/ui/request-sequence";

/**
 * Lights Out, the solo wager. Same shape as ante-up-memory.tsx: no
 * server-driven clock (the forfeit condition is moves, not time), so no
 * polling loop -- a tap response is authoritative the instant it lands.
 *
 * Taps flip on screen straight away and queue behind any still in flight
 * (useActionQueue). The rules are public, so showing a tap early gives nothing
 * away, and the server still decides the board.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000, 25_000] as const;

function pressureLine(pressure: 1 | 2 | 3): string {
  const band = LIGHTS_OUT_BANDS[pressure];
  const ladder = lightsOutLadder(band);
  return `${band.size}x${band.size} board scrambled by ${band.taps} taps. 3x needs a clear in ${band.taps} moves, and the cap is ${ladder[ladder.length - 1].maxMoves}.`;
}

const PRESSURE_RULES = { 1: [pressureLine(1)], 2: [pressureLine(2)], 3: [pressureLine(3)] };

interface Response {
  attempt: BrainLightsOutSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

export function BrainLightsOut() {
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<BrainLightsOutSnapshot | null>(null);
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [sequence] = useState(() => createRequestSequence<BrainLightsOutSnapshot>());

  const applyResponse = useCallback((data: Partial<Response>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined && sequence.admit(data.attempt)) setAttempt(data.attempt ?? null);
  }, [sequence, setProfile]);

  const refresh = useCallback(async () => {
    const ticket = sequence.beginRead();
    if (!ticket) return;
    try {
      const response = await fetch("/api/brain-lights-out", { cache: "no-store" });
      const data = (await response.json()) as Partial<Response>;
      if (!mounted.current || !sequence.acceptRead(ticket)) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the player can just try an action.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse, sequence]);

  const send = useCallback(async (url: string, body: unknown) => {
    sending.current = true;
    const done = sequence.beginWrite();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<Response> & { round?: BrainLightsOutSnapshot };
      if (!mounted.current) return;
      if (!response.ok) {
        if (data.round) applyResponse({ attempt: data.round });
        setError(data.error ?? "That did not go through.");
        return;
      }
      applyResponse(data);
    } catch {
      if (mounted.current) setError("Could not reach the board. Check your connection.");
    } finally {
      sending.current = false;
      done();
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse, sequence]);

  /** Sends one queued move against the newest version. A refusal drops the rest of the queue. */
  const sendMove = useCallback(async (move: number): Promise<boolean> => {
    if (!mounted.current) return false;
    try {
      const response = await fetch("/api/brain-lights-out/actions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tap", version: sequence.version(), index: move }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<Response> & { round?: BrainLightsOutSnapshot };
      if (!mounted.current) return false;
      if (response.ok) {
        applyResponse(data);
        return data.attempt?.status === "active";
      }
      if (data.round) applyResponse({ attempt: data.round });
      // A board that finished under a queued tap already shows why.
      const ordinary = !!data.round && data.round.status !== "active";
      if (!ordinary) setError(data.error ?? "That tap did not go through.");
      return false;
    } catch {
      if (mounted.current) setError("Could not reach the board. Check your connection.");
      return false;
    }
  }, [applyResponse, sequence]);

  const { pending, push: enqueue } = useActionQueue<number>(sequence, sendMove);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const movesHeard = useRef(0);
  useEffect(() => {
    if (!attempt) {
      movesHeard.current = 0;
      return;
    }
    if (attempt.moves === movesHeard.current) return;
    movesHeard.current = attempt.moves;
    play("card");
  }, [attempt, play]);

  const start = () => {
    if (sending.current) return;
    void send("/api/brain-lights-out", { wager });
  };

  // What the board looks like once every queued tap lands.
  const shownLights = attempt ? pending.reduce<boolean[]>((lights, index) => toggleLightsOut(lights, index), attempt.lights) : [];
  const shownMoves = (attempt?.moves ?? 0) + pending.length;
  const shownCleared = attempt !== null && shownLights.every((on) => !on);

  const tap = (index: number) => {
    if (!attempt || !active || busy || shownCleared || shownMoves >= attempt.maxMoves) return;
    tapSound();
    enqueue(index);
  };

  const resign = () => {
    if (sending.current || pending.length > 0) return;
    void send("/api/brain-lights-out/actions", { action: "resign" });
  };
  const playAgain = () => setAttempt(null);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("lights-out" as AnteUpGame, null);
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const lobbyLadder = lightsOutLadder(lightsOutBandFor(wager));
  const maxMoves = attempt?.maxMoves ?? lobbyLadder[lobbyLadder.length - 1].maxMoves;
  const movesLeft = Math.max(0, maxMoves - shownMoves);
  const ranOutOfMoves = attempt !== null && attempt.status === "lost" && attempt.moves >= attempt.maxMoves;
  const projectedPayout = attempt && active ? Math.round(attempt.wager * wagerMultiplierForMoves(shownMoves, attempt.ladder)) : attempt?.payout ?? 0;

  return (
    <main className="duel-shell ante-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink
            confirmLeave={active && (attempt?.wager ?? 0) > 0}
            confirmMessage="Your wager is still in play on this board. Leaving won't give it up — come back to finish, or use Give Up to settle it now."
          />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>{profile ? (profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()) : "—"}</strong>
        </span>
      </header>

      {showHelp && (
        <HowToPlayModal title="Lights Out" onClose={() => setShowHelp(false)}>
          <p>
            Tapping a tile flips it and the tiles directly above, below, left and right of it. Turn
            every light off to clear the board. Every board dealt here can be solved.
          </p>
          <p>
            Wager Gold or play free, any time — there&apos;s no daily board to gate here, so a fresh
            layout deals on every attempt. Clear it within {maxMoves} moves to win and
            cash out; run past that cap, or give up early, and the wager is gone. Fewer moves pays more.
            Bigger wagers deal bigger boards.
          </p>
        </HowToPlayModal>
      )}

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {!attempt ? (
        <section className="puzzle-summary ante-lobby-card">
          <div className="ante-lobby-heading">
            <h1>Lights Out, against yourself</h1>
            <p>
              Wager on your own logic. Clear the board before your {maxMoves}th move and
              cash out — the fewer moves it takes, the more it pays.
            </p>
          </div>

          <StakePicker
            ariaLabel="Wager"
            picks={STAKE_QUICK_PICKS}
            value={wager}
            min={0}
            max={ceiling}
            leading={{ label: "Free", value: 0 }}
            onChange={(next) => { selectSound(); setWager(next); }}
          />
          <StakePressureNote wager={wager} rules={PRESSURE_RULES} />
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free practice — no payout on a win, but there's no fun in that."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : `Clear the board inside ${maxMoves} moves. Speed is what pays: a fast clear multiplies the wager, a slow one returns less than you staked, and running past the cap loses it outright.`}
          </p>

          <button
            type="button"
            className="puzzle-share-button"
            disabled={busy || !loaded || !canAfford}
            onClick={() => { selectSound(); start(); }}
          >
            <Coins size={15} aria-hidden="true" />
            {!loaded ? "…" : !canAfford ? "Not enough Gold" : busy ? "Dealing…" : "Ante up"}
          </button>
          {loaded && insufficientGold && <GoldShortfallHint needed={wager} compact />}
        </section>
      ) : (
        <div className="duel-match ante-match">
          <div className="duel-scoreline ante-scoreline">
            <span className="ante-clock" aria-live="polite">
              {active ? `${movesLeft} move${movesLeft === 1 ? "" : "s"} left · par ${attempt.par}` : `${attempt.moves} moves taken`}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {projectedPayout.toLocaleString()}</small>}
            </span>
          </div>

          <div className="lo-grid" style={{ "--lo-size": attempt.size } as React.CSSProperties}>
            {shownLights.map((on, index) => (
              <button
                key={index}
                type="button"
                className={clsx("lo-tile", on && "lo-tile-on")}
                disabled={!active}
                aria-label={on ? "Light on" : "Light off"}
                onClick={() => tap(index)}
              />
            ))}
          </div>

          {settled ? (
            <div className={clsx("duel-result", attempt.status === "won" && "duel-result-won")}>
              <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
              <strong>{attempt.status === "won" ? "Cleared it" : ranOutOfMoves ? "Ran out of moves" : "Gave up"}</strong>
              <span>{attempt.moves} {attempt.moves === 1 ? "move" : "moves"}</span>
              <span className="duel-result-gold">{result.label}</span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <div className="duel-controls">
              <button type="button" className="duel-resign" disabled={busy || pending.length > 0} onClick={() => void resign()}>
                Give up
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

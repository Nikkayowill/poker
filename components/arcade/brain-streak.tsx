"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
import { MIN_ANTE_UP_WAGER, type BrainStreakSnapshot } from "@/lib/arcade/brain-streak";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * The shared shell for every Brain Games "streak" round (Sequence Recall,
 * Quick Math Sprint, Pattern Predictor, Trivia Blitz). Same request shape and
 * wager step as ante-up-sudoku.tsx/ante-up-memory.tsx; the four games differ
 * only in how a round is drawn and answered, which is why `renderPrompt`/
 * `renderControls` are render props instead of four near-identical files.
 *
 * Polls the server only in sprint mode (a shared clock that can run out with
 * nobody clicking); survival mode has no clock, same as Memory Match, so it
 * has no poll loop either. See ante-up-sudoku.tsx's own poll for the idiom
 * this copies.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000, 25_000] as const;
const POLL_MS = 2000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface BrainStreakResponse {
  attempt: BrainStreakSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

/**
 * The live round, handed to each game's own prompt/controls components
 * through context rather than as function props. `renderX(...)` props that
 * get *called* during render (instead of rendered as JSX) run their body
 * eagerly as part of BrainStreak's own render pass, which the ref-safety
 * lint rule refuses whenever that body can reach a ref -- `submit`/`resign`
 * close over this component's `sending`/`mounted` refs. Context sidesteps
 * that: BrainStreak renders its caller's `promptSlot`/`controlsSlot` as
 * ordinary children, and each slot pulls today's round out of context on
 * its own, on its own render.
 */
interface BrainStreakRound {
  prompt: Record<string, unknown>;
  submit: (given: string) => void;
  busy: boolean;
  disabled: boolean;
}

const BrainStreakRoundContext = createContext<BrainStreakRound | null>(null);

/** Reads the live round a `promptSlot`/`controlsSlot` component was rendered inside. */
export function useBrainStreakRound(): BrainStreakRound {
  const round = useContext(BrainStreakRoundContext);
  if (!round) throw new Error("useBrainStreakRound must be used inside a BrainStreak's slots.");
  return round;
}

export interface BrainStreakProps {
  gameId: string;
  apiPath: string;
  title: string;
  lobbyBlurb: ReactNode;
  helpTitle: string;
  helpBody: ReactNode;
  /** Noun for the scoreline, e.g. "sequences" or "correct answers". */
  scoreNoun: string;
  /** Rendered where the round's prompt goes; reads the round via useBrainStreakRound(). */
  promptSlot: ReactNode;
  /** Rendered where the round's answer controls go; reads the round via useBrainStreakRound(). */
  controlsSlot: ReactNode;
}

export function BrainStreak({
  gameId,
  apiPath,
  title,
  lobbyBlurb,
  helpTitle,
  helpBody,
  scoreNoun,
  promptSlot,
  controlsSlot,
}: BrainStreakProps) {
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<BrainStreakSnapshot | null>(null);
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";
  const sprint = attempt?.expiresAt !== null && attempt?.expiresAt !== undefined;

  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<BrainStreakResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, [setProfile]);

  const refresh = useCallback(async (): Promise<number | null> => {
    if (sending.current) return null;
    try {
      const response = await fetch(apiPath, { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<BrainStreakResponse>;
      if (!mounted.current || sending.current) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the player can just try an action.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [apiPath, applyResponse]);

  const send = useCallback(async (url: string, body: unknown) => {
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as Partial<BrainStreakResponse> & { round?: BrainStreakSnapshot };
      if (!mounted.current) return;
      if (!response.ok) {
        if (data.round) setAttempt(data.round);
        // A miss (survival) or a clock that ran out mid-answer (sprint) is
        // ordinary play, not a fault -- the settled result screen already
        // says the run is over, so a banner on top of it would be a second,
        // redundant way of saying the same thing.
        const ordinary =
          data.round && (data.round.status === "active" || data.error === "That ended the run." || data.error === "Time's up.");
        if (!ordinary) setError(data.error ?? "That did not go through.");
        return;
      }
      applyResponse(data);
    } catch {
      if (mounted.current) setError("Could not reach the game. Check your connection.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Sprint mode's clock can run out with nobody clicking; survival mode has
  // no clock at all, so it gets no poll, same as Memory Match.
  useEffect(() => {
    if (!active || !sprint) return;
    let cancelled = false;
    let timer: number | null = null;
    const tick = () => {
      void refresh().then((pauseMs) => {
        if (cancelled) return;
        timer = window.setTimeout(tick, pauseMs ?? POLL_MS);
      });
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, sprint, refresh]);

  useEffect(() => {
    if (!active || !sprint) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active, sprint]);

  const scoreHeard = useRef(0);
  useEffect(() => {
    if (!attempt) {
      scoreHeard.current = 0;
      return;
    }
    if (attempt.score === scoreHeard.current) return;
    const grew = attempt.score > scoreHeard.current;
    scoreHeard.current = attempt.score;
    if (grew) play("card");
  }, [attempt, play]);

  const start = () => {
    if (sending.current) return;
    void send(apiPath, { wager });
  };

  const submit = (given: string) => {
    if (!attempt || sending.current || !active) return;
    void send(`${apiPath}/actions`, { action: "answer", version: attempt.version, given });
  };

  const resign = () => {
    if (sending.current) return;
    void send(`${apiPath}/actions`, { action: "resign" });
  };
  const playAgain = () => setAttempt(null);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager(gameId as AnteUpGame, null);
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  // Computed from `now` (ticked every 250ms below) rather than read straight
  // off the last snapshot: the snapshot's msRemaining is only as fresh as the
  // last answer or 2s poll, which would make the countdown visibly freeze
  // between them instead of counting down smoothly, the way ante-up-sudoku's
  // own clock does.
  const msRemainingLive = attempt?.expiresAt ? Math.max(0, Date.parse(attempt.expiresAt) - now) : null;
  const secondsLeft = msRemainingLive !== null ? Math.ceil(msRemainingLive / 1000) : null;

  return (
    <main className="duel-shell ante-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink
            confirmLeave={active && (attempt?.wager ?? 0) > 0}
            confirmMessage="Your wager is still in play. Leaving won't give it up — come back to finish, or use Cash out to settle it now."
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
        <HowToPlayModal title={helpTitle} onClose={() => setShowHelp(false)}>
          {helpBody}
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
            <h1>{title}</h1>
            <p>{lobbyBlurb}</p>
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
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free practice — no payout on a run, but there's no fun in that."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : `The longer your streak, the more it pays — a short run forfeits the wager.`}
          </p>

          <button
            type="button"
            className="puzzle-share-button"
            disabled={busy || !loaded || !canAfford}
            onClick={() => { selectSound(); start(); }}
          >
            <Coins size={15} aria-hidden="true" />
            {!loaded ? "…" : !canAfford ? "Not enough Gold" : busy ? "Starting…" : "Ante up"}
          </button>
          {loaded && insufficientGold && <GoldShortfallHint needed={wager} compact />}
        </section>
      ) : (
        <div className="duel-match ante-match">
          <div className="duel-scoreline ante-scoreline">
            <span className="ante-clock" aria-live="polite">
              {active
                ? secondsLeft !== null
                  ? `${secondsLeft}s left · ${attempt.score} ${scoreNoun}`
                  : `${attempt.score} ${scoreNoun}`
                : `${attempt.score} ${scoreNoun}`}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
            </span>
          </div>

          {settled ? (
            <div className={clsx("duel-result", result.profited && "duel-result-won")}>
              <WinCelebration active={result.profited} amount={result.net} />
              <strong>Run over</strong>
              <span>{attempt.score} {scoreNoun}</span>
              <span className="duel-result-gold">{result.label}</span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <BrainStreakRoundContext.Provider
              value={{ prompt: attempt.prompt, submit, busy, disabled: busy || !active }}
            >
              <div className="brain-prompt">{promptSlot}</div>
              <div className="brain-controls">{controlsSlot}</div>
              <div className="duel-controls">
                <button type="button" className="duel-resign" disabled={busy} onClick={() => void resign()}>
                  Cash out
                </button>
              </div>
            </BrainStreakRoundContext.Provider>
          )}
        </div>
      )}
    </main>
  );
}

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
  MIN_ANTE_UP_WAGER,
  WORD_GUESS_MAX_MISSES,
  wagerMultiplierForMisses,
  type BrainWordGuessSnapshot,
} from "@/lib/arcade/brain-word-guess";
import type { PlayerProfile } from "@/lib/profile/types";

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000, 25_000] as const;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

interface Response {
  attempt: BrainWordGuessSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

/**
 * Word Guess, the solo wager -- classic hangman on an everyday word. Same
 * shape as brain-lights-out.tsx: no server-driven clock, a guess response is
 * authoritative the instant it lands.
 */
export function BrainWordGuess() {
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<BrainWordGuessSnapshot | null>(null);
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

  const applyResponse = useCallback((data: Partial<Response>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, [setProfile]);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/brain-word-guess", { cache: "no-store" });
      const data = (await response.json()) as Partial<Response>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the player can just try an action.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

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
      const data = (await response.json()) as Partial<Response> & { round?: BrainWordGuessSnapshot };
      if (!mounted.current) return;
      if (!response.ok) {
        // A wrong or repeated letter that still carries a fresh round is
        // ordinary play, same treatment Sudoku gives a wrong digit.
        const ordinary = !!data.round && data.round.status === "active" && data.error !== "Already guessed that one.";
        if (data.round) setAttempt(data.round);
        if (!ordinary) setError(data.error ?? "That did not go through.");
        return;
      }
      applyResponse(data);
    } catch {
      if (mounted.current) setError("Could not reach the word. Check your connection.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const missesHeard = useRef(0);
  useEffect(() => {
    if (!attempt) {
      missesHeard.current = 0;
      return;
    }
    if (attempt.misses === missesHeard.current) return;
    missesHeard.current = attempt.misses;
    play("card");
  }, [attempt, play]);

  const start = () => {
    if (sending.current) return;
    void send("/api/brain-word-guess", { wager });
  };

  const guess = (letter: string) => {
    if (!attempt || sending.current || !active) return;
    if (attempt.guessed.includes(letter)) return;
    void send("/api/brain-word-guess/actions", { action: "guess", version: attempt.version, letter });
  };

  const resign = () => {
    if (sending.current) return;
    void send("/api/brain-word-guess/actions", { action: "resign" });
  };
  const playAgain = () => setAttempt(null);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("word-guess" as AnteUpGame, null);
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const missesLeft = attempt ? Math.max(0, attempt.maxMisses - attempt.misses) : WORD_GUESS_MAX_MISSES;
  const projectedPayout = attempt && active ? Math.round(attempt.wager * wagerMultiplierForMisses(attempt.misses)) : attempt?.payout ?? 0;

  return (
    <main className="duel-shell ante-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink
            confirmLeave={active && (attempt?.wager ?? 0) > 0}
            confirmMessage="Your wager is still in play on this word. Leaving won't give it up — come back to finish, or use Give Up to settle it now."
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
        <HowToPlayModal title="Word Guess" onClose={() => setShowHelp(false)}>
          <p>
            Classic hangman: guess letters to reveal an everyday word. {WORD_GUESS_MAX_MISSES} wrong
            guesses and it&apos;s over — nothing here needs any specialist background.
          </p>
          <p>
            Wager Gold or play free, any time. Solve it in fewer wrong guesses and the wager pays
            more; run out of guesses, or give up early, and it&apos;s gone.
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
            <h1>Word Guess, against yourself</h1>
            <p>
              Wager on your own vocabulary. Solve the word within {WORD_GUESS_MAX_MISSES} wrong
              guesses and cash out — fewer misses pays more.
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
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free practice — no payout on a win, but there's no fun in that."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : `Solve it inside ${WORD_GUESS_MAX_MISSES} wrong guesses. Fewer misses pays more, and running out loses the wager outright.`}
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
              {active ? `${missesLeft} miss${missesLeft === 1 ? "" : "es"} left` : `${attempt.misses} misses`}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {projectedPayout.toLocaleString()}</small>}
            </span>
          </div>

          <div className="wg-word" aria-live="polite">
            {attempt.revealed.map((char, i) => (
              <span key={i} className={clsx("wg-slot", char !== "_" && "wg-slot-filled")}>
                {char === "_" ? "" : char}
              </span>
            ))}
          </div>

          {!settled && (
            <div className="wg-keyboard">
              {ALPHABET.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className="wg-key"
                  disabled={busy || !active || attempt.guessed.includes(letter)}
                  onClick={() => { tapSound(); guess(letter); }}
                >
                  {letter}
                </button>
              ))}
            </div>
          )}

          {settled ? (
            <div className={clsx("duel-result", attempt.status === "won" && "duel-result-won")}>
              <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
              <strong>{attempt.status === "won" ? "You got it" : "Out of guesses"}</strong>
              <span>The word was {attempt.word}</span>
              <span className="duel-result-gold">{result.label}</span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <div className="duel-controls">
              <button type="button" className="duel-resign" disabled={busy} onClick={() => void resign()}>
                Give up
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

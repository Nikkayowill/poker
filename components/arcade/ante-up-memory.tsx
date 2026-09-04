"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, HelpCircle } from "lucide-react";
import { PlayingCard } from "@/components/table/playing-card";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { maxAnteUpWager } from "@/lib/arcade/ante-up-stakes";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  ANTE_UP_MEMORY_MAX_TURNS,
  MIN_ANTE_UP_WAGER,
  wagerMultiplierForTurns,
  type AnteUpMemorySnapshot,
} from "@/lib/arcade/ante-up-memory";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Ante Up: Memory Match, the solo half of Ante Up, on the daily's own board.
 *
 * Same request shape as the daily Memory board (a flip is a request, the
 * server turns the card, a face-down tile is genuinely absent from the
 * payload) and the same wager step ante-up-sudoku.tsx uses. There is no
 * server-driven clock here: the forfeit condition is turns, not time, and a
 * flip response is authoritative the instant it lands, so this needs no
 * polling loop the way Sudoku's countdown does. See 43-ante-up.css's header
 * for why this reuses the duel/ante classes rather than inventing new ones,
 * and 34-memory.css for the mm- grid this borrows from the daily board.
 */

/** Capped by the game's flat ceiling in StakePicker; see lib/arcade/ante-up-stakes.ts. */
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000, 25_000] as const;

interface AnteUpMemoryResponse {
  attempt: AnteUpMemorySnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

export function AnteUpMemory() {
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpMemorySnapshot | null>(null);
  // The persistent shell owns the profile now -- this screen still gets it
  // back from its own attempt-response payload too (unchanged), it just
  // writes into the shared setter instead of a local copy.
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  // Tells the shell an attempt is open -- hides the persistent nav chrome,
  // same as every other live-money screen. Not narrowed to `active`: the
  // settled result is still this screen, not the picker.
  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  // Same guard duel-shell.tsx (and ante-up-sudoku.tsx) keep: true while the
  // player's own action is in flight, so nothing else can paint over it.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<AnteUpMemoryResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, [setProfile]);

  /** The initial read: restores a live attempt after a refresh. */
  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/ante-up-memory", { cache: "no-store" });
      const data = (await response.json()) as Partial<AnteUpMemoryResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the player can just try an action.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  /** A player-initiated action: start, flip, resign. Sets busy; a 409 still applies its payload. */
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
      const data = (await response.json()) as Partial<AnteUpMemoryResponse> & { round?: AnteUpMemorySnapshot };
      if (!mounted.current) return;
      if (!response.ok) {
        if (data.round) setAttempt(data.round);
        setError(data.error ?? "That did not go through.");
        return;
      }
      applyResponse(data);
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse]);

  // Deferred a tick, the idiom every arcade table and the duel shell share: a
  // fetch fired straight from an effect body sets state during the same commit.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  /**
   * A matched pair is worth a sound; a miss is not. Reset the count whenever
   * a fresh attempt lands (a new board, or none at all) so "Play again"
   * doesn't carry the previous board's pair count into the new one.
   */
  const pairsHeard = useRef(0);
  useEffect(() => {
    if (!attempt) {
      pairsHeard.current = 0;
      return;
    }
    const pairs = attempt.matched.length / 2;
    if (pairs === pairsHeard.current) return;
    const grew = pairs > pairsHeard.current;
    pairsHeard.current = pairs;
    if (grew) play(pairs === attempt.pairs ? "win" : "card");
  }, [attempt, play]);

  const start = () => {
    void send("/api/ante-up-memory", { wager });
  };

  const flip = (index: number) => {
    if (!attempt || busy || !active) return;
    if (attempt.matched.includes(index) || attempt.revealed.includes(index)) return;
    void send("/api/ante-up-memory/actions", { action: "flip", version: attempt.version, index });
  };

  const resign = () => void send("/api/ante-up-memory/actions", { action: "resign" });
  const playAgain = () => setAttempt(null);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("memory-match", null);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  // Narrower than !canAfford; see ante-up-sudoku.tsx's own note on the same check.
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const turnsLeft = attempt ? Math.max(0, attempt.maxTurns - attempt.turns) : ANTE_UP_MEMORY_MAX_TURNS;
  // A forfeit can only come from the turn cap or a resignation; the turn
  // count is what tells them apart, since both settle as "lost".
  const ranOutOfTurns = attempt !== null && attempt.status === "lost" && attempt.turns > attempt.maxTurns;
  // attempt.payout is 0 for the entire game; it only becomes real once the
  // board is solved (anteUpMemoryPayout's own rule), so the scoreline shows
  // this instead while active: what a win pays at the current turn count,
  // the live version of the lobby's own "the fewer turns it takes, the more
  // it pays" promise. Once settled, attempt.payout is the true, final number.
  const projectedPayout = attempt && active
    ? Math.round(attempt.wager * wagerMultiplierForTurns(attempt.turns))
    : attempt?.payout ?? 0;

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
          <strong>
            {/* profile null means "we don't know yet" (still loading, or the
                fetch that would have set it failed) -- never "zero". */}
            {profile ? (profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()) : "—"}
          </strong>
        </span>
      </header>

      {showHelp && (
        <HowToPlayModal title="Memory Match" onClose={() => setShowHelp(false)}>
          <p>
            Flip tiles two at a time to find all eight matching pairs. Wager Gold or play free,
            any time — there&apos;s no daily board to gate here, so a fresh layout deals on every
            attempt.
          </p>
          <p>
            Clear all eight pairs within {ANTE_UP_MEMORY_MAX_TURNS} turns to win and cash out;
            run past that cap, or give up early, and the wager is gone. Speed is what pays: a
            fast clear multiplies the wager, a slow one can pay back less than you staked, so
            clearing the board isn&apos;t by itself a profit.
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
            <h1>Memory Match, against yourself</h1>
            <p>
              Wager on your own memory. Clear all eight pairs before your {ANTE_UP_MEMORY_MAX_TURNS}th turn
              and cash out -- the fewer turns it takes, the more it pays.
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
                : wager > ceiling
                  ? `Memory Match caps at ${ceiling.toLocaleString()} Gold a wager.`
                  : `Clear the board inside ${ANTE_UP_MEMORY_MAX_TURNS} turns. Speed is what pays: a fast clear multiplies the wager, a slow one returns less than you staked, and running past the cap loses it outright.`}
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
              {active ? `${turnsLeft} turn${turnsLeft === 1 ? "" : "s"} left` : `${attempt.turns} turns taken`}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {projectedPayout.toLocaleString()}</small>}
            </span>
          </div>

          <div className="mm-grid" style={{ "--mm-columns": attempt.columns } as React.CSSProperties}>
            {attempt.board.map((card, index) => {
              const matched = attempt.matched.includes(index);
              const up = matched || attempt.revealed.includes(index);
              return (
                <button
                  key={index}
                  type="button"
                  className={clsx("mm-tile", up && "mm-tile-up", matched && "mm-tile-matched")}
                  disabled={busy || up || !active}
                  aria-label={up && card ? `${card.rank} of ${card.suit}` : "Face-down card"}
                  onClick={() => { tapSound(); flip(index); }}
                >
                  {/* Face-down draws the player's own equipped back. `card` really
                      is null until the server turns it over, same contract the
                      daily Memory board's tiles carry. */}
                  <PlayingCard card={card} back={profile?.equipped.cardBack} />
                </button>
              );
            })}
          </div>

          {settled ? (
            <div
              className={clsx(
                "duel-result",
                attempt.status === "won" && "duel-result-won",
              )}
            >
              <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
              <strong>
                {attempt.status === "won" ? "You cleared it" : ranOutOfTurns ? "Ran out of turns" : "Gave up"}
              </strong>
              <span>{attempt.turns} {attempt.turns === 1 ? "turn" : "turns"}</span>
              <span className="duel-result-gold">
                {result.label}
              </span>
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

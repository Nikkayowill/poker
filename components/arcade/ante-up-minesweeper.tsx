"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Bomb, Coins, Flag, HelpCircle } from "lucide-react";
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
  ANTE_UP_MINESWEEPER_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpMinesweeperSnapshot,
} from "@/lib/arcade/ante-up-minesweeper";
import {
  CELL_EXPLODED,
  CELL_HIDDEN,
  CELL_MINE,
  CELL_WRONG_FLAG,
  MINESWEEPER_DIFFICULTIES,
  type MinesweeperDifficulty,
} from "@/lib/arcade/puzzles/minesweeper";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Ante Up: Minesweeper, the solo half of Ante Up.
 *
 * Same request shape as Ante Up: Sudoku (every move is a request, the server
 * says what happened, the mine layout never crosses the wire) and the same
 * wager step lib/pvp's duel lobby uses. Reuses `.duel-*` and `.ante-*` classes
 * rather than a third copy of either; see 46-minesweeper.css's header.
 *
 * A phone has no right mouse button, so flagging needs two ways in: a
 * long-press on a square, and a sticky Flag-mode toggle for players who would
 * rather not hold. Desktop gets right-click as well. Tapping a number that's
 * already open chords it, opening everything around it once its flags match,
 * which is the move that makes a big board playable at all.
 */

/** StakePicker drops the picks above the chosen board's ceiling; see lib/arcade/ante-up-stakes.ts. */
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 25_000, 100_000, 500_000] as const;

/** How long a press has to hold before it counts as a flag rather than a tap. */
const LONG_PRESS_MS = 350;

/** How often the shell re-reads a live attempt: catches the clock running out with nothing clicked. */
const POLL_MS = 3000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface AnteUpMinesweeperResponse {
  attempt: AnteUpMinesweeperSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

function difficultyLabel(id: MinesweeperDifficulty): string {
  return id[0].toUpperCase() + id.slice(1);
}

export function AnteUpMinesweeper() {
  const [difficulty, setDifficulty] = useState<MinesweeperDifficulty>("beginner");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpMinesweeperSnapshot | null>(null);
  // The persistent shell owns the profile now -- this screen still gets it
  // back from its own attempt-response payload too (unchanged), it just
  // writes into the shared setter instead of a local copy.
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagMode, setFlagMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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

  // Same guard duel-shell.tsx keeps: true while the player's own action is in
  // flight, so a background poll cannot paint the pre-action board back over
  // what the action's own response is about to paint forward.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Long-press bookkeeping. `handled` marks a press already resolved as a flag,
  // so the click that follows it does not also open the square.
  const pressTimer = useRef<number | null>(null);
  const handled = useRef(false);

  const applyResponse = useCallback((data: Partial<AnteUpMinesweeperResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, [setProfile]);

  /**
   * The background poll: reads the live attempt, sets no busy flag.
   *
   * Returns the pause (in ms) the poll loop should wait before its next tick
   * when the server answered 429, or null for the ordinary POLL_MS cadence.
   */
  const refresh = useCallback(async (): Promise<number | null> => {
    if (sending.current) return null;
    try {
      const response = await fetch("/api/ante-up-minesweeper", { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<AnteUpMinesweeperResponse>;
      if (!mounted.current || sending.current) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [applyResponse]);

  /** A player-initiated action: start, move, resign. A 409 still applies its payload. */
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
      const data = (await response.json()) as Partial<AnteUpMinesweeperResponse> & {
        round?: AnteUpMinesweeperSnapshot;
      };
      if (!mounted.current) return;
      if (!response.ok) {
        // A refused move still carries the true board; paint it, and only
        // raise a banner when the refusal is something the player should see
        // (a real error rather than "that square is already open").
        if (data.round) setAttempt(data.round);
        else setError(data.error ?? "That did not go through.");
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

  // Initial read, deferred a tick: the idiom every arcade table shares.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Poll a live attempt so a clock running out with nobody clicking still
  // settles. A self-rescheduling timeout rather than setInterval: the next
  // tick is only scheduled once the current refresh() has settled, so a slow
  // response can never leave two polls in flight at once. A 429 reply makes
  // refresh() return the server's own Retry-After (in ms) instead of null,
  // which is used as that one tick's delay in place of POLL_MS -- the loop
  // then resumes its normal cadence on the following tick.
  useEffect(() => {
    if (!active) return;
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
  }, [active, refresh]);

  // The running clock, once a second, only while an attempt is live.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
  }, []);

  const start = () => {
    setFlagMode(false);
    void send("/api/ante-up-minesweeper", { difficulty, wager });
  };

  const move = (action: "reveal" | "flag" | "chord", index: number) => {
    if (!attempt || !active || busy) return;
    void send("/api/ante-up-minesweeper/actions", { action, version: attempt.version, index });
  };

  const flag = (index: number) => {
    if (!attempt || !active || busy) return;
    tapSound();
    move("flag", index);
  };

  /** A plain tap: chord an open number, flag if Flag mode is on, otherwise open. */
  const tap = (index: number) => {
    if (!attempt || !active || busy) return;
    const cell = attempt.board.cells[index];
    if (cell >= 0) {
      // Already open. Only a number can be chorded; a blank has nothing around it.
      if (cell > 0) { tapSound(); move("chord", index); }
      return;
    }
    if (flagMode) { flag(index); return; }
    if (attempt.board.flags.includes(index)) return; // flagged squares are protected
    play("ui");
    move("reveal", index);
  };

  const beginPress = (index: number) => {
    handled.current = false;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      handled.current = true;
      flag(index);
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const resign = () => void send("/api/ante-up-minesweeper/actions", { action: "resign" });
  const playAgain = () => { setAttempt(null); setFlagMode(false); };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("minesweeper", difficulty);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  // Narrower than !canAfford; see ante-up-sudoku.tsx's own note on the same check.
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const tier = ANTE_UP_MINESWEEPER_TIERS[difficulty];

  // Counted down from the absolute deadline against a `now` that ticks once a
  // second. Before the first click there is no deadline yet, so the full
  // allowance is shown rather than a countdown that has not started.
  // Capped at the tier's own limit as well as floored at zero: the deadline is
  // the server's and `now` is the browser's, so a slow response would otherwise
  // put a second or two of network latency on the clock and show 5:01 of a
  // five-minute board.
  const deadline = attempt?.expiresAt ? Date.parse(attempt.expiresAt) : null;
  const displayedMs =
    deadline !== null && attempt
      ? Math.min(attempt.timeLimitMs, Math.max(0, deadline - now))
      : attempt?.timeLimitMs ?? 0;

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
        <HowToPlayModal title="Minesweeper" onClose={() => setShowHelp(false)}>
          <p>
            Clear every safe square without hitting a mine. Every board here is guaranteed
            solvable by logic alone — the opening click is always safe, and a careful read of
            the numbers never has to come down to a coin-flip guess.
          </p>
          <p>
            Pick beginner, intermediate, or expert, then wager Gold or play free. The clock
            starts on your first click; clear the board before it runs out and you win. Hit a
            mine, let the clock expire, or resign, and the wager is gone. Harder difficulties
            run a longer clock, pay more on a win, and let you stake more.
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
            <h1>Minesweeper, against the clock</h1>
            <p>
              Every board can be cleared by logic alone — no board here ever comes down to a guess.
              Wager on your own reading of it and cash out up to {ANTE_UP_MINESWEEPER_TIERS.expert.multiplier}x.
            </p>
          </div>

          <div className="ante-difficulties" role="group" aria-label="Difficulty">
            {MINESWEEPER_DIFFICULTIES.map((entry) => {
              const entryTier = ANTE_UP_MINESWEEPER_TIERS[entry.id];
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={clsx(
                    "ante-difficulty",
                    entry.id === difficulty && "ante-difficulty-active",
                  )}
                  aria-pressed={entry.id === difficulty}
                  onClick={() => {
                    selectSound();
                    setDifficulty(entry.id);
                    // An easier board lowers the ceiling under a wager that
                    // was legal a moment ago; bring it down with it.
                    setWager((current) => Math.min(current, maxAnteUpWager("minesweeper", entry.id)));
                  }}
                >
                  <strong>{entry.label}</strong>
                  <span>{entry.cols}×{entry.rows} · {entry.mines} mines</span>
                  <span>{Math.round(entryTier.timeLimitMs / 60_000)} min · {entryTier.multiplier}x</span>
                </button>
              );
            })}
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
              ? "Free practice — no payout on a clear, but nothing at risk either."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : wager > ceiling
                  ? `${difficulty[0].toUpperCase() + difficulty.slice(1)} caps at ${ceiling.toLocaleString()} Gold a wager. Step up a difficulty to stake more.`
                  : `Clear ${difficulty} inside ${Math.round(tier.timeLimitMs / 60_000)} minutes and cash out ${Math.round(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Hit a mine, or run out of time, and the wager is gone.`}
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
        <div className="duel-match ante-match ms-match">
          <div className="duel-scoreline ante-scoreline ms-scoreline">
            <span className="ms-mines" aria-label={`${attempt.board.minesLeft} mines left`}>
              <Bomb size={13} aria-hidden="true" />
              <strong>{attempt.board.minesLeft}</strong>
            </span>
            <span className="ante-clock" aria-live="polite">
              {active ? formatDuration(displayedMs) : formatDuration(attempt.elapsedMs)}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {attempt.payout.toLocaleString()}</small>}
            </span>
          </div>

          <div
            className="ms-grid"
            role="grid"
            aria-label="Minesweeper board"
            style={
              {
                "--ms-cols": attempt.board.cols,
                "--ms-rows": attempt.board.rows,
              } as React.CSSProperties
            }
          >
            {attempt.board.cells.map((cell, index) => {
              const row = Math.floor(index / attempt.board.cols) + 1;
              const column = (index % attempt.board.cols) + 1;
              const flagged = attempt.board.flags.includes(index);
              const open = cell >= 0 && cell <= 8;

              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={clsx(
                    "ms-cell",
                    open ? "ms-cell-open" : "ms-cell-hidden",
                    open && cell > 0 && `ms-cell-${cell}`,
                    cell === CELL_EXPLODED && "ms-cell-exploded",
                    cell === CELL_MINE && "ms-cell-mine",
                    cell === CELL_WRONG_FLAG && "ms-cell-wrong-flag",
                    flagged && cell === CELL_HIDDEN && "ms-cell-flagged",
                  )}
                  disabled={!active}
                  aria-label={
                    `Row ${row}, column ${column}, ` +
                    (open ? (cell === 0 ? "empty" : `${cell}`) : flagged ? "flagged" : "unopened")
                  }
                  onContextMenu={(event) => { event.preventDefault(); flag(index); }}
                  onPointerDown={() => beginPress(index)}
                  onPointerUp={endPress}
                  onPointerLeave={endPress}
                  onPointerCancel={endPress}
                  onClick={() => { if (!handled.current) tap(index); }}
                >
                  {cell === CELL_EXPLODED || cell === CELL_MINE ? (
                    <Bomb size={13} aria-hidden="true" />
                  ) : cell === CELL_WRONG_FLAG ? (
                    <Flag size={12} aria-hidden="true" />
                  ) : flagged && !open ? (
                    <Flag size={12} aria-hidden="true" />
                  ) : open && cell > 0 ? (
                    cell
                  ) : (
                    ""
                  )}
                </button>
              );
            })}
          </div>

          {settled ? (
            <div className={clsx("duel-result", attempt.status === "won" && "duel-result-won")}>
              <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
              <strong>
                {attempt.status === "won"
                  ? "Board cleared"
                  : attempt.status === "timed-out"
                    ? "Time's up"
                    : attempt.board.explodedAt !== null
                      // A mine and a resignation both settle as "lost", so the
                      // board is what tells them apart; see the view's own note.
                      ? "Boom"
                      : "Gave up"}
              </strong>
              <span>{formatDuration(attempt.elapsedMs)} · {difficultyLabel(attempt.difficulty)}</span>
              <span className="duel-result-gold">
                {result.label}
              </span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <>
              <div className="ms-toolbar">
                <button
                  type="button"
                  className={clsx("ms-flag-toggle", flagMode && "ms-flag-toggle-active")}
                  aria-pressed={flagMode}
                  onClick={() => { selectSound(); setFlagMode((mode) => !mode); }}
                >
                  <Flag size={13} aria-hidden="true" />
                  Flag {flagMode ? "on" : "off"}
                </button>
                <p className="ms-hint">
                  {flagMode
                    ? "Tap a square to flag it."
                    : "Hold a square to flag it. Tap a number to open around it."}
                </p>
              </div>
              <div className="duel-controls">
                <button type="button" className="duel-resign" disabled={busy} onClick={() => void resign()}>
                  Give up
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}

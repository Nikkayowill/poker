"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Bomb, Coins, Flag } from "lucide-react";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { StakePicker } from "@/components/pvp/stake-picker";
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
 * Ante Up: Minesweeper -- the solo half of Ante Up.
 *
 * Same request shape as Ante Up: Sudoku (every move is a request, the server
 * says what happened, the mine layout never crosses the wire) and the same
 * wager step lib/pvp's duel lobby uses. Reuses `.duel-*` and `.ante-*` classes
 * rather than a third copy of either -- see 46-minesweeper.css's header.
 *
 * ## Input, which is most of what makes this game feel right
 *
 * A phone has no right mouse button, so flagging needs two ways in: a
 * long-press on a square, and a sticky Flag-mode toggle for players who would
 * rather not hold. Desktop gets right-click as well. Tapping a number that is
 * already open chords it -- opens everything around it, once its flags match --
 * which is the move that makes a big board playable at all.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000] as const;

/** How long a press has to hold before it counts as a flag rather than a tap. */
const LONG_PRESS_MS = 350;

/** How often the shell re-reads a live attempt -- catches the clock running out with nothing clicked. */
const POLL_MS = 3000;

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
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagMode, setFlagMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

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
  }, []);

  /** The background poll: reads the live attempt, sets no busy flag. */
  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/ante-up-minesweeper", { cache: "no-store" });
      const data = (await response.json()) as Partial<AnteUpMinesweeperResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner -- the next one is seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
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
        // A refused move still carries the true board -- paint it, and only
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

  // Initial read, deferred a tick -- the idiom every arcade table shares.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Poll a live attempt so a clock running out with nobody clicking still settles.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
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
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && balance >= wager);
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
        <Link className="floor-back" href="/games" onClick={tapSound}>← Ante Up</Link>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded ? "—" : profile?.unlimitedGold ? "Unlimited" : (profile?.goldBalance ?? 0).toLocaleString()}
          </strong>
        </span>
      </header>

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {!attempt ? (
        <div className="duel-lobby">
          <div className="floor-head">
            <div className="lobby-kicker">Ante Up</div>
            <h1>Minesweeper, against the clock</h1>
            <p>
              Every board can be cleared by logic alone — no board here ever comes down to a guess.
              Wager on your own reading of it and cash out up to {ANTE_UP_MINESWEEPER_TIERS.expert.multiplier}x.
            </p>
          </div>

          <section className="duel-panel">
            <h2 className="floor-section-head">Difficulty</h2>
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
                    onClick={() => { selectSound(); setDifficulty(entry.id); }}
                  >
                    <strong>{entry.label}</strong>
                    <span>{entry.cols}×{entry.rows} · {entry.mines} mines</span>
                    <span>{Math.round(entryTier.timeLimitMs / 60_000)} min · {entryTier.multiplier}x</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="duel-panel">
            <h2 className="floor-section-head">Your wager</h2>
            <StakePicker
              ariaLabel="Wager"
              picks={STAKE_QUICK_PICKS}
              value={wager}
              min={0}
              leading={{ label: "Free", value: 0 }}
              onChange={(next) => { selectSound(); setWager(next); }}
            />
            <p className="duel-pot-note">
              {wager === 0
                ? "Free practice — no payout on a clear, but nothing at risk either."
                : wager < MIN_ANTE_UP_WAGER
                  ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                  : `Clear ${difficulty} inside ${Math.round(tier.timeLimitMs / 60_000)} minutes and cash out ${(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Hit a mine, or run out of time, and the wager is gone.`}
            </p>

            <button
              type="button"
              className="floor-play duel-open"
              disabled={busy || !loaded || !canAfford}
              onClick={() => { selectSound(); start(); }}
            >
              {!loaded ? "…" : !canAfford ? "Not enough Gold" : busy ? "Dealing…" : "Ante up"}
            </button>
          </section>
        </div>
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
              <strong>
                {attempt.status === "won"
                  ? "Board cleared"
                  : attempt.status === "timed-out"
                    ? "Time's up"
                    : attempt.board.explodedAt !== null
                      // A mine and a resignation both settle as "lost", so the
                      // board is what tells them apart -- see the view's own note.
                      ? "Boom"
                      : "Gave up"}
              </strong>
              <span>{formatDuration(attempt.elapsedMs)} · {difficultyLabel(attempt.difficulty)}</span>
              <span className="duel-result-gold">
                {attempt.status === "won"
                  ? attempt.wager > 0
                    ? `+${attempt.payout.toLocaleString()} Gold`
                    : "Practice round — no Gold at stake"
                  : attempt.wager > 0
                    ? `−${attempt.wager.toLocaleString()} Gold`
                    : "Practice round — nothing lost"}
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

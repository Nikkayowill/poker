"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, Eraser, HelpCircle, Pencil, X } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { maxAnteUpWager } from "@/lib/arcade/ante-up-stakes";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  ANTE_UP_NONOGRAM_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpNonogramSnapshot,
} from "@/lib/arcade/ante-up-nonogram";
import {
  MARK_CROSSED,
  MARK_FILLED,
  MARK_UNKNOWN,
  NONOGRAM_DIFFICULTIES,
  SOLUTION_FILLED,
  type NonogramClues,
  type NonogramDifficulty,
  type NonogramMark,
} from "@/lib/arcade/puzzles/nonogram";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Ante Up: Nonogram, the solo half of Ante Up.
 *
 * Same request shape as Ante Up: Minesweeper (every mark is a request, the
 * server says what happened, the answer never crosses the wire while the
 * round is live) and the same wager step lib/pvp's duel lobby uses. Reuses
 * `.duel-*` and `.ante-*` classes rather than a third copy of either; see
 * 50-nonogram.css's header.
 *
 * The board is a CSS grid with a clue gutter down the left and across the top,
 * inside a frame that scrolls in both axes. That frame is the whole reason a
 * 25x25 rung can exist at all: 625 squares will not fit a phone at a size a
 * thumb can hit, and shrinking them until they do would be a board nobody can
 * play rather than a hard one.
 *
 * A clue that the player's own marks have already satisfied is dimmed. That is
 * derived from the marks alone, never from the answer, so it leaks nothing --
 * it is the same pencil-stroke a person puts through a finished clue on paper.
 */

/** StakePicker drops the picks above the chosen board's ceiling; see lib/arcade/ante-up-stakes.ts. */
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 25_000, 100_000, 500_000] as const;

/** How long a press has to hold before it counts as a cross rather than a tap. */
const LONG_PRESS_MS = 350;

/** How often the shell re-reads a live attempt: catches the clock running out with nothing marked. */
const POLL_MS = 3000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Square size per board width, in px.
 *
 * Bigger boards get smaller squares, but only down to a floor a thumb can
 * still hit; past that the frame scrolls instead. Every rung is a multiple of
 * five wide, which is what lets the heavier every-fifth gridline (the
 * convention every paper nonogram uses to make counting possible) fall on a
 * real boundary rather than an arbitrary one.
 */
const CELL_PX: Readonly<Record<number, number>> = { 5: 46, 10: 34, 15: 28, 20: 24, 25: 22 };

interface AnteUpNonogramResponse {
  attempt: AnteUpNonogramSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

function difficultyLabel(id: NonogramDifficulty): string {
  return id[0].toUpperCase() + id.slice(1);
}

/**
 * The runs the player's own marks currently spell out in one line.
 *
 * Only `#` counts as filled; both `x` and an untouched square break a run.
 * Treating an untouched square as a break is what makes a half-finished line
 * read as unsatisfied rather than accidentally matching its clue.
 */
function markedRuns(marks: readonly string[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const mark of marks) {
    if (mark === MARK_FILLED) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

function sameRuns(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((run, index) => run === b[index]);
}

/** Which row and column clues the player's marks already satisfy. */
function satisfiedLines(marks: string, size: number, clues: NonogramClues) {
  const cells = [...marks];
  const rows: boolean[] = [];
  const cols: boolean[] = [];

  for (let row = 0; row < size; row += 1) {
    rows.push(sameRuns(markedRuns(cells.slice(row * size, row * size + size)), clues.rows[row]));
  }
  for (let col = 0; col < size; col += 1) {
    const line: string[] = [];
    for (let row = 0; row < size; row += 1) line.push(cells[row * size + col]);
    cols.push(sameRuns(markedRuns(line), clues.cols[col]));
  }
  return { rows, cols };
}

export function AnteUpNonogram() {
  const [difficulty, setDifficulty] = useState<NonogramDifficulty>("easy");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpNonogramSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crossMode, setCrossMode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  // Same guard duel-shell.tsx keeps: true while the player's own action is in
  // flight, so a background poll cannot paint the pre-action board back over
  // what the action's own response is about to paint forward.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Long-press bookkeeping. `handled` marks a press already resolved as a
  // cross, so the click that follows it does not also fill the square.
  const pressTimer = useRef<number | null>(null);
  const handled = useRef(false);

  const applyResponse = useCallback((data: Partial<AnteUpNonogramResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, []);

  /**
   * The background poll: reads the live attempt, sets no busy flag.
   *
   * Returns the pause (in ms) the poll loop should wait before its next tick
   * when the server answered 429, or null for the ordinary POLL_MS cadence.
   */
  const refresh = useCallback(async (): Promise<number | null> => {
    if (sending.current) return null;
    try {
      const response = await fetch("/api/ante-up-nonogram", { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<AnteUpNonogramResponse>;
      if (!mounted.current || sending.current) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [applyResponse]);

  /** A player-initiated action: start, mark, resign. A 409 still applies its payload. */
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
      const data = (await response.json()) as Partial<AnteUpNonogramResponse> & {
        round?: AnteUpNonogramSnapshot;
      };
      if (!mounted.current) return;
      if (!response.ok) {
        // A refused mark still carries the true board; paint it, and only
        // raise a banner when the refusal is something the player should see
        // (a real error rather than "that square is already settled").
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

  // Poll a live attempt so a clock running out with nobody marking still
  // settles. A self-rescheduling timeout rather than setInterval: the next
  // tick is only scheduled once the current refresh() has settled, so a slow
  // response can never leave two polls in flight at once. A 429 reply makes
  // refresh() return the server's own Retry-After (in ms) instead of null,
  // which is used as that one tick's delay in place of POLL_MS.
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
    setCrossMode(false);
    void send("/api/ante-up-nonogram", { difficulty, wager });
  };

  const mark = (index: number, next: NonogramMark) => {
    if (!attempt || !active || busy) return;
    void send("/api/ante-up-nonogram/actions", {
      action: "mark",
      version: attempt.version,
      index,
      mark: next,
    });
  };

  const cross = (index: number) => {
    if (!attempt || !active || busy) return;
    if (attempt.board.marks[index] === MARK_FILLED) return;
    tapSound();
    mark(index, attempt.board.marks[index] === MARK_CROSSED ? "clear" : "cross");
  };

  /** A plain tap: whatever the current tool puts down, or a clear if it is already there. */
  const tap = (index: number) => {
    if (!attempt || !active || busy) return;
    const current = attempt.board.marks[index];
    if (current === MARK_FILLED) return; // proven filled; nothing left to decide
    if (current === MARK_CROSSED) { cross(index); return; } // takes the cross back
    if (crossMode) { cross(index); return; }
    play("ui");
    mark(index, "fill");
  };

  const beginPress = (index: number) => {
    handled.current = false;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      handled.current = true;
      cross(index);
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const resign = () => void send("/api/ante-up-nonogram/actions", { action: "resign" });
  const playAgain = () => { setAttempt(null); setCrossMode(false); };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("nonogram", difficulty);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  // Narrower than !canAfford; see ante-up-sudoku.tsx's own note on the same check.
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const tier = ANTE_UP_NONOGRAM_TIERS[difficulty];

  // Counted down from the absolute deadline against a `now` that ticks once a
  // second. Before the first square there is no deadline yet, so the full
  // allowance is shown rather than a countdown that has not started. Capped at
  // the tier's own limit as well as floored at zero: the deadline is the
  // server's and `now` is the browser's, so a slow response would otherwise
  // put a second or two of network latency on the clock.
  const deadline = attempt?.expiresAt ? Date.parse(attempt.expiresAt) : null;
  const displayedMs =
    deadline !== null && attempt
      ? Math.min(attempt.timeLimitMs, Math.max(0, deadline - now))
      : attempt?.timeLimitMs ?? 0;

  const board = attempt?.board ?? null;
  const done = useMemo(
    () => (board ? satisfiedLines(board.marks, board.size, board.clues) : null),
    [board],
  );

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
            {!loaded ? "—" : profile?.unlimitedGold ? "Unlimited" : (profile?.goldBalance ?? 0).toLocaleString()}
          </strong>
        </span>
      </header>

      {showHelp && (
        <HowToPlayModal title="Nonogram" onClose={() => setShowHelp(false)}>
          <p>
            The numbers down the side and across the top are the answer. Each one is the
            length of a run of filled squares in that line, in order, with at least one gap
            between runs. A row reading &ldquo;3 1&rdquo; has three filled squares, then a gap,
            then one more, somewhere along its length. Work out where they have to sit and
            fill them in.
          </p>
          <p>
            Tap a square to fill it. Hold one, or switch to Cross mode, to mark a square you
            have worked out is empty. Crosses are your own notation and are never scored, so
            mark as many as you like and take them back whenever. A clue dims once your marks
            satisfy it.
          </p>
          <p>
            Only a wrong <em>fill</em> costs you. Every board here can be finished by logic
            alone, so nothing ever comes down to a guess, and the mistake budget is small
            because of it: spend it and the board is lost. The clock starts on your first
            square. Fill every square in the picture before it runs out and you win; run out
            of time, spend the budget, or resign, and the wager is gone.
          </p>
          <p>
            Bigger boards run a longer clock, allow more mistakes, pay more on a win, and let
            you stake more.
          </p>
        </HowToPlayModal>
      )}

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {!attempt || !board || !done ? (
        <section className="puzzle-summary ante-lobby-card">
          <div className="ante-lobby-heading">
            <h1>Nonogram, against the clock</h1>
            <p>
              Read the numbers, draw the picture. Every board can be finished by logic alone,
              so nothing here comes down to a guess. Cash out up to {ANTE_UP_NONOGRAM_TIERS.master.multiplier}x.
            </p>
          </div>

          <div className="ante-difficulties ng-difficulties" role="group" aria-label="Board size">
            {NONOGRAM_DIFFICULTIES.map((entry) => {
              const entryTier = ANTE_UP_NONOGRAM_TIERS[entry.id];
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
                    // A smaller board lowers the ceiling under a wager that
                    // was legal a moment ago; bring it down with it.
                    setWager((current) => Math.min(current, maxAnteUpWager("nonogram", entry.id)));
                  }}
                >
                  <strong>{entry.label}</strong>
                  <span>{entry.size}×{entry.size} · {entry.mistakes} mistakes</span>
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
                  ? `${difficultyLabel(difficulty)} caps at ${ceiling.toLocaleString()} Gold a wager. Step up a size to stake more.`
                  : `Finish ${difficultyLabel(difficulty)} inside ${Math.round(tier.timeLimitMs / 60_000)} minutes and cash out ${Math.round(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Spend the mistake budget, or run out of time, and the wager is gone.`}
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
        <div className="duel-match ante-match ng-match">
          <div className="duel-scoreline ante-scoreline ng-scoreline">
            <span
              className={clsx("ng-mistakes", board.mistakes > 0 && "ng-mistakes-spent")}
              aria-label={`${board.mistakeLimit - board.mistakes} mistakes left`}
            >
              <X size={13} aria-hidden="true" />
              <strong>{board.mistakeLimit - board.mistakes}</strong>
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

          <div className="ng-frame">
            {/* Flex rows rather than one CSS grid: the clue gutters are not
                cells, and a grid would need every row's clue block to be a
                span the same way the board's are. Each row is a fixed-width
                strip, so the columns line up by construction. The two gutter
                depths are the longest clue in either direction, measured
                rather than guessed -- a fixed gutter either clips a busy line
                or wastes half the screen on a quiet one. */}
            <div
              className="ng-grid"
              role="grid"
              aria-label={`Nonogram board, ${board.size} by ${board.size}`}
              style={
                {
                  "--ng-size": board.size,
                  "--ng-cell": `${CELL_PX[board.size] ?? 24}px`,
                  "--ng-row-clues": Math.max(1, ...board.clues.rows.map((clue) => clue.length)),
                  "--ng-col-clues": Math.max(1, ...board.clues.cols.map((clue) => clue.length)),
                } as React.CSSProperties
              }
            >
              <div className="ng-head" role="row">
                <div className="ng-corner" aria-hidden="true" />
                {board.clues.cols.map((clue, col) => (
                  <div
                    key={`col-${col}`}
                    className={clsx(
                      "ng-clue ng-clue-col",
                      done.cols[col] && "ng-clue-done",
                      (col + 1) % 5 === 0 && col + 1 < board.size && "ng-major-col",
                    )}
                    aria-hidden="true"
                  >
                    {clue.length === 0 ? <span>0</span> : clue.map((run, i) => <span key={i}>{run}</span>)}
                  </div>
                ))}
              </div>

              {board.clues.rows.map((clue, row) => (
                <div className="ng-row" key={`row-${row}`} role="row">
                  <div
                    className={clsx(
                      "ng-clue ng-clue-row",
                      done.rows[row] && "ng-clue-done",
                      (row + 1) % 5 === 0 && row + 1 < board.size && "ng-major-row",
                    )}
                    aria-hidden="true"
                  >
                    {clue.length === 0 ? <span>0</span> : clue.map((run, i) => <span key={i}>{run}</span>)}
                  </div>

                  {Array.from({ length: board.size }, (_, col) => {
                    const index = row * board.size + col;
                    const cell = board.marks[index];
                    // Only ever read once the round is over, when the server
                    // has handed the answer over; null while it is live.
                    const missed =
                      board.solution !== null &&
                      board.solution[index] === SOLUTION_FILLED &&
                      cell !== MARK_FILLED;

                    return (
                      <button
                        key={index}
                        type="button"
                        role="gridcell"
                        className={clsx(
                          "ng-cell",
                          cell === MARK_FILLED && "ng-cell-filled",
                          cell === MARK_CROSSED && "ng-cell-crossed",
                          cell === MARK_UNKNOWN && "ng-cell-blank",
                          missed && "ng-cell-missed",
                          (col + 1) % 5 === 0 && col + 1 < board.size && "ng-major-col",
                          (row + 1) % 5 === 0 && row + 1 < board.size && "ng-major-row",
                        )}
                        disabled={!active}
                        aria-label={
                          `Row ${row + 1}, column ${col + 1}, ` +
                          (cell === MARK_FILLED ? "filled" : cell === MARK_CROSSED ? "crossed off" : "blank")
                        }
                        onContextMenu={(event) => { event.preventDefault(); cross(index); }}
                        onPointerDown={() => beginPress(index)}
                        onPointerUp={endPress}
                        onPointerLeave={endPress}
                        onPointerCancel={endPress}
                        onClick={() => { if (!handled.current) tap(index); }}
                      >
                        {cell === MARK_CROSSED && <X size={11} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {settled ? (
            <div className={clsx("duel-result", attempt.status === "won" && "duel-result-won")}>
              <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
              <strong>
                {attempt.status === "won"
                  ? "Picture finished"
                  : attempt.status === "timed-out"
                    ? "Time's up"
                    : board.mistakes >= board.mistakeLimit
                      // A spent budget and a resignation both settle as
                      // "lost", so the board is what tells them apart.
                      ? "Out of mistakes"
                      : "Gave up"}
              </strong>
              <span>
                {formatDuration(attempt.elapsedMs)} · {difficultyLabel(attempt.difficulty)} ·{" "}
                {board.filled} of {board.filledTotal} squares
              </span>
              <span className="duel-result-gold">{result.label}</span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <>
              <div className="ng-toolbar">
                <button
                  type="button"
                  className={clsx("ms-flag-toggle", crossMode && "ms-flag-toggle-active")}
                  aria-pressed={crossMode}
                  onClick={() => { selectSound(); setCrossMode((mode) => !mode); }}
                >
                  {crossMode ? <X size={13} aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />}
                  {crossMode ? "Cross" : "Fill"}
                </button>
                <p className="ms-hint">
                  {crossMode
                    ? "Tap to cross off. Crosses cost nothing."
                    : "Tap to fill. Hold a square to cross it off."}
                </p>
                <span className="ng-progress" aria-label={`${board.filled} of ${board.filledTotal} squares filled`}>
                  <Eraser size={12} aria-hidden="true" />
                  {board.filled}/{board.filledTotal}
                </span>
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

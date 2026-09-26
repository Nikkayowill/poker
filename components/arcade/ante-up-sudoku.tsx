"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, Eraser, HelpCircle, Lock, Pencil, X } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { StakePressureNote } from "@/components/arcade/stake-pressure-note";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { useActionQueue } from "@/components/shared/use-action-queue";
import { clearSound, comboSound, selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  ANTE_UP_TIERS,
  MIN_ANTE_UP_WAGER,
  anteUpTimeLimitMs,
  type AnteUpSnapshot,
} from "@/lib/arcade/ante-up";
import {
  ANTE_UP_TIER_LADDERS,
  anteUpStakeProblem,
  anteUpTierAllowed,
  maxAnteUpWager,
} from "@/lib/arcade/ante-up-stakes";
import { lowestTierFor, stakePressureThreshold } from "@/lib/arcade/stake-pressure";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import {
  SUDOKU_CELLS,
  SUDOKU_DIFFICULTIES,
  SUDOKU_SIZE,
  boxOf,
  columnOf,
  formatDuration,
  isSudokuDifficulty,
  rowOf,
  type SudokuDifficulty,
} from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";
import { createRequestSequence } from "@/lib/ui/request-sequence";

/**
 * Ante Up: Sudoku, the solo half of Ante Up.
 *
 * Same request shape as the daily Sudoku board (a fill is a request, the
 * server says whether it was right, the solution never crosses the wire) and
 * the same wager step lib/pvp's duel lobby uses (a quick-pick row plus a
 * custom field, floored at MIN_ANTE_UP_WAGER). Reuses both stylesheets'
 * classes rather than a third copy of either; see 43-ante-up.css's header.
 */

/**
 * Offered low to high; StakePicker drops the ones above the chosen board's
 * ceiling, so easy shows three of these and expert shows all of them. The top
 * end exists so the harder rungs can actually reach the headroom their
 * ceiling grants (lib/arcade/ante-up-stakes.ts).
 */
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 25_000, 100_000, 500_000] as const;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** "5 min" for whole minutes, "2:30" otherwise. */
function clockLabel(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : formatDuration(ms);
}

/** What each stake band asks of the grid, for the lobby note. */
const STAKE_RULES = {
  1: [`Medium grid or harder. Medium runs ${clockLabel(ANTE_UP_TIERS.medium.rankedTimeLimitMs)}.`],
  2: [`Hard grid or harder, on a ${clockLabel(ANTE_UP_TIERS.hard.rankedTimeLimitMs)} clock. Every one needs hidden singles.`],
  3: [
    "Expert grid only. Singles alone won't finish it.",
    "Expect to need pairs, pointing and wings.",
  ],
} as const;

/** The grid a stake needs: the current one if it's still allowed, else the easiest that is. */
function difficultyForStake(current: SudokuDifficulty, wager: number): SudokuDifficulty {
  const ladder = ANTE_UP_TIER_LADDERS.sudoku;
  if (!ladder || anteUpTierAllowed("sudoku", current, wager)) return current;
  const lowest = lowestTierFor(ladder, wager);
  return isSudokuDifficulty(lowest) ? lowest : current;
}

/** "10k" for a grid a stake of 10k or more can't be played on. Null if no stake locks it. */
function stakeLockedFrom(difficulty: SudokuDifficulty): string | null {
  const ladder = ANTE_UP_TIER_LADDERS.sudoku;
  if (!ladder) return null;
  const index = ladder.tiers.indexOf(difficulty);
  const band = ([1, 2, 3] as const).find((pressure) => ladder.minTierByPressure[pressure] > index);
  return band ? stakePressureThreshold(band).replace("+", "") : null;
}

interface AnteUpResponse {
  attempt: AnteUpSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

/** A digit the player has put down that the server has not answered yet. */
interface PendingFill {
  index: number;
  value: number;
}

/** The 9 cell indices sharing `index`'s row, column, or box. */
function rowCells(index: number): number[] {
  const row = rowOf(index);
  return Array.from({ length: SUDOKU_SIZE }, (_, c) => row * SUDOKU_SIZE + c);
}
function columnCells(index: number): number[] {
  const col = columnOf(index);
  return Array.from({ length: SUDOKU_SIZE }, (_, r) => r * SUDOKU_SIZE + col);
}
function boxCells(index: number): number[] {
  const boxRow = Math.floor(rowOf(index) / 3) * 3;
  const boxCol = Math.floor(columnOf(index) / 3) * 3;
  const cells: number[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) cells.push((boxRow + r) * SUDOKU_SIZE + (boxCol + c));
  }
  return cells;
}

/**
 * Every cell of a row, column or box that `index` just completed, deduped and
 * in ascending order (the same "stagger delay by position" idiom Blockudoku's
 * own clear animation uses). A digit only ever completes a unit it's part of,
 * so checking the after-fill board at `index`'s own three units is enough --
 * no need to compare against the board before the fill.
 */
function newlyCompletedCells(board: readonly number[], index: number): number[] {
  const done = new Set<number>();
  for (const cells of [rowCells(index), columnCells(index), boxCells(index)]) {
    if (cells.every((cell) => board[cell] !== 0)) for (const cell of cells) done.add(cell);
  }
  return Array.from(done).sort((a, b) => a - b);
}

/** How often the shell re-reads a live attempt, so the clock still settles even with no fill sent. */
const POLL_MS = 3000;
/** Fallback pause on a 429 with no (or a bogus) Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

export function AnteUpSudoku() {
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("easy");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpSnapshot | null>(null);
  // The persistent shell owns the profile now -- this screen still gets it
  // back from its own attempt-response payload too (unchanged), it just
  // writes into the shared setter instead of a local copy.
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [rejected, setRejected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Pencil marks are a client-side memory aid only, never sent to the server:
  // the engine only ever stores a cell's committed digit (lib/arcade/puzzles/
  // sudoku.ts's `entries`), and a candidate note doesn't change what's correct
  // or move any Gold, so there's nothing here for the server to referee.
  const [notesMode, setNotesMode] = useState(false);
  const [notes, setNotes] = useState<Record<number, Set<number>>>({});
  const [showHelp, setShowHelp] = useState(false);
  // Cells of a row/column/box a fill just completed, ascending order (also
  // each cell's glow stagger delay), plus whether more than one unit
  // completed on the same digit.
  const [celebrate, setCelebrate] = useState<readonly number[]>([]);
  const [celebrateCombo, setCelebrateCombo] = useState(false);
  const celebrateTimer = useRef<number | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  // Tells the shell an attempt is open -- hides the persistent nav chrome,
  // same as every other live-money screen. Not narrowed to `active`: the
  // settled result is still this screen, not the picker, and FloorBackLink
  // is the way out of either.
  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  // Guards start and resign against a double click. Poll ordering and board
  // versions live in `sequence`, which also covers the queued fills.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    if (celebrateTimer.current !== null) window.clearTimeout(celebrateTimer.current);
  }, []);
  const [sequence] = useState(() => createRequestSequence<AnteUpSnapshot>());

  const applyResponse = useCallback((data: Partial<AnteUpResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined && sequence.admit(data.attempt)) setAttempt(data.attempt ?? null);
  }, [sequence, setProfile]);

  /**
   * The background poll: reads the live attempt, sets no busy flag.
   *
   * Returns the pause (in ms) the poll loop should wait before its next tick
   * when the server answered 429, or null for the ordinary POLL_MS cadence --
   * same contract as Minesweeper's/Nonogram's own `refresh`, which this one
   * used to lack, leaving a rate-limited response dropped silently forever.
   */
  const refresh = useCallback(async (): Promise<number | null> => {
    const ticket = sequence.beginRead();
    if (!ticket) return null;
    try {
      const response = await fetch("/api/ante-up", { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<AnteUpResponse>;
      if (!mounted.current || !sequence.acceptRead(ticket)) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is a few seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [applyResponse, sequence]);

  /** A player-initiated action: start or resign. Sets busy; a 409 still applies its payload. */
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
      const data = (await response.json()) as Partial<AnteUpResponse> & { round?: AnteUpSnapshot };
      if (!mounted.current) return;
      if (!response.ok) {
        if (data.round) applyResponse({ attempt: data.round });
        setError(data.error ?? "That did not go through.");
        return;
      }
      applyResponse(data);
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
    } finally {
      sending.current = false;
      done();
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse, sequence]);

  /**
   * A committed digit answers its own cell (drop its notes) and rules itself
   * out as a candidate in every peer cell, the bookkeeping a solver does by hand.
   */
  const clearPeerNotes = useCallback((cellIndex: number, value: number) => {
    setNotes((prev) => {
      let changed = false;
      const next: Record<number, Set<number>> = {};
      for (const [key, digits] of Object.entries(prev)) {
        const index = Number(key);
        if (index === cellIndex) { changed = true; continue; }
        const isPeer =
          rowOf(index) === rowOf(cellIndex) ||
          columnOf(index) === columnOf(cellIndex) ||
          boxOf(index) === boxOf(cellIndex);
        if (isPeer && digits.has(value)) {
          changed = true;
          const filtered = new Set(digits);
          filtered.delete(value);
          if (filtered.size > 0) next[index] = filtered;
        } else {
          next[index] = digits;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /**
   * Sends one queued digit against the newest board. Returns false to drop the
   * rest of the queue, which only happens once the attempt is over or unreachable.
   */
  const sendFill = useCallback(async ({ index, value }: PendingFill): Promise<boolean> => {
    if (!mounted.current) return false;
    const before = sequence.latest();
    try {
      const response = await fetch("/api/ante-up/actions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fill", version: sequence.version(), index, value }),
      });
      const data = (await response.json()) as Partial<AnteUpResponse> & { round?: AnteUpSnapshot };
      if (!mounted.current) return false;
      if (response.ok) {
        applyResponse(data);
        if (value !== 0) {
          play("ui");
          clearPeerNotes(index, value);
          const next = data.attempt;
          if (next) {
            const board = next.puzzle.map((given, i) => given || next.entries[i]);
            const completed = newlyCompletedCells(board, index);
            if (completed.length > 0) {
              const combo = completed.length > SUDOKU_SIZE;
              if (combo) comboSound(); else clearSound();
              setCelebrate(completed);
              setCelebrateCombo(combo);
              if (celebrateTimer.current !== null) window.clearTimeout(celebrateTimer.current);
              celebrateTimer.current = window.setTimeout(() => {
                celebrateTimer.current = null;
                if (mounted.current) {
                  setCelebrate([]);
                  setCelebrateCombo(false);
                }
              }, 500);
            }
          }
        }
        return true;
      }
      if (data.round) applyResponse({ attempt: data.round });
      if (data.round?.status === "active") {
        // Still live, so either a wrong digit or a board that moved. Only a
        // wrong digit raises the mistake count, so only that one shakes.
        if (data.round.mistakes > (before?.mistakes ?? 0)) {
          setRejected(index);
          window.setTimeout(() => setRejected(null), 420);
        }
        return true;
      }
      // A settled board (the clock ran out under this digit) already says so
      // on the result card, so it doesn't also need a banner.
      if (!data.round) setError(data.error ?? "That did not go through.");
      return false;
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
      return false;
    }
  }, [applyResponse, clearPeerNotes, play, sequence]);

  const fills = useActionQueue<PendingFill>(sequence, sendFill);

  // The server's entries with every digit still on the wire drawn on top, so a
  // tap shows at once. A wrong one is taken back when its answer lands.
  const entries = useMemo(() => {
    if (!attempt) return [];
    if (fills.pending.length === 0) return attempt.entries;
    const next = [...attempt.entries];
    for (const fill of fills.pending) next[fill.index] = fill.value;
    return next;
  }, [attempt, fills.pending]);

  // Initial read, deferred a tick: the idiom every arcade table and the duel
  // shell share, since a fetch fired straight from an effect body sets state
  // during the same commit.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Poll a live attempt so a clock that runs out with nobody clicking still
  // settles for the player looking at it, same reasoning DuelShell's poll
  // gives. A self-rescheduling timeout rather than setInterval: the next tick
  // is only scheduled once the current refresh() has settled, so a slow
  // response can never leave two polls in flight, and a 429 reply's own
  // Retry-After becomes that one tick's delay in place of POLL_MS.
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

  const start = () => {
    if (sending.current) return;
    setSelected(null);
    setNotes({});
    fills.clear();
    void send("/api/ante-up", { difficulty, wager });
  };

  // Queued rather than refused while an earlier digit is on the wire, so a
  // fast solver's taps all land in order, each on the newest board.
  const fill = (value: number) => {
    if (!attempt || selected === null || !active) return;
    if (attempt.puzzle[selected] !== 0 || entries[selected] === value) return;
    fills.push({ index: selected, value });
  };

  /** Toggles one candidate digit in the selected cell, notes mode's version of `fill`. */
  const toggleNote = (digit: number) => {
    if (!attempt || selected === null) return;
    if (attempt.puzzle[selected] !== 0 || entries[selected] !== 0) return;
    tapSound();
    const cellIndex = selected;
    setNotes((prev) => {
      const current = new Set(prev[cellIndex] ?? []);
      if (current.has(digit)) current.delete(digit); else current.add(digit);
      const next = { ...prev };
      if (current.size > 0) next[cellIndex] = current; else delete next[cellIndex];
      return next;
    });
  };

  const clearNotes = () => {
    if (selected === null || !notes[selected]) return;
    tapSound();
    const cellIndex = selected;
    setNotes((prev) => {
      const next = { ...prev };
      delete next[cellIndex];
      return next;
    });
  };

  /**
   * A physical keyboard does what the pad does: digits fill (or note, in notes
   * mode), Backspace/Delete/0 erase, arrows move the selection, N flips notes.
   * Returns true when it used the key.
   */
  const onKey = (event: KeyboardEvent): boolean => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      const clamp = (n: number) => Math.min(SUDOKU_SIZE - 1, Math.max(0, n));
      setSelected((current) => {
        if (current === null) return 0;
        return clamp(rowOf(current) + move[0]) * SUDOKU_SIZE + clamp(columnOf(current) + move[1]);
      });
      return true;
    }
    // Held keys only repeat for movement; a held digit is not ten fills.
    if (event.repeat || busy) return false;
    if (event.key.toLowerCase() === "n") {
      selectSound();
      setNotesMode((mode) => !mode);
      return true;
    }
    if (selected === null) return false;
    if (/^[1-9]$/.test(event.key)) {
      const digit = Number(event.key);
      if (notesMode) toggleNote(digit); else fill(digit);
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      if (notesMode) clearNotes(); else fill(0);
      return true;
    }
    return false;
  };

  // The newest onKey, so the listener below is added once per attempt
  // rather than on every render.
  const keyHandler = useRef(onKey);
  useEffect(() => {
    keyHandler.current = onKey;
  });
  useEffect(() => {
    if (!active) return;
    const listen = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='dialog']")) return;
      if (keyHandler.current(event)) event.preventDefault();
    };
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, [active]);

  const resign = () => {
    if (sending.current) return;
    fills.clear();
    void send("/api/ante-up/actions", { action: "resign" });
  };
  const playAgain = () => { setAttempt(null); setSelected(null); setNotes({}); };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const ceiling = maxAnteUpWager("sudoku", difficulty);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  // Narrower than !canAfford: that also covers a wager under the floor or
  // over the ceiling, which the verdict paragraph below already explains and
  // which "earn more Gold" would not fix. Only an actual shortfall gets the hint.
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const tier = ANTE_UP_TIERS[difficulty];
  const stakeProblem = anteUpStakeProblem("sudoku", difficulty, wager);
  // What the attempt did to the balance, not what it credited: the slow
  // rungs can pay back less than was staked. See lib/arcade/ante-up-result.ts.
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  // Clamped at the tier's own time limit: expiresAt is the server's deadline
  // and `now` is the browser's clock, so a slow response would otherwise put
  // a second or two of network latency on the clock right after starting.
  // Minesweeper/Nonogram already clamp their own countdowns for this reason.
  const msRemaining = attempt
    ? Math.min(attempt.timeLimitMs, Math.max(0, Date.parse(attempt.expiresAt) - now))
    : 0;

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
        <HowToPlayModal title="Sudoku" onClose={() => setShowHelp(false)}>
          <p>
            Fill the 9×9 grid so every row, column, and 3×3 box holds 1 through 9 exactly once.
            Every grid is generated fresh with a guaranteed unique solution, so you can play as
            often as you like — there&apos;s no shared daily board here.
          </p>
          <p>
            Pick a difficulty, then wager Gold or play free. Beat the grid before its clock runs
            out and you win; let the clock expire or give up and the wager is gone. A wrong digit
            costs a mistake, and the third mistake ends the grid. Harder difficulties run a longer clock
            and pay more on a win. Bigger stakes need harder grids: 10k and up plays Medium or
            harder, 100k Hard or harder, and 1M Expert only, and from 10k some clocks are
            tighter. Your wager, clock and payout are locked in the moment you ante up.
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
            <h1>Sudoku, against the clock</h1>
            <p>
              Wager on your own ability. Beat the grid before time runs out and cash out up to{" "}
              {ANTE_UP_TIERS.expert.multiplier}x. The harder the grid, the more it pays. Big stakes play the hard ones.
            </p>
          </div>

          <div className="ante-difficulties sk-difficulties" role="group" aria-label="Difficulty">
            {SUDOKU_DIFFICULTIES.map((entry) => {
              const entryTier = ANTE_UP_TIERS[entry];
              const locked = !anteUpTierAllowed("sudoku", entry, wager);
              return (
                <button
                  key={entry}
                  type="button"
                  className={clsx("ante-difficulty", entry === difficulty && "ante-difficulty-active")}
                  aria-pressed={entry === difficulty}
                  disabled={locked}
                  onClick={() => {
                    selectSound();
                    setDifficulty(entry);
                    // Dropping to an easier grid lowers the ceiling under a
                    // wager that was legal a moment ago; bring it down with it
                    // rather than leaving an amount the server will refuse.
                    setWager((current) => Math.min(current, maxAnteUpWager("sudoku", entry)));
                  }}
                >
                  <strong>{entry[0].toUpperCase() + entry.slice(1)}</strong>
                  {locked ? (
                    <span className="ante-difficulty-lock">
                      <Lock size={10} aria-hidden="true" /> Under {stakeLockedFrom(entry)} stakes
                    </span>
                  ) : (
                    <span>{clockLabel(anteUpTimeLimitMs(entry, wager))} · {entryTier.multiplier}x</span>
                  )}
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
            onChange={(next) => {
              selectSound();
              setWager(next);
              setDifficulty((current) => difficultyForStake(current, next));
            }}
          />
          <StakePressureNote wager={wager} rules={STAKE_RULES} />
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free practice — no payout on a win, but there's no fun in that."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : stakeProblem
                  ? stakeProblem
                  : wager > ceiling
                    ? `${difficulty[0].toUpperCase() + difficulty.slice(1)} caps at ${ceiling.toLocaleString()} Gold a wager. Step up a difficulty to stake more.`
                    : `Beat ${difficulty} inside ${clockLabel(anteUpTimeLimitMs(difficulty, wager))} and cash out ${Math.round(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Miss it and the wager is gone.`}
          </p>

          <button
            type="button"
            className="puzzle-share-button"
            disabled={busy || !loaded || !canAfford || stakeProblem !== null}
            onClick={() => { selectSound(); start(); }}
          >
            <Coins size={15} aria-hidden="true" />
            {!loaded
              ? "…"
              : stakeProblem
                ? "Pick a harder grid"
                : wager > ceiling
                  ? "Over the cap"
                  : !canAfford
                    ? "Not enough Gold"
                    : busy
                      ? "Dealing…"
                      : "Ante up"}
          </button>
          {loaded && insufficientGold && <GoldShortfallHint needed={wager} compact />}
        </section>
      ) : (
        <div className="duel-match ante-match">
          <div className="duel-scoreline ante-scoreline">
            <span className="ante-clock" aria-live="polite">
              {active ? formatDuration(msRemaining) : formatDuration(attempt.elapsedMs)}
            </span>
            {active && (
              <span
                className={clsx("ng-mistakes", attempt.mistakes > 0 && "ng-mistakes-spent")}
                aria-label={`${attempt.maxMistakes - attempt.mistakes} mistakes left`}
              >
                <X size={13} aria-hidden="true" />
                <strong>{attempt.maxMistakes - attempt.mistakes}</strong>
              </span>
            )}
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {attempt.payout.toLocaleString()}</small>}
            </span>
          </div>

          <div className={clsx("sk-grid", celebrateCombo && "sk-grid-combo")} role="grid" aria-label="Sudoku grid">
            {Array.from({ length: SUDOKU_CELLS }, (_, index) => {
              const given = attempt.puzzle[index];
              const entry = entries[index];
              const value = given || entry;
              const isSelected = selected === index;
              const peer =
                selected !== null &&
                (rowOf(selected) === rowOf(index) ||
                  columnOf(selected) === columnOf(index) ||
                  boxOf(selected) === boxOf(index));
              const twin = selected !== null && value !== 0
                && value === (attempt.puzzle[selected] || entries[selected]);
              const cellNotes = value === 0 ? notes[index] : undefined;
              const celebrateOrder = celebrate.indexOf(index);

              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={clsx(
                    "sk-cell",
                    given !== 0 && "sk-cell-given",
                    isSelected && "sk-cell-selected",
                    !isSelected && peer && "sk-cell-peer",
                    !isSelected && twin && "sk-cell-twin",
                    rejected === index && "sk-cell-wrong",
                    celebrateOrder !== -1 && "sk-cell-complete",
                    columnOf(index) % 3 === 0 && "sk-cell-box-left",
                    rowOf(index) % 3 === 0 && "sk-cell-box-top",
                    columnOf(index) === SUDOKU_SIZE - 1 && "sk-cell-box-right",
                    rowOf(index) === SUDOKU_SIZE - 1 && "sk-cell-box-bottom",
                  )}
                  style={celebrateOrder !== -1 ? ({ "--sk-complete-i": celebrateOrder } as React.CSSProperties) : undefined}
                  disabled={!active}
                  aria-label={
                    `Row ${rowOf(index) + 1}, column ${columnOf(index) + 1}` +
                    (value ? `, ${value}` : cellNotes?.size ? `, candidates ${[...cellNotes].sort().join(", ")}` : ", empty")
                  }
                  onClick={() => { tapSound(); setSelected(index); }}
                >
                  {value ? (
                    value
                  ) : cellNotes?.size ? (
                    <span className="sk-notes" aria-hidden="true">
                      {DIGITS.map((digit) => (
                        <span key={digit} className="sk-note">{cellNotes.has(digit) ? digit : ""}</span>
                      ))}
                    </span>
                  ) : (
                    ""
                  )}
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
                {attempt.status === "won"
                  ? "You beat it"
                  : attempt.status === "timed-out"
                    ? "Time's up"
                    : attempt.mistakes >= attempt.maxMistakes
                      ? "Too many mistakes"
                      : "Gave up"}
              </strong>
              <span>
                {formatDuration(attempt.elapsedMs)} · {attempt.mistakes} {attempt.mistakes === 1 ? "mistake" : "mistakes"}
              </span>
              <span className="duel-result-gold">
                {result.label}
              </span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <>
              <div className="sk-toolbar">
                <button
                  type="button"
                  className={clsx("sk-notes-toggle", notesMode && "sk-notes-toggle-active")}
                  aria-pressed={notesMode}
                  disabled={busy}
                  onClick={() => { selectSound(); setNotesMode((mode) => !mode); }}
                >
                  <Pencil size={13} aria-hidden="true" />
                  Notes {notesMode ? "on" : "off"}
                </button>
              </div>
              <div className="sk-pad" role="group" aria-label="Digits">
                {DIGITS.map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    className="sk-key"
                    disabled={busy || selected === null}
                    onClick={() => (notesMode ? toggleNote(digit) : fill(digit))}
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  className="sk-key sk-key-erase"
                  disabled={busy || selected === null}
                  aria-label={notesMode ? "Clear notes" : "Erase"}
                  onClick={() => (notesMode ? clearNotes() : fill(0))}
                >
                  <Eraser size={15} aria-hidden="true" />
                </button>
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

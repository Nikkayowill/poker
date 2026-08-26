"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins, Eraser, Pencil } from "lucide-react";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { StakePicker } from "@/components/pvp/stake-picker";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { ANTE_UP_TIERS, MIN_ANTE_UP_WAGER, type AnteUpSnapshot } from "@/lib/arcade/ante-up";
import {
  SUDOKU_CELLS,
  SUDOKU_DIFFICULTIES,
  SUDOKU_SIZE,
  boxOf,
  columnOf,
  formatDuration,
  rowOf,
  type SudokuDifficulty,
} from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";

/**
 * Ante Up: Sudoku, the solo half of Ante Up.
 *
 * Same request shape as the daily Sudoku board (a fill is a request, the
 * server says whether it was right, the solution never crosses the wire) and
 * the same wager step lib/pvp's duel lobby uses (a quick-pick row plus a
 * custom field, floored at MIN_ANTE_UP_WAGER). Reuses both stylesheets'
 * classes rather than a third copy of either; see 43-ante-up.css's header.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 10_000] as const;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

interface AnteUpResponse {
  attempt: AnteUpSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

/** How often the shell re-reads a live attempt, so the clock still settles even with no fill sent. */
const POLL_MS = 3000;

export function AnteUpSudoku() {
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("easy");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpSnapshot | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
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

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  // Same guard duel-shell.tsx keeps: true while the player's own action is in
  // flight, so a background poll landing in the middle of it cannot paint the
  // pre-action state back over what the action's own response is about to
  // paint forward. Without it a digit briefly vanishes and reappears.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<AnteUpResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined) setAttempt(data.attempt ?? null);
  }, []);

  /** The background poll: reads the live attempt, sets no busy flag. */
  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/ante-up", { cache: "no-store" });
      const data = (await response.json()) as Partial<AnteUpResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is a few seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  /** A player-initiated action: start, fill, resign. Sets busy; a 409 still applies its payload. */
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
      const data = (await response.json()) as Partial<AnteUpResponse> & { round?: AnteUpSnapshot };
      if (!mounted.current) return { wrong: false };
      if (!response.ok) {
        // A wrong digit is ordinary play: the board takes the updated state
        // (the mistake counter moved) and shrugs, same treatment Sudoku's own
        // board gives it. Anything else is a real refusal.
        const wrong = !!data.round && data.round.status === "active";
        if (data.round) setAttempt(data.round);
        if (!wrong) setError(data.error ?? "That did not go through.");
        return { wrong };
      }
      applyResponse(data);
      return { wrong: false };
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
      return { wrong: false };
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse]);

  // Initial read, deferred a tick: the idiom every arcade table and the duel
  // shell share, since a fetch fired straight from an effect body sets state
  // during the same commit.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Poll a live attempt so a clock that runs out with nobody clicking still
  // settles for the player looking at it, same reasoning DuelShell's poll
  // gives.
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

  const start = () => {
    setSelected(null);
    setNotes({});
    void send("/api/ante-up", { difficulty, wager });
  };

  const fill = async (value: number) => {
    if (!attempt || selected === null || busy || !active) return;
    if (attempt.puzzle[selected] !== 0) return;
    const cellIndex = selected;
    const result = await send("/api/ante-up/actions", {
      action: "fill",
      version: attempt.version,
      index: cellIndex,
      value,
    });
    if (result?.wrong) {
      setRejected(cellIndex);
      window.setTimeout(() => setRejected(null), 420);
    } else if (value !== 0) {
      play("ui");
      // A committed digit answers this cell (drop its own notes entirely) and
      // rules itself out as a candidate everywhere it now shares a row,
      // column or box: the same bookkeeping a solver does by hand once a
      // number lands.
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
    }
  };

  /** Toggles one candidate digit in the selected cell, notes mode's version of `fill`. */
  const toggleNote = (digit: number) => {
    if (!attempt || selected === null) return;
    if (attempt.puzzle[selected] !== 0 || attempt.entries[selected] !== 0) return;
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

  const resign = () => void send("/api/ante-up/actions", { action: "resign" });
  const playAgain = () => { setAttempt(null); setSelected(null); setNotes({}); };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const canAfford = wager === 0 || (wager >= MIN_ANTE_UP_WAGER && balance >= wager);
  const tier = ANTE_UP_TIERS[difficulty];
  const msRemaining = attempt ? Math.max(0, Date.parse(attempt.expiresAt) - now) : 0;

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
            <h1>Sudoku, against the clock</h1>
            <p>Wager on your own ability. Beat the grid before time runs out and cash out up to 10x.</p>
          </div>

          <section className="duel-panel">
            <h2 className="floor-section-head">Difficulty</h2>
            <div className="ante-difficulties" role="group" aria-label="Difficulty">
              {SUDOKU_DIFFICULTIES.map((entry) => {
                const entryTier = ANTE_UP_TIERS[entry];
                return (
                  <button
                    key={entry}
                    type="button"
                    className={clsx("ante-difficulty", entry === difficulty && "ante-difficulty-active")}
                    aria-pressed={entry === difficulty}
                    onClick={() => { selectSound(); setDifficulty(entry); }}
                  >
                    <strong>{entry[0].toUpperCase() + entry.slice(1)}</strong>
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
                ? "Free practice -- no payout on a win, but there's no fun in that."
                : wager < MIN_ANTE_UP_WAGER
                  ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                  : `Beat ${difficulty} inside ${Math.round(tier.timeLimitMs / 60_000)} minutes and cash out ${(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Miss it and the wager is gone.`}
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
        <div className="duel-match ante-match">
          <div className="duel-scoreline ante-scoreline">
            <span className="ante-clock" aria-live="polite">
              {active ? formatDuration(msRemaining) : "—:—"}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {attempt.payout.toLocaleString()}</small>}
            </span>
          </div>

          <div className="sk-grid" role="grid" aria-label="Sudoku grid">
            {Array.from({ length: SUDOKU_CELLS }, (_, index) => {
              const given = attempt.puzzle[index];
              const entry = attempt.entries[index];
              const value = given || entry;
              const isSelected = selected === index;
              const peer =
                selected !== null &&
                (rowOf(selected) === rowOf(index) ||
                  columnOf(selected) === columnOf(index) ||
                  boxOf(selected) === boxOf(index));
              const twin = selected !== null && value !== 0
                && value === (attempt.puzzle[selected] || attempt.entries[selected]);
              const cellNotes = value === 0 ? notes[index] : undefined;

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
                    columnOf(index) % 3 === 0 && "sk-cell-box-left",
                    rowOf(index) % 3 === 0 && "sk-cell-box-top",
                    columnOf(index) === SUDOKU_SIZE - 1 && "sk-cell-box-right",
                    rowOf(index) === SUDOKU_SIZE - 1 && "sk-cell-box-bottom",
                  )}
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
              <strong>
                {attempt.status === "won" ? "You beat it" : attempt.status === "timed-out" ? "Time's up" : "Gave up"}
              </strong>
              <span>{attempt.mistakes} {attempt.mistakes === 1 ? "mistake" : "mistakes"}</span>
              <span className="duel-result-gold">
                {attempt.status === "won"
                  ? attempt.wager > 0 ? `+${attempt.payout.toLocaleString()} Gold` : "Practice round -- no Gold at stake"
                  : attempt.wager > 0 ? `−${attempt.wager.toLocaleString()} Gold` : "Practice round -- nothing lost"}
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
                    onClick={() => (notesMode ? toggleNote(digit) : void fill(digit))}
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  className="sk-key sk-key-erase"
                  disabled={busy || selected === null}
                  aria-label={notesMode ? "Clear notes" : "Erase"}
                  onClick={() => (notesMode ? clearNotes() : void fill(0))}
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

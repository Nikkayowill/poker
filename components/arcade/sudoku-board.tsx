"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Eraser } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { NextPuzzleCountdown } from "@/components/arcade/next-puzzle-countdown";
import { ShareResultButton } from "@/components/arcade/share-result-button";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  SUDOKU_CELLS,
  SUDOKU_DIFFICULTIES,
  SUDOKU_SIZE,
  boxOf,
  columnOf,
  formatDuration,
  rowOf,
  type SudokuDifficulty,
  type SudokuSnapshot,
} from "@/lib/arcade/puzzles/sudoku";
import { puzzleShareTitle, sudokuShareText } from "@/lib/arcade/puzzles/share";

/**
 * Daily Sudoku.
 *
 * The board lives on the server and so does the answer -- every digit is a
 * request, and the response says whether it was right. See the note at the top
 * of lib/arcade/puzzles/sudoku.ts for why that round trip is worth it.
 *
 * Four difficulties are four separate boards with four separate attempts, so
 * the difficulty is part of the URL of every request rather than a display
 * setting.
 */

interface SudokuResponse {
  round: SudokuSnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
  error?: string;
  reason?: string;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function SudokuBoard() {
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("easy");
  const [state, setState] = useState<SudokuResponse | null>(null);
  /**
   * An absolute instant, computed the moment the server's figure arrived --
   * which is both when it was accurate and the only place reading the clock is
   * honest. NextPuzzleCountdown ticks against it rather than decrementing a
   * remaining-ms counter, which drifts in a throttled tab.
   */
  const [nextPuzzleAt, setNextPuzzleAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /** The cell that just refused a digit, so it can shake once. */
  const [rejected, setRejected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const play = useArcadeSound();
  const round = state?.round ?? null;
  const solved = round?.status === "solved";

  const send = useCallback(
    async (url: string, body?: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          cache: "no-store",
          ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        });
        const data = (await response.json()) as Partial<SudokuResponse>;
        if (!response.ok) {
          // A wrong digit is ordinary play, not a fault: the board takes the
          // updated state (the mistake counter moved) and shrugs rather than
          // raising a banner. Same treatment Word Stack gives a non-word.
          if (data.reason === "wrong") {
            if (data.round) setState((current) => (current ? { ...current, round: data.round! } : current));
            return { wrong: true };
          }
          setError(data.error ?? "That did not go through. Try again.");
          if (data.round) setState((current) => (current ? { ...current, round: data.round! } : current));
          return { wrong: false };
        }
        setState(data as SudokuResponse);
        setNextPuzzleAt(Date.now() + (data.msUntilNextPuzzle ?? 0));
        return { wrong: false };
      } catch {
        setError("Could not reach the puzzle. Check your connection.");
        return { wrong: false };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Re-read whenever the difficulty changes -- these are four different boards
  // with four different attempts, not one board with a filter on it. The
  // selection is cleared by whatever changed the difficulty, not here: a cell
  // index means nothing on a different grid, but clearing it inside this
  // effect would be a synchronous setState in an effect body.
  // Deferred a tick, the same idiom the other arcade tables use: `send` sets
  // its busy flag synchronously, and firing it straight from an effect body is
  // the cascading-render pattern.
  useEffect(() => {
    const timer = window.setTimeout(() => void send(`/api/arcade/sudoku?difficulty=${difficulty}`), 0);
    return () => window.clearTimeout(timer);
  }, [send, difficulty]);

  const chooseDifficulty = (next: SudokuDifficulty) => {
    setDifficulty(next);
    setSelected(null);
  };

  /** The running clock. One tick a second, and only while a board is live. */
  useEffect(() => {
    if (!round || round.status !== "playing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [round]);

  const start = () => void send("/api/arcade/sudoku", { difficulty });

  const fill = async (value: number) => {
    if (!round || selected === null || busy || solved) return;
    if (round.puzzle[selected] !== 0) return;
    const result = await send("/api/arcade/sudoku/actions", {
      difficulty,
      version: round.version,
      index: selected,
      value,
    });
    if (result?.wrong) {
      setRejected(selected);
      window.setTimeout(() => setRejected(null), 420);
    } else if (value !== 0) {
      play("ui");
    }
  };

  // A digit that already sits in all nine cells has nowhere left to go --
  // graying it out on the pad is the cue: "you're done placing this one."
  // Counts both givens and entries, since a digit the puzzle handed you fills
  // the same slot as one you typed in.
  const digitCounts = new Array(10).fill(0);
  if (round) {
    for (let i = 0; i < SUDOKU_CELLS; i += 1) {
      const value = round.puzzle[i] || round.entries[i];
      if (value) digitCounts[value] += 1;
    }
  }

  const elapsed = round
    ? round.elapsedMs ?? Math.max(0, now - Date.parse(round.startedAt))
    : 0;

  const shareText = round ? sudokuShareText(round, { link: "https://stackchips.app/games/sudoku" }) : null;

  return (
    <main className="bj-shell sk-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/" onClick={tapSound}>← Back to the lobby</Link>
          <h1>Daily Sudoku</h1>
          <p>
            {state ? `#${state.puzzleNumber} · ` : ""}Four grids a day · One attempt each · Resets at midnight UTC
          </p>
        </div>
        <div className="bj-header-meters">
          <span className="bj-meter">
            <small>Time</small>
            <strong>{round ? formatDuration(elapsed) : "—"}</strong>
          </span>
          <span className={clsx("bj-meter", (round?.mistakes ?? 0) > 0 && "bj-meter-down")}>
            <small>Mistakes</small>
            <strong>{round?.mistakes ?? 0}</strong>
          </span>
          <span className="bj-meter">
            <small>Clues</small>
            <strong>{round?.clues ?? "—"}</strong>
          </span>
        </div>
      </header>

      <p className="bj-practice-note">
        Everyone gets the same four grids each day, chosen from the date rather than picked by hand. The
        answer stays on the server: a wrong digit is refused and counted, so the mistake tally is what makes
        a shared time worth reading.
      </p>

      {error && (
        <p className="bj-error" role="alert">
          {error}
        </p>
      )}

      <div className="sk-difficulties" role="group" aria-label="Difficulty">
        {SUDOKU_DIFFICULTIES.map((entry) => (
          <button
            key={entry}
            type="button"
            className={clsx("bj-stake", entry === difficulty && "bj-stake-on")}
            disabled={busy}
            onClick={() => { selectSound(); chooseDifficulty(entry); }}
          >
            {entry[0].toUpperCase() + entry.slice(1)}
          </button>
        ))}
      </div>

      <section className="bj-felt hud-felt-plain sk-felt" aria-live="polite" aria-busy={busy}>
        {!round ? (
          <div className="sk-start">
            <p>Today&apos;s {difficulty} grid is waiting.</p>
            <button type="button" className="bj-action bj-action-deal" disabled={busy} onClick={() => { selectSound(); start(); }}>
              {busy ? "Opening…" : "Start the grid"}
            </button>
          </div>
        ) : (
          <>
            <div className="sk-grid" role="grid" aria-label="Sudoku grid">
              {Array.from({ length: SUDOKU_CELLS }, (_, index) => {
                const given = round.puzzle[index];
                const entry = round.entries[index];
                const value = given || entry;
                const isSelected = selected === index;
                const peer =
                  selected !== null &&
                  (rowOf(selected) === rowOf(index) ||
                    columnOf(selected) === columnOf(index) ||
                    boxOf(selected) === boxOf(index));
                const twin = selected !== null && value !== 0 && value === (round.puzzle[selected] || round.entries[selected]);

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
                      // The 3x3 boxes are drawn with thicker edges on the
                      // cells themselves -- a grid this small cannot afford
                      // separate box elements.
                      columnOf(index) % 3 === 0 && "sk-cell-box-left",
                      rowOf(index) % 3 === 0 && "sk-cell-box-top",
                      columnOf(index) === SUDOKU_SIZE - 1 && "sk-cell-box-right",
                      rowOf(index) === SUDOKU_SIZE - 1 && "sk-cell-box-bottom",
                    )}
                    disabled={solved}
                    aria-label={`Row ${rowOf(index) + 1}, column ${columnOf(index) + 1}${value ? `, ${value}` : ", empty"}`}
                    onClick={() => { tapSound(); setSelected(index); }}
                  >
                    {value || ""}
                  </button>
                );
              })}
            </div>

            {solved ? (
              <div className="sk-done">
                <strong>
                  Solved in {formatDuration(round.elapsedMs ?? elapsed)} · {round.mistakes}{" "}
                  {round.mistakes === 1 ? "mistake" : "mistakes"}
                </strong>
                {shareText && (
                  <ShareResultButton
                    text={shareText}
                    title={puzzleShareTitle("sudoku", round.puzzleNumber)}
                  />
                )}
                {nextPuzzleAt !== null && <NextPuzzleCountdown deadline={nextPuzzleAt} />}
              </div>
            ) : (
              <div className="sk-pad" role="group" aria-label="Digits">
                {DIGITS.map((digit) => {
                  const complete = digitCounts[digit] >= SUDOKU_SIZE;
                  return (
                    <button
                      key={digit}
                      type="button"
                      className={clsx("sk-key", complete && "sk-key-complete")}
                      disabled={busy || selected === null || complete}
                      aria-label={complete ? `${digit}, all placed` : `${digit}`}
                      onClick={() => void fill(digit)}
                    >
                      {digit}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="sk-key sk-key-erase"
                  disabled={busy || selected === null}
                  aria-label="Erase"
                  onClick={() => void fill(0)}
                >
                  <Eraser size={15} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        )}

        {state?.profile && (
          <div className="bj-hand-head sk-player-head">
            <ProfileAvatar
              profile={{ ...state.profile, avatarCosmetic: state.profile.equipped.avatar2d }}
            />
            <span className="bj-hand-who">
              <span className="bj-hand-label">{state.profile.displayName}</span>
              <span className="bj-hand-caption">
                {solved ? "Grid cleared" : round ? "In progress" : "Not started"}
              </span>
            </span>
          </div>
        )}
      </section>
    </main>
  );
}

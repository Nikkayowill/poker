"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, Eraser, HelpCircle } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { useActionQueue } from "@/components/shared/use-action-queue";
import { StakePressureNote } from "@/components/arcade/stake-pressure-note";
import { ANTE_UP_TIER_LADDERS, anteUpTierAllowed, maxAnteUpWager } from "@/lib/arcade/ante-up-stakes";
import { STAKE_PRESSURE_STEPS, lowestTierFor, type TierLadder } from "@/lib/arcade/stake-pressure";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { clearedSlotGuesses, placedSlotGuesses } from "@/lib/arcade/puzzles/word-fill-in-grid";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  ANTE_UP_WORD_FILL_IN_TIERS,
  anteUpWordFillInTerms,
  MIN_ANTE_UP_WAGER,
  type AnteUpWordFillInSnapshot,
  type AnteUpWordFillInTier,
} from "@/lib/arcade/ante-up-word-fill-in";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";
import { createRequestSequence } from "@/lib/ui/request-sequence";

/**
 * Ante Up: Word Fill-In. A crossword grid with no clues, filled from a word
 * list. Same request shape as Minesweeper and Nonogram: every move is a
 * request, the server answers with the true board, and the solution never
 * crosses the wire while the attempt is live. Moves made while an earlier one
 * is on the wire queue up and go out in order.
 *
 * Input is tap a slot, then tap a word. Tapping a crossing square a second
 * time flips between its across and down slots. Tapping a word first arms it,
 * and the next slot tapped takes it.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 25_000, 100_000, 500_000] as const;

/** Marathon grids are bigger than this and get more room; see 60-word-fill-in.css. */
const REGULAR_GRID_SIDE = 9;

/** How often the page re-reads a live attempt, so a clock that runs out with nobody tapping still settles. */
const POLL_MS = 3000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

const TIERS: readonly { id: AnteUpWordFillInTier; label: string }[] = [
  { id: "quick", label: "Quick" },
  { id: "marathon", label: "Marathon" },
];

interface AnteUpWordFillInResponse {
  attempt: AnteUpWordFillInSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

const LADDER = ANTE_UP_TIER_LADDERS["word-fill-in"] as TierLadder<AnteUpWordFillInTier>;

function marathonLine(wager: number): string {
  const clock = formatDuration(anteUpWordFillInTerms("marathon", wager).timeLimitMs);
  return `Marathon only: the big 11x11 grid, sixteen words that all cross, on a ${clock} clock.`;
}

/** What each stake band changes, for the lobby note. */
const STAKE_RULES = {
  1: [marathonLine(STAKE_PRESSURE_STEPS[0])],
  2: [marathonLine(STAKE_PRESSURE_STEPS[1])],
  3: [marathonLine(STAKE_PRESSURE_STEPS[2])],
};

/** "Under 10k" style limit for a tier a big stake locks out, or null if no stake does. */
function stakeLimitLabel(id: AnteUpWordFillInTier): string | null {
  const index = LADDER.tiers.indexOf(id);
  const band = LADDER.minTierByPressure.findIndex((min) => min > index);
  if (band <= 0) return null;
  const step = STAKE_PRESSURE_STEPS[band - 1];
  return `Stakes under ${step >= 1_000_000 ? `${step / 1_000_000}M` : `${step / 1000}k`}`;
}

function tierLabel(id: AnteUpWordFillInTier): string {
  return TIERS.find((tier) => tier.id === id)?.label ?? id;
}

function isAcross(cells: readonly number[]): boolean {
  return cells.length > 1 && cells[1] - cells[0] === 1;
}

/** A place or clear waiting its turn. */
type PendingMove =
  | { action: "place"; slot: number; word: string }
  | { action: "clear"; slot: number };

function spelled(guesses: string, cells: readonly number[]): string {
  return cells.map((cell) => guesses[cell]).join("");
}

export function AnteUpWordFillIn() {
  const [tier, setTier] = useState<AnteUpWordFillInTier>("quick");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpWordFillInSnapshot | null>(null);
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [armedWord, setArmedWord] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  // Guards start and resign against a double click, and stops moves once a
  // resign is on the wire. Read ordering and board versions live in
  // `sequence`, which also covers the queued moves.
  const sending = useRef(false);
  const mounted = useRef(true);
  const [sequence] = useState(() => createRequestSequence<AnteUpWordFillInSnapshot>());
  // Set on every mount, not only at creation: a remount (StrictMode, Fast
  // Refresh) would otherwise leave it false and drop every response.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const applyResponse = useCallback((data: Partial<AnteUpWordFillInResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined && sequence.admit(data.attempt)) setAttempt(data.attempt ?? null);
  }, [sequence, setProfile]);

  /** The background poll. Returns a pause in ms after a 429, or null for the normal cadence. */
  const refresh = useCallback(async (): Promise<number | null> => {
    const ticket = sequence.beginRead();
    if (!ticket) return null;
    try {
      const response = await fetch("/api/ante-up-word-fill-in", { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<AnteUpWordFillInResponse>;
      if (!mounted.current || !sequence.acceptRead(ticket)) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [applyResponse, sequence]);

  /** A player action: start or resign. A 409 still paints the true board it carries. */
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
      const data = (await response.json()) as Partial<AnteUpWordFillInResponse> & {
        round?: AnteUpWordFillInSnapshot;
      };
      if (!mounted.current) return;
      if (!response.ok) {
        if (data.round) applyResponse({ attempt: data.round });
        else setError(data.error ?? "That did not go through.");
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
   * Sends one queued move against the newest board. A refusal on a live grid
   * (a slot an earlier move already changed) is skipped, not fatal.
   */
  const sendMove = useCallback(async (move: PendingMove): Promise<boolean> => {
    if (!mounted.current) return false;
    try {
      const response = await fetch("/api/ante-up-word-fill-in/actions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...move, version: sequence.version() }),
      });
      const data = (await response.json()) as Partial<AnteUpWordFillInResponse> & {
        round?: AnteUpWordFillInSnapshot;
      };
      if (!mounted.current) return false;
      if (response.ok) {
        applyResponse(data);
        return true;
      }
      if (!data.round) {
        setError(data.error ?? "That did not go through.");
        return false;
      }
      applyResponse({ attempt: data.round });
      return data.round.status === "active";
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
      return false;
    }
  }, [applyResponse, sequence]);

  const moves = useActionQueue<PendingMove>(sequence, sendMove);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Self-rescheduling poll, so a slow response never leaves two in flight.
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

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const board = attempt?.board ?? null;
  const slots = useMemo(() => board?.slots ?? [], [board]);

  // The server's letters with every queued move written on top. A place or
  // clear follows fixed rules, so the grid can show it before it lands.
  const guesses = useMemo(() => {
    let next = board?.guesses ?? "";
    for (const move of moves.pending) {
      next = move.action === "place"
        ? placedSlotGuesses(next, slots, move.slot, move.word)
        : clearedSlotGuesses(next, slots, move.slot);
    }
    return next;
  }, [board, slots, moves.pending]);

  /**
   * Where a word ends against another open square. The templates run short
   * across words right up to a long down word, so without these bars a row
   * reads as one long gap. Same idea as a barred crossword.
   */
  const bars = useMemo(() => {
    const right = new Set<number>();
    const below = new Set<number>();
    if (!board) return { right, below };
    const size = attempt?.gridSize ?? 0;
    const joined = new Set<string>();
    for (const cells of slots) {
      for (let i = 1; i < cells.length; i += 1) joined.add(`${cells[i - 1]}-${cells[i]}`);
    }
    const open = (index: number) => board.pattern[index] !== "#";
    for (let index = 0; index < board.pattern.length; index += 1) {
      if (!open(index)) continue;
      if ((index + 1) % size !== 0 && open(index + 1) && !joined.has(`${index}-${index + 1}`)) {
        right.add(index);
      }
      if (index + size < board.pattern.length && open(index + size) && !joined.has(`${index}-${index + size}`)) {
        below.add(index);
      }
    }
    return { right, below };
  }, [board, slots, attempt?.gridSize]);

  /** Which slots currently spell a list word; those words are struck through. */
  const placedWords = useMemo(() => {
    const placed = new Set<string>();
    if (!board) return placed;
    const listed = new Set(board.words);
    for (const cells of slots) {
      const word = spelled(guesses, cells);
      if (listed.has(word)) placed.add(word);
    }
    return placed;
  }, [board, slots, guesses]);

  /**
   * Squares in a full slot that spells no list word. Placing a word writes
   * over its crossings, so this is how a player sees which word it broke.
   */
  const clashCells = useMemo(() => {
    const clash = new Set<number>();
    if (!board || board.status !== "active") return clash;
    const listed = new Set(board.words);
    for (const cells of slots) {
      const word = spelled(guesses, cells);
      if (/^[A-Z]+$/.test(word) && !listed.has(word)) cells.forEach((cell) => clash.add(cell));
    }
    return clash;
  }, [board, slots, guesses]);

  const wordsByLength = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const word of board?.words ?? []) {
      const group = groups.get(word.length) ?? [];
      group.push(word);
      groups.set(word.length, group);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [board]);

  // Only a live grid shows a selection, or the highlight would sit on the answers.
  const selectedCells = active && selected !== null ? slots[selected] ?? null : null;
  const selectedSet = useMemo(() => new Set(selectedCells ?? []), [selectedCells]);

  const start = () => {
    if (sending.current || !anteUpTierAllowed("word-fill-in", tier, wager)) return;
    setSelected(null);
    setArmedWord(null);
    moves.clear();
    void send("/api/ante-up-word-fill-in", { tier, wager });
  };

  // Queued rather than refused while an earlier move is on the wire, so quick
  // taps all land in order.
  const place = (slot: number, word: string) => {
    if (!board || !active || sending.current) return;
    const cells = slots[slot];
    if (!cells || cells.length !== word.length) return;
    setArmedWord(null);
    if (spelled(guesses, cells) === word) return;
    play("ui");
    setSelected(null);
    moves.push({ action: "place", slot, word });
  };

  const clearSlot = () => {
    if (!board || !active || selected === null || sending.current) return;
    const slot = selected;
    if (clearedSlotGuesses(guesses, slots, slot) === guesses) return;
    tapSound();
    setSelected(null);
    moves.push({ action: "clear", slot });
  };

  /** Tap a square: pick a slot through it, flipping across/down on a second tap. */
  const tapCell = (index: number) => {
    if (!board || !active) return;
    let through = slots
      .map((cells, slot) => ({ cells, slot }))
      .filter(({ cells }) => cells.includes(index));
    if (armedWord) {
      const fitting = through.filter(({ cells }) => cells.length === armedWord.length);
      if (fitting.length > 0) through = fitting;
    }
    if (through.length === 0) return;
    // Across first, unless across is what is already selected here.
    through.sort((a, b) => Number(isAcross(b.cells)) - Number(isAcross(a.cells)));
    const current = through.findIndex(({ slot }) => slot === selected);
    const next = through[(current + 1) % through.length].slot;

    if (armedWord && slots[next].length === armedWord.length) {
      place(next, armedWord);
      return;
    }
    tapSound();
    setArmedWord(null);
    setSelected(next);
  };

  const tapWord = (word: string) => {
    if (!active) return;
    if (selected !== null && slots[selected]?.length === word.length) {
      place(selected, word);
      return;
    }
    tapSound();
    setSelected(null);
    setArmedWord((current) => (current === word ? null : word));
  };

  const resign = () => {
    if (sending.current || moves.queued().length > 0) return;
    void send("/api/ante-up-word-fill-in/actions", { action: "resign" });
  };
  const playAgain = () => {
    setAttempt(null);
    setSelected(null);
    setArmedWord(null);
  };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("word-fill-in", tier);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const tierConfig = anteUpWordFillInTerms(tier, wager);
  const tierAllowed = anteUpTierAllowed("word-fill-in", tier, wager);

  // A bigger stake moves the pick up to the easiest grid it still allows.
  const changeWager = (next: number) => {
    setWager(next);
    if (!anteUpTierAllowed("word-fill-in", tier, next)) setTier(lowestTierFor(LADDER, next));
  };

  // Capped at the tier's limit as well as floored at zero, so network latency
  // never shows more time than the tier allows.
  const deadline = attempt?.expiresAt ? Date.parse(attempt.expiresAt) : null;
  const displayedMs =
    deadline !== null && attempt
      ? Math.min(attempt.timeLimitMs, Math.max(0, deadline - now))
      : attempt?.timeLimitMs ?? 0;

  // A timeout settles on the next read, a few seconds past the limit; never show more than the limit.
  const elapsedMs = attempt ? Math.min(attempt.elapsedMs, attempt.timeLimitMs) : 0;

  // On a loss the answer shows through in the empty or wrong squares. On a
  // win the player's own grid is the answer, even if it fits the list a
  // different way than the one it was built from.
  const revealAnswer = settled && attempt.status !== "won" && board?.solution;

  const selectionHint = (() => {
    if (!board || !selectedCells) {
      return armedWord
        ? `${armedWord}: tap a ${armedWord.length}-letter slot to put it there.`
        : "Tap a slot in the grid, then tap a word to drop it in.";
    }
    const pattern = spelled(guesses, selectedCells).replace(/_/g, "·");
    const broken = /^[A-Z]+$/.test(pattern) && !board.words.includes(pattern);
    return `${isAcross(selectedCells) ? "Across" : "Down"}, ${selectedCells.length} letters: ${pattern}${broken ? ", not a list word" : ""}`;
  })();

  return (
    <main className="duel-shell ante-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink
            confirmLeave={active && (attempt?.wager ?? 0) > 0}
            confirmMessage="Your wager is still in play on this grid. Leaving won't give it up. Come back to finish, or use Give up to settle it now."
          />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {profile ? (profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()) : "…"}
          </strong>
        </span>
      </header>

      {showHelp && (
        <HowToPlayModal title="Word Fill-In" onClose={() => setShowHelp(false)}>
          <p>
            It is a crossword with no clues. You get the list of every word in the grid, and each
            word goes in exactly once. Word length and the letters where words cross are all you
            have to go on.
          </p>
          <p>
            Tap a slot in the grid, then tap a word from the list to drop it in. Tap a crossing
            square again to switch between across and down. Use Clear to empty a slot. A word
            dropped in writes over the squares it crosses, and red letters mark a slot that no
            longer spells a word from the list.
          </p>
          <p>
            Wager Gold or play free. The clock starts when you place your first word. Fill the
            whole grid before it runs out and you win. Run out of time, or give up, and the wager
            is gone.
          </p>
        </HowToPlayModal>
      )}

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {!attempt || !board ? (
        <section className="puzzle-summary ante-lobby-card">
          <div className="ante-lobby-heading">
            <h1>Word Fill-In, against the clock</h1>
            <p>
              Every word on the list fits the grid exactly once, and there are no clues. Wager on
              your own reading of it and cash out up to {ANTE_UP_WORD_FILL_IN_TIERS.marathon.multiplier}x.
            </p>
          </div>

          <div className="ante-difficulties" role="group" aria-label="Grid">
            {TIERS.map((entry) => {
              const entryTier = anteUpWordFillInTerms(entry.id, wager);
              const locked = !anteUpTierAllowed("word-fill-in", entry.id, wager);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={clsx("ante-difficulty", entry.id === tier && "ante-difficulty-active")}
                  aria-pressed={entry.id === tier}
                  disabled={locked}
                  onClick={() => {
                    selectSound();
                    setTier(entry.id);
                    setWager((current) => Math.min(current, maxAnteUpWager("word-fill-in", entry.id)));
                  }}
                >
                  <strong>{entry.label}</strong>
                  <span>{entryTier.grid === "large" ? "Big 11×11 grid" : "9×9 grid"}</span>
                  <span>{formatDuration(entryTier.timeLimitMs)} · {entryTier.multiplier}x</span>
                  {locked && <span className="wf-tier-locked">{stakeLimitLabel(entry.id)}</span>}
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
            onChange={(next) => { selectSound(); changeWager(next); }}
          />
          <StakePressureNote wager={wager} rules={STAKE_RULES} />
          <p className="puzzle-verdict">
            {wager === 0
              ? "Free practice. No payout on a solve, but nothing at risk either."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : `Fill the grid inside ${formatDuration(tierConfig.timeLimitMs)} and cash out ${Math.round(wager * tierConfig.multiplier).toLocaleString()} Gold (${tierConfig.multiplier}x). Run out of time and the wager is gone.`}
          </p>

          <button
            type="button"
            className="puzzle-share-button"
            disabled={busy || !loaded || !canAfford || !tierAllowed}
            onClick={() => { selectSound(); start(); }}
          >
            <Coins size={15} aria-hidden="true" />
            {!loaded ? "…" : !tierAllowed ? "Pick a bigger grid" : !canAfford ? "Not enough Gold" : busy ? "Dealing…" : "Ante up"}
          </button>
          {loaded && insufficientGold && <GoldShortfallHint needed={wager} compact />}
        </section>
      ) : (
        <div className="duel-match ante-match wf-match">
          <div className="duel-scoreline ante-scoreline wf-scoreline">
            <span className="wf-count" aria-label={`${placedWords.size} of ${board.words.length} words placed`}>
              <strong>{placedWords.size}</strong>/{board.words.length}
            </span>
            <span className="ante-clock" aria-live="polite">
              {active ? formatDuration(displayedMs) : formatDuration(elapsedMs)}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {/* While live, what a solve pays; payout itself stays 0 until the win settles. */}
              {attempt.wager > 0 && (
                <small>
                  → {(active ? Math.round(attempt.wager * attempt.multiplier) : attempt.payout).toLocaleString()}
                </small>
              )}
            </span>
          </div>

          <div className="wf-play" aria-busy={busy || moves.pending.length > 0}>
            <div
              className={clsx("wf-grid", attempt.gridSize > REGULAR_GRID_SIDE && "wf-grid-large")}
              role="group"
              aria-label="Word grid"
              style={{ "--wf-size": attempt.gridSize } as React.CSSProperties}
            >
              {[...board.pattern].map((cell, index) => {
                const row = Math.floor(index / attempt.gridSize) + 1;
                const column = (index % attempt.gridSize) + 1;
                if (cell === "#") {
                  return <span key={index} className="wf-cell wf-cell-black" aria-hidden="true" />;
                }
                const guess = guesses[index];
                const letter = /[A-Z]/.test(guess) ? guess : "";
                // Written by a move still on the wire; the server has not confirmed it yet.
                const unconfirmed = guess !== board.guesses[index];
                const answer = revealAnswer ? board.solution?.[index] ?? "" : "";
                const wrong = Boolean(answer) && letter !== answer;
                return (
                  <button
                    key={index}
                    type="button"
                    className={clsx(
                      "wf-cell",
                      selectedSet.has(index) && "wf-cell-selected",
                      bars.right.has(index) && "wf-bar-right",
                      bars.below.has(index) && "wf-bar-below",
                      wrong && "wf-cell-revealed",
                      clashCells.has(index) && "wf-cell-clash",
                      unconfirmed && "wf-cell-pending",
                    )}
                    disabled={!active}
                    aria-label={`Row ${row}, column ${column}, ${letter || "empty"}`}
                    onClick={() => tapCell(index)}
                  >
                    {wrong ? answer : letter}
                  </button>
                );
              })}
            </div>

            <div className="wf-side">
              {settled ? (
                <div className={clsx("duel-result wf-result", attempt.status === "won" && "duel-result-won")}>
                  <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
                  <strong>
                    {attempt.status === "won"
                      ? "Grid filled"
                      : attempt.status === "timed-out"
                        ? "Time's up"
                        : "Gave up"}
                  </strong>
                  <span>
                    {formatDuration(elapsedMs)} · {tierLabel(attempt.tier)} · {placedWords.size} of{" "}
                    {board.words.length} words
                  </span>
                  {revealAnswer && <span>Red letters show the answers you missed.</span>}
                  <span className="duel-result-gold">{result.label}</span>
                  <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
                </div>
              ) : (
                <div className="wf-toolbar">
                  <p className="ms-hint wf-hint" aria-live="polite">{selectionHint}</p>
                  <button
                    type="button"
                    className="wf-clear"
                    disabled={!selectedCells || selectedCells.every((cell) => !/[A-Z]/.test(guesses[cell]))}
                    onClick={clearSlot}
                  >
                    <Eraser size={14} aria-hidden="true" /> Clear
                  </button>
                </div>
              )}

              {/* Groups sit inline with a short length tag, so the whole list stays
                  a few rows tall and fits under the grid on a phone. */}
              <div className={clsx("wf-words", !active && "wf-words-settled")} aria-label="Word list">
                {wordsByLength.map(([length, words]) => (
                  <section key={length} className="wf-group" aria-label={`${length} letters`}>
                    <h2 aria-hidden="true">{length}</h2>
                    {words.map((word) => {
                      const placed = placedWords.has(word);
                      const fits = selectedCells === null || selectedCells.length === word.length;
                      const armed = active && armedWord === word;
                      return (
                        <button
                          key={word}
                          type="button"
                          className={clsx("wf-word", placed && "wf-word-placed", armed && "wf-word-armed")}
                          // Not disabled while a move is in flight: that dimmed the whole
                          // list on every tap. A tap made then just queues behind it.
                          disabled={!active || !fits}
                          aria-pressed={armed}
                          aria-label={placed ? `${word}, placed` : word}
                          onClick={() => tapWord(word)}
                        >
                          {word}
                        </button>
                      );
                    })}
                  </section>
                ))}
              </div>

              {active && (
                <div className="duel-controls wf-controls">
                  <button
                    type="button"
                    className="duel-resign"
                    disabled={busy || moves.pending.length > 0}
                    onClick={() => void resign()}
                  >
                    Give up
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

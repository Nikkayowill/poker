"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import {
  Coins,
  HelpCircle,
  Lightbulb,
  Lock,
  Move,
  Pencil,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { StakePressureNote } from "@/components/arcade/stake-pressure-note";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { useActionQueue } from "@/components/shared/use-action-queue";
import {
  ANTE_UP_TIER_LADDERS,
  anteUpStakeProblem,
  anteUpTierAllowed,
  maxAnteUpWager,
} from "@/lib/arcade/ante-up-stakes";
import { lowestTierFor, stakePressureThreshold } from "@/lib/arcade/stake-pressure";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { clearSound, comboSound, selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  ANTE_UP_NONOGRAM_TIERS,
  MIN_ANTE_UP_WAGER,
  anteUpNonogramAutoCrossAllowed,
  anteUpNonogramTimeLimitMs,
  type AnteUpNonogramSnapshot,
} from "@/lib/arcade/ante-up-nonogram";
import {
  MARK_CROSSED,
  MARK_FILLED,
  MARK_UNKNOWN,
  NONOGRAM_DIFFICULTIES,
  SOLUTION_FILLED,
  isNonogramDifficulty,
  nonogramClueProgress,
  type NonogramDifficulty,
  type NonogramMark,
} from "@/lib/arcade/puzzles/nonogram";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";
import { createRequestSequence } from "@/lib/ui/request-sequence";

/**
 * Ante Up: Nonogram, the solo half of Ante Up.
 *
 * Same request shape as Ante Up: Minesweeper (the server says what happened,
 * the answer never crosses the wire while the round is live) and the same
 * wager step lib/pvp's duel lobby uses. Reuses `.duel-*` and `.ante-*` classes
 * rather than a third copy of either; see 50-nonogram.css's header.
 *
 * The three things that make this feel like a picross rather than a grid of
 * buttons, and the reasoning behind each:
 *
 *   - **Dragging paints.** A pointer-down decides one operation from the
 *     square it lands on, the drag locks to whichever axis it moves along
 *     first, and letting go sends the whole run as one `stroke` request. Axis
 *     locking is not a nicety: a free-form drag across a board wanders, and
 *     wandering costs mistakes. Every square is *not* a round trip -- a 25x25
 *     board is 625 of them.
 *
 *   - **The drag paints immediately.** Marks land under the finger and the
 *     server's answer replaces them when it arrives. `pendingStrokes` holds
 *     the strokes still in flight, newest applied last, so the board on screen
 *     is always the server's truth plus whatever has not come back yet. A
 *     wrong fill turns into a cross when the response lands, which is the
 *     honest thing to show: the client cannot know it was wrong, because it
 *     does not have the answer.
 *
 *   - **Strokes go out one at a time.** They are queued rather than fired in
 *     parallel, because each one is pinned to the board version before it and
 *     two in flight would race for the same version and lose. A refusal drops
 *     the whole queue and repaints from what the server sent back, rather than
 *     replaying strokes against a board that has moved.
 *
 * A clue number dims once the player's own marks have pinned that particular
 * run down. That is `nonogramClueProgress`, which lives in the engine rather
 * than here so it can be tested; it reads the marks and the clues alone, never
 * the answer, so it leaks nothing -- it is the pencil stroke a person puts
 * through a finished clue on paper.
 */

/** StakePicker drops the picks above the chosen board's ceiling; see lib/arcade/ante-up-stakes.ts. */
const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 25_000, 100_000, 500_000] as const;

/** How often the shell re-reads a live attempt: catches the clock running out with nothing marked. */
const POLL_MS = 3000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Square size per board width, in px, before zoom.
 *
 * Bigger boards get smaller squares, but only down to a floor a thumb can
 * still hit; past that the frame scrolls and the zoom control takes over.
 * Every rung is a multiple of five wide, which is what lets the heavier
 * every-fifth gridline (the convention every paper nonogram uses to make
 * counting possible) fall on a real boundary rather than an arbitrary one.
 */
const CELL_PX: Readonly<Record<number, number>> = { 5: 46, 10: 34, 15: 28, 20: 26, 25: 24 };

/** Zoom rungs, smallest first. 1 is the size CELL_PX names; below it is "see the whole thing". */
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5] as const;
const DEFAULT_ZOOM_INDEX = ZOOM_STEPS.indexOf(1);

/** What the pointer puts down. Pan is not a mark: it hands the drag back to the scroller. */
type NonogramTool = "fill" | "cross" | "pan";

/** A stroke the player has made that the server has not confirmed yet. */
interface PendingStroke {
  kind: "stroke";
  id: number;
  indexes: number[];
  mark: NonogramMark;
}

/**
 * Anything that moves the board goes through the one queue, so Undo and Hint
 * wait for the strokes ahead of them instead of racing them for a version.
 */
type PendingAction = PendingStroke | { kind: "undo"; id: number } | { kind: "hint"; id: number };

interface AnteUpNonogramResponse {
  attempt: AnteUpNonogramSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

function difficultyLabel(id: NonogramDifficulty): string {
  return id[0].toUpperCase() + id.slice(1);
}

/** Where a personal best is kept. Per size, this browser only; nothing here is a leaderboard. */
function bestKey(difficulty: NonogramDifficulty): string {
  return `stackchips:nonogram:best:${difficulty}`;
}

function readBest(difficulty: NonogramDifficulty): number | null {
  try {
    const raw = window.localStorage.getItem(bestKey(difficulty));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeBest(difficulty: NonogramDifficulty, ms: number): void {
  try {
    window.localStorage.setItem(bestKey(difficulty), String(Math.round(ms)));
  } catch {
    // Private browsing, or storage turned off. A lost personal best is not worth a banner.
  }
  for (const listener of bestListeners) listener();
}

/**
 * Personal bests are read as an external store rather than copied into state.
 *
 * They live in localStorage, which React does not own, and the honest way to
 * read something React does not own is `useSyncExternalStore` -- it reads
 * through on every render and has a server snapshot, so nothing has to be
 * mirrored into state by an effect and there is no hydration mismatch to
 * paper over. Writing one notifies, which is the whole subscription.
 */
const bestListeners = new Set<() => void>();

function subscribeBests(listener: () => void): () => void {
  bestListeners.add(listener);
  return () => { bestListeners.delete(listener); };
}

/** A short buzz on a phone that has one. Silent everywhere else, including when the OS says no. */
function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw rather than returning false. Either way, nothing happens.
  }
}

/** "5 min" for whole minutes, "2:30" otherwise. */
function clockLabel(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : formatDuration(ms);
}

function rankedClock(id: NonogramDifficulty): string {
  return clockLabel(ANTE_UP_NONOGRAM_TIERS[id].rankedTimeLimitMs);
}

const NO_AUTO_CROSS_RULE = "Auto-cross is off. Cross your own finished lines.";

/** What each stake band asks of the board, for the lobby note. */
const STAKE_RULES = {
  1: [`Medium board (10×10) or bigger. Medium runs ${rankedClock("medium")}.`],
  2: [`Hard board (15×15) or bigger. Hard runs ${rankedClock("hard")}.`, NO_AUTO_CROSS_RULE],
  3: [
    `Expert (20×20, ${rankedClock("expert")}) or Master (25×25, ${rankedClock("master")}) only.`,
    NO_AUTO_CROSS_RULE,
  ],
} as const;

/** The board a stake needs: the current one if it's still allowed, else the smallest that is. */
function difficultyForStake(current: NonogramDifficulty, wager: number): NonogramDifficulty {
  const ladder = ANTE_UP_TIER_LADDERS.nonogram;
  if (!ladder || anteUpTierAllowed("nonogram", current, wager)) return current;
  const lowest = lowestTierFor(ladder, wager);
  return isNonogramDifficulty(lowest) ? lowest : current;
}

/** "10k" for a board a stake of 10k or more can't be played on. Null if no stake locks it. */
function stakeLockedFrom(difficulty: NonogramDifficulty): string | null {
  const ladder = ANTE_UP_TIER_LADDERS.nonogram;
  if (!ladder) return null;
  const index = ladder.tiers.indexOf(difficulty);
  const band = ([1, 2, 3] as const).find((pressure) => ladder.minTierByPressure[pressure] > index);
  return band ? stakePressureThreshold(band).replace("+", "") : null;
}

/** True when every number in a line is accounted for, so the whole gutter entry can dim. */
function lineDone(entry: readonly boolean[]): boolean {
  return entry.length > 0 && entry.every(Boolean);
}

export function AnteUpNonogram() {
  const [difficulty, setDifficulty] = useState<NonogramDifficulty>("easy");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [autoCross, setAutoCross] = useState(true);
  const [attempt, setAttempt] = useState<AnteUpNonogramSnapshot | null>(null);
  // The persistent shell owns the profile now -- this screen still gets it
  // back from its own attempt-response payload too (unchanged), it just
  // writes into the shared setter instead of a local copy.
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<NonogramTool>("fill");
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [beatBest, setBeatBest] = useState(false);
  // Cells of a row/column a stroke just satisfied (server-confirmed marks
  // only, never the optimistic paint), plus whether more than one line
  // completed on the same stroke.
  const [celebrate, setCelebrate] = useState<readonly number[]>([]);
  const [celebrateCombo, setCelebrateCombo] = useState(false);
  const celebrateTimer = useRef<number | null>(null);
  /** Which lines were already done, so only a false-to-true edge celebrates. */
  const doneLines = useRef<Set<string> | null>(null);

  // Read through to localStorage rather than mirrored into state; see subscribeBests.
  const best = useSyncExternalStore(
    subscribeBests,
    () => readBest(difficulty),
    () => null,
  );
  /** The attempt whose win has already been counted against the personal best. */
  const recordedWin = useRef<string | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  // Tells the shell an attempt is open -- hides the persistent nav chrome,
  // same as every other live-money screen. Not narrowed to `active`: the
  // settled result is still this screen, not the picker.
  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  // Read ordering, board versions and the stroke queue all go through
  // `sequence`, so a poll can never paint an older board over a stroke.
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    if (celebrateTimer.current !== null) window.clearTimeout(celebrateTimer.current);
  }, []);
  const [sequence] = useState(() => createRequestSequence<AnteUpNonogramSnapshot>());

  /**
   * Takes a response, and is the only place the board on screen changes.
   *
   * A won board is recorded here rather than in an effect watching the status,
   * because it is an event -- a win arrives once, in one response -- and
   * watching for it means re-deciding on every render whether it has already
   * been counted. `recordedWin` is that decision, made once per attempt id, so
   * a poll that lands after the win does not re-run it.
   */
  const applyResponse = useCallback((data: Partial<AnteUpNonogramResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt === undefined) return;

    const next = data.attempt ?? null;
    if (!sequence.admit(next)) return;
    if (next && next.status === "won" && recordedWin.current !== next.id) {
      recordedWin.current = next.id;
      const previous = readBest(next.difficulty);
      if (previous === null || next.elapsedMs < previous) {
        writeBest(next.difficulty, next.elapsedMs);
        setBeatBest(previous !== null);
      }
    }
    setAttempt(next);
  }, [sequence, setProfile]);

  /**
   * The background poll: reads the live attempt, sets no busy flag.
   *
   * Returns the pause (in ms) the poll loop should wait before its next tick
   * when the server answered 429, or null for the ordinary POLL_MS cadence.
   */
  const refresh = useCallback(async (): Promise<number | null> => {
    const ticket = sequence.beginRead();
    if (!ticket) return null;
    try {
      const response = await fetch("/api/ante-up-nonogram", { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<AnteUpNonogramResponse>;
      if (!mounted.current || !sequence.acceptRead(ticket)) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [applyResponse, sequence]);

  /** A player-initiated action: start or resign. Undo and hint go through the action queue. */
  const send = useCallback(async (url: string, body: unknown) => {
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
      const data = (await response.json()) as Partial<AnteUpNonogramResponse> & {
        round?: AnteUpNonogramSnapshot;
      };
      if (!mounted.current) return;
      if (!response.ok) {
        // A refused action still carries the true board; paint it, and only
        // raise a banner when the refusal is something the player should see.
        if (data.round) applyResponse({ attempt: data.round });
        if (data.error && !data.round) setError(data.error);
        else if (data.error && response.status !== 409) setError(data.error);
        return;
      }
      applyResponse(data);
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
    } finally {
      done();
      if (mounted.current) setBusy(false);
    }
  }, [applyResponse, sequence]);

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

  /* ------------------------------------------------------------ strokes */

  /**
   * Sends one queued action, pinned to the newest board version. A refusal
   * drops the rest of the queue rather than replaying it, since the board
   * those actions were made against no longer exists.
   */
  const sendAction = useCallback(async (item: PendingAction): Promise<boolean> => {
    if (!mounted.current) return false;
    const body =
      item.kind === "stroke"
        ? { action: "stroke", version: sequence.version(), indexes: item.indexes, mark: item.mark }
        : { action: item.kind, version: sequence.version() };
    try {
      const response = await fetch("/api/ante-up-nonogram/actions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as Partial<AnteUpNonogramResponse> & {
        round?: AnteUpNonogramSnapshot;
      };
      if (!mounted.current) return false;
      if (response.ok && data.attempt) {
        const before = sequence.latest()?.board.mistakes ?? 0;
        applyResponse(data);
        // A buzz and nothing else. lib/audio/manifest.ts maps `lose` to
        // null on purpose -- there is no loss cue in the set -- and
        // play("lose") would be a silent no-op dressed up as feedback.
        // The square turning into a cross is the visual half. A hint's
        // mistake was paid on purpose, so it doesn't buzz.
        if (item.kind === "stroke" && data.attempt.board.mistakes > before) buzz([28, 40, 28]);
        return true;
      }
      if (data.round) applyResponse({ attempt: data.round });
      // A refused stroke's repaint says enough. An undo or hint refused for
      // anything but a stale version (say, no mistakes left) gets a banner.
      if (data.error && (!data.round || (item.kind !== "stroke" && response.status !== 409))) {
        setError(data.error);
      }
      return false;
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
      return false;
    }
  }, [applyResponse, sequence]);

  // Strokes, undos and hints go out one at a time through the shared queue;
  // see lib/ui/request-sequence.ts.
  const { pending, push: pushAction, clear: clearPending } = useActionQueue<PendingAction>(sequence, sendAction);
  const actionId = useRef(0);

  const queueStroke = useCallback((indexes: number[], mark: NonogramMark) => {
    if (indexes.length === 0) return;
    actionId.current += 1;
    pushAction({ kind: "stroke", id: actionId.current, indexes, mark });
  }, [pushAction]);

  const queueAction = useCallback((kind: "undo" | "hint") => {
    actionId.current += 1;
    pushAction({ kind, id: actionId.current });
  }, [pushAction]);

  // A stroke still in the queue will leave something to undo once it lands.
  const strokeQueued = pending.some((item) => item.kind === "stroke");

  /* --------------------------------------------------------------- drag */

  const board = attempt?.board ?? null;
  const size = board?.size ?? 0;

  // The last press's pointer type, so a touch long-press's context menu
  // doesn't mark the square a second time.
  const lastPointerType = useRef<string | null>(null);

  // The drag in progress. `mark` is decided by the square the pointer landed
  // on and never changes mid-drag: a drag is one assertion, not a sequence of
  // independent taps, and re-deciding per square is how a drag across mixed
  // squares turns into a mess.
  const drag = useRef<{
    mark: NonogramMark;
    from: number;
    to: number;
    axis: "row" | "col" | null;
  } | null>(null);
  // The same drag, as state, because the board is rendered from it. The ref is
  // what pointermove reads and writes at screen rate; this is what React sees.
  const [paint, setPaint] = useState<{ cells: readonly number[]; mark: NonogramMark } | null>(null);

  /** The run of squares a drag from `from` to `to` covers, along whichever axis it locked to. */
  const runBetween = useCallback((from: number, to: number, axis: "row" | "col" | null): number[] => {
    if (axis === null || from === to) return [from];
    const cells: number[] = [];
    if (axis === "row") {
      const row = Math.floor(from / size);
      const a = Math.min(from % size, to % size);
      const b = Math.max(from % size, to % size);
      for (let col = a; col <= b; col += 1) cells.push(row * size + col);
    } else {
      const col = from % size;
      const a = Math.min(Math.floor(from / size), Math.floor(to / size));
      const b = Math.max(Math.floor(from / size), Math.floor(to / size));
      for (let row = a; row <= b; row += 1) cells.push(row * size + col);
    }
    return cells;
  }, [size]);

  /**
   * What a press on this square means, given the tool and what is already there.
   *
   * Painting semantics, not toggling-per-square: the first square decides, and
   * the rest of the drag does the same thing. Pressing on a mark the tool
   * would put down means the player is rubbing it out, which is what every
   * drawing tool everywhere does.
   */
  const operationAt = useCallback((index: number, current: string): NonogramMark | null => {
    if (current === MARK_FILLED) return null; // settled; nothing to decide
    if (tool === "cross") return current === MARK_CROSSED ? "clear" : "cross";
    return current === MARK_CROSSED ? "clear" : "fill";
  }, [tool]);

  const beginDrag = useCallback((index: number, current: string) => {
    if (!active || tool === "pan") return;
    const mark = operationAt(index, current);
    if (mark === null) return;
    drag.current = { mark, from: index, to: index, axis: null };
    setPaint({ cells: [index], mark });
    if (mark === "fill") play("ui"); else tapSound();
  }, [active, operationAt, play, tool]);

  const extendDrag = useCallback((index: number) => {
    const current = drag.current;
    if (!current || index === current.to) return;

    // The axis locks the first time the drag leaves the square it started on,
    // and stays locked. A picross drag is always along a line; letting it
    // wander diagonally is how a careless finger spends a mistake budget.
    let axis = current.axis;
    if (axis === null) {
      const dr = Math.abs(Math.floor(index / size) - Math.floor(current.from / size));
      const dc = Math.abs((index % size) - (current.from % size));
      if (dr === 0 && dc === 0) return;
      axis = dc >= dr ? "row" : "col";
    }
    // Off-axis movement is ignored rather than ending the drag: a finger
    // tracking along a row drifts a pixel or two into the row above and
    // snapping back to the locked line is what the player meant.
    if (axis === "row" && Math.floor(index / size) !== Math.floor(current.from / size)) return;
    if (axis === "col" && index % size !== current.from % size) return;

    drag.current = { ...current, axis, to: index };
    setPaint({ cells: runBetween(current.from, index, axis), mark: current.mark });
  }, [runBetween, size]);

  const endDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    setPaint(null);
    if (!current) return;
    queueStroke(runBetween(current.from, current.to, current.axis), current.mark);
  }, [queueStroke, runBetween]);

  useEffect(() => {
    if (!active) return;
    const stop = () => endDrag();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [active, endDrag]);

  /**
   * Which square is under the pointer.
   *
   * Read off the document rather than from a per-cell `pointerenter`, because
   * a touch pointer is captured by the element it started on and never enters
   * any other. This is the one way that works for a finger and a mouse both.
   */
  const onGridPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const cell = target?.closest<HTMLElement>("[data-ng-index]");
    if (!cell) return;
    const index = Number(cell.dataset.ngIndex);
    if (Number.isInteger(index)) extendDrag(index);
  }, [extendDrag]);

  /* ------------------------------------------------------- other actions */

  const start = () => {
    setTool("fill");
    setCursor(0);
    setBeatBest(false);
    clearPending();
    void send("/api/ante-up-nonogram", { difficulty, wager, autoCross });
  };

  // Queued behind any strokes still in flight, so they run on the board those
  // strokes leave rather than a version from before them.
  const undo = () => {
    if (!attempt || !active || !(board?.canUndo || strokeQueued)) return;
    tapSound();
    queueAction("undo");
  };

  const hint = () => {
    if (!attempt || !active) return;
    selectSound();
    queueAction("hint");
  };

  const resign = () => void send("/api/ante-up-nonogram/actions", { action: "resign" });
  const playAgain = () => {
    setAttempt(null);
    setTool("fill");
    setBeatBest(false);
    clearPending();
  };

  /* ------------------------------------------------------------ derived */

  // The server's board, plus every stroke still in flight, oldest applied
  // first. A pending fill is shown as a fill even though the client cannot
  // know it is right; the response is what corrects it, and it arrives in
  // well under the time it takes to notice.
  const marks = useMemo(() => {
    if (!board) return "";
    if (pending.length === 0 && paint === null) return board.marks;
    const cells = [...board.marks];
    const apply = (indexes: readonly number[], mark: NonogramMark) => {
      for (const index of indexes) {
        if (cells[index] === MARK_FILLED) continue;
        // Mirrors the engine's own guard: a fill stroke merely dragging across
        // a crossed square must not paint over it locally either, or the
        // preview shows something the server is about to refuse.
        if (mark === "fill" && cells[index] === MARK_CROSSED) continue;
        cells[index] = mark === "fill" ? MARK_FILLED : mark === "cross" ? MARK_CROSSED : MARK_UNKNOWN;
      }
    };
    // Only strokes are drawn ahead of time. What an undo or hint changes is
    // the server's to say, so the board waits for its answer.
    for (const item of pending) if (item.kind === "stroke") apply(item.indexes, item.mark);
    if (paint) apply(paint.cells, paint.mark);
    return cells.join("");
  }, [board, pending, paint]);

  const progress = useMemo(
    () => (board ? nonogramClueProgress(marks, board.size, board.clues) : null),
    [board, marks],
  );

  const filled = useMemo(() => {
    let count = 0;
    for (const mark of marks) if (mark === MARK_FILLED) count += 1;
    return count;
  }, [marks]);

  // A line (row or column) the server's own marks now satisfy, checked
  // against server truth only so an optimistic fill that merely looks
  // complete before the server confirms it never celebrates early.
  useEffect(() => {
    if (!board) {
      doneLines.current = null;
      return;
    }
    const trueProgress = nonogramClueProgress(board.marks, board.size, board.clues);
    const now = new Set<string>();
    for (let row = 0; row < board.size; row += 1) if (lineDone(trueProgress.rows[row])) now.add(`r${row}`);
    for (let col = 0; col < board.size; col += 1) if (lineDone(trueProgress.cols[col])) now.add(`c${col}`);

    const before = doneLines.current;
    doneLines.current = now;
    if (!before) return; // First read of a fresh attempt; nothing "just" happened.

    const newlyDone = [...now].filter((key) => !before.has(key));
    if (newlyDone.length === 0) return;

    const cells = new Set<number>();
    for (const key of newlyDone) {
      const n = Number(key.slice(1));
      if (key[0] === "r") for (let col = 0; col < board.size; col += 1) cells.add(n * board.size + col);
      else for (let row = 0; row < board.size; row += 1) cells.add(row * board.size + n);
    }
    const isCombo = newlyDone.length > 1;
    if (isCombo) comboSound(); else clearSound();
    setCelebrate(Array.from(cells).sort((a, b) => a - b));
    setCelebrateCombo(isCombo);
    if (celebrateTimer.current !== null) window.clearTimeout(celebrateTimer.current);
    celebrateTimer.current = window.setTimeout(() => {
      celebrateTimer.current = null;
      if (mounted.current) {
        setCelebrate([]);
        setCelebrateCombo(false);
      }
    }, 500);
  }, [board]);

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("nonogram", difficulty);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  // Narrower than !canAfford; see ante-up-sudoku.tsx's own note on the same check.
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const tier = ANTE_UP_NONOGRAM_TIERS[difficulty];
  const stakeProblem = anteUpStakeProblem("nonogram", difficulty, wager);
  const autoCrossAllowed = anteUpNonogramAutoCrossAllowed(wager);

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
  const running = deadline !== null && active;
  // A timeout is settled by whichever read comes first after the deadline, so
  // the stored elapsed time can run far past the limit. Show the limit.
  const finalMs = attempt ? Math.min(attempt.elapsedMs, attempt.timeLimitMs) : 0;

  const zoom = ZOOM_STEPS[zoomIndex];
  const cellPx = Math.round((CELL_PX[size] ?? 24) * zoom);
  const cursorRow = size > 0 ? Math.floor(cursor / size) : 0;
  const cursorCol = size > 0 ? cursor % size : 0;

  /** Arrow keys walk the board; the roving tabindex means only one cell is ever in the tab order. */
  const onGridKeyDown = (event: React.KeyboardEvent) => {
    if (!board) return;
    const moves: Record<string, number> = {
      ArrowUp: -size,
      ArrowDown: size,
      ArrowLeft: -1,
      ArrowRight: 1,
    };
    const delta = moves[event.key];
    if (delta !== undefined) {
      const next = cursor + delta;
      const sameRow = Math.abs(delta) === 1 && Math.floor(next / size) === Math.floor(cursor / size);
      if (next < 0 || next >= size * size || (Math.abs(delta) === 1 && !sameRow)) return;
      event.preventDefault();
      setCursor(next);
      const cell = document.querySelector<HTMLElement>(`[data-ng-index="${next}"]`);
      cell?.focus();
      return;
    }
    // Enter and Space are deliberately not handled here: the cell is a real
    // <button>, so the browser turns them into a click, and the cell's own
    // onClick takes it. Claiming them here would double up.
    if (event.key.toLowerCase() === "x" && active) {
      event.preventDefault();
      const mark = marks[cursor] === MARK_CROSSED ? "clear" : "cross";
      if (marks[cursor] !== MARK_FILLED) { tapSound(); queueStroke([cursor], mark); }
      return;
    }
    if (event.key.toLowerCase() === "u" && active) {
      event.preventDefault();
      undo();
    }
  };

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
            then one more, somewhere along its length. Work out where they have to sit, fill
            them in, and a picture comes out.
          </p>
          <p>
            Tap a square to fill it, or <strong>drag to paint a whole run at once</strong> —
            the drag locks to the row or column you started along. Switch to Cross to mark
            squares you have worked out are empty; crosses are your own notation, are never
            scored, and can be rubbed out by dragging back over them. A clue number dims once
            your marks have pinned that run down, and finished lines cross themselves off
            unless you turned that off before dealing.
          </p>
          <p>
            Only a wrong <em>fill</em> costs you, and a drag that runs past the end of a run
            stops there — one bad drag is one mistake, not ten. Every board here can be
            finished by logic alone, so nothing comes down to a guess, and the mistake budget
            is small because of it. A hint fills in one square of the picture and costs a
            mistake; you cannot spend your last one on it. Undo takes back your last stroke,
            but never a square the board has already proved.
          </p>
          <p>
            The clock starts on your first square. Fill every square in the picture before it
            runs out and you win; run out of time, spend the budget, or resign, and the wager
            is gone. Bigger boards run a longer clock, allow more mistakes and pay more on a
            win. Bigger stakes need bigger boards: 10k and up plays Medium or bigger, 100k Hard
            or bigger, and 1M Expert or Master. From 10k the clocks are tighter, and from 100k
            finished lines are not crossed for you.
          </p>
        </HowToPlayModal>
      )}

      {error && (
        <div className="duel-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {!attempt || !board || !progress ? (
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
              const locked = !anteUpTierAllowed("nonogram", entry.id, wager);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={clsx(
                    "ante-difficulty",
                    entry.id === difficulty && "ante-difficulty-active",
                  )}
                  aria-pressed={entry.id === difficulty}
                  disabled={locked}
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
                  {locked ? (
                    <span className="ante-difficulty-lock">
                      <Lock size={10} aria-hidden="true" /> Under {stakeLockedFrom(entry.id)} stakes
                    </span>
                  ) : (
                    <span>{clockLabel(anteUpNonogramTimeLimitMs(entry.id, wager))} · {entryTier.multiplier}x</span>
                  )}
                </button>
              );
            })}
          </div>

          {best !== null && (
            <p className="ng-best">
              Your best {difficultyLabel(difficulty)}: <strong>{formatDuration(best)}</strong>
            </p>
          )}

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

          <label className={clsx("ng-option", !autoCrossAllowed && "ng-option-off")}>
            <input
              type="checkbox"
              checked={autoCross && autoCrossAllowed}
              disabled={!autoCrossAllowed}
              onChange={(event) => { selectSound(); setAutoCross(event.target.checked); }}
            />
            <span>
              <strong>Cross finished lines for me</strong>
              <small>
                {autoCrossAllowed
                  ? "Once your fills satisfy a line, the rest of it is crossed off. Turn it off for the paper experience."
                  : "Off at 100k and up. You cross your own lines, as on paper."}
              </small>
            </span>
          </label>

          <p className="puzzle-verdict">
            {wager === 0
              ? "Free practice — no payout on a clear, but nothing at risk either."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : stakeProblem
                  ? stakeProblem
                  : wager > ceiling
                    ? `${difficultyLabel(difficulty)} caps at ${ceiling.toLocaleString()} Gold a wager. Step up a size to stake more.`
                    : `Finish ${difficultyLabel(difficulty)} inside ${clockLabel(anteUpNonogramTimeLimitMs(difficulty, wager))} and cash out ${Math.round(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Spend the mistake budget, or run out of time, and the wager is gone.`}
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
                ? "Pick a bigger board"
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
        <div className="duel-match ante-match ng-match">
          <div className="duel-scoreline ante-scoreline ng-scoreline">
            <span
              className={clsx("ng-mistakes", board.mistakes > 0 && "ng-mistakes-spent")}
              aria-label={`${board.mistakeLimit - board.mistakes} mistakes left`}
            >
              <X size={13} aria-hidden="true" />
              <strong>{board.mistakeLimit - board.mistakes}</strong>
            </span>
            <span
              className={clsx(
                "ante-clock",
                running && displayedMs < 60_000 && "ng-clock-low",
              )}
              aria-live="polite"
            >
              {active ? formatDuration(displayedMs) : formatDuration(finalMs)}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {attempt.payout.toLocaleString()}</small>}
            </span>
          </div>

          <div
            className="ng-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={board.filledTotal}
            aria-valuenow={filled}
            aria-label="Squares of the picture filled in"
          >
            <span style={{ width: `${(filled / Math.max(1, board.filledTotal)) * 100}%` }} />
          </div>

          <div className={clsx("ng-frame", tool === "pan" && "ng-frame-panning")}>
            {/* Flex rows rather than one CSS grid: the clue gutters are not
                cells, and a grid would need every row's clue block to be a
                span the same way the board's are. Each row is a fixed-width
                strip, so the columns line up by construction. The two gutter
                depths are the longest clue in either direction, measured
                rather than guessed -- a fixed gutter either clips a busy line
                or wastes half the screen on a quiet one. */}
            <div
              className={clsx("ng-grid", tool === "pan" && "ng-grid-pan", celebrateCombo && "ng-grid-combo")}
              role="grid"
              aria-label={`Nonogram board, ${board.size} by ${board.size}`}
              onPointerMove={onGridPointerMove}
              onKeyDown={onGridKeyDown}
              style={
                {
                  "--ng-size": board.size,
                  "--ng-cell": `${cellPx}px`,
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
                      lineDone(progress.cols[col]) && "ng-clue-done",
                      col === cursorCol && "ng-clue-lit",
                      (col + 1) % 5 === 0 && col + 1 < board.size && "ng-major-col",
                    )}
                    aria-hidden="true"
                  >
                    {clue.length === 0
                      ? <span className="ng-run-done">0</span>
                      : clue.map((run, i) => (
                          <span key={i} className={clsx(progress.cols[col][i] && "ng-run-done")}>{run}</span>
                        ))}
                  </div>
                ))}
              </div>

              {board.clues.rows.map((clue, row) => (
                <div className="ng-row" key={`row-${row}`} role="row">
                  <div
                    className={clsx(
                      "ng-clue ng-clue-row",
                      lineDone(progress.rows[row]) && "ng-clue-done",
                      row === cursorRow && "ng-clue-lit",
                      (row + 1) % 5 === 0 && row + 1 < board.size && "ng-major-row",
                    )}
                    aria-hidden="true"
                  >
                    {clue.length === 0
                      ? <span className="ng-run-done">0</span>
                      : clue.map((run, i) => (
                          <span key={i} className={clsx(progress.rows[row][i] && "ng-run-done")}>{run}</span>
                        ))}
                  </div>

                  {Array.from({ length: board.size }, (_, col) => {
                    const index = row * board.size + col;
                    const cell = marks[index];
                    // Only ever read once the round is over, when the server
                    // has handed the answer over; null while it is live.
                    const missed =
                      board.solution !== null &&
                      board.solution[index] === SOLUTION_FILLED &&
                      cell !== MARK_FILLED;
                    const celebrateOrder = celebrate.indexOf(index);

                    return (
                      <button
                        key={index}
                        type="button"
                        role="gridcell"
                        data-ng-index={index}
                        tabIndex={index === cursor ? 0 : -1}
                        className={clsx(
                          "ng-cell",
                          cell === MARK_FILLED && "ng-cell-filled",
                          cell === MARK_CROSSED && "ng-cell-crossed",
                          cell === MARK_UNKNOWN && "ng-cell-blank",
                          missed && "ng-cell-missed",
                          active && (row === cursorRow || col === cursorCol) && "ng-cell-lit",
                          (col + 1) % 5 === 0 && col + 1 < board.size && "ng-major-col",
                          (row + 1) % 5 === 0 && row + 1 < board.size && "ng-major-row",
                          celebrateOrder !== -1 && "ng-cell-complete",
                        )}
                        style={celebrateOrder !== -1 ? ({ "--ng-complete-i": celebrateOrder } as React.CSSProperties) : undefined}
                        disabled={!active}
                        aria-label={
                          `Row ${row + 1}, column ${col + 1}, ` +
                          (cell === MARK_FILLED ? "filled" : cell === MARK_CROSSED ? "crossed off" : "blank")
                        }
                        onFocus={() => setCursor(index)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          // A touch long-press fires this too, after the press
                          // already started a drag here. Only a mouse crosses.
                          if (lastPointerType.current === "touch") return;
                          if (!active || cell === MARK_FILLED) return;
                          tapSound();
                          queueStroke([index], cell === MARK_CROSSED ? "clear" : "cross");
                        }}
                        onPointerDown={(event) => {
                          lastPointerType.current = event.pointerType;
                          setCursor(index);
                          if (event.button === 2) return; // the context menu handles it
                          beginDrag(index, cell);
                        }}
                        onPointerEnter={() => extendDrag(index)}
                        onClick={(event) => {
                          // detail === 0 is a click nothing pointed at: the
                          // keyboard, or a screen reader activating the
                          // button. A real press is already resolved by the
                          // drag, and handling that here too would mark the
                          // same square twice.
                          if (event.detail !== 0 || !active || tool === "pan") return;
                          const mark = operationAt(index, cell);
                          if (mark === null) return;
                          if (mark === "fill") play("ui"); else tapSound();
                          queueStroke([index], mark);
                        }}
                      >
                        {cell === MARK_CROSSED && <X size={Math.max(8, Math.round(cellPx * 0.42))} aria-hidden="true" />}
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
              {board.solution && (
                // The picture on its own, with no grid, no crosses and no
                // mistakes on it. This is the thing the whole game is for and
                // it is unreadable inside the playing board, where every
                // square carries a hairline and a state.
                <div
                  className="ng-reveal"
                  style={{ "--ng-reveal-size": board.size } as React.CSSProperties}
                  aria-hidden="true"
                >
                  {[...board.solution].map((cell, index) => (
                    <span key={index} className={cell === SOLUTION_FILLED ? "ng-reveal-on" : undefined} />
                  ))}
                </div>
              )}
              {board.title && <p className="ng-reveal-name">{board.title}</p>}
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
                {formatDuration(finalMs)} · {difficultyLabel(attempt.difficulty)} ·{" "}
                {board.filled} of {board.filledTotal} squares
                {board.hints > 0 && ` · ${board.hints} hint${board.hints === 1 ? "" : "s"}`}
              </span>
              {beatBest && <span className="ng-record">New personal best</span>}
              <span className="duel-result-gold">{result.label}</span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <>
              <div className="ng-toolbar">
                <div className="ng-tools" role="group" aria-label="Tool">
                  <button
                    type="button"
                    className={clsx("ng-tool", tool === "fill" && "ng-tool-active")}
                    aria-pressed={tool === "fill"}
                    onClick={() => { selectSound(); setTool("fill"); }}
                  >
                    <Pencil size={13} aria-hidden="true" /> Fill
                  </button>
                  <button
                    type="button"
                    className={clsx("ng-tool", tool === "cross" && "ng-tool-active")}
                    aria-pressed={tool === "cross"}
                    onClick={() => { selectSound(); setTool("cross"); }}
                  >
                    <X size={13} aria-hidden="true" /> Cross
                  </button>
                  <button
                    type="button"
                    className={clsx("ng-tool", tool === "pan" && "ng-tool-active")}
                    aria-pressed={tool === "pan"}
                    title="Drag the board around instead of marking it"
                    onClick={() => { selectSound(); setTool("pan"); }}
                  >
                    <Move size={13} aria-hidden="true" /> Pan
                  </button>
                </div>

                <div className="ng-zoom" role="group" aria-label="Zoom">
                  <button
                    type="button"
                    className="ng-icon-button"
                    aria-label="Smaller squares"
                    disabled={zoomIndex === 0}
                    onClick={() => { tapSound(); setZoomIndex((i) => Math.max(0, i - 1)); }}
                  >
                    <ZoomOut size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ng-icon-button"
                    aria-label="Bigger squares"
                    disabled={zoomIndex === ZOOM_STEPS.length - 1}
                    onClick={() => { tapSound(); setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1)); }}
                  >
                    <ZoomIn size={14} aria-hidden="true" />
                  </button>
                </div>

                <div className="ng-helpers">
                  <button
                    type="button"
                    className="ng-icon-button"
                    disabled={busy || !(board.canUndo || strokeQueued)}
                    aria-label="Undo the last stroke"
                    onClick={undo}
                  >
                    <Undo2 size={14} aria-hidden="true" /> Undo
                  </button>
                  <button
                    type="button"
                    className="ng-icon-button ng-hint"
                    disabled={busy || board.mistakes + 1 >= board.mistakeLimit}
                    title="Fills in one square of the picture. Costs a mistake."
                    onClick={hint}
                  >
                    <Lightbulb size={14} aria-hidden="true" /> Hint
                  </button>
                </div>
              </div>

              <p className="ms-hint ng-hint-line">
                {tool === "pan"
                  ? "Drag to move the board. Switch back to Fill or Cross to mark it."
                  : tool === "cross"
                    ? "Drag to cross off a run. Crosses cost nothing — drag back over one to rub it out."
                    : "Drag along a row or column to fill a whole run. Right-click, or the Cross tool, to cross off."}
              </p>

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

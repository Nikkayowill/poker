"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import {
  Coins,
  HelpCircle,
  Lightbulb,
  Move,
  Pencil,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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
  nonogramClueProgress,
  type NonogramDifficulty,
  type NonogramMark,
} from "@/lib/arcade/puzzles/nonogram";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";

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
  id: number;
  indexes: number[];
  mark: NonogramMark;
}

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
  const [pending, setPending] = useState<PendingStroke[]>([]);
  const [cursor, setCursor] = useState(0);
  const [beatBest, setBeatBest] = useState(false);

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

  // Same guard duel-shell.tsx keeps: true while the player's own action is in
  // flight, so a background poll cannot paint the pre-action board back over
  // what the action's own response is about to paint forward.
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

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
    if (next) {
      versionRef.current = next.version;
      mistakesRef.current = next.board.mistakes;
      if (next.status === "won" && recordedWin.current !== next.id) {
        recordedWin.current = next.id;
        const previous = readBest(next.difficulty);
        if (previous === null || next.elapsedMs < previous) {
          writeBest(next.difficulty, next.elapsedMs);
          setBeatBest(previous !== null);
        }
      }
    }
    setAttempt(next);
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

  /** A player-initiated action: start, resign, or a queued stroke. */
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
        // A refused action still carries the true board; paint it, and only
        // raise a banner when the refusal is something the player should see.
        if (data.round) setAttempt(data.round);
        if (data.error && !data.round) setError(data.error);
        else if (data.error && response.status !== 409) setError(data.error);
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

  /* ------------------------------------------------------------ strokes */

  // The queue, and the drag being drawn right now. Refs rather than state:
  // pointermove runs at screen rate and re-rendering the whole board on every
  // frame to move a preview is exactly the lag this feature exists to remove.
  const queue = useRef<PendingStroke[]>([]);
  const strokeId = useRef(0);
  const pumping = useRef(false);
  // What the queue pins its next request to. Kept on refs rather than read
  // from `attempt`, because the queue runs across awaits and would otherwise
  // close over whatever the board was when the drag started. Written from
  // every response the shell takes, which is `applyResponse` and nowhere else.
  const versionRef = useRef(0);
  const mistakesRef = useRef(0);

  const clearPending = useCallback(() => {
    queue.current = [];
    setPending([]);
  }, []);

  /**
   * Sends queued strokes, one at a time, oldest first.
   *
   * Serial because each stroke is pinned to the board version before it: two
   * in flight would send the same version and the second would be refused. A
   * refusal drops the rest of the queue rather than replaying it, since the
   * board those strokes were drawn against no longer exists.
   */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    // Held for the whole drain, not per request. Between two strokes it would
    // otherwise fall false for a moment, which is exactly long enough for a
    // poll that started before the first one to land and paint a board two
    // strokes out of date.
    sending.current = true;
    try {
      while (queue.current.length > 0) {
        const stroke = queue.current[0];
        let ok = false;
        try {
          const response = await fetch("/api/ante-up-nonogram/actions", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "stroke",
              version: versionRef.current,
              indexes: stroke.indexes,
              mark: stroke.mark,
            }),
          });
          const data = (await response.json()) as Partial<AnteUpNonogramResponse> & {
            round?: AnteUpNonogramSnapshot;
          };
          if (!mounted.current) return;
          if (response.ok && data.attempt) {
            const before = mistakesRef.current;
            applyResponse(data);
            // A buzz and nothing else. lib/audio/manifest.ts maps `lose` to
            // null on purpose -- there is no loss cue in the set -- and
            // play("lose") would be a silent no-op dressed up as feedback.
            // The square turning into a cross is the visual half.
            if (data.attempt.board.mistakes > before) buzz([28, 40, 28]);
            ok = true;
          } else if (data.round) {
            setAttempt(data.round);
          } else if (data.error) {
            setError(data.error);
          }
        } catch {
          if (mounted.current) setError("Could not reach the table. Check your connection.");
        }

        if (!ok) { clearPending(); return; }
        queue.current = queue.current.filter((entry) => entry.id !== stroke.id);
        if (mounted.current) setPending([...queue.current]);
      }
    } finally {
      pumping.current = false;
      sending.current = false;
    }
  }, [applyResponse, clearPending]);

  const queueStroke = useCallback((indexes: number[], mark: NonogramMark) => {
    if (indexes.length === 0) return;
    strokeId.current += 1;
    const stroke: PendingStroke = { id: strokeId.current, indexes, mark };
    queue.current = [...queue.current, stroke];
    setPending([...queue.current]);
    void pump();
  }, [pump]);

  /* --------------------------------------------------------------- drag */

  const board = attempt?.board ?? null;
  const size = board?.size ?? 0;

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

  const undo = () => {
    if (!attempt || !active || !board?.canUndo) return;
    tapSound();
    clearPending();
    void send("/api/ante-up-nonogram/actions", { action: "undo", version: attempt.version });
  };

  const hint = () => {
    if (!attempt || !active) return;
    selectSound();
    clearPending();
    void send("/api/ante-up-nonogram/actions", { action: "hint", version: attempt.version });
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
        cells[index] = mark === "fill" ? MARK_FILLED : mark === "cross" ? MARK_CROSSED : MARK_UNKNOWN;
      }
    };
    for (const stroke of pending) apply(stroke.indexes, stroke.mark);
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
  const running = deadline !== null && active;

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
            is gone. Bigger boards run a longer clock, allow more mistakes, pay more on a win,
            and let you stake more.
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
            onChange={(next) => { selectSound(); setWager(next); }}
          />

          <label className="ng-option">
            <input
              type="checkbox"
              checked={autoCross}
              onChange={(event) => { selectSound(); setAutoCross(event.target.checked); }}
            />
            <span>
              <strong>Cross finished lines for me</strong>
              <small>Once your fills satisfy a line, the rest of it is crossed off. Turn it off for the paper experience.</small>
            </span>
          </label>

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
            <span
              className={clsx(
                "ante-clock",
                running && displayedMs < 60_000 && "ng-clock-low",
              )}
              aria-live="polite"
            >
              {active ? formatDuration(displayedMs) : formatDuration(attempt.elapsedMs)}
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
              className={clsx("ng-grid", tool === "pan" && "ng-grid-pan")}
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
                        )}
                        disabled={!active}
                        aria-label={
                          `Row ${row + 1}, column ${col + 1}, ` +
                          (cell === MARK_FILLED ? "filled" : cell === MARK_CROSSED ? "crossed off" : "blank")
                        }
                        onFocus={() => setCursor(index)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!active || cell === MARK_FILLED) return;
                          tapSound();
                          queueStroke([index], cell === MARK_CROSSED ? "clear" : "cross");
                        }}
                        onPointerDown={(event) => {
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
                {formatDuration(attempt.elapsedMs)} · {difficultyLabel(attempt.difficulty)} ·{" "}
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
                    disabled={busy || !board.canUndo}
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

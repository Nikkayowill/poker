"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, HelpCircle, Target } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { useAppShell } from "@/components/shell/app-shell";
import { WinCelebration } from "@/components/celebration/win-celebration";
import { StakePicker } from "@/components/pvp/stake-picker";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { useActionQueue } from "@/components/shared/use-action-queue";
import { maxAnteUpWager } from "@/lib/arcade/ante-up-stakes";
import { anteUpResultLine } from "@/lib/arcade/ante-up-result";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  ANTE_UP_BLOCKUDOKU_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpBlockudokuSnapshot,
  type BlockudokuDifficulty,
} from "@/lib/arcade/ante-up-blockudoku";
import { GRID_SIDE, type BlockudokuShape } from "@/lib/arcade/puzzles/blockudoku";
import { formatDuration } from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";
import { createRequestSequence } from "@/lib/ui/request-sequence";

/**
 * Ante Up: Blockudoku.
 *
 * Same request shape as Minesweeper: every placement is a request carrying
 * only a tray slot and a cell, the server decides what fits and what clears,
 * and the piece stream's seed never crosses the wire. Placements made while
 * an earlier one is on the wire queue up and go out in order. Reuses the `.duel-*`
 * and `.ante-*` shell classes; only the board and tray live in
 * 59-blockudoku.css.
 *
 * Placing works three ways over one rule, "a tap inside a legal ghost drops
 * the piece": on a phone you tap a piece, tap the board to aim it (the ghost
 * shows where it lands and whether it fits), then tap the ghost to drop it.
 * A mouse aims on hover, so one click drops. Dragging a piece from the tray
 * onto the board drops it on release.
 */

const STAKE_QUICK_PICKS = [MIN_ANTE_UP_WAGER, 1000, 5000, 25_000, 100_000, 500_000] as const;

/** How often the shell re-reads a live attempt: catches the clock running out with nothing placed. */
const POLL_MS = 3000;

/** Fallback pause on a 429 with no usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** How long cleared lines flash before the board shows them empty. */
const CLEAR_FLASH_MS = 480;

/** Under this much time left the clock turns red. */
const LOW_TIME_MS = 30_000;

/** How far a pointer has to travel from a tray piece before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 8;

/** A finger covers what it is dragging, so a touch drag aims this many cells above it. */
const TOUCH_LIFT_CELLS = 1.6;

const DIFFICULTIES: readonly { id: BlockudokuDifficulty; label: string }[] = [
  { id: "casual", label: "Casual" },
  { id: "standard", label: "Standard" },
  { id: "hardcore", label: "Hardcore" },
];

interface AnteUpBlockudokuResponse {
  attempt: AnteUpBlockudokuSnapshot | null;
  profile: PlayerProfile;
  error?: string;
}

interface Anchor {
  row: number;
  col: number;
}

/** A placement waiting its turn. `cells` is kept so the board can paint it before the server answers. */
interface PendingPlacement {
  slot: number;
  row: number;
  col: number;
  cells: readonly number[];
}

interface DragState {
  pointerId: number;
  slot: number;
  startX: number;
  startY: number;
  touch: boolean;
  moved: boolean;
}

function difficultyLabel(id: BlockudokuDifficulty): string {
  return id[0].toUpperCase() + id.slice(1);
}

function shapeSize(shape: BlockudokuShape): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const [r, c] of shape.cells) {
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols };
}

/**
 * The block nearest the middle of `shape`. Pieces are aimed by this block
 * rather than by the middle of their bounding box, so the cell under the
 * finger or cursor is always part of the piece, even for an L with a gap.
 */
function pivotOf(shape: BlockudokuShape): readonly [number, number] {
  const size = shapeSize(shape);
  const midRow = (size.rows - 1) / 2;
  const midCol = (size.cols - 1) / 2;
  let best = shape.cells[0];
  let bestDistance = Infinity;
  for (const cell of shape.cells) {
    const distance = Math.abs(cell[0] - midRow) + Math.abs(cell[1] - midCol);
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The anchor that puts `shape`'s pivot block on the tapped cell, pulled back
 * inside the board. Clamping means a tap near an edge still aims a piece that
 * fits the grid rather than one hanging off it.
 */
function anchorFor(shape: BlockudokuShape, row: number, col: number): Anchor {
  const size = shapeSize(shape);
  const [pivotRow, pivotCol] = pivotOf(shape);
  const top = row - pivotRow;
  const left = col - pivotCol;
  return {
    row: Math.min(Math.max(top, 0), GRID_SIDE - size.rows),
    col: Math.min(Math.max(left, 0), GRID_SIDE - size.cols),
  };
}

function cellsAt(shape: BlockudokuShape, anchor: Anchor): number[] {
  return shape.cells.map(([r, c]) => (anchor.row + r) * GRID_SIDE + (anchor.col + c));
}

function fits(board: readonly number[], shape: BlockudokuShape, anchor: Anchor): boolean {
  const size = shapeSize(shape);
  if (anchor.row < 0 || anchor.col < 0) return false;
  if (anchor.row + size.rows > GRID_SIDE || anchor.col + size.cols > GRID_SIDE) return false;
  return cellsAt(shape, anchor).every((index) => board[index] === 0);
}

function fitsAnywhere(board: readonly number[], shape: BlockudokuShape): boolean {
  for (let row = 0; row < GRID_SIDE; row += 1) {
    for (let col = 0; col < GRID_SIDE; col += 1) {
      if (fits(board, shape, { row, col })) return true;
    }
  }
  return false;
}

/** Every row, column and 3x3 box that is full on `board`, flattened to cell indices. */
function fullLines(board: readonly number[]): Set<number> {
  const out = new Set<number>();
  const groups: number[][] = [];
  for (let i = 0; i < GRID_SIDE; i += 1) {
    const row: number[] = [];
    const col: number[] = [];
    const box: number[] = [];
    for (let j = 0; j < GRID_SIDE; j += 1) {
      row.push(i * GRID_SIDE + j);
      col.push(j * GRID_SIDE + i);
      const r = Math.floor(i / 3) * 3 + Math.floor(j / 3);
      const c = (i % 3) * 3 + (j % 3);
      box.push(r * GRID_SIDE + c);
    }
    groups.push(row, col, box);
  }
  for (const group of groups) {
    if (group.every((index) => board[index] === 1)) for (const index of group) out.add(index);
  }
  return out;
}

function isShadedBox(index: number): boolean {
  const boxRow = Math.floor(Math.floor(index / GRID_SIDE) / 3);
  const boxCol = Math.floor((index % GRID_SIDE) / 3);
  return (boxRow + boxCol) % 2 === 1;
}

function PieceGlyph({ shape }: { shape: BlockudokuShape }) {
  const size = shapeSize(shape);
  const filled = new Set(shape.cells.map(([r, c]) => r * size.cols + c));
  return (
    <span
      className="bk-piece"
      style={{ "--bk-piece-cols": size.cols, "--bk-piece-rows": size.rows } as React.CSSProperties}
    >
      {Array.from({ length: size.rows * size.cols }, (_, index) => (
        <span key={index} className={filled.has(index) ? "bk-piece-block" : undefined} />
      ))}
    </span>
  );
}

export function AnteUpBlockudoku() {
  const [difficulty, setDifficulty] = useState<BlockudokuDifficulty>("casual");
  const [wager, setWager] = useState<number>(MIN_ANTE_UP_WAGER);
  const [attempt, setAttempt] = useState<AnteUpBlockudokuSnapshot | null>(null);
  const { profile, setProfile, setImmersive } = useAppShell();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);

  const [selected, setSelected] = useState<number | null>(null);
  const [aim, setAim] = useState<Anchor | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clearing, setClearing] = useState<ReadonlySet<number>>(() => new Set());
  const [gain, setGain] = useState<{ points: number; key: number } | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const active = attempt?.status === "active";
  const settled = attempt !== null && attempt.status !== "active";

  useEffect(() => {
    setImmersive(Boolean(attempt));
  }, [attempt, setImmersive]);

  // Guards start and resign against a double click, and stops placements once
  // a resign is on the wire. Read ordering and board versions live in
  // `sequence`, which also covers the queued placements.
  const sending = useRef(false);
  const mounted = useRef(true);
  const [sequence] = useState(() => createRequestSequence<AnteUpBlockudokuSnapshot>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  // A drag ends in a click on the tray button; this swallows that one click.
  const swallowClick = useRef(false);
  const clearTimer = useRef<number | null>(null);

  const applyResponse = useCallback((data: Partial<AnteUpBlockudokuResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.attempt !== undefined && sequence.admit(data.attempt)) setAttempt(data.attempt ?? null);
  }, [sequence, setProfile]);

  /** The background poll. Returns a pause in ms after a 429, or null for the normal cadence. */
  const refresh = useCallback(async (): Promise<number | null> => {
    const ticket = sequence.beginRead();
    if (!ticket) return null;
    try {
      const response = await fetch("/api/ante-up-blockudoku", { cache: "no-store" });
      if (response.status === 429) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
        return seconds * 1000;
      }
      const data = (await response.json()) as Partial<AnteUpBlockudokuResponse>;
      if (!mounted.current || !sequence.acceptRead(ticket)) return null;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped poll is not worth a banner; the next one is seconds away.
    } finally {
      if (mounted.current) setLoaded(true);
    }
    return null;
  }, [applyResponse, sequence]);

  /** A player-initiated action: start or resign. A refusal still carries the true board, painted without a banner. */
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
      const data = (await response.json()) as Partial<AnteUpBlockudokuResponse> & {
        round?: AnteUpBlockudokuSnapshot;
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
   * Sends one queued placement against the newest board. A refusal drops the
   * rest of the queue, since each later placement was aimed at a board that
   * included this one.
   */
  const sendPlace = useCallback(async ({ slot, row, col }: PendingPlacement): Promise<boolean> => {
    if (!mounted.current) return false;
    const before = sequence.latest();
    try {
      const response = await fetch("/api/ante-up-blockudoku/actions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", version: sequence.version(), slot, row, col }),
      });
      const data = (await response.json()) as Partial<AnteUpBlockudokuResponse> & {
        round?: AnteUpBlockudokuSnapshot;
      };
      if (!mounted.current) return false;
      if (!response.ok) {
        if (data.round) applyResponse({ attempt: data.round });
        else setError(data.error ?? "That did not go through.");
        return false;
      }
      applyResponse(data);
      // The score is the server's to work out, so the gain shows when it lands.
      const next = data.attempt;
      const points = next && before ? next.board.score - before.board.score : 0;
      if (next && points > 0) setGain({ points, key: next.version });
      return true;
    } catch {
      if (mounted.current) setError("Could not reach the table. Check your connection.");
      return false;
    }
  }, [applyResponse, sequence]);

  const placements = useActionQueue<PendingPlacement>(sequence, sendPlace);

  /**
   * The server's board with every queued placement drawn on top. Fits and
   * line clears follow fixed rules, so those show at once. The next three
   * pieces are dealt from a seed only the server holds, so an emptied tray
   * just waits for them.
   */
  const view = useMemo(() => {
    if (!attempt) return null;
    const board = attempt.board.board.slice();
    const inventory = attempt.board.inventory.slice();
    const placed = new Set<number>();
    for (const move of placements.pending) {
      for (const index of move.cells) {
        board[index] = 1;
        placed.add(index);
      }
      for (const index of fullLines(board)) {
        board[index] = 0;
        placed.delete(index);
      }
      inventory[move.slot] = null;
    }
    const dealing = placements.pending.length > 0 && inventory.every((piece) => piece === null);
    return { board, inventory, placed, dealing };
  }, [attempt, placements.pending]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Self-rescheduling poll while live, so only one read is ever in flight and
  // a 429's Retry-After replaces one tick's delay.
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

  useEffect(() => () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
  }, []);

  const board = view?.board ?? null;
  const inventory = view?.inventory ?? null;
  const selectedShape = selected !== null && inventory ? inventory[selected] ?? null : null;

  // A slot the server has since emptied (or a finished board) drops the selection.
  const liveSelection = active && selectedShape !== null;

  const ghost = useMemo(() => {
    if (!liveSelection || !board || !selectedShape || !aim) return null;
    const cells = cellsAt(selectedShape, aim);
    const legal = fits(board, selectedShape, aim);
    let completes: ReadonlySet<number> = new Set();
    if (legal) {
      const after = board.slice();
      for (const index of cells) after[index] = 1;
      completes = fullLines(after);
    }
    return { cells: new Set(cells), legal, completes, anchor: aim };
  }, [liveSelection, board, selectedShape, aim]);

  const start = () => {
    if (sending.current) return;
    setSelected(null);
    setAim(null);
    placements.clear();
    void send("/api/ante-up-blockudoku", { difficulty, wager });
  };

  // Queued rather than refused while an earlier placement is on the wire, so
  // quick drops all land in order.
  const place = (slot: number, anchor: Anchor) => {
    if (!active || sending.current || !board || !inventory) return;
    const shape = inventory[slot];
    if (!shape || !fits(board, shape, anchor)) return;

    const cells = cellsAt(shape, anchor);
    const after = board.slice();
    for (const index of cells) after[index] = 1;
    const cleared = fullLines(after);

    play("ui");
    setSelected(null);
    setAim(null);
    placements.push({ slot, row: anchor.row, col: anchor.col, cells });
    if (cleared.size > 0) {
      tapSound();
      setClearing(cleared);
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => {
        clearTimer.current = null;
        if (mounted.current) setClearing(new Set());
      }, CLEAR_FLASH_MS);
    }
  };

  const selectSlot = (slot: number) => {
    if (!active || !inventory?.[slot]) return;
    selectSound();
    setSelected((current) => (current === slot ? null : slot));
    setAim(null);
  };

  /**
   * A tap inside a legal ghost drops the piece; any other tap on the board
   * re-aims it. A tap that would aim exactly where the ghost already is also
   * drops it: near an edge the clamped ghost can sit off the tapped cell, and
   * a mouse click always lands on the cell its own hover just aimed from.
   */
  const tapCell = (index: number) => {
    if (!active || !selectedShape || selected === null) return;
    const next = anchorFor(selectedShape, Math.floor(index / GRID_SIDE), index % GRID_SIDE);
    const sameAim = ghost !== null && ghost.anchor.row === next.row && ghost.anchor.col === next.col;
    if (ghost && ghost.legal && (ghost.cells.has(index) || sameAim)) {
      place(selected, ghost.anchor);
      return;
    }
    tapSound();
    setAim(next);
  };

  const hoverCell = (index: number, pointerType: string) => {
    if (pointerType !== "mouse" || !selectedShape || drag.current) return;
    setAim(anchorFor(selectedShape, Math.floor(index / GRID_SIDE), index % GRID_SIDE));
  };

  /** The board cell under a viewport point, or null when the point is off the board. */
  const cellAtPoint = (x: number, y: number): Anchor | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const size = rect.width / GRID_SIDE;
    return {
      row: Math.min(GRID_SIDE - 1, Math.floor((y - rect.top) / size)),
      col: Math.min(GRID_SIDE - 1, Math.floor((x - rect.left) / size)),
    };
  };

  const onTrayPointerDown = (slot: number, event: React.PointerEvent<HTMLButtonElement>) => {
    // A touch drag ends with no click at all, so a swallow left over from one
    // would eat this new press's tap. A fresh press always starts clean.
    swallowClick.current = false;
    if (!active || !inventory?.[slot]) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = {
      pointerId: event.pointerId,
      slot,
      startX: event.clientX,
      startY: event.clientY,
      touch: event.pointerType !== "mouse",
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onTrayPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || !inventory) return;
    const shape = inventory[state.slot];
    if (!shape) return;
    if (!state.moved) {
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
      if (distance < DRAG_THRESHOLD_PX) return;
      state.moved = true;
      setDragging(true);
      setSelected(state.slot);
    }
    const grid = gridRef.current;
    const lift = state.touch && grid
      ? (grid.getBoundingClientRect().width / GRID_SIDE) * TOUCH_LIFT_CELLS
      : 0;
    const cell = cellAtPoint(event.clientX, event.clientY - lift);
    setAim(cell ? anchorFor(shape, cell.row, cell.col) : null);
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>, drop: boolean) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!state.moved) return; // A plain tap; the click that follows selects the piece.
    swallowClick.current = true;
    setDragging(false);
    if (drop && ghost && ghost.legal) {
      place(state.slot, ghost.anchor);
    } else {
      setAim(null);
    }
  };

  const onTrayClick = (slot: number) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    selectSlot(slot);
  };

  const resign = () => {
    if (sending.current || placements.queued().length > 0) return;
    setSelected(null);
    setAim(null);
    void send("/api/ante-up-blockudoku/actions", { action: "resign" });
  };
  const playAgain = () => {
    setAttempt(null);
    setSelected(null);
    setAim(null);
    setGain(null);
  };

  const balance = profile?.unlimitedGold ? Infinity : profile?.goldBalance ?? 0;
  const result = anteUpResultLine(attempt?.wager ?? 0, attempt?.payout ?? 0);
  const ceiling = maxAnteUpWager("blockudoku", difficulty);
  const canAfford =
    wager === 0 || (wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance >= wager);
  const insufficientGold = wager >= MIN_ANTE_UP_WAGER && wager <= ceiling && balance < wager;
  const tier = ANTE_UP_BLOCKUDOKU_TIERS[difficulty];

  // Counted down from the server's absolute deadline, capped at the tier's
  // own limit so network latency never shows more time than the board has.
  const deadline = attempt?.expiresAt ? Date.parse(attempt.expiresAt) : null;
  const displayedMs =
    deadline !== null && attempt
      ? Math.min(attempt.timeLimitMs, Math.max(0, deadline - now))
      : attempt?.timeLimitMs ?? 0;

  // Jam and resignation both settle as "lost". A resignation always leaves a
  // piece that still fits, since a jammed board would already have ended.
  const jammed =
    attempt?.status === "lost" &&
    board !== null &&
    !(inventory ?? []).some((piece) => piece !== null && fitsAnywhere(board, piece));

  // A timeout is settled by whichever read comes first after the deadline, so
  // the stored elapsed time can run a few seconds past the limit. Show the limit.
  const finalMs = attempt ? Math.min(attempt.elapsedMs, attempt.timeLimitMs) : 0;

  const lowTime = active && deadline !== null && displayedMs <= LOW_TIME_MS;

  const progress = attempt ? Math.min(1, attempt.board.score / attempt.targetScore) : 0;
  const placedSet = view?.placed ?? new Set<number>();

  return (
    <main className={clsx("duel-shell ante-shell", attempt && "bk-shell-playing")}>
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink
            confirmLeave={active && (attempt?.wager ?? 0) > 0}
            confirmMessage="Your wager is still in play on this board. Leaving won't give it up. Come back to finish, or use Give Up to settle it now."
          />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {profile ? (profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()) : "—"}
          </strong>
        </span>
      </header>

      {showHelp && (
        <HowToPlayModal title="Blockudoku" onClose={() => setShowHelp(false)}>
          <p>
            Drop the three pieces from your tray onto the 9×9 board. Fill a whole row, column or
            3×3 box and it clears. Clearing several at once scores far more than clearing them one
            at a time. You get three new pieces once all three are placed.
          </p>
          <p>
            Tap a piece, tap the board to aim it, then tap the shaded shape to drop it. You can
            also drag a piece straight onto the board.
          </p>
          <p>
            Pick a difficulty, then wager Gold or play free. The clock starts on your first piece.
            Reach the target score before time runs out and you win. If no piece in your tray fits
            anywhere, the board is jammed and the round ends.
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
            <h1>Blockudoku, against the clock</h1>
            <p>
              Drop shapes, clear rows, columns and boxes. Hit the target score before the board
              jams or the clock runs out, and cash out up to {ANTE_UP_BLOCKUDOKU_TIERS.hardcore.multiplier}x.
            </p>
          </div>

          <div className="ante-difficulties" role="group" aria-label="Difficulty">
            {DIFFICULTIES.map((entry) => {
              const entryTier = ANTE_UP_BLOCKUDOKU_TIERS[entry.id];
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={clsx("ante-difficulty", entry.id === difficulty && "ante-difficulty-active")}
                  aria-pressed={entry.id === difficulty}
                  onClick={() => {
                    selectSound();
                    setDifficulty(entry.id);
                    setWager((current) => Math.min(current, maxAnteUpWager("blockudoku", entry.id)));
                  }}
                >
                  <strong>{entry.label}</strong>
                  <span>Score {entryTier.targetScore.toLocaleString()}</span>
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
              ? "Free practice. No payout on a win, but nothing at risk either."
              : wager < MIN_ANTE_UP_WAGER
                ? `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`
                : `Score ${tier.targetScore.toLocaleString()} inside ${Math.round(tier.timeLimitMs / 60_000)} minutes and cash out ${Math.round(wager * tier.multiplier).toLocaleString()} Gold (${tier.multiplier}x). Jam the board or run out of time and the wager is gone.`}
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
        <div className="duel-match ante-match bk-match">
          <div className="duel-scoreline ante-scoreline bk-scoreline">
            <span
              className="bk-score"
              aria-label={`Score ${attempt.board.score} of ${attempt.targetScore}`}
            >
              <Target size={13} aria-hidden="true" />
              <strong>{attempt.board.score.toLocaleString()}</strong>
              <small>/ {attempt.targetScore.toLocaleString()}</small>
              {gain && (
                <span key={gain.key} className="bk-gain" aria-hidden="true">+{gain.points}</span>
              )}
            </span>
            <span className={clsx("ante-clock", lowTime && "bk-clock-low")} aria-live="polite">
              {active ? formatDuration(displayedMs) : formatDuration(finalMs)}
            </span>
            <span className="duel-pot">
              <Coins size={12} aria-hidden="true" />
              <strong>{attempt.wager.toLocaleString()}</strong>
              {attempt.wager > 0 && <small>→ {Math.round(attempt.wager * attempt.multiplier).toLocaleString()}</small>}
            </span>
          </div>
          <div className="bk-progress" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="bk-play">
            <div
              ref={gridRef}
              className={clsx("bk-grid", dragging && "bk-grid-dragging")}
              role="grid"
              aria-label="Blockudoku board"
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse" && !drag.current) setAim(null);
              }}
            >
              {(board ?? []).map((cell, index) => {
                const inGhost = ghost?.cells.has(index) ?? false;
                return (
                  <button
                    key={index}
                    type="button"
                    role="gridcell"
                    className={clsx(
                      "bk-cell",
                      isShadedBox(index) && "bk-cell-shade",
                      cell === 1 && "bk-cell-filled",
                      placedSet.has(index) && "bk-cell-pending",
                      inGhost && (ghost?.legal ? "bk-cell-ghost" : "bk-cell-ghost-bad"),
                      ghost?.legal && ghost.completes.has(index) && "bk-cell-will-clear",
                      clearing.has(index) && "bk-cell-clearing",
                    )}
                    disabled={!active}
                    aria-label={`Row ${Math.floor(index / GRID_SIDE) + 1}, column ${(index % GRID_SIDE) + 1}, ${cell === 1 ? "filled" : "empty"}`}
                    onPointerEnter={(event) => hoverCell(index, event.pointerType)}
                    onClick={() => tapCell(index)}
                  />
                );
              })}
            </div>

            {!settled && inventory && (
              <div
                className={clsx("bk-tray", view?.dealing && "bk-tray-dealing")}
                role="group"
                aria-label="Pieces"
                aria-busy={view?.dealing ?? false}
              >
                {inventory.map((piece, slot) => {
                  const stuck = piece !== null && board !== null && !fitsAnywhere(board, piece);
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={clsx(
                        "bk-slot",
                        selected === slot && piece && "bk-slot-selected",
                        stuck && "bk-slot-stuck",
                      )}
                      disabled={!active || piece === null}
                      aria-pressed={selected === slot && piece !== null}
                      aria-label={piece ? `Piece ${slot + 1}${stuck ? ", fits nowhere" : ""}` : `Piece ${slot + 1}, played`}
                      onPointerDown={(event) => onTrayPointerDown(slot, event)}
                      onPointerMove={onTrayPointerMove}
                      onPointerUp={(event) => endDrag(event, true)}
                      onPointerCancel={(event) => endDrag(event, false)}
                      onClick={() => onTrayClick(slot)}
                    >
                      {piece && <PieceGlyph shape={piece} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {settled ? (
            <div className={clsx("duel-result", attempt.status === "won" && "duel-result-won")}>
              <WinCelebration active={attempt.status === "won" && result.profited} amount={result.net} />
              <strong>
                {attempt.status === "won"
                  ? "Target reached"
                  : attempt.status === "timed-out"
                    ? "Time's up"
                    : jammed
                      ? "Board jammed"
                      : "Gave up"}
              </strong>
              <span>
                {attempt.board.score.toLocaleString()} of {attempt.targetScore.toLocaleString()} ·{" "}
                {formatDuration(finalMs)} · {difficultyLabel(attempt.difficulty)}
              </span>
              <span className="duel-result-gold">{result.label}</span>
              <button type="button" className="floor-play" onClick={playAgain}>Play again</button>
            </div>
          ) : (
            <>
              <p className="bk-hint">
                {selectedShape === null
                  ? view?.dealing
                    ? "Dealing the next pieces."
                    : "Tap a piece, or drag it onto the board."
                  : ghost === null
                    ? "Tap the board to aim the piece."
                    : ghost.legal
                      ? "Tap the shaded shape to drop it, or tap elsewhere to move it."
                      : "It does not fit there. Tap somewhere else."}
              </p>
              <div className="duel-controls">
                <button
                  type="button"
                  className="duel-resign"
                  disabled={busy || placements.pending.length > 0}
                  onClick={resign}
                >
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

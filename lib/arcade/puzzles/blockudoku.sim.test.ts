import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { mulberry32 } from "@/lib/seeded-random";
import { anteUpBlockudokuTerms } from "../ante-up-blockudoku";
import {
  BLOCKUDOKU_PIECE_SETS,
  GRID_SIDE,
  placeBlockudokuPiece,
  startBlockudokuRound,
  type BlockudokuPieceSet,
  type BlockudokuRound,
  type BlockudokuShape,
} from "./blockudoku";

/**
 * The calibration run behind ANTE_UP_BLOCKUDOKU_TIERS. Skipped by default
 * because it plays thousands of games; run it with
 * `BLOCKUDOKU_SIM=1 pnpm vitest run lib/arcade/puzzles/blockudoku.sim.test.ts`.
 *
 * Four bots stand in for four points on the skill curve and play the real
 * engine:
 * - median: drops whichever single piece clears most right now, snug against
 *   what is already down. No look at what the board is left like.
 * - +1 SD: plans the whole tray of three, but only follows its two best
 *   lines, scoring each by the board it leaves (buried holes, ragged edges,
 *   open 3x3 boxes).
 * - +2 SD: the same plan, following its twelve best lines.
 * - +3 SD: forty lines, and it also keeps room for every piece the set can
 *   still deal, the big awkward ones most of all.
 * A clock becomes a placement budget at 4s, 3.2s, 2.5s and 2s a piece, 0.8x
 * per SD: a stronger player plans better and also reads the board faster.
 * Each run's pace varies around that by a lognormal sigma of 0.15, since
 * nobody plays every game at exactly their own average speed.
 */

const N = GRID_SIDE;

type Board = Uint8Array;

interface Move {
  slot: number;
  row: number;
  col: number;
}

/** Every anchor where `shape` fits. */
function fits(board: Board, shape: BlockudokuShape): number[] {
  const out: number[] = [];
  for (let row = 0; row < N; row += 1) {
    for (let col = 0; col < N; col += 1) {
      let ok = true;
      for (const [dr, dc] of shape.cells) {
        const r = row + dr;
        const c = col + dc;
        if (r >= N || c >= N || board[r * N + c] !== 0) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(row * N + col);
    }
  }
  return out;
}

/** Places and clears, same rules as the engine. Returns the new board, lines cleared and points. */
function play(board: Board, shape: BlockudokuShape, anchor: number): { board: Board; lines: number; points: number } {
  const next = board.slice();
  const row = Math.floor(anchor / N);
  const col = anchor % N;
  for (const [dr, dc] of shape.cells) next[(row + dr) * N + col + dc] = 1;
  const clear: number[] = [];
  let lines = 0;
  for (let r = 0; r < N; r += 1) {
    let full = true;
    for (let c = 0; c < N; c += 1) if (!next[r * N + c]) { full = false; break; }
    if (full) { lines += 1; for (let c = 0; c < N; c += 1) clear.push(r * N + c); }
  }
  for (let c = 0; c < N; c += 1) {
    let full = true;
    for (let r = 0; r < N; r += 1) if (!next[r * N + c]) { full = false; break; }
    if (full) { lines += 1; for (let r = 0; r < N; r += 1) clear.push(r * N + c); }
  }
  for (let br = 0; br < 3; br += 1) {
    for (let bc = 0; bc < 3; bc += 1) {
      let full = true;
      for (let i = 0; i < 9 && full; i += 1) if (!next[(br * 3 + Math.floor(i / 3)) * N + bc * 3 + (i % 3)]) full = false;
      if (full) {
        lines += 1;
        for (let i = 0; i < 9; i += 1) clear.push((br * 3 + Math.floor(i / 3)) * N + bc * 3 + (i % 3));
      }
    }
  }
  for (const index of clear) next[index] = 0;
  const points = shape.cells.length + (lines > 0 ? (18 * lines * (lines + 1)) / 2 : 0);
  return { board: next, lines, points };
}

function filled(board: Board, r: number, c: number): boolean {
  return r < 0 || r >= N || c < 0 || c >= N || board[r * N + c] === 1;
}

/** Higher is healthier. */
function health(board: Board): number {
  let transitions = 0;
  let holes = 0;
  let emptyBoxes = 0;
  let empty = 0;
  for (let r = 0; r < N; r += 1) {
    for (let c = 0; c < N; c += 1) {
      const here = filled(board, r, c);
      if (here !== filled(board, r, c + 1)) transitions += 1;
      if (here !== filled(board, r + 1, c)) transitions += 1;
      if (c === 0 && here !== filled(board, r, -1)) transitions += 1;
      if (r === 0 && here !== filled(board, -1, c)) transitions += 1;
      if (!here) {
        empty += 1;
        const walls =
          Number(filled(board, r - 1, c)) + Number(filled(board, r + 1, c)) +
          Number(filled(board, r, c - 1)) + Number(filled(board, r, c + 1));
        if (walls === 4) holes += 3;
        else if (walls === 3) holes += 1;
      }
    }
  }
  for (let br = 0; br < 3; br += 1) {
    for (let bc = 0; bc < 3; bc += 1) {
      let clean = true;
      for (let i = 0; i < 9 && clean; i += 1) if (board[(br * 3 + Math.floor(i / 3)) * N + bc * 3 + (i % 3)]) clean = false;
      if (clean) emptyBoxes += 1;
    }
  }
  return empty * 0.6 - transitions * 1 - holes * 3 + emptyBoxes * 4;
}

interface Node {
  board: Board;
  points: number;
  used: number;
  path: Move[];
  value: number;
}

/** Negative for every set piece that no longer fits anywhere, weighted by its size. */
function roomFor(board: Board, shapes: readonly BlockudokuShape[]): number {
  let penalty = 0;
  for (const shape of shapes) {
    if (!anyFit(board, shape)) penalty += shape.cells.length * shape.cells.length;
  }
  return -penalty;
}

function anyFit(board: Board, shape: BlockudokuShape): boolean {
  for (let row = 0; row < N; row += 1) {
    for (let col = 0; col < N; col += 1) {
      let ok = true;
      for (const [dr, dc] of shape.cells) {
        const r = row + dr;
        const c = col + dc;
        if (r >= N || c >= N || board[r * N + c] !== 0) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

/** Plans the whole remaining tray: beam search over every order, scored by points plus board health. */
function planMoves(round: BlockudokuRound, beam: number, shapes: readonly BlockudokuShape[] | null): Move[] | null {
  const tray = round.inventory;
  let frontier: Node[] = [
    { board: Uint8Array.from(round.board), points: 0, used: 0, path: [], value: 0 },
  ];
  const remaining = tray.filter((piece) => piece !== null).length;
  let best: Node | null = null;
  for (let depth = 0; depth < remaining; depth += 1) {
    const next: Node[] = [];
    for (const node of frontier) {
      const seen = new Set<string>();
      tray.forEach((shape, slot) => {
        if (!shape || node.used & (1 << slot)) return;
        if (seen.has(shape.id)) return;
        seen.add(shape.id);
        for (const anchor of fits(node.board, shape)) {
          const played = play(node.board, shape, anchor);
          const points = node.points + played.points;
          next.push({
            board: played.board,
            points,
            used: node.used | (1 << slot),
            path: [...node.path, { slot, row: Math.floor(anchor / N), col: anchor % N }],
            value: points * 0.35 + health(played.board),
          });
        }
      });
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.value - a.value);
    frontier = next.slice(0, beam);
    if (shapes && depth === remaining - 1) {
      for (const node of frontier) node.value += roomFor(node.board, shapes) * 0.5;
      frontier.sort((a, b) => b.value - a.value);
    }
    if (depth === remaining - 1 || !best || frontier[0].path.length > best.path.length) best = frontier[0];
  }
  return best ? best.path : null;
}

/** The single piece and spot that clears the most right now, snug against what is already down. */
function greedyMove(round: BlockudokuRound, random: () => number): Move | null {
  const board = Uint8Array.from(round.board);
  let best: Move | null = null;
  let bestKey = -Infinity;
  round.inventory.forEach((shape, slot) => {
    if (!shape) return;
    for (const anchor of fits(board, shape)) {
      const row = Math.floor(anchor / N);
      const col = anchor % N;
      let touching = 0;
      for (const [dr, dc] of shape.cells) {
        const r = row + dr;
        const c = col + dc;
        touching += Number(filled(board, r - 1, c)) + Number(filled(board, r + 1, c)) +
          Number(filled(board, r, c - 1)) + Number(filled(board, r, c + 1));
      }
      const { lines } = play(board, shape, anchor);
      const key = lines * 1000 + touching + random() * 0.99;
      if (key > bestKey) {
        bestKey = key;
        best = { slot, row, col };
      }
    }
  });
  return best;
}

const BOTS = ["median", "sd1", "sd2", "sd3"] as const;
type Bot = (typeof BOTS)[number];

const MS_PER_PIECE: Record<Bot, number> = { median: 4000, sd1: 3200, sd2: 2500, sd3: 2000 };

const NOW = new Date("2026-09-25T12:00:00.000Z");

/** Score after each placement, until the board jams or `cap` placements. */
function scoreTrail(bot: Bot, pieceSet: BlockudokuPieceSet, seed: number, cap: number, stopAt = Infinity): number[] {
  let round = startBlockudokuRound(seed, pieceSet);
  const random = mulberry32(seed ^ 0x5bd1e995);
  const trail: number[] = [];
  while (round.status === "active" && trail.length < cap && round.score < stopAt) {
    const moves =
      bot === "sd3" ? planMoves(round, 40, BLOCKUDOKU_PIECE_SETS[pieceSet])
        : bot === "sd2" ? planMoves(round, 12, null)
          : bot === "sd1" ? planMoves(round, 2, null)
            : [greedyMove(round, random)];
    if (!moves || moves.length === 0 || moves[0] === null) break;
    for (const move of moves) {
      if (!move || round.status !== "active" || trail.length >= cap) break;
      const next = placeBlockudokuPiece(round, move.slot, move.row, move.col, NOW);
      if (next === round) throw new Error("bot tried an illegal move");
      round = next;
      trail.push(round.score);
    }
  }
  return trail;
}

/** Standard normal draws, seeded, for the per-run pace spread. */
function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function winRate(trails: number[][], target: number, budget: number): number {
  const random = mulberry32(12345);
  let won = 0;
  for (const trail of trails) {
    const runBudget = budget / Math.exp(0.15 * gaussian(random));
    const reach = trail.findIndex((score) => score >= target);
    if (reach !== -1 && reach < runBudget) won += 1;
  }
  return won / trails.length;
}

function seedFor(game: number): number {
  return (game * 2654435761 + 17) >>> 0;
}

/** Each stake band, the board it has to play at least, and who it is aimed at. */
const BANDS = [
  { wager: 1_000, difficulty: "casual" },
  { wager: 10_000, difficulty: "standard" },
  { wager: 100_000, difficulty: "hardcore" },
  { wager: 1_000_000, difficulty: "hardcore" },
] as const;

/**
 * Trails for one bot and set: read from SIM_TRAILS if "writes score trails"
 * already dumped them there (the +3 SD bot is slow, so the dumps are how a
 * full run gets split across processes), otherwise played here.
 */
function loadOrPlay(bot: Bot, pieceSet: BlockudokuPieceSet, games: number, cap: number, stopAt: number): number[][] {
  const dir = process.env.SIM_TRAILS;
  if (dir) {
    const prefix = `${bot}-${pieceSet}-`;
    const files = readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort((a, b) => Number(a.slice(prefix.length, -5)) - Number(b.slice(prefix.length, -5)));
    if (files.length > 0) {
      return files.flatMap((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as number[][]);
    }
  }
  return Array.from({ length: games }, (_, game) => scoreTrail(bot, pieceSet, seedFor(game), cap, stopAt));
}

describe.skipIf(!process.env.BLOCKUDOKU_SIM)("blockudoku calibration", () => {
  it("measures each stake band's board against all four bots", () => {
    const games = Number(process.env.SIM_GAMES ?? 300);
    const cap = 500;
    const trails = new Map<string, number[][]>();
    const rows: string[] = ["band | board | target in clock | median / +1SD / +2SD / +3SD win"];
    BANDS.forEach(({ wager, difficulty }, band) => {
      const terms = anteUpBlockudokuTerms(difficulty, wager);
      const rates = BOTS.map((bot) => {
        const key = `${bot}:${terms.pieceSet}`;
        if (!trails.has(key)) trails.set(key, loadOrPlay(bot, terms.pieceSet, games, cap, terms.targetScore));
        const budget = terms.timeLimitMs / MS_PER_PIECE[bot];
        return `${Math.round(winRate(trails.get(key) ?? [], terms.targetScore, budget) * 100)}%`;
      });
      rows.push(`${band} | ${difficulty} (${terms.pieceSet}) | ${terms.targetScore} in ${terms.timeLimitMs / 60_000}m | ${rates.join(" / ")}`);
    });
    process.stdout.write(`${rows.join("\n")}\n`);
    expect(rows.length).toBe(5);
  }, 3_600_000);

  // Dumps raw score trails for one bot and set, for sweeping targets and clocks offline.
  it.skipIf(!process.env.SIM_OUT)("writes score trails", () => {
    const bot = (process.env.SIM_BOT ?? "median") as Bot;
    const pieceSet = (process.env.SIM_SET ?? "expert") as BlockudokuPieceSet;
    const from = Number(process.env.SIM_FROM ?? 0);
    const to = Number(process.env.SIM_TO ?? 100);
    const trails: number[][] = [];
    for (let game = from; game < to; game += 1) trails.push(scoreTrail(bot, pieceSet, seedFor(game), 600));
    writeFileSync(process.env.SIM_OUT ?? "", JSON.stringify(trails));
  }, 3_600_000);
});

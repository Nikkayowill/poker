import "server-only";
import { NextResponse } from "next/server";
import { msUntilNextPuzzle, puzzleDay, puzzleNumber } from "@/lib/arcade/puzzles/daily";
import {
  fillSudokuCell,
  generateSudoku,
  startSudokuRound,
  sudokuFillProblem,
  toSudokuSnapshot,
  type SudokuBoard,
  type SudokuDifficulty,
  type SudokuRound,
  type SudokuSnapshot,
} from "@/lib/arcade/puzzles/sudoku";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  DailyPuzzleAlreadyStarted,
  advancePuzzleRound,
  createPuzzleRound,
  getPuzzleRound,
  type StoredPuzzleRound,
} from "./daily-puzzle-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { applyAchievementEvent } from "./achievement-store";
import { applyMissionEvent } from "./mission-store";
import { ensureProfile } from "./profile-store";

/**
 * Everything between a Sudoku request and the board.
 *
 * The shape is word-stack-service.ts's, and the rule that governs all of them is
 * restated rather than referenced because breaking it ruins the feature for
 * everyone rather than for one player:
 *
 *   **The solution never leaves this file.**
 *
 * Here that rule has a particular edge. The server necessarily knows every
 * answer, and the client necessarily needs to be told whether a digit was
 * right -- so the check happens here, one cell at a time, and only the verdict
 * crosses the wire. `toSudokuSnapshot` drops `solution` outright; this file's
 * job is to make sure every path out to the browser goes through it.
 *
 * No Gold moves here, so the casino services' three ordering rules do not
 * apply. The day rule does, with a twist: the four difficulties are four
 * separate `game` values, so the store's unconditional unique index on
 * (profile, game, day) gives one attempt per difficulty per day rather than
 * one attempt in total. That is what "four difficulties" means -- four boards,
 * not a choice between them.
 */

/** `sudoku-hard`, and so on. The difficulty is part of the identity, not a field on the round. */
export function sudokuGameId(difficulty: SudokuDifficulty): string {
  return `sudoku-${difficulty}`;
}

export interface SudokuView {
  /** Null when the player has not opened today's board at this difficulty yet. */
  round: SudokuSnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
  difficulty: SudokuDifficulty;
}

/** `wrong` is ordinary play -- a mistake is counted and the board shrugs rather than raising a banner. */
export class SudokuRequestError extends ArcadeRequestError<
  SudokuSnapshot,
  "wrong" | "rolled-over" | "stale" | "not-editable"
> {
  readonly name = "SudokuRequestError";
}

type StoredSudoku = StoredPuzzleRound<SudokuRound>;

/**
 * Boards already built this process, keyed by day and difficulty.
 *
 * Generation is deterministic, so a cache can never serve a different board
 * than a fresh call would -- it is purely a way not to re-carve the same grid
 * for every player. Carving an expert board runs tens of milliseconds, which
 * is fine once and wasteful on every request. Unbounded is safe in practice:
 * one entry per difficulty per day, and a serverless instance does not live
 * long enough to accumulate many.
 */
const boardCache = new Map<string, SudokuBoard>();

function boardFor(day: string, difficulty: SudokuDifficulty): SudokuBoard {
  const key = `${day}:${difficulty}`;
  const cached = boardCache.get(key);
  if (cached) return cached;
  const board = generateSudoku(day, difficulty);
  boardCache.set(key, board);
  return board;
}

function today(now = new Date()) {
  const day = puzzleDay(now);
  return { day, number: puzzleNumber(day), msUntil: msUntilNextPuzzle(now) };
}

function snapshot(stored: StoredSudoku): SudokuSnapshot {
  return toSudokuSnapshot(stored.round, {
    day: stored.day,
    puzzleNumber: puzzleNumber(stored.day),
    version: stored.version,
  });
}

function view(
  stored: StoredSudoku | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
  difficulty: SudokuDifficulty,
): SudokuView {
  return {
    round: stored ? snapshot(stored) : null,
    profile,
    day: clock.day,
    puzzleNumber: clock.number,
    msUntilNextPuzzle: clock.msUntil,
    difficulty,
  };
}

/** The caller's attempt at today's board, finished or not, or null if they have not started one. */
export async function readSudokuRound(
  token: string,
  difficulty: SudokuDifficulty,
  now = new Date(),
): Promise<SudokuView> {
  const profile = await ensureProfile(token);
  const clock = today(now);
  const stored = await getPuzzleRound<SudokuRound>(profile.id, sudokuGameId(difficulty), clock.day);
  return view(stored, profile, clock, difficulty);
}

/**
 * Opens today's board at a difficulty.
 *
 * An attempt that already exists is returned untouched -- finished or not.
 * Dealing again would restart a grid the player may be twenty minutes into,
 * and would reset the clock the score is made of.
 */
export async function startSudoku(
  token: string,
  difficulty: SudokuDifficulty,
  now = new Date(),
): Promise<SudokuView> {
  const profile = await ensureProfile(token);
  const clock = today(now);
  const game = sudokuGameId(difficulty);

  const existing = await getPuzzleRound<SudokuRound>(profile.id, game, clock.day);
  if (existing) return view(existing, profile, clock, difficulty);

  const round = startSudokuRound(boardFor(clock.day, difficulty), difficulty, now);

  try {
    const stored = await createPuzzleRound<SudokuRound>({
      profileId: profile.id,
      game,
      day: clock.day,
      round,
      complete: false,
    });
    return view(stored, profile, clock, difficulty);
  } catch (error) {
    if (error instanceof DailyPuzzleAlreadyStarted) {
      // Lost a race with the player's own second tab. Theirs is the real
      // attempt; hand it back rather than reporting a conflict.
      const live = await getPuzzleRound<SudokuRound>(profile.id, game, clock.day);
      if (live) return view(live, profile, clock, difficulty);
    }
    throw error;
  }
}

/**
 * Writes one digit.
 *
 * The verdict -- and only the verdict -- crosses the wire. A wrong digit is
 * refused, counted, and reported as `reason: "wrong"` so the board can shrug
 * rather than raise an error banner: a mistake is ordinary play, not a fault.
 */
export async function fillSudoku(
  token: string,
  difficulty: SudokuDifficulty,
  input: { version: number; index: number; value: number },
  now = new Date(),
): Promise<SudokuView> {
  const profile = await ensureProfile(token);
  const clock = today(now);
  const game = sudokuGameId(difficulty);

  const current = await getPuzzleRound<SudokuRound>(profile.id, game, clock.day);
  if (!current) throw new SudokuRequestError("Open today's board first.", 404);
  if (current.day !== clock.day) {
    throw new SudokuRequestError("The day rolled over. Today's board is a new one.", 409, {
      reason: "rolled-over",
    });
  }
  if (current.version !== input.version) {
    throw new SudokuRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = sudokuFillProblem(current.round, input.index, input.value);
  if (problem) {
    throw new SudokuRequestError(
      problem === "finished" ? "This board is already solved." : "That cell cannot take a digit.",
      409,
      { reason: "not-editable", round: snapshot(current) },
    );
  }

  const { round: next, correct } = fillSudokuCell(current.round, input.index, input.value, now);
  const complete = next.status === "solved";
  const stored = await advancePuzzleRound<SudokuRound>(current, next, complete);
  if (!stored) {
    // A lost race did not happen. Costs a fill rather than money, but a
    // double-fired request must not be able to count two mistakes for one
    // wrong digit.
    const live = await getPuzzleRound<SudokuRound>(profile.id, game, clock.day);
    throw new SudokuRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: live ? snapshot(live) : undefined,
    });
  }

  if (!correct) {
    // The mistake IS persisted above -- this is a rejection of the digit, not
    // of the request, and it carries the updated board so the counter moves.
    throw new SudokuRequestError("Not that one.", 409, { reason: "wrong", round: snapshot(stored) });
  }

  // Awaited: the route responds with this function's own return value, so a
  // fire-and-forget call here could be dropped by a frozen serverless
  // invocation right after the response goes out. applyMissionEvent never
  // throws, so this only costs latency, not reliability.
  if (complete) await applyMissionEvent(profile.id, { kind: "puzzle_completed" });
  if (complete) await applyAchievementEvent(profile.id, { kind: "puzzle_completed" });

  return view(stored, profile, clock, difficulty);
}

/** Maps a thrown error to the response both Sudoku routes send. */
export function toSudokuErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That puzzle could not be played.");
}

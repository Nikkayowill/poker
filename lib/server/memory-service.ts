import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { msUntilNextPuzzle, puzzleDay, puzzleNumber } from "@/lib/arcade/puzzles/daily";
import {
  dealMemoryRound,
  flipMemoryTile,
  memoryFlipProblem,
  toMemorySnapshot,
  type MemoryRound,
  type MemorySnapshot,
} from "@/lib/arcade/puzzles/memory";
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
 * Everything between a Memory Match request and the board.
 *
 * The rule, restated rather than referenced for the same reason the other
 * puzzle services restate theirs:
 *
 *   **The layout never leaves this file.**
 *
 * `toMemorySnapshot` sends a card only for tiles that are matched or currently
 * turned over, and `null` everywhere else -- not a card flagged hidden, no
 * card. A client holding the layout finishes in eight turns every time, and
 * the turn count is the entire score.
 *
 * Unlike the other dailies the board is shuffled per player rather than
 * derived from the day. That is not an oversight and the reasoning is at the
 * top of lib/arcade/puzzles/memory.ts: a shared memory board is not a shared
 * puzzle, it is a screenshot away from being no puzzle at all. One attempt per
 * player per day still holds, enforced by the store's unique index.
 */

export const MEMORY_GAME = "memory-match";

export interface MemoryView {
  /** Null when the player has not opened today's board yet. */
  round: MemorySnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
}

/** `already-up` and the rest are ordinary play -- a mis-tap, not a fault. */
export class MemoryRequestError extends ArcadeRequestError<
  MemorySnapshot,
  "rolled-over" | "stale" | "illegal-flip"
> {
  readonly name = "MemoryRequestError";
}

type StoredMemory = StoredPuzzleRound<MemoryRound>;

function today(now = new Date()) {
  const day = puzzleDay(now);
  return { day, number: puzzleNumber(day), msUntil: msUntilNextPuzzle(now) };
}

function snapshot(stored: StoredMemory): MemorySnapshot {
  return toMemorySnapshot(stored.round, {
    day: stored.day,
    puzzleNumber: puzzleNumber(stored.day),
    version: stored.version,
  });
}

function view(
  stored: StoredMemory | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
): MemoryView {
  return {
    round: stored ? snapshot(stored) : null,
    profile,
    day: clock.day,
    puzzleNumber: clock.number,
    msUntilNextPuzzle: clock.msUntil,
  };
}

/** The caller's attempt at today's board, finished or not. */
export async function readMemoryRound(token: string, now = new Date()): Promise<MemoryView> {
  const profile = await ensureProfile(token);
  const clock = today(now);
  const stored = await getPuzzleRound<MemoryRound>(profile.id, MEMORY_GAME, clock.day);
  return view(stored, profile, clock);
}

/**
 * Deals today's board.
 *
 * An attempt that already exists comes back untouched. Re-dealing would not
 * only reset the clock -- it would hand the player a *new layout*, which after
 * a few turns of learning the old one is the one thing that would make the
 * score meaningless.
 */
export async function startMemory(token: string, now = new Date()): Promise<MemoryView> {
  const profile = await ensureProfile(token);
  const clock = today(now);

  const existing = await getPuzzleRound<MemoryRound>(profile.id, MEMORY_GAME, clock.day);
  if (existing) return view(existing, profile, clock);

  // node:crypto's randomInt, not Math.random: the layout is the secret this
  // whole game rests on, so it is drawn the same way a deck is.
  const round = dealMemoryRound(randomInt, now);

  try {
    const stored = await createPuzzleRound<MemoryRound>({
      profileId: profile.id,
      game: MEMORY_GAME,
      day: clock.day,
      round,
      complete: false,
    });
    return view(stored, profile, clock);
  } catch (error) {
    if (error instanceof DailyPuzzleAlreadyStarted) {
      const live = await getPuzzleRound<MemoryRound>(profile.id, MEMORY_GAME, clock.day);
      if (live) return view(live, profile, clock);
    }
    throw error;
  }
}

/** Turns one tile over. */
export async function flipMemory(
  token: string,
  input: { version: number; index: number },
  now = new Date(),
): Promise<MemoryView> {
  const profile = await ensureProfile(token);
  const clock = today(now);

  const current = await getPuzzleRound<MemoryRound>(profile.id, MEMORY_GAME, clock.day);
  if (!current) throw new MemoryRequestError("Deal today's board first.", 404);
  if (current.day !== clock.day) {
    throw new MemoryRequestError("The day rolled over. Today's board is a new one.", 409, {
      reason: "rolled-over",
    });
  }
  if (current.version !== input.version) {
    throw new MemoryRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = memoryFlipProblem(current.round, input.index);
  if (problem) {
    throw new MemoryRequestError(
      problem === "finished" ? "This board is already cleared." : "That card is not face down.",
      409,
      { reason: "illegal-flip", round: snapshot(current) },
    );
  }

  const next = flipMemoryTile(current.round, input.index, now);
  const complete = next.status === "solved";
  const stored = await advancePuzzleRound<MemoryRound>(current, next, complete);
  if (!stored) {
    // A lost race did not happen: a double-fired tap must not burn two turns
    // on one card.
    const live = await getPuzzleRound<MemoryRound>(profile.id, MEMORY_GAME, clock.day);
    throw new MemoryRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: live ? snapshot(live) : undefined,
    });
  }

  // Awaited: the route responds with this function's own return value, so a
  // fire-and-forget call here could be dropped by a frozen serverless
  // invocation right after the response goes out. applyMissionEvent never
  // throws, so this only costs latency, not reliability.
  if (complete) await applyMissionEvent(profile.id, { kind: "puzzle_completed" });
  if (complete) await applyAchievementEvent(profile.id, { kind: "puzzle_completed" });

  return view(stored, profile, clock);
}

/** Maps a thrown error to the response both Memory routes send. */
export function toMemoryErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That board could not be played.");
}

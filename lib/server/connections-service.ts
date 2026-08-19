import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { msUntilNextPuzzle, pickDaily, puzzleDay, puzzleNumber } from "@/lib/arcade/puzzles/daily";
import { CONNECTIONS_PUZZLES } from "@/lib/arcade/puzzles/connections-puzzles";
import {
  connectionsGuessProblem,
  startConnectionsRound,
  submitConnectionsGuess,
  toConnectionsSnapshot,
  type ConnectionsRound,
  type ConnectionsSnapshot,
} from "@/lib/arcade/puzzles/connections";
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
 * Everything between a Connections request and the board.
 *
 * The shape is word-stack-service.ts's, and the one rule that governs both is
 * restated rather than referenced because breaking it silently ruins the
 * feature for everyone rather than for one player:
 *
 *   **The groups never leave this file.**
 *
 * Here that rule has a second edge the Word Stack service does not need. The
 * answer is not only the four groups -- it is also *which group each word is
 * in*, which the server necessarily computes on every guess. Reporting those
 * per-word would turn four wrong guesses into a complete solution, so a wrong
 * guess reports "one away" or nothing at all, and the per-word colour matrix
 * the share text is built from is withheld until the round is over. That
 * redaction lives in toConnectionsSnapshot; this file's job is to make sure
 * every path out to the browser goes through it.
 *
 * No Gold moves here, so the casino services' three ordering rules do not
 * apply. The day rule does: one board per player per UTC day, enforced by the
 * store's unique index rather than by a check here.
 */

export const CONNECTIONS_GAME = "connections";

export interface ConnectionsView {
  /** Null when the player has not opened today's board yet. */
  round: ConnectionsSnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
}

/** `repeat` is ordinary play -- a selection already tried, refused without charging a mistake. */
export class ConnectionsRequestError extends ArcadeRequestError<
  ConnectionsSnapshot,
  "repeat" | "rolled-over" | "stale"
> {
  readonly name = "ConnectionsRequestError";
}

type StoredConnections = StoredPuzzleRound<ConnectionsRound>;

function today(now = new Date()) {
  const day = puzzleDay(now);
  return { day, number: puzzleNumber(day), msUntilNext: msUntilNextPuzzle(now) };
}

function snapshot(stored: StoredConnections): ConnectionsSnapshot {
  return toConnectionsSnapshot(stored.round, {
    day: stored.day,
    puzzleNumber: puzzleNumber(stored.day),
    version: stored.version,
  });
}

function view(
  stored: StoredConnections | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
): ConnectionsView {
  return {
    round: stored ? snapshot(stored) : null,
    profile,
    day: clock.day,
    puzzleNumber: clock.number,
    msUntilNextPuzzle: clock.msUntilNext,
  };
}

/** Today's board as it stands, or null if it has not been opened. Read-only -- opening is POST. */
export async function readConnectionsPuzzle(token: string): Promise<ConnectionsView> {
  const profile = await ensureProfile(token);
  const clock = today();
  const stored = await getPuzzleRound<ConnectionsRound>(profile.id, CONNECTIONS_GAME, clock.day);
  return view(stored, profile, clock);
}

/**
 * Opens today's board, or hands back the one already in progress -- including
 * a finished one. A completed attempt resumes rather than re-deals, for the
 * same reason it does at Word Stack: replaying a board you have already solved
 * would make the shared grid a lie.
 */
export async function startConnectionsPuzzle(
  token: string,
): Promise<ConnectionsView & { resumed: boolean }> {
  const profile = await ensureProfile(token);
  const clock = today();

  const existing = await getPuzzleRound<ConnectionsRound>(profile.id, CONNECTIONS_GAME, clock.day);
  if (existing) return { ...view(existing, profile, clock), resumed: true };

  // Same puzzle for everyone on the day (pickDaily), different tile order for
  // each player (randomInt) -- the board is shared, the shuffle is not, and
  // node:crypto's randomInt is used rather than Math.random for the same
  // reason the deck uses it: this is the only randomness the server owns here.
  const puzzle = pickDaily(CONNECTIONS_PUZZLES, clock.day, CONNECTIONS_GAME);
  const round = startConnectionsRound(puzzle, randomInt);

  let stored: StoredConnections;
  try {
    stored = await createPuzzleRound<ConnectionsRound>({
      profileId: profile.id,
      game: CONNECTIONS_GAME,
      day: clock.day,
      round,
      complete: false,
    });
  } catch (error) {
    if (error instanceof DailyPuzzleAlreadyStarted) {
      const live = await getPuzzleRound<ConnectionsRound>(profile.id, CONNECTIONS_GAME, clock.day);
      if (live) return { ...view(live, profile, clock), resumed: true };
    }
    throw error;
  }

  return { ...view(stored, profile, clock), resumed: false };
}

/**
 * Plays one selection of four words.
 *
 * `day` and `version` are checked for the reasons they are at Word Stack: a board
 * that rolled over at 00:00 UTC must not take a guess meant for yesterday's,
 * and a double-fired submit must not spend two of the player's four mistakes
 * on one selection.
 */
export async function playConnectionsGuess(
  token: string,
  input: { day: string; version: number; selection: string[] },
): Promise<ConnectionsView> {
  const profile = await ensureProfile(token);
  const clock = today();

  if (input.day !== clock.day) {
    throw new ConnectionsRequestError(
      "A new puzzle just went up — this board has rolled over.",
      409,
      { reason: "rolled-over" },
    );
  }

  const current = await getPuzzleRound<ConnectionsRound>(profile.id, CONNECTIONS_GAME, clock.day);
  if (!current) throw new ConnectionsRequestError("You have not started today's puzzle.", 404);

  if (current.version !== input.version) {
    throw new ConnectionsRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = connectionsGuessProblem(current.round, input.selection);
  if (problem === "finished") {
    throw new ConnectionsRequestError("Today's puzzle is already done.", 409, {
      round: snapshot(current),
    });
  }
  if (problem === "repeat") {
    // Ordinary play, not a fault: refused without charging a mistake, because
    // charging for a selection the player already paid for reads as the game
    // cheating.
    throw new ConnectionsRequestError("You have already tried that group.", 400, {
      reason: "repeat",
      round: snapshot(current),
    });
  }
  if (problem) {
    throw new ConnectionsRequestError("Pick four words that are still on the board.", 400, {
      round: snapshot(current),
    });
  }

  const next = submitConnectionsGuess(current.round, input.selection);
  const complete = next.status !== "active";
  const stored = await advancePuzzleRound<ConnectionsRound>(current, next, complete);
  if (!stored) {
    const live = await getPuzzleRound<ConnectionsRound>(profile.id, CONNECTIONS_GAME, clock.day);
    throw new ConnectionsRequestError("That board moved on. Here is where it actually stands.", 409, {
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

/** Maps a thrown error to the response both Connections routes send. Same placement rationale as Word Stack's. */
export function toConnectionsErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That puzzle could not be played.");
}

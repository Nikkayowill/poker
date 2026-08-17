import "server-only";
import { NextResponse } from "next/server";
import { msUntilNextPuzzle, pickDaily, puzzleDay, puzzleNumber } from "@/lib/arcade/puzzles/daily";
import { WORDLE_ANSWERS } from "@/lib/arcade/puzzles/wordle-answers";
import { isAllowedWordleGuess } from "@/lib/arcade/puzzles/wordle-dictionary";
import {
  startWordleRound,
  submitWordleGuess,
  toWordleSnapshot,
  wordleGuessProblem,
  type WordleRound,
  type WordleSnapshot,
} from "@/lib/arcade/puzzles/wordle";
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
 * Everything between a Wordle request and the board.
 *
 * No Gold moves here, so the three ordering rules that govern
 * blackjack-service.ts and hi-lo-service.ts do not apply -- there is no stake
 * to debit before a round exists and no payout to fire exactly once. What
 * replaces them is one rule of its own, and it is the whole game:
 *
 *   **The answer never leaves this file.**
 *
 * The word is read from a `server-only` list, put straight into the stored
 * round, and every path out to the browser goes through toWordleSnapshot,
 * which nulls it until the round is over. That is not defence in depth against
 * a determined attacker -- it is defence against the first thing a curious
 * player does, which is open the network tab. A daily puzzle that can be read
 * out of a response is not a puzzle, and unlike a mispriced casino table the
 * damage is not measurable in Gold: it is that the share grid stops meaning
 * anything, for everyone, which is the only thing the feature is for.
 *
 * The second rule is the day. One board per player per UTC day, enforced by
 * the store's unique index rather than by a check here -- see
 * daily-puzzle-store.ts for why finishing must block a new attempt just as
 * firmly as playing does.
 */

export const WORDLE_GAME = "wordle";

export interface WordleView {
  /** Null when the player has not opened today's board yet. */
  round: WordleSnapshot | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  /** Drives the "next puzzle in ..." countdown, so the client need not know the rollover rule. */
  msUntilNextPuzzle: number;
}

/**
 * `unknown-word` is a player typing a non-word: expected, costs nothing, and
 * the board should shrug rather than show an error banner.
 */
export class WordleRequestError extends ArcadeRequestError<
  WordleSnapshot,
  "unknown-word" | "rolled-over" | "stale"
> {
  readonly name = "WordleRequestError";
}

type StoredWordle = StoredPuzzleRound<WordleRound>;

/** Everything a request needs to know about "today", resolved once per call. */
function today(now = new Date()) {
  const day = puzzleDay(now);
  return { day, number: puzzleNumber(day), msUntilNext: msUntilNextPuzzle(now) };
}

function snapshot(stored: StoredWordle): WordleSnapshot {
  return toWordleSnapshot(stored.round, {
    day: stored.day,
    puzzleNumber: puzzleNumber(stored.day),
    version: stored.version,
  });
}

function view(
  stored: StoredWordle | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
): WordleView {
  return {
    round: stored ? snapshot(stored) : null,
    profile,
    day: clock.day,
    puzzleNumber: clock.number,
    msUntilNextPuzzle: clock.msUntilNext,
  };
}

/**
 * Today's board as it stands, or null if it has not been opened.
 *
 * Read-only: it never opens a board. Visiting a page must not be the same
 * thing as starting a puzzle, and the app's own rule is that game reads do not
 * write. Opening is POST, which costs the client one extra request on the
 * first visit of a day and nothing after.
 */
export async function readWordlePuzzle(token: string): Promise<WordleView> {
  const profile = await ensureProfile(token);
  const clock = today();
  const stored = await getPuzzleRound<WordleRound>(profile.id, WORDLE_GAME, clock.day);
  return view(stored, profile, clock);
}

/**
 * Opens today's board, or hands back the one already in progress.
 *
 * A refresh, a second tab or a back-button is a resume, not a new board --
 * and here that is stricter than the casino games' version of the same rule:
 * a finished attempt resumes too. The player gets their completed grid back,
 * not a fresh word. Replaying a word you have already been shown would make
 * the share grid a lie.
 */
export async function startWordlePuzzle(token: string): Promise<WordleView & { resumed: boolean }> {
  const profile = await ensureProfile(token);
  const clock = today();

  const existing = await getPuzzleRound<WordleRound>(profile.id, WORDLE_GAME, clock.day);
  if (existing) return { ...view(existing, profile, clock), resumed: true };

  // The answer is chosen here and nowhere else. pickDaily walks the pool, so
  // every player asking on the same UTC day gets the same word -- which is the
  // entire premise of a shareable result.
  const round = startWordleRound(pickDaily(WORDLE_ANSWERS, clock.day, WORDLE_GAME));

  let stored: StoredWordle;
  try {
    stored = await createPuzzleRound<WordleRound>({
      profileId: profile.id,
      game: WORDLE_GAME,
      day: clock.day,
      round,
      complete: false,
    });
  } catch (error) {
    if (error instanceof DailyPuzzleAlreadyStarted) {
      // Lost a race with another tab. The board that won is the real one.
      const live = await getPuzzleRound<WordleRound>(profile.id, WORDLE_GAME, clock.day);
      if (live) return { ...view(live, profile, clock), resumed: true };
    }
    throw error;
  }

  return { ...view(stored, profile, clock), resumed: false };
}

/**
 * Plays one guess.
 *
 * `day` and `version` are both required and both checked. The day catches a
 * board that rolled over while the player was staring at it -- at 00:00 UTC
 * their tab is holding yesterday's puzzle, and applying a guess to today's
 * word would burn a guess on a board they have not seen. The version pins the
 * guess to the exact state they were looking at, so a double-fired submit
 * cannot spend two of their six on one word.
 */
export async function playWordleGuess(
  token: string,
  input: { day: string; version: number; guess: string },
): Promise<WordleView> {
  const profile = await ensureProfile(token);
  const clock = today();

  if (input.day !== clock.day) {
    throw new WordleRequestError(
      "A new puzzle just went up — this board has rolled over.",
      409,
      { reason: "rolled-over" },
    );
  }

  const current = await getPuzzleRound<WordleRound>(profile.id, WORDLE_GAME, clock.day);
  if (!current) throw new WordleRequestError("You have not started today's puzzle.", 404);

  if (current.version !== input.version) {
    throw new WordleRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = wordleGuessProblem(current.round, input.guess);
  if (problem === "finished") {
    throw new WordleRequestError("Today's puzzle is already done.", 409, { round: snapshot(current) });
  }
  if (problem) {
    throw new WordleRequestError("A guess is five letters.", 400, { round: snapshot(current) });
  }

  // The dictionary check is here rather than in the engine because the word
  // list is server-only -- shipping it to the browser would hand over the
  // shape of every future answer. A non-word is ordinary play, not a fault:
  // it costs no guess and the board is returned untouched.
  if (!isAllowedWordleGuess(input.guess)) {
    throw new WordleRequestError("Not in the word list.", 400, {
      reason: "unknown-word",
      round: snapshot(current),
    });
  }

  const next = submitWordleGuess(current.round, input.guess);
  const complete = next.status !== "active";
  const stored = await advancePuzzleRound<WordleRound>(current, next, complete);
  if (!stored) {
    // A lost race did not happen. Return the board that did.
    const live = await getPuzzleRound<WordleRound>(profile.id, WORDLE_GAME, clock.day);
    throw new WordleRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: live ? snapshot(live) : undefined,
    });
  }

  // Win or lose, the attempt is finished -- "complete one brain game" is
  // about playing, not winning. Awaited: the route responds with this
  // function's own return value, so a fire-and-forget call here could be
  // dropped by a frozen serverless invocation right after the response goes
  // out. applyMissionEvent never throws, so this only costs latency.
  if (complete) await applyMissionEvent(profile.id, { kind: "puzzle_completed" });
  if (complete) await applyAchievementEvent(profile.id, { kind: "puzzle_completed" });

  return view(stored, profile, clock);
}

/**
 * Maps a thrown error to the response both Wordle routes send. Lives here
 * rather than beside the handlers because every other file under app/api is a
 * route.ts, and lib/server/api-auth.ts already established that a lib/server
 * module may hand back a NextResponse.
 */
export function toWordleErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That puzzle could not be played.");
}

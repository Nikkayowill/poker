import "server-only";
import { NextResponse } from "next/server";
import { msUntilNextPuzzle, pickDaily, puzzleDay, puzzleNumber } from "@/lib/arcade/puzzles/daily";
import { WORD_STACK_ANSWERS } from "@/lib/arcade/puzzles/word-stack-answers";
import { isAllowedWordStackGuess } from "@/lib/arcade/puzzles/word-stack-dictionary";
import {
  startWordStackRound,
  submitWordStackGuess,
  toWordStackSnapshot,
  wordStackGuessProblem,
  type WordStackRound,
  type WordStackSnapshot,
} from "@/lib/arcade/puzzles/word-stack";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  DailyPuzzleAlreadyStarted,
  advancePuzzleRound,
  createPuzzleRound,
  getPuzzleRound,
  type StoredPuzzleRound,
} from "./daily-puzzle-store";
import { MIN_ANTE_UP_WAGER, anteUpWordStackPayout, wordStackDailyBonusMultiplier } from "@/lib/arcade/ante-up-word-stack";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { applyAchievementEvent } from "./achievement-store";
import { creditDailyBonus } from "./daily-puzzle-bonus";
import { applyMissionEvent } from "./mission-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a Word Stack request and the board.
 *
 * The answer never leaves this file. The word is read from a `server-only`
 * list, put straight into the stored round, and every path out to the
 * browser goes through toWordStackSnapshot, which nulls it until the round
 * is over. That's less about defending against a determined attacker than
 * against the first thing a curious player does, which is open the network
 * tab. A daily puzzle that can be read out of a response isn't a puzzle,
 * and the damage isn't measurable in Gold the way a mispriced casino table's
 * would be: the share grid stops meaning anything, for everyone, which is
 * the only thing the feature is for.
 *
 * One board per player per UTC day, enforced by the store's unique index
 * rather than by a check here (see daily-puzzle-store.ts for why finishing
 * must block a new attempt just as firmly as playing does). A wager does
 * not relax this, and that's deliberate: Word Stack keeps its once-a-day
 * limit no matter how it's played, unlike Sudoku/Memory Match, which lost
 * their daily gate entirely. A wager just attaches to that one attempt
 * instead of unlocking a second, separately-repeatable game.
 *
 * Money moves here too, and the same ordering rules apply. A wager is
 * optional: the player picks it before opening today's board, 0 meaning
 * the free daily play this game has always been. When wagered:
 *
 *   1. The wager leaves the wallet before the board's row exists
 *      (startWordStackPuzzle below); a row that fails to persist refunds it.
 *   2. A payout is credited only after the version-guarded settle write
 *      (advancePuzzleRound) is confirmed; a lost race must never pay.
 *   3. Settlement is a single credit, never a second debit: a win pays
 *      wager * multiplier (anteUpWordStackPayout), a loss pays nothing
 *      because the wager is already spent.
 *
 * A wager replaces the free path's daily completion bonus rather than
 * stacking with it. Free play still earns creditDailyBonus exactly as it
 * always has; a wagered attempt earns the wager's own payout instead.
 */

export const WORD_STACK_GAME = "word-stack";

/** The stored round, plus the wager it was opened with. Zero for the free daily play. */
export interface StoredWordStackRound extends WordStackRound {
  wager: number;
}

export interface WordStackView {
  /** Null when the player has not opened today's board yet. */
  round: (WordStackSnapshot & { wager: number; payout: number }) | null;
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
export class WordStackRequestError extends ArcadeRequestError<
  WordStackSnapshot,
  "unknown-word" | "rolled-over" | "stale"
> {
  readonly name = "WordStackRequestError";
}

type StoredWordStack = StoredPuzzleRound<StoredWordStackRound>;

/** Everything a request needs to know about "today", resolved once per call. */
function today(now = new Date()) {
  const day = puzzleDay(now);
  return { day, number: puzzleNumber(day), msUntilNext: msUntilNextPuzzle(now) };
}

/** The base redacted snapshot, no wager/payout: what error payloads carry. */
function snapshot(stored: StoredWordStack): WordStackSnapshot {
  return toWordStackSnapshot(stored.round, {
    day: stored.day,
    puzzleNumber: puzzleNumber(stored.day),
    version: stored.version,
  });
}

function view(
  stored: StoredWordStack | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
): WordStackView {
  return {
    round: stored
      ? {
          ...snapshot(stored),
          wager: stored.round.wager,
          payout: anteUpWordStackPayout({ wager: stored.round.wager, word: stored.round }),
        }
      : null,
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
export async function readWordStackPuzzle(token: string): Promise<WordStackView> {
  const profile = await ensureProfile(token);
  const clock = today();
  const stored = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, clock.day);
  return view(stored, profile, clock);
}

/**
 * Opens today's board at a wager (0 for the free play this has always been),
 * or hands back the one already in progress.
 *
 * A refresh, a second tab or a back-button is a resume, not a new board,
 * and here that's stricter than the casino games' version of the same rule:
 * a finished attempt resumes too. The player gets their completed grid back,
 * not a fresh word, since replaying a word they've already been shown would
 * make the share grid a lie. The wager chosen on a resume is ignored: the
 * one that opened the row is the one that's live, and a second open can't
 * change what is already staked.
 *
 * Rule 1 of the money-ordering rules restated at the top of this file: the
 * wager leaves before the row exists, and a row that fails to persist
 * refunds it.
 */
export async function startWordStackPuzzle(
  token: string,
  wagerInput = 0,
): Promise<WordStackView & { resumed: boolean }> {
  const profile = await ensureProfile(token);
  const clock = today();

  const existing = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, clock.day);
  if (existing) return { ...view(existing, profile, clock), resumed: true };

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new WordStackRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new WordStackRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error;
  // spendGoldByProfile is the authority.
  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new WordStackRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  // The answer is chosen here and nowhere else. pickDaily walks the pool, so
  // every player asking on the same UTC day gets the same word, which is the
  // entire premise of a shareable result. Every player's wager is their own;
  // the word itself never depends on it.
  const round: StoredWordStackRound = {
    ...startWordStackRound(pickDaily(WORD_STACK_ANSWERS, clock.day, WORD_STACK_GAME)),
    wager: wagerInput,
  };

  let stored: StoredWordStack;
  try {
    stored = await createPuzzleRound<StoredWordStackRound>({
      profileId: profile.id,
      game: WORD_STACK_GAME,
      day: clock.day,
      round,
      complete: false,
    });
  } catch (error) {
    // The row never came into existence, so the player must not have paid for it.
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof DailyPuzzleAlreadyStarted) {
      // Lost a race with another tab. The board that won is the real one.
      const live = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, clock.day);
      if (live) return { ...view(live, profile, clock), resumed: true };
    }
    throw error;
  }

  // Only a real wager earns XP; nothing was risked on a free attempt, the
  // same reasoning ante-up-service.ts's openAnteUpAttempt gives.
  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, new Date()).catch(() => null);

  return { ...view(stored, profile, clock), resumed: false };
}

/**
 * Plays one guess.
 *
 * `day` and `version` are both required and both checked. The day catches a
 * board that rolled over while the player was staring at it: at 00:00 UTC
 * their tab is holding yesterday's puzzle, and applying a guess to today's
 * word would burn a guess on a board they have not seen. The version pins the
 * guess to the exact state they were looking at, so a double-fired submit
 * cannot spend two of their six on one word.
 */
export async function playWordStackGuess(
  token: string,
  input: { day: string; version: number; guess: string },
): Promise<WordStackView> {
  const profile = await ensureProfile(token);
  const clock = today();

  if (input.day !== clock.day) {
    throw new WordStackRequestError(
      "A new puzzle just went up — this board has rolled over.",
      409,
      { reason: "rolled-over" },
    );
  }

  const current = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, clock.day);
  if (!current) throw new WordStackRequestError("You have not started today's puzzle.", 404);

  if (current.version !== input.version) {
    throw new WordStackRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = wordStackGuessProblem(current.round, input.guess);
  if (problem === "finished") {
    throw new WordStackRequestError("Today's puzzle is already done.", 409, { round: snapshot(current) });
  }
  if (problem) {
    throw new WordStackRequestError("A guess is five letters.", 400, { round: snapshot(current) });
  }

  // The dictionary check is here rather than in the engine because the word
  // list is server-only; shipping it to the browser would hand over the
  // shape of every future answer. A non-word is ordinary play, not a fault:
  // it costs no guess and the board is returned untouched.
  if (!isAllowedWordStackGuess(input.guess)) {
    throw new WordStackRequestError("Not in the word list.", 400, {
      reason: "unknown-word",
      round: snapshot(current),
    });
  }

  const nextWord = submitWordStackGuess(current.round, input.guess);
  const next: StoredWordStackRound = { ...nextWord, wager: current.round.wager };
  const complete = next.status !== "active";
  const stored = await advancePuzzleRound<StoredWordStackRound>(current, next, complete);
  if (!stored) {
    // A lost race did not happen. Return the board that did.
    const live = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, clock.day);
    throw new WordStackRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: live ? snapshot(live) : undefined,
    });
  }

  // Win or lose, the attempt is finished; "complete one brain game" is about
  // playing, not winning. Awaited: the route responds with this function's
  // own return value, so a fire-and-forget call here could be dropped by a
  // frozen serverless invocation right after the response goes out.
  // applyMissionEvent never throws, so this only costs latency.
  if (complete) await applyMissionEvent(profile.id, { kind: "puzzle_completed" });
  if (complete) await applyAchievementEvent(profile.id, { kind: "puzzle_completed" });

  // A wager replaces the daily completion bonus rather than stacking with
  // it. Rule 2/3: a win credits wager * multiplier only after the settle
  // write above is confirmed; a loss credits nothing, since the wager
  // already left the wallet when the board was opened.
  if (complete && current.round.wager > 0) {
    const payout = anteUpWordStackPayout({ wager: current.round.wager, word: next });
    if (payout > 0) {
      await creditGoldByProfile(profile.id, payout).catch((error) => {
        console.error("word-stack.wager_payout_credit_failed", { profileId: profile.id, payout, error });
      });
    }
  } else if (complete) {
    // The per-game daily bonus, replacing the retired flat "daily_brain_game"
    // mission (see lib/server/daily-puzzle-bonus.ts). Pays even on a loss, at
    // the floor multiplier. Only the free path earns this.
    await creditDailyBonus(profile.id, wordStackDailyBonusMultiplier(next));
  }

  return view(stored, profile, clock);
}

/**
 * Maps a thrown error to the response both Word Stack routes send. Lives here
 * rather than beside the handlers because every other file under app/api is a
 * route.ts, and lib/server/api-auth.ts already established that a lib/server
 * module may hand back a NextResponse.
 */
export function toWordStackErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That puzzle could not be played.");
}

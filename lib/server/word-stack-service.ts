import "server-only";
import { NextResponse } from "next/server";
import {
  PUZZLE_EPOCH_DAY,
  msUntilNextPuzzle,
  pickDaily,
  previousDay,
  puzzleDay,
  puzzleNumber,
} from "@/lib/arcade/puzzles/daily";
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
  getOrCreateCanonicalAnswer,
  getPuzzleRound,
  getPuzzleRoundsForProfile,
  type StoredPuzzleRound,
} from "./daily-puzzle-store";
import {
  MIN_ANTE_UP_WAGER,
  WAGER_MULTIPLIER_BY_GUESSES,
  anteUpWordStackPayout,
  wordStackDailyBonusMultiplier,
} from "@/lib/arcade/ante-up-word-stack";
import type { WagerLadder } from "@/lib/arcade/ante-up-ladder";
import { anteUpWagerCeilingProblem } from "@/lib/arcade/ante-up-stakes";
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
 *
 * The puzzle archive: every function below takes an optional `day`, letting
 * a player open and play any past day back to PUZZLE_EPOCH_DAY, not just
 * today's. Two rules make that safe rather than a reopened version of the
 * daily gate it otherwise protects:
 *
 *   - Archive plays are free-only. No wager on any day but today's -- see
 *     the isArchive check in startWordStackPuzzle. Word Stack kept its
 *     1-attempt/day gate specifically to bound staked play; letting an
 *     archive wager too would remove that bound entirely (dozens of past
 *     days, back to back, in one sitting).
 *   - An archive completion earns no mission/achievement/daily-bonus credit
 *     -- see the isToday guards in playWordStackGuess. Only finishing
 *     *today's* puzzle is real once-a-day progress.
 *
 * The answer for a given day is resolved through
 * getOrCreateCanonicalAnswer (daily-puzzle-store.ts) rather than calling
 * pickDaily directly: pickDaily is a pure function of the answer pool's
 * *current* size, so recomputing it for an old day after the pool has grown
 * can silently produce a different word than the one actually shown that
 * day. See that function's own doc comment.
 */

export const WORD_STACK_GAME = "word-stack";

/** The stored round, plus the wager it was opened with. Zero for the free daily play. */
export interface StoredWordStackRound extends WordStackRound {
  wager: number;
  /**
   * The payout ladder this round was opened under, copied in at open and
   * never re-read from the module afterwards. A daily board can be opened in
   * the morning and finished at night; without this, a retune landing in
   * between pays the player at a rate they never agreed to. Optional: rounds
   * written before this field existed fall back to the live table. See
   * lib/arcade/ante-up-ladder.ts.
   *
   * Only meaningful when `wager > 0`; a free round has no payout to protect.
   */
  wagerLadder?: WagerLadder;
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

/**
 * `viewDay` describes whichever day the board being shown belongs to --
 * today's by default, or an archive day when one is passed in. `msUntilNext`
 * always describes the real countdown to tomorrow regardless: that is a
 * property of "today," not of whichever day happens to be on screen.
 */
function view(
  stored: StoredWordStack | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
  viewDay: string = clock.day,
): WordStackView {
  return {
    round: stored
      ? {
          ...snapshot(stored),
          wager: stored.round.wager,
          payout: anteUpWordStackPayout({
            wager: stored.round.wager,
            word: stored.round,
            ladder: stored.round.wagerLadder,
          }),
        }
      : null,
    profile,
    day: viewDay,
    puzzleNumber: puzzleNumber(viewDay),
    msUntilNextPuzzle: clock.msUntilNext,
  };
}

/**
 * A board as it stands, or null if it has not been opened. Today's by
 * default; pass `day` to read an archive day instead.
 *
 * Read-only: it never opens a board. Visiting a page must not be the same
 * thing as starting a puzzle, and the app's own rule is that game reads do not
 * write. Opening is POST, which costs the client one extra request on the
 * first visit of a day and nothing after.
 */
export async function readWordStackPuzzle(token: string, day?: string): Promise<WordStackView> {
  const profile = await ensureProfile(token);
  const clock = today();
  const targetDay = day ?? clock.day;
  const stored = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, targetDay);
  return view(stored, profile, clock, targetDay);
}

/**
 * Opens a board at a wager (0 for the free play this has always been), or
 * hands back the one already in progress. Today's board by default; pass
 * `day` to open an archive day instead, which is always free (see below).
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
  day?: string,
): Promise<WordStackView & { resumed: boolean }> {
  const profile = await ensureProfile(token);
  const clock = today();
  const targetDay = day ?? clock.day;
  const isArchive = targetDay !== clock.day;

  if (targetDay > clock.day) throw new WordStackRequestError("That puzzle hasn't been posted yet.", 400);
  if (targetDay < PUZZLE_EPOCH_DAY) {
    throw new WordStackRequestError("There's no puzzle before the archive begins.", 400);
  }

  const existing = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, targetDay);
  if (existing) return { ...view(existing, profile, clock, targetDay), resumed: true };

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new WordStackRequestError("That is not a wager.", 400);
  }
  // Archive plays are free-only, checked here rather than only at the route
  // so a caller cannot reach the wager path by skipping route-level
  // validation. See this file's header for why: the 1-attempt/day gate is
  // the only thing bounding staked play, and an archive would remove that
  // bound entirely if wagering were allowed on it too.
  if (isArchive && wagerInput > 0) {
    throw new WordStackRequestError("Archive puzzles are free to play — wagering is only on today's word.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new WordStackRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }
  // One flat ceiling: there is no harder board to earn a bigger one with, and
  // the shared daily word is the same for everybody. See
  // lib/arcade/ante-up-stakes.ts. Deliberately after the resume short-circuit
  // above -- a resumed round already ignores the client's wager.
  const overCeiling = anteUpWagerCeilingProblem(WORD_STACK_GAME, null, wagerInput);
  if (overCeiling) throw new WordStackRequestError(overCeiling, 400);

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error;
  // spendGoldByProfile is the authority.
  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new WordStackRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  // The answer is the canonical one for this day: pickDaily only actually
  // runs on that day's first-ever ask (today's first opener, or an
  // archive's first visitor) and is cached forever after. See
  // getOrCreateCanonicalAnswer's own doc comment for why recomputing
  // pickDaily fresh for an old day is unsafe once the pool has grown.
  const answer = await getOrCreateCanonicalAnswer(
    WORD_STACK_GAME,
    targetDay,
    () => pickDaily(WORD_STACK_ANSWERS, targetDay, WORD_STACK_GAME),
    (round) => (round as StoredWordStackRound).answer,
  );
  const round: StoredWordStackRound = {
    ...startWordStackRound(answer),
    wager: wagerInput,
    // Copied in only for a real wager; see the field's own doc comment.
    ...(wagerInput > 0 ? { wagerLadder: WAGER_MULTIPLIER_BY_GUESSES } : {}),
  };

  let stored: StoredWordStack;
  try {
    stored = await createPuzzleRound<StoredWordStackRound>({
      profileId: profile.id,
      game: WORD_STACK_GAME,
      day: targetDay,
      round,
      complete: false,
    });
  } catch (error) {
    // The row never came into existence, so the player must not have paid for it.
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof DailyPuzzleAlreadyStarted) {
      // Lost a race with another tab. The board that won is the real one.
      const live = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, targetDay);
      if (live) return { ...view(live, profile, clock, targetDay), resumed: true };
    }
    throw error;
  }

  // Only a real wager earns XP; nothing was risked on a free attempt, the
  // same reasoning ante-up-service.ts's openAnteUpAttempt gives.
  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, new Date()).catch(() => null);

  return { ...view(stored, profile, clock, targetDay), resumed: false };
}

/**
 * Plays one guess.
 *
 * `day` and `version` are both required and both checked. The day used to
 * have to equal today's exactly; the puzzle archive loosens that on purpose
 * to any day from PUZZLE_EPOCH_DAY through today -- `profile.id` scoping in
 * getPuzzleRound below is what stops a player addressing anyone else's
 * board, not this equality check, so widening it does not widen who can
 * read or write what. A day still strictly after today (a clock skew, a
 * forged future date) is rejected: there is no puzzle to play yet, and this
 * is also what catches a board that rolled over while the player was
 * staring at today's -- at 00:00 UTC their tab is holding yesterday's
 * puzzle, and applying a guess to today's word would burn a guess on a
 * board they have not seen. The version pins the guess to the exact state
 * they were looking at, so a double-fired submit cannot spend two of their
 * six on one word.
 */
export async function playWordStackGuess(
  token: string,
  input: { day: string; version: number; guess: string },
): Promise<WordStackView> {
  const profile = await ensureProfile(token);
  const clock = today();

  if (input.day > clock.day) {
    throw new WordStackRequestError(
      "A new puzzle just went up — this board has rolled over.",
      409,
      { reason: "rolled-over" },
    );
  }
  if (input.day < PUZZLE_EPOCH_DAY) {
    throw new WordStackRequestError("There's no puzzle before the archive begins.", 400);
  }

  const current = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, input.day);
  if (!current) throw new WordStackRequestError("You have not started that puzzle.", 404);
  // Only today's completion earns mission/achievement/daily-bonus credit --
  // see the two isToday guards below and this file's header.
  const isToday = current.day === clock.day;

  if (current.version !== input.version) {
    throw new WordStackRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = wordStackGuessProblem(current.round, input.guess);
  if (problem === "finished") {
    throw new WordStackRequestError("That puzzle is already done.", 409, { round: snapshot(current) });
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
  const next: StoredWordStackRound = {
    ...nextWord,
    wager: current.round.wager,
    ...(current.round.wagerLadder ? { wagerLadder: current.round.wagerLadder } : {}),
  };
  const complete = next.status !== "active";
  const stored = await advancePuzzleRound<StoredWordStackRound>(current, next, complete);
  if (!stored) {
    // A lost race did not happen. Return the board that did.
    const live = await getPuzzleRound<StoredWordStackRound>(profile.id, WORD_STACK_GAME, current.day);
    throw new WordStackRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: live ? snapshot(live) : undefined,
    });
  }

  // Win or lose, the attempt is finished; "complete one brain game" is about
  // playing, not winning. Awaited: the route responds with this function's
  // own return value, so a fire-and-forget call here could be dropped by a
  // frozen serverless invocation right after the response goes out.
  // applyMissionEvent never throws, so this only costs latency. Archive
  // completions earn none of this -- see isToday above and this file's header.
  if (complete && isToday) await applyMissionEvent(profile.id, { kind: "puzzle_completed" });
  if (complete && isToday) await applyAchievementEvent(profile.id, { kind: "puzzle_completed" });

  // A wager replaces the daily completion bonus rather than stacking with
  // it. Rule 2/3: a win credits wager * multiplier only after the settle
  // write above is confirmed; a loss credits nothing, since the wager
  // already left the wallet when the board was opened. The wager branch is
  // naturally unreachable on an archive day (startWordStackPuzzle forces
  // wager to 0 there), but the daily-bonus branch still needs its own
  // isToday guard so an archive win doesn't quietly collect it.
  if (complete && current.round.wager > 0) {
    const payout = anteUpWordStackPayout({
      wager: current.round.wager,
      word: next,
      ladder: current.round.wagerLadder,
    });
    if (payout > 0) {
      await creditGoldByProfile(profile.id, payout).catch((error) => {
        console.error("word-stack.wager_payout_credit_failed", { profileId: profile.id, payout, error });
      });
    }
  } else if (complete && isToday) {
    // The per-game daily bonus, replacing the retired flat "daily_brain_game"
    // mission (see lib/server/daily-puzzle-bonus.ts). Pays even on a loss, at
    // the floor multiplier. Only today's free path earns this.
    await creditDailyBonus(profile.id, wordStackDailyBonusMultiplier(next));
  }

  return view(stored, profile, clock, current.day);
}

export type WordStackArchiveStatus = "not-started" | "active" | "won" | "lost";

export interface WordStackArchiveDay {
  day: string;
  puzzleNumber: number;
  status: WordStackArchiveStatus;
}

/**
 * This player's status on every Word Stack day from yesterday back through
 * the epoch -- "days you missed." Today is deliberately excluded: it's the
 * live puzzle the main page already handles, not part of the archive.
 *
 * `token` is nullable and, unlike every other function in this file, never
 * mints a profile when it's missing: the archive list is a read reachable
 * with no session cookie at all (a direct link to /games/word-stack/archive
 * with nothing else visited first), and visiting a read-only page must never
 * be what creates a player -- see lib/server/session-minting.test.ts, which
 * enforces this at the route level for exactly this reason. With no token
 * there is by definition no history, so every day is reported "not-started"
 * without touching the database at all.
 *
 * One query (getPuzzleRoundsForProfile, index-backed), not one per day: a
 * day absent from that result set defaults to "not-started" here rather than
 * being queried for individually or erroring.
 */
export async function listWordStackArchive(token: string | null): Promise<WordStackArchiveDay[]> {
  const clock = today();
  const profile = token ? await ensureProfile(token) : null;
  const attempts = profile
    ? await getPuzzleRoundsForProfile<StoredWordStackRound>(profile.id, WORD_STACK_GAME, { before: clock.day })
    : [];
  const byDay = new Map(attempts.map((attempt) => [attempt.day, attempt]));

  const days: WordStackArchiveDay[] = [];
  for (let day = previousDay(clock.day); day >= PUZZLE_EPOCH_DAY; day = previousDay(day)) {
    const attempt = byDay.get(day);
    days.push({
      day,
      puzzleNumber: puzzleNumber(day),
      status:
        !attempt
          ? "not-started"
          : attempt.status === "active"
            ? "active"
            : attempt.round.status === "won"
              ? "won"
              : "lost",
    });
  }
  return days;
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

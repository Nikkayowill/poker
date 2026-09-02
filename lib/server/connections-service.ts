import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import {
  PUZZLE_EPOCH_DAY,
  msUntilNextPuzzle,
  pickDaily,
  previousDay,
  puzzleDay,
  puzzleNumber,
} from "@/lib/arcade/puzzles/daily";
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
  getOrCreateCanonicalAnswer,
  getPuzzleRound,
  getPuzzleRoundsForProfile,
  type StoredPuzzleRound,
} from "./daily-puzzle-store";
import {
  MIN_ANTE_UP_WAGER,
  WAGER_MULTIPLIER_BY_MISTAKES,
  anteUpConnectionsPayout,
  connectionsDailyBonusMultiplier,
} from "@/lib/arcade/ante-up-connections";
import type { WagerLadder } from "@/lib/arcade/ante-up-ladder";
import { anteUpWagerCeilingProblem } from "@/lib/arcade/ante-up-stakes";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { applyAchievementEvent } from "./achievement-store";
import { creditDailyBonus } from "./daily-puzzle-bonus";
import { applyMissionEvent } from "./mission-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a Connections request and the board.
 *
 * The shape is word-stack-service.ts's, and the rules that govern both are
 * restated rather than referenced because breaking one silently ruins the
 * feature for everyone rather than for one player. The core rule: **the
 * groups never leave this file.**
 *
 * Here that rule has a second edge the Word Stack service does not need. The
 * answer is not only the four groups, it is also *which group each word is
 * in*, which the server necessarily computes on every guess. Reporting those
 * per-word would turn four wrong guesses into a complete solution, so a wrong
 * guess reports "one away" or nothing at all, and the per-word colour matrix
 * the share text is built from is withheld until the round is over. That
 * redaction lives in toConnectionsSnapshot; this file's job is to make sure
 * every path out to the browser goes through it.
 *
 * The day rule: one board per player per UTC day, enforced by the store's
 * unique index rather than by a check here. **A wager does not relax this**,
 * same call as Word Stack's (see word-stack-service.ts's header for the full
 * reasoning): Connections keeps its once-a-day limit no matter how it is
 * played, and a wager attaches to that one attempt.
 *
 * Money now moves here when wagered, following the same three rules
 * word-stack-service.ts restates: debit before the row exists (refund on a
 * failed insert), credit only after the version-guarded settle write is
 * confirmed, and a wager replaces the free path's daily bonus rather than
 * stacking with it.
 *
 * The puzzle archive: every function below takes an optional `day`, same
 * shape and same two rules as Word Stack's -- see word-stack-service.ts's
 * header for the full reasoning, restated only in brief here: archive plays
 * are free-only (no wager on any day but today's, checked in
 * startConnectionsPuzzle), and an archive completion earns no mission/
 * achievement/daily-bonus credit (the isToday guards in
 * playConnectionsGuess). The puzzle for a given day is resolved through
 * getOrCreateCanonicalAnswer (daily-puzzle-store.ts) rather than calling
 * pickDaily directly, for the same pool-size-drift reason Word Stack's does.
 */

export const CONNECTIONS_GAME = "connections";

/** The stored round, plus the wager it was opened with. Zero for the free daily play. */
export interface StoredConnectionsRound extends ConnectionsRound {
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

export interface ConnectionsView {
  /** Null when the player has not opened today's board yet. */
  round: (ConnectionsSnapshot & { wager: number; payout: number }) | null;
  profile: PlayerProfile;
  day: string;
  puzzleNumber: number;
  msUntilNextPuzzle: number;
}

/** `repeat` is ordinary play: a selection already tried, refused without charging a mistake. */
export class ConnectionsRequestError extends ArcadeRequestError<
  ConnectionsSnapshot,
  "repeat" | "rolled-over" | "stale"
> {
  readonly name = "ConnectionsRequestError";
}

type StoredConnections = StoredPuzzleRound<StoredConnectionsRound>;

function today(now = new Date()) {
  const day = puzzleDay(now);
  return { day, number: puzzleNumber(day), msUntilNext: msUntilNextPuzzle(now) };
}

/** The base redacted snapshot, no wager/payout: what error payloads carry. */
function snapshot(stored: StoredConnections): ConnectionsSnapshot {
  return toConnectionsSnapshot(stored.round, {
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
  stored: StoredConnections | null,
  profile: PlayerProfile,
  clock: ReturnType<typeof today>,
  viewDay: string = clock.day,
): ConnectionsView {
  return {
    round: stored
      ? {
          ...snapshot(stored),
          wager: stored.round.wager,
          payout: anteUpConnectionsPayout({
            wager: stored.round.wager,
            puzzle: stored.round,
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
 * default; pass `day` to read an archive day instead. Read-only; opening is
 * POST.
 */
export async function readConnectionsPuzzle(token: string, day?: string): Promise<ConnectionsView> {
  const profile = await ensureProfile(token);
  const clock = today();
  const targetDay = day ?? clock.day;
  const stored = await getPuzzleRound<StoredConnectionsRound>(profile.id, CONNECTIONS_GAME, targetDay);
  return view(stored, profile, clock, targetDay);
}

/**
 * Opens a board at a wager (0 for the free play this has always been), or
 * hands back the one already in progress, including a finished one. Today's
 * board by default; pass `day` to open an archive day instead, which is
 * always free (see below). A completed attempt resumes rather than
 * re-deals, for the same reason it does at Word Stack: replaying a board
 * you have already solved would make the shared grid a lie, and the wager
 * chosen on a resume is ignored; the one that opened the row is the one
 * that is live.
 *
 * Rule 1: the wager leaves before the row exists, and a row that fails to
 * persist refunds it.
 */
export async function startConnectionsPuzzle(
  token: string,
  wagerInput = 0,
  day?: string,
): Promise<ConnectionsView & { resumed: boolean }> {
  const profile = await ensureProfile(token);
  const clock = today();
  const targetDay = day ?? clock.day;
  const isArchive = targetDay !== clock.day;

  if (targetDay > clock.day) throw new ConnectionsRequestError("That puzzle hasn't been posted yet.", 400);
  if (targetDay < PUZZLE_EPOCH_DAY) {
    throw new ConnectionsRequestError("There's no puzzle before the archive begins.", 400);
  }

  const existing = await getPuzzleRound<StoredConnectionsRound>(profile.id, CONNECTIONS_GAME, targetDay);
  if (existing) return { ...view(existing, profile, clock, targetDay), resumed: true };

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new ConnectionsRequestError("That is not a wager.", 400);
  }
  // Archive plays are free-only, checked here rather than only at the route
  // so a caller cannot reach the wager path by skipping route-level
  // validation. See this file's header for why.
  if (isArchive && wagerInput > 0) {
    throw new ConnectionsRequestError("Archive puzzles are free to play — wagering is only on today's board.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new ConnectionsRequestError(
      `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
      400,
    );
  }
  // One flat ceiling; see lib/arcade/ante-up-stakes.ts and Word Stack's twin
  // of this check. Deliberately after the resume short-circuit above.
  const overCeiling = anteUpWagerCeilingProblem(CONNECTIONS_GAME, null, wagerInput);
  if (overCeiling) throw new ConnectionsRequestError(overCeiling, 400);

  // The puzzle is the canonical one for this day: pickDaily only actually
  // runs on that day's first-ever ask and is cached forever after -- see
  // getOrCreateCanonicalAnswer's own doc comment for why recomputing
  // pickDaily fresh for an old day is unsafe once the pool has grown. The
  // tile order (randomInt) is not part of the canon: the board is shared,
  // the shuffle is not, and node:crypto's randomInt is used rather than
  // Math.random for the same reason the deck uses it -- this is the only
  // randomness the server owns here.
  //
  // Deliberately before the debit. This reads and writes no money and needs
  // nothing the debit produces, but it CAN throw (it talks to the database),
  // and it used to sit between the debit and the try/catch below that refunds
  // -- so a throw here charged the player and handed back no board. Rule 1
  // still holds with it up here: the stake leaves before the round it pays
  // for exists.
  const puzzle = await getOrCreateCanonicalAnswer(
    CONNECTIONS_GAME,
    targetDay,
    () => pickDaily(CONNECTIONS_PUZZLES, targetDay, CONNECTIONS_GAME),
    (round) => ({ groups: (round as StoredConnectionsRound).groups }),
  );

  // Rule 1: the wager leaves first. Null is "cannot afford", not an error;
  // spendGoldByProfile is the authority.
  const debited = wagerInput > 0 ? await spendGoldByProfile(profile.id, wagerInput) : profile;
  if (!debited) {
    throw new ConnectionsRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  const round: StoredConnectionsRound = {
    ...startConnectionsRound(puzzle, randomInt),
    wager: wagerInput,
    // Copied in only for a real wager; see the field's own doc comment.
    ...(wagerInput > 0 ? { wagerLadder: WAGER_MULTIPLIER_BY_MISTAKES } : {}),
  };

  let stored: StoredConnections;
  try {
    stored = await createPuzzleRound<StoredConnectionsRound>({
      profileId: profile.id,
      game: CONNECTIONS_GAME,
      day: targetDay,
      round,
      complete: false,
    });
  } catch (error) {
    if (wagerInput > 0) await creditGoldByProfile(profile.id, wagerInput).catch(() => null);
    if (error instanceof DailyPuzzleAlreadyStarted) {
      const live = await getPuzzleRound<StoredConnectionsRound>(profile.id, CONNECTIONS_GAME, targetDay);
      if (live) return { ...view(live, profile, clock, targetDay), resumed: true };
    }
    throw error;
  }

  if (wagerInput > 0) await awardWager(profile.id, token, wagerInput, new Date()).catch(() => null);

  return { ...view(stored, profile, clock, targetDay), resumed: false };
}

/**
 * Plays one selection of four words.
 *
 * `day` and `version` are checked for the reasons they are at Word Stack: the
 * day used to have to equal today's exactly; the puzzle archive loosens that
 * on purpose to any day from PUZZLE_EPOCH_DAY through today -- `profile.id`
 * scoping in getPuzzleRound below is what stops a player addressing anyone
 * else's board, not this equality check. A day still strictly after today is
 * rejected (no puzzle to play yet), which is also what catches a board that
 * rolled over at 00:00 UTC while the player was staring at today's. The
 * version pins the guess to the exact state they were looking at, so a
 * double-fired submit cannot spend two of the player's four mistakes on one
 * selection.
 */
export async function playConnectionsGuess(
  token: string,
  input: { day: string; version: number; selection: string[] },
): Promise<ConnectionsView> {
  const profile = await ensureProfile(token);
  const clock = today();

  if (input.day > clock.day) {
    throw new ConnectionsRequestError(
      "A new puzzle just went up — this board has rolled over.",
      409,
      { reason: "rolled-over" },
    );
  }
  if (input.day < PUZZLE_EPOCH_DAY) {
    throw new ConnectionsRequestError("There's no puzzle before the archive begins.", 400);
  }

  const current = await getPuzzleRound<StoredConnectionsRound>(profile.id, CONNECTIONS_GAME, input.day);
  if (!current) throw new ConnectionsRequestError("You have not started that puzzle.", 404);
  // Only today's completion earns mission/achievement/daily-bonus credit --
  // see the two isToday guards below and this file's header.
  const isToday = current.day === clock.day;

  if (current.version !== input.version) {
    throw new ConnectionsRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: snapshot(current),
    });
  }

  const problem = connectionsGuessProblem(current.round, input.selection);
  if (problem === "finished") {
    throw new ConnectionsRequestError("That puzzle is already done.", 409, {
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

  const nextPuzzle = submitConnectionsGuess(current.round, input.selection);
  const next: StoredConnectionsRound = {
    ...nextPuzzle,
    wager: current.round.wager,
    ...(current.round.wagerLadder ? { wagerLadder: current.round.wagerLadder } : {}),
  };
  const complete = next.status !== "active";
  const stored = await advancePuzzleRound<StoredConnectionsRound>(current, next, complete);
  if (!stored) {
    const live = await getPuzzleRound<StoredConnectionsRound>(profile.id, CONNECTIONS_GAME, current.day);
    throw new ConnectionsRequestError("That board moved on. Here is where it actually stands.", 409, {
      reason: "stale",
      round: live ? snapshot(live) : undefined,
    });
  }

  // Awaited because the route responds with this function's own return value,
  // so a fire-and-forget call here could be dropped by a frozen serverless
  // invocation right after the response goes out. applyMissionEvent never
  // throws, so this only costs latency, not reliability. Archive completions
  // earn none of this -- see isToday above and this file's header.
  if (complete && isToday) await applyMissionEvent(profile.id, { kind: "puzzle_completed" });
  if (complete && isToday) await applyAchievementEvent(profile.id, { kind: "puzzle_completed" });

  // A wager replaces the daily completion bonus, it does not stack with it,
  // same call as Word Stack's. A win credits wager * multiplier only after
  // the settle write above is confirmed; a loss credits nothing, the wager
  // already having left the wallet when the board was opened. The wager
  // branch is naturally unreachable on an archive day (startConnectionsPuzzle
  // forces wager to 0 there), but the daily-bonus branch still needs its own
  // isToday guard so an archive win doesn't quietly collect it.
  if (complete && current.round.wager > 0) {
    const payout = anteUpConnectionsPayout({
      wager: current.round.wager,
      puzzle: next,
      ladder: current.round.wagerLadder,
    });
    if (payout > 0) {
      await creditGoldByProfile(profile.id, payout).catch((error) => {
        console.error("connections.wager_payout_credit_failed", { profileId: profile.id, payout, error });
      });
    }
  } else if (complete && isToday) {
    // The per-game daily bonus, replacing the retired flat "daily_brain_game"
    // mission; see lib/server/daily-puzzle-bonus.ts. Pays even on a loss, at
    // the floor multiplier. Only today's free path earns this.
    await creditDailyBonus(profile.id, connectionsDailyBonusMultiplier(next));
  }

  return view(stored, profile, clock, current.day);
}

export type ConnectionsArchiveStatus = "not-started" | "active" | "won" | "lost";

export interface ConnectionsArchiveDay {
  day: string;
  puzzleNumber: number;
  status: ConnectionsArchiveStatus;
}

/**
 * This player's status on every Connections day from yesterday back through
 * the epoch -- "days you missed." Today is deliberately excluded: it's the
 * live puzzle the main page already handles, not part of the archive.
 *
 * `token` is nullable and never mints a profile when it's missing, same
 * reasoning as listWordStackArchive's twin: a direct link straight to
 * /games/connections/archive is a read with no session cookie yet, and
 * visiting a read-only page must never be what creates a player -- see
 * lib/server/session-minting.test.ts. With no token there is by definition
 * no history, so every day is reported "not-started" without a database
 * call.
 *
 * One query (getPuzzleRoundsForProfile, index-backed), not one per day: a
 * day absent from that result set defaults to "not-started" here rather than
 * being queried for individually or erroring.
 */
export async function listConnectionsArchive(token: string | null): Promise<ConnectionsArchiveDay[]> {
  const clock = today();
  const profile = token ? await ensureProfile(token) : null;
  const attempts = profile
    ? await getPuzzleRoundsForProfile<StoredConnectionsRound>(profile.id, CONNECTIONS_GAME, { before: clock.day })
    : [];
  const byDay = new Map(attempts.map((attempt) => [attempt.day, attempt]));

  const days: ConnectionsArchiveDay[] = [];
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

/** Maps a thrown error to the response both Connections routes send. Same placement rationale as Word Stack's. */
export function toConnectionsErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That puzzle could not be played.");
}

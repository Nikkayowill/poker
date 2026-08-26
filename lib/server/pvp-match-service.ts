import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import type { AnyDuelGame, DuelOutcome, DuelSeat } from "@/lib/pvp/match-contract";
import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import { duelGame } from "@/lib/pvp/registry";
import type { PlayerProfile } from "@/lib/profile/types";
import { applyAchievementEvent } from "./achievement-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { isBlockedEitherWay } from "./friends-store";
import { recordDuelResult } from "./leaderboard-store";
import {
  attachMatchToChallenge,
  claimChallenge,
  createChallenge,
  expireStaleChallenges,
  listOpenChallenges,
  OpenChallengeExists,
  releaseChallenge,
  reopenClaimedChallenge,
  type StoredPvpChallenge,
} from "./pvp-challenge-store";
import {
  ActivePvpMatchExists,
  advancePvpMatch,
  createPvpMatch,
  getActivePvpMatch,
  getPvpMatchById,
  getRecentlySettledPvpMatch,
  type StoredPvpMatch,
} from "./pvp-match-store";
import { applyMissionEvent } from "./mission-store";
import {
  creditGoldByProfile,
  ensureProfile,
  getPublicProfilesByIds,
  spendGoldByProfile,
} from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a duel request and the wallet.
 *
 * ## The ordering rules
 *
 * A duel is winner-take-all with no house: both players ante the same stake,
 * the winner takes both, a draw returns each their own. That makes Gold
 * conserved across a match (the two balances sum to the same number before
 * and after), and every rule below exists to keep that true under retries,
 * double-clicks, two tabs and both players acting at once.
 *
 *   1. **A stake leaves a wallet before the thing it pays for exists**, and
 *      anything that fails afterwards refunds it. The challenger is debited
 *      before the challenge row; the acceptor before the match row. The
 *      reverse order creates a game nobody paid for.
 *   2. **The pot is credited only after the version-guarded write that settles
 *      the match is confirmed.** `advancePvpMatch` returns null when it loses
 *      that race, and null must never pay. This is the whole reason a pot
 *      cannot be paid twice when both players' clients report the same
 *      checkmate in the same instant.
 *   3. **Settlement is a credit of what comes back, never a second debit.**
 *      Both stakes already left in rule 1, so a win credits `stake * 2` to one
 *      player and nothing to the other; a draw credits `stake` to each. A
 *      "net" settlement here would charge the loser twice.
 *   4. **Escrow is released exactly once.** An open challenge holds real Gold.
 *      Every path that ends one (cancel, expire, a failed accept) goes
 *      through a status-guarded write that returns the row at most once, and
 *      only a returned row is refunded. Refunding on a null return is what
 *      would turn a double-tapped Cancel into free Gold.
 *
 * Rule 4 has no equivalent in the casino services: nothing there held a
 * stake for a counterparty who might never arrive.
 */

/** Refuses a duel request in a way the player can act on. */
export class DuelRequestError extends ArcadeRequestError<never> {
  readonly name = "DuelRequestError";
}

// ---- wire shapes -----------------------------------------------------------

export interface DuelPlayerView {
  profileId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

export interface DuelMatchView {
  id: string;
  game: string;
  version: number;
  status: "active" | "settled";
  /** Which seat the READER holds. Their board orients from this. */
  yourSeat: DuelSeat;
  players: [DuelPlayerView, DuelPlayerView];
  stake: number;
  /** stake * 2. Stated rather than left for the client to multiply. */
  pot: number;
  /** Null while playing; on a settled match, null means a draw. */
  winnerSeat: DuelSeat | null;
  outcome: DuelOutcome | null;
  /** The game's own redacted view, for this reader. */
  state: unknown;
}

export interface DuelChallengeView {
  id: string;
  game: string;
  challenger: DuelPlayerView;
  /** Null on an open-to-anyone challenge. */
  opponentId: string | null;
  stake: number;
  expiresAt: string;
  /** Whether the reader is the one whose Gold is escrowed against this. */
  mine: boolean;
}

// ---- helpers ---------------------------------------------------------------

function requireGame(id: string): AnyDuelGame {
  const game = duelGame(id);
  if (!game) throw new DuelRequestError("That game is not available.", 404);
  return game;
}

/** Which seat this profile holds, or null if they are not in this match. */
function seatOf(match: StoredPvpMatch, profileId: string): DuelSeat | null {
  if (match.players[0] === profileId) return 0;
  if (match.players[1] === profileId) return 1;
  return null;
}

async function playerViews(ids: [string, string]): Promise<[DuelPlayerView, DuelPlayerView]> {
  const profiles = await getPublicProfilesByIds(ids);
  return ids.map((id) => {
    const profile = profiles.get(id);
    return {
      profileId: id,
      // A vanished profile leaves a seat labelled rather than blank. The FKs
      // cascade, so this should only be reachable mid-deletion.
      displayName: profile?.displayName ?? "Player",
      initials: profile?.initials ?? "??",
      avatarUrl: profile?.avatarUrl ?? null,
      accent: profile?.accent ?? "#e7c66a",
    };
  }) as [DuelPlayerView, DuelPlayerView];
}

/**
 * Builds what a specific reader may see.
 *
 * The reader's seat is passed to the engine's `snapshot`, which is the
 * redaction boundary: a trivia answer or a word race solution is dropped
 * there, per viewer. Anyone who is not one of the two players gets a 403
 * before reaching this, so `seat` is never guessed.
 */
async function matchView(
  game: AnyDuelGame,
  match: StoredPvpMatch,
  seat: DuelSeat,
  now: number,
): Promise<DuelMatchView> {
  return {
    id: match.id,
    game: match.game,
    version: match.version,
    status: match.status,
    yourSeat: seat,
    players: await playerViews(match.players),
    stake: match.stake,
    pot: match.stake * 2,
    winnerSeat: match.winnerSeat,
    outcome: match.status === "settled" ? game.result(match.state) : null,
    state: game.snapshot(match.state, seat, now),
  };
}

/**
 * Pays a settled match out. Never throws.
 *
 * The match is already durably settled by the time this runs, so letting a
 * credit failure bubble would turn a finished game into an error response and
 * cost a player their result on top of their Gold. Logged loudly instead:
 * this is the one place a duel can quietly cost real currency.
 *
 * Rule 3: a win is one credit of the whole pot, a draw is one credit of their
 * own stake to each, never a debit (both stakes already left in rule 1).
 */
async function payOutMatch(match: StoredPvpMatch): Promise<void> {
  const pot = match.stake * 2;
  const credits: [string, number][] =
    match.winnerSeat === null
      // A draw returns each player their own ante: `stake` twice rather than
      // `pot / 2`, since a division is how an odd pot silently loses a Gold,
      // and the two halves are what was actually taken.
      ? [[match.players[0], match.stake], [match.players[1], match.stake]]
      : [[match.players[match.winnerSeat], pot]];

  // Independent profiles, no ordering between them, so run concurrently.
  await Promise.all(credits.map(async ([profileId, amount]) => {
    try {
      await creditGoldByProfile(profileId, amount);
    } catch (error) {
      console.error("pvp.payout_credit_failed", {
        game: match.game,
        matchId: match.id,
        profileId,
        amount,
        error,
      });
    }
  }));

  // Leaderboard stats record unconditionally, unlike the mission/achievement
  // calls below: a draw is a real result on a per-game record and must show
  // up on both players' rows, not just a decided match's winner.
  // recordDuelResult never throws, same contract as the two calls it sits
  // beside.
  await recordDuelResult(match.game, match.players, match.winnerSeat);

  // A draw is not a win: only a decided match feeds the "win a duel" missions
  // and achievements. Awaited, not fired-and-forgotten: every caller of
  // payOutMatch awaits it before its own route responds, and a serverless
  // invocation can be frozen right after the response is sent, so an
  // un-awaited call here could simply never run. Neither call ever throws,
  // so this adds no new failure.
  if (match.winnerSeat !== null) {
    const winnerId = match.players[match.winnerSeat];
    await applyMissionEvent(winnerId, { kind: "duel_won" });
    await applyAchievementEvent(winnerId, { kind: "duel_won" });
  }
}

/**
 * Settles a match if the game says it is over, and pays it.
 *
 * The result is read off the state that has already been written, never off
 * one just computed (rule 2). A settle that loses the version race returns
 * without paying, because the winning writer is the one that will pay.
 */
async function settleIfFinished(
  game: AnyDuelGame,
  match: StoredPvpMatch,
): Promise<StoredPvpMatch> {
  const outcome = game.result(match.state);
  if (!outcome || match.status !== "active") return match;

  const settled = await advancePvpMatch(match, match.state, { winnerSeat: outcome.winner });
  // Rule 2: a lost race did not happen, so it does not pay. The writer that
  // won it is settling and paying this same match right now.
  if (!settled) return (await getPvpMatchById(match.id)) ?? match;

  await payOutMatch(settled);
  return settled;
}

/**
 * Refunds every challenge a sweep reclaimed. Never throws.
 *
 * Rule 4: `expireStaleChallenges` returns each row at most once because its
 * UPDATE is guarded on `status = 'open'`, so this cannot double-refund even if
 * two requests sweep at the same moment.
 */
async function refundExpired(expired: StoredPvpChallenge[]): Promise<void> {
  // Independent challengers, no ordering between them, so run concurrently.
  await Promise.all(expired.map(async (challenge) => {
    try {
      await creditGoldByProfile(challenge.challengerId, challenge.stake);
    } catch (error) {
      console.error("pvp.expiry_refund_failed", {
        challengeId: challenge.id,
        profileId: challenge.challengerId,
        stake: challenge.stake,
        error,
      });
    }
  }));
}

// ---- challenges ------------------------------------------------------------

/**
 * Opens a challenge, escrowing the challenger's stake.
 *
 * Rule 1: the Gold leaves before the row exists, and a row that fails to
 * persist refunds. The reverse order would advertise a challenge backed by
 * nothing, which the acceptor would then pay into.
 */
export async function openDuelChallenge(
  token: string,
  gameId: string,
  stake: number,
  opponentId: string | null,
): Promise<{ challenge: DuelChallengeView; profile: PlayerProfile }> {
  const game = requireGame(gameId);
  const profile = await ensureProfile(token);
  if (!Number.isInteger(stake) || stake < MIN_DUEL_STAKE) {
    throw new DuelRequestError(
      `Wager at least ${MIN_DUEL_STAKE.toLocaleString()} Gold to open a duel.`,
      400,
    );
  }

  if (opponentId) {
    if (opponentId === profile.id) {
      throw new DuelRequestError("You cannot challenge yourself.", 400);
    }
    const targets = await getPublicProfilesByIds([opponentId]);
    if (!targets.has(opponentId)) throw new DuelRequestError("No such player.", 404);
    // Checked before the wallet is touched, so a blocked challenge costs
    // nothing and needs no refund.
    if (await isBlockedEitherWay(profile.id, opponentId)) {
      throw new DuelRequestError("You cannot challenge that player.", 403);
    }
  }

  // Rule 1: the stake leaves first. Null is "cannot afford", not an error;
  // spendGoldByProfile is the authority, and any balance read before it is
  // stale.
  const debited = await spendGoldByProfile(profile.id, stake);
  if (!debited) {
    throw new DuelRequestError(
      `You need ${stake.toLocaleString()} Gold to stake this duel.`,
      400,
    );
  }

  let challenge: StoredPvpChallenge;
  try {
    challenge = await createChallenge({
      game: game.id,
      challengerId: profile.id,
      opponentId,
      // Retained as a stored column, not a chosen ladder rung any more; see
      // MIN_DUEL_STAKE's doc comment. Nothing reads this back for meaning.
      tier: "custom",
      stake,
    });
  } catch (error) {
    // The challenge never came into existence, so the player must not have
    // paid for it.
    await creditGoldByProfile(profile.id, stake).catch(() => null);
    if (error instanceof OpenChallengeExists) {
      throw new DuelRequestError(error.message, 409);
    }
    throw error;
  }

  const [challenger] = await playerViews([profile.id, profile.id]);
  return {
    challenge: {
      id: challenge.id,
      game: challenge.game,
      challenger,
      opponentId: challenge.opponentId,
      stake: challenge.stake,
      expiresAt: challenge.expiresAt,
      mine: true,
    },
    profile: debited,
  };
}

/** The challenges this player can act on, plus their own standing offer. */
export async function listDuelChallenges(
  token: string,
  gameId: string,
): Promise<{ challenges: DuelChallengeView[]; profile: PlayerProfile }> {
  const game = requireGame(gameId);
  const profile = await ensureProfile(token);

  // Swept on the read, and every reclaimed row refunded. Correctness does not
  // depend on it having run, since listOpenChallenges filters on expires_at
  // regardless, but a challenger's escrow coming back does.
  await refundExpired(await expireStaleChallenges());

  const rows = await listOpenChallenges(profile.id, game.id);
  if (rows.length === 0) return { challenges: [], profile };

  const challengerIds = [...new Set(rows.map((row) => row.challengerId))];
  const profiles = await getPublicProfilesByIds(challengerIds);

  return {
    challenges: rows.flatMap((row) => {
      const challenger = profiles.get(row.challengerId);
      if (!challenger) return [];
      return [{
        id: row.id,
        game: row.game,
        challenger: {
          profileId: row.challengerId,
          displayName: challenger.displayName,
          initials: challenger.initials,
          avatarUrl: challenger.avatarUrl,
          accent: challenger.accent,
        },
        opponentId: row.opponentId,
        stake: row.stake,
        expiresAt: row.expiresAt,
        mine: row.challengerId === profile.id,
      }];
    }),
    profile,
  };
}

/**
 * Withdraws the caller's own challenge and refunds their escrow.
 *
 * Rule 4: only a row `releaseChallenge` actually returned is refunded. It
 * returns one at most once, so a double-tapped Cancel refunds once and the
 * second press reports there was nothing to withdraw.
 */
export async function cancelDuelChallenge(
  token: string,
  challengeId: string,
): Promise<{ profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const released = await releaseChallenge(challengeId, profile.id, "cancelled");
  if (!released) {
    throw new DuelRequestError("That challenge is no longer open.", 409);
  }
  const refunded = await creditGoldByProfile(profile.id, released.stake);
  return { profile: refunded ?? profile };
}

/**
 * Accepts a challenge: debits the acceptor and opens the match.
 *
 * The order is claim, then pay, then build, and every failure after the
 * claim unwinds everything before it:
 *
 *   - The **claim** is a status-guarded UPDATE, so exactly one acceptor can
 *     ever take a given challenge. Doing it first is what stops two players
 *     both paying into one escrowed stake.
 *   - The **debit** comes next (rule 1). If they cannot afford it, the claim
 *     is reopened so the challenger's escrow goes back into the pool rather
 *     than being stranded in an accepted row that never became a match.
 *   - The **match** is built last. If it will not persist, the acceptor is
 *     refunded and the challenge reopened; neither player has paid for a
 *     game that does not exist.
 */
export async function acceptDuelChallenge(
  token: string,
  challengeId: string,
): Promise<{ match: DuelMatchView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);

  const claimed = await claimChallenge(challengeId, profile.id);
  if (!claimed) {
    // Covers every way this can fail at once: taken, expired, withdrawn,
    // addressed to someone else, or their own. All of them are "not yours to
    // accept", and distinguishing them would leak who is challenging whom.
    throw new DuelRequestError("That challenge is no longer available.", 409);
  }

  const game = duelGame(claimed.game);
  if (!game) {
    await reopenClaimedChallenge(claimed.id);
    throw new DuelRequestError("That game is not available.", 404);
  }

  if (await isBlockedEitherWay(profile.id, claimed.challengerId)) {
    await reopenClaimedChallenge(claimed.id);
    throw new DuelRequestError("You cannot play that player.", 403);
  }

  // Rule 1: the acceptor's stake leaves before the match exists.
  const debited = await spendGoldByProfile(profile.id, claimed.stake);
  if (!debited) {
    await reopenClaimedChallenge(claimed.id);
    throw new DuelRequestError(
      `You need ${claimed.stake.toLocaleString()} Gold to accept this duel.`,
      400,
    );
  }

  let match: StoredPvpMatch;
  try {
    // The challenger is seat 0: they moved first by challenging, and at
    // chess that means white. node:crypto's randomInt, not Math.random, since
    // the seed decides a trivia set and a word race's word, and both decide
    // real Gold, so it must not be reachable or predictable from a browser.
    const state = game.createState(randomInt(0, 2 ** 31 - 1), Date.now());
    match = await createPvpMatch({
      game: claimed.game,
      players: [claimed.challengerId, profile.id],
      tier: claimed.tier,
      stake: claimed.stake,
      state,
    });
  } catch (error) {
    // Neither player may pay for a match that does not exist: refund the
    // acceptor, and put the challenger's escrow back in the pool.
    await creditGoldByProfile(profile.id, claimed.stake).catch(() => null);
    await reopenClaimedChallenge(claimed.id);
    if (error instanceof ActivePvpMatchExists) {
      throw new DuelRequestError(error.message, 409);
    }
    throw error;
  }

  await attachMatchToChallenge(claimed.id, match.id);

  // Both players wagered, so both earn XP at the ordinary rate, the same
  // parity argument hand-completion.ts makes about chips and Gold. Non-fatal
  // by contract: a progression outage must not fail a match both players
  // paid for.
  await Promise.all([
    awardWager(claimed.challengerId, null, claimed.stake).catch(() => null),
    awardWager(profile.id, token, claimed.stake).catch(() => null),
  ]);

  return { match: await matchView(game, match, 1, Date.now()), profile: debited };
}

// ---- matches ---------------------------------------------------------------

/**
 * The caller's live match of this game, or null.
 *
 * Ticks the clock before answering, which is what makes a chess flag fall and
 * a trivia question time out without either client having to be open. A tick
 * that finishes the game settles and pays it here, so a player who closed the
 * tab still gets what they won.
 */
export async function readDuelMatch(
  token: string,
  gameId: string,
): Promise<{ match: DuelMatchView | null; profile: PlayerProfile }> {
  const game = requireGame(gameId);
  const profile = await ensureProfile(token);

  let match = await getActivePvpMatch(profile.id, game.id);
  if (!match) {
    // No live match, but it may have just settled without this player being
    // the one whose request settled it (their opponent resigned, flagged, or
    // was the one whose own poll happened to observe the win condition
    // first). Without this fallback that player's next poll would find
    // nothing and drop them straight back to the lobby, having never seen
    // whether they won or lost.
    const recent = await getRecentlySettledPvpMatch<unknown>(profile.id, game.id);
    if (!recent) return { match: null, profile };
    const recentSeat = seatOf(recent, profile.id);
    if (recentSeat === null) return { match: null, profile };
    return { match: await matchView(game, recent, recentSeat, Date.now()), profile };
  }

  const seat = seatOf(match, profile.id);
  if (seat === null) return { match: null, profile };

  const now = Date.now();
  const ticked = game.tick?.(match.state, now) ?? null;
  if (ticked !== null) {
    // A tick that loses the version race is fine to drop: the writer that won
    // it advanced the same clock. Re-read so the reader sees the winner's
    // state rather than their own discarded one.
    const advanced = await advancePvpMatch(match, ticked, null);
    match = advanced ?? (await getPvpMatchById(match.id)) ?? match;
  }

  match = await settleIfFinished(game, match);
  return { match: await matchView(game, match, seat, now), profile };
}

/** A specific match by id, live or finished. 403 unless the reader is in it. */
export async function readDuelMatchById(
  token: string,
  matchId: string,
): Promise<{ match: DuelMatchView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const match = await getPvpMatchById(matchId);
  if (!match) throw new DuelRequestError("No such match.", 404);

  const seat = seatOf(match, profile.id);
  // Not 404: they asked about a real match. But the state holds hidden
  // information, so a stranger gets no view of it at all rather than a
  // redacted one; an unknown viewer must be the most restrictive case.
  if (seat === null) throw new DuelRequestError("That is not your match.", 403);

  const game = requireGame(match.game);
  return { match: await matchView(game, match, seat, Date.now()), profile };
}

/**
 * Applies one player's move, and settles the match if it ended.
 *
 * `version` is required and checked: it pins the move to the exact state the
 * player was looking at, so a replayed or double-fired request cannot move
 * twice or answer one trivia question with two submissions.
 *
 * Whose turn it is is not checked here. The engine owns turn order: chess
 * rejects a move from the seat that is not to act, while trivia accepts
 * either seat at any moment, so a check at this layer would have to be
 * wrong for one of the two.
 */
export async function playDuelMove(
  token: string,
  input: { matchId: string; version: number; move: unknown },
): Promise<{ match: DuelMatchView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getPvpMatchById(input.matchId);
  if (!current) throw new DuelRequestError("No such match.", 404);

  const seat = seatOf(current, profile.id);
  if (seat === null) throw new DuelRequestError("That is not your match.", 403);

  const game = requireGame(current.game);
  const now = Date.now();

  if (current.status !== "active") {
    throw new DuelRequestError("That match is already over.", 409, {
      round: (await matchView(game, current, seat, now)) as never,
    });
  }
  if (current.version !== input.version) {
    throw new DuelRequestError("That match moved on. Here is where it actually stands.", 409, {
      round: (await matchView(game, current, seat, now)) as never,
    });
  }

  // The clock is applied before the move: a player whose flag fell while the
  // request was in flight has lost, and must not get one more move in.
  const ticked = game.tick?.(current.state, now) ?? current.state;
  const applied = game.applyMove(ticked, seat, input.move, now);
  if ("reject" in applied) {
    throw new DuelRequestError(applied.reject, 409, {
      round: (await matchView(game, current, seat, now)) as never,
    });
  }

  const outcome = game.result(applied.next);
  const stored = await advancePvpMatch(
    current,
    applied.next,
    outcome ? { winnerSeat: outcome.winner } : null,
  );
  if (!stored) {
    // Rule 2: a lost race did not happen, so it does not pay and it does not
    // move. Hand back where the match actually stands.
    const live = (await getPvpMatchById(current.id)) ?? current;
    throw new DuelRequestError("That match moved on. Here is where it actually stands.", 409, {
      round: (await matchView(game, live, seat, now)) as never,
    });
  }

  // Rule 2: paid only after the guarded write is confirmed.
  if (outcome) await payOutMatch(stored);

  return { match: await matchView(game, stored, seat, now), profile };
}

/**
 * Concedes the match, paying the pot to the other player.
 *
 * Routed through the engine's `resign` rather than settled here, so a game
 * that does not treat quitting as a plain loss can say so, and the final
 * state a player sees says how it ended rather than a board that just stops.
 */
export async function resignDuelMatch(
  token: string,
  matchId: string,
): Promise<{ match: DuelMatchView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getPvpMatchById(matchId);
  if (!current) throw new DuelRequestError("No such match.", 404);

  const seat = seatOf(current, profile.id);
  if (seat === null) throw new DuelRequestError("That is not your match.", 403);

  const game = requireGame(current.game);
  const now = Date.now();
  if (current.status !== "active") {
    return { match: await matchView(game, current, seat, now), profile };
  }

  const next = game.resign
    ? game.resign(current.state, seat, now)
    : current.state;
  // A game with no `resign` of its own still has to end: the concession is
  // recorded here so the pot moves even though the board did not.
  const outcome = game.result(next) ?? {
    winner: (seat === 0 ? 1 : 0) as DuelSeat,
    reason: "Resigned",
  };

  const stored = await advancePvpMatch(current, next, { winnerSeat: outcome.winner });
  if (!stored) {
    // Rule 2 again: somebody else settled it first, and they paid it.
    const live = (await getPvpMatchById(current.id)) ?? current;
    return { match: await matchView(game, live, seat, now), profile };
  }

  await payOutMatch(stored);
  return { match: await matchView(game, stored, seat, now), profile };
}

/** Maps a thrown error to the response every duel route sends. */
export function toDuelErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That duel could not be played.");
}

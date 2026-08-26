import "server-only";
import { randomUUID } from "crypto";
import { adminClient } from "./supabase-admin";

/**
 * Open duel challenges: an offer with the challenger's Gold already escrowed.
 *
 * Every write here is one half of a money movement, so the shape to keep in
 * mind is that a row in `open` status means the challenger has already been
 * debited and has not been paid back. Settling that row (accepting,
 * declining, cancelling, expiring) is what decides whether the Gold becomes a
 * pot or a refund, and it must happen exactly once. That is why every
 * terminal write below is a status-guarded UPDATE returning the row, never a
 * read followed by a write: the guard is what makes a double-tapped Decline
 * refund once.
 *
 * Freshness is a predicate on `expires_at`, never a consequence of the sweep
 * having run, the same rule table-invite-store.ts states and for the same
 * reason: a challenge one second past its window must not be acceptable even
 * though nothing has marked it expired yet. Here it matters more, because
 * accepting one debits the acceptor.
 */

/**
 * How long an offer stands.
 *
 * Ten minutes rather than the table invite's five: an invite is "come sit down
 * at a hand running right now", where a duel challenge is "play me when you
 * see this". Long enough to catch a friend who is between things, short enough
 * that escrowed Gold is not locked up all evening.
 */
export const DUEL_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** How many open challenges one lobby read returns. */
export const CHALLENGE_PAGE_SIZE = 25;

/** Postgres' unique_violation; here, pvp_challenges_one_open_per_challenger. */
const UNIQUE_VIOLATION = "23505";

export type PvpChallengeStatus = "open" | "accepted" | "cancelled" | "expired";

export interface StoredPvpChallenge {
  id: string;
  game: string;
  challengerId: string;
  /** Null means open to anyone: the matchmaking queue. */
  opponentId: string | null;
  tier: string;
  /** What the challenger has already been debited. A refund pays back exactly this. */
  stake: number;
  status: PvpChallengeStatus;
  matchId: string | null;
  createdAt: string;
  expiresAt: string;
}

export class OpenChallengeExists extends Error {
  constructor(game: string) {
    super(`You already have an open ${game} challenge.`);
    this.name = "OpenChallengeExists";
  }
}

declare global {
  var __riverRoomPvpChallenges: Map<string, StoredPvpChallenge> | undefined;
}

const memoryChallenges =
  globalThis.__riverRoomPvpChallenges ?? new Map<string, StoredPvpChallenge>();
globalThis.__riverRoomPvpChallenges = memoryChallenges;

/** Test seam only: the memory branch is process-global. */
export function __resetPvpChallengesForTest(): void {
  memoryChallenges.clear();
}

const CHALLENGE_COLUMNS =
  "id, game, challenger_id, opponent_id, tier, stake, status, match_id, created_at, expires_at";

interface ChallengeRow {
  id: string;
  game: string;
  challenger_id: string;
  opponent_id: string | null;
  tier: string;
  stake: number | string;
  status: string;
  match_id: string | null;
  created_at: string;
  expires_at: string;
}

function fromRow(row: ChallengeRow): StoredPvpChallenge {
  return {
    id: String(row.id),
    game: String(row.game),
    challengerId: String(row.challenger_id),
    opponentId: row.opponent_id ? String(row.opponent_id) : null,
    tier: String(row.tier),
    stake: Number(row.stake),
    status: String(row.status) as PvpChallengeStatus,
    matchId: row.match_id ? String(row.match_id) : null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  };
}

export function challengeExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + DUEL_CHALLENGE_TTL_MS).toISOString();
}

/**
 * Settles every open challenge whose window has closed, and returns them.
 *
 * Returns the rows rather than a count, unlike expireStaleTableInvites, and
 * that difference is the whole point: each of these carries escrowed Gold
 * that has to be refunded, and the caller pays them back. Because the UPDATE
 * is guarded on `status = 'open'`, a row can only be returned to one caller
 * ever, so two concurrent sweeps cannot both refund the same challenge.
 */
export async function expireStaleChallenges(now: Date = new Date()): Promise<StoredPvpChallenge[]> {
  const stamp = now.toISOString();
  const supabase = adminClient();

  if (!supabase) {
    const swept: StoredPvpChallenge[] = [];
    for (const challenge of memoryChallenges.values()) {
      if (challenge.status !== "open" || challenge.expiresAt > stamp) continue;
      challenge.status = "expired";
      swept.push({ ...challenge });
    }
    return swept;
  }

  const { data, error } = await supabase
    .from("pvp_challenges")
    .update({ status: "expired", responded_at: stamp })
    .eq("status", "open")
    .lte("expires_at", stamp)
    .select(CHALLENGE_COLUMNS);
  if (error) throw new Error(`Could not expire stale challenges: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as ChallengeRow));
}

/**
 * Opens a challenge for a stake that has already been debited.
 *
 * Throws OpenChallengeExists when this player already has one open for this
 * game. Caught from the partial unique index rather than by a read-first
 * check: two concurrent creates both pass that check, and each has already
 * taken the challenger's Gold by the time it arrives here.
 */
export async function createChallenge(input: {
  game: string;
  challengerId: string;
  opponentId: string | null;
  tier: string;
  stake: number;
}): Promise<StoredPvpChallenge> {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = challengeExpiry(now);
  const supabase = adminClient();

  if (!supabase) {
    const live = [...memoryChallenges.values()].some(
      (challenge) =>
        challenge.status === "open"
        && challenge.game === input.game
        && challenge.challengerId === input.challengerId,
    );
    if (live) throw new OpenChallengeExists(input.game);
    const challenge: StoredPvpChallenge = {
      id: randomUUID(),
      game: input.game,
      challengerId: input.challengerId,
      opponentId: input.opponentId,
      tier: input.tier,
      stake: input.stake,
      status: "open",
      matchId: null,
      createdAt,
      expiresAt,
    };
    memoryChallenges.set(challenge.id, { ...challenge });
    return { ...challenge };
  }

  // A lapsed row still marked open would hold the partial unique index's slot
  // and turn a legitimate new challenge into OpenChallengeExists. Unconditional
  // rather than throttled: this is the one path whose correctness depends on
  // the sweep having run. Its refunds are the caller's; see the service.
  await expireStaleChallenges(now);

  const { data, error } = await supabase
    .from("pvp_challenges")
    .insert({
      game: input.game,
      challenger_id: input.challengerId,
      opponent_id: input.opponentId,
      tier: input.tier,
      stake: input.stake,
      status: "open",
      expires_at: expiresAt,
    })
    .select(CHALLENGE_COLUMNS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new OpenChallengeExists(input.game);
    throw new Error(`Could not open that challenge: ${error.message}`);
  }
  return fromRow(data as ChallengeRow);
}

/**
 * The challenges this player could act on right now: open ones addressed to
 * them, plus every open-to-anyone challenge for the game.
 *
 * Their own challenges are included so the lobby can show what they have
 * standing (and offer to cancel it) rather than looking empty while their Gold
 * is escrowed.
 */
export async function listOpenChallenges(
  profileId: string,
  game: string,
): Promise<StoredPvpChallenge[]> {
  const nowIso = new Date().toISOString();
  const supabase = adminClient();

  if (!supabase) {
    return [...memoryChallenges.values()]
      .filter(
        (challenge) =>
          challenge.status === "open"
          && challenge.game === game
          && challenge.expiresAt > nowIso
          && (challenge.opponentId === null
            || challenge.opponentId === profileId
            || challenge.challengerId === profileId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, CHALLENGE_PAGE_SIZE)
      .map((challenge) => ({ ...challenge }));
  }

  const { data, error } = await supabase
    .from("pvp_challenges")
    .select(CHALLENGE_COLUMNS)
    .eq("game", game)
    .eq("status", "open")
    .gt("expires_at", nowIso)
    .or(`opponent_id.is.null,opponent_id.eq.${profileId},challenger_id.eq.${profileId}`)
    .order("created_at", { ascending: false })
    .limit(CHALLENGE_PAGE_SIZE);
  if (error) throw new Error(`Could not load challenges: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as ChallengeRow));
}

/**
 * Claims an open challenge for this acceptor, exactly once.
 *
 * Returns the row on success and null on a lost race. This is the duel
 * equivalent of the match version guard, and it is what stops two players
 * accepting the same open challenge and both being debited for one escrowed
 * stake: the `status = 'open'` predicate means one UPDATE wins and the other
 * matches zero rows.
 *
 * Claiming does not create the match; it marks the row `accepted` and hands
 * the caller its terms. The service then debits the acceptor and builds the
 * match, attaching the id with `attachMatchToChallenge`. It's split that way
 * because a claim that is instantly visible to everyone else is what stops
 * the race, and the match cannot exist before the acceptor has paid.
 */
export async function claimChallenge(
  challengeId: string,
  acceptorId: string,
): Promise<StoredPvpChallenge | null> {
  const now = new Date();
  const stamp = now.toISOString();
  const supabase = adminClient();

  if (!supabase) {
    const challenge = memoryChallenges.get(challengeId);
    if (
      !challenge
      || challenge.status !== "open"
      || challenge.expiresAt <= stamp
      || challenge.challengerId === acceptorId
      || (challenge.opponentId !== null && challenge.opponentId !== acceptorId)
    ) {
      return null;
    }
    challenge.status = "accepted";
    return { ...challenge };
  }

  // Every condition below is a predicate on the UPDATE rather than a check
  // before it, so the whole claim is one statement and cannot be raced.
  // `neq(challenger_id)` stops a player accepting their own challenge and
  // being debited twice to play themselves.
  const { data, error } = await supabase
    .from("pvp_challenges")
    .update({ status: "accepted", responded_at: stamp })
    .eq("id", challengeId)
    .eq("status", "open")
    .gt("expires_at", stamp)
    .neq("challenger_id", acceptorId)
    .or(`opponent_id.is.null,opponent_id.eq.${acceptorId}`)
    .select(CHALLENGE_COLUMNS);
  if (error) throw new Error(`Could not accept that challenge: ${error.message}`);

  const row = (data ?? [])[0];
  return row ? fromRow(row as ChallengeRow) : null;
}

/**
 * Records which match a claimed challenge became.
 *
 * Separate from claimChallenge because the match does not exist yet at claim
 * time. The row is already `accepted` and out of everyone else's reach by
 * then, so this needs no guard of its own; the schema's
 * pvp_challenges_match_id_matches_status constraint is what keeps the pair
 * honest.
 */
export async function attachMatchToChallenge(
  challengeId: string,
  matchId: string,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const challenge = memoryChallenges.get(challengeId);
    if (challenge) challenge.matchId = matchId;
    return;
  }

  const { error } = await supabase
    .from("pvp_challenges")
    .update({ match_id: matchId })
    .eq("id", challengeId)
    .eq("status", "accepted");
  if (error) throw new Error(`Could not link that match: ${error.message}`);
}

/**
 * Withdraws a challenge and hands back its terms so the caller can refund it.
 *
 * Returns null when there was nothing to withdraw: already accepted, already
 * cancelled, someone else's. Null must never be refunded: the guard returning
 * a row exactly once is what makes the refund happen exactly once, and paying
 * out on null would turn a double-tapped Cancel into free Gold.
 *
 * `reason` separates a player pressing Cancel from the service unwinding a
 * failed accept. Both refund; they differ only in the row's final status,
 * which is history rather than logic.
 */
export async function releaseChallenge(
  challengeId: string,
  challengerId: string | null,
  reason: "cancelled" | "expired",
): Promise<StoredPvpChallenge | null> {
  const stamp = new Date().toISOString();
  const supabase = adminClient();

  if (!supabase) {
    const challenge = memoryChallenges.get(challengeId);
    if (!challenge || challenge.status !== "open") return null;
    if (challengerId !== null && challenge.challengerId !== challengerId) return null;
    challenge.status = reason;
    return { ...challenge };
  }

  let query = supabase
    .from("pvp_challenges")
    .update({ status: reason, responded_at: stamp })
    .eq("id", challengeId)
    .eq("status", "open");
  // Null means the service is unwinding its own failed accept, where there is
  // no caller to authorize. A player-initiated cancel always names them, so
  // one player cannot withdraw another's escrow.
  if (challengerId !== null) query = query.eq("challenger_id", challengerId);

  const { data, error } = await query.select(CHALLENGE_COLUMNS);
  if (error) throw new Error(`Could not cancel that challenge: ${error.message}`);

  const row = (data ?? [])[0];
  return row ? fromRow(row as ChallengeRow) : null;
}

/**
 * Reopens a claimed challenge after the accept failed downstream.
 *
 * The claim took the row out of the pool; if the acceptor then could not pay,
 * or the match would not persist, the challenger's escrow must not be left
 * stranded in an `accepted` row that never became a match. Guarded on
 * `status = 'accepted'` and a null match_id, so a challenge that did become a
 * match can never be reopened underneath it.
 */
export async function reopenClaimedChallenge(challengeId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const challenge = memoryChallenges.get(challengeId);
    if (challenge && challenge.status === "accepted" && challenge.matchId === null) {
      challenge.status = "open";
    }
    return;
  }

  const { error } = await supabase
    .from("pvp_challenges")
    .update({ status: "open", responded_at: null })
    .eq("id", challengeId)
    .eq("status", "accepted")
    .is("match_id", null);
  if (error) throw new Error(`Could not reopen that challenge: ${error.message}`);
}

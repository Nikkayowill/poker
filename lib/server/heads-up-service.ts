import "server-only";
import { NextResponse } from "next/server";
import { createHeadsUpGame } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/types";
import { isStakesTier, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import { applyAchievementEvent } from "./achievement-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { createStoredGame } from "./game-store";
import {
  cancelEmptyHeadsUpTable,
  claimHeadsUpSeat,
  createHeadsUpTableRow,
  dealHeadsUpTable,
  findOpenHeadsUpTable,
  getActiveHeadsUpTableFor,
  getHeadsUpSeats,
  getHeadsUpTableByGameId,
  getHeadsUpTableById,
  getHeadsUpTablesInvitingPlayer,
  leaveHeadsUpTable as leaveHeadsUpTableRow,
  settleHeadsUpTable,
  HeadsUpTableNotJoinable,
  type HeadsUpSeatRow,
  type HeadsUpTableStatus,
  type StoredHeadsUpTable,
} from "./heads-up-store";
import { recordDuelResult } from "./leaderboard-store";
import { applyMissionEvent } from "./mission-store";
import {
  creditGoldByProfile,
  ensureProfile,
  getProfileById,
  getPublicProfilesByIds,
  spendGoldByProfile,
} from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a heads-up match request and the wallet.
 *
 * This table is only the pre-deal lobby and the escrow around a real poker
 * table -- the hands themselves are played through the ordinary poker
 * engine/routes (lib/game/engine.ts's createHeadsUpGame, the same
 * app/api/games/[id]/actions and /advance routes every table uses), not
 * through anything in this file. See the migration's own header
 * (supabase/migrations/20260826140000_heads_up_tables.sql) for why this is
 * shaped like cribbage's table/service pair rather than pvp_matches.
 *
 * Same four money-ordering rules as every staked game in this app:
 *
 *   1. **A stake leaves a wallet before the seat it pays for exists**, and
 *      anything that fails afterwards refunds it. Opening a table debits the
 *      host before the table row exists; joining debits the joiner before
 *      their seat row exists.
 *   2. **The pot is credited only after the version-guarded write that
 *      settles the table is confirmed.** settleHeadsUpTable returns null
 *      when it loses that race, and null must never pay.
 *   3. **Settlement is a single credit, never a second debit.** Both stakes
 *      already left in rule 1; a win always credits `stake * 2` to exactly
 *      one profile.
 *   4. **A pre-deal leave refunds exactly once**, via a status-guarded write
 *      (leave_heads_up_table) that returns the removed seat at most once.
 *
 * One code path deals a table -- dealHeadsUpTableIfReady, the only place
 * dealHeadsUpTable is called, whether the 2nd seat filled through quick play
 * or through an accepted invite.
 */

export class HeadsUpRequestError extends ArcadeRequestError<never> {
  readonly name = "HeadsUpRequestError";
}

// ---- wire shapes -----------------------------------------------------------

export interface HeadsUpPlayerView {
  profileId: string;
  seat: 0 | 1;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

export interface HeadsUpTableView {
  id: string;
  status: HeadsUpTableStatus;
  version: number;
  tier: StakesTier;
  stake: number;
  /** stake * 2. Stated rather than left for the client to multiply. */
  pot: number;
  hostId: string;
  yourSeat: 0 | 1 | null;
  isHost: boolean;
  players: HeadsUpPlayerView[];
  winnerId: string | null;
  /**
   * The real poker table this match dealt into, once both seats are filled.
   * The client's own waiting room redirects to `/?table=<gameId>` the
   * instant this appears -- there is no bespoke heads-up table UI, same as
   * every other private-table flow in this app.
   */
  gameId: string | null;
}

// ---- helpers ----------------------------------------------------------------

async function playerViews(seats: HeadsUpSeatRow[]): Promise<HeadsUpPlayerView[]> {
  if (seats.length === 0) return [];
  const profiles = await getPublicProfilesByIds(seats.map((s) => s.playerId));
  return seats.map((s) => {
    const profile = profiles.get(s.playerId);
    return {
      profileId: s.playerId,
      seat: s.seat,
      displayName: profile?.displayName ?? "Player",
      initials: profile?.initials ?? "??",
      avatarUrl: profile?.avatarUrl ?? null,
      accent: profile?.accent ?? "#e7c66a",
    };
  });
}

function seatOf(seats: HeadsUpSeatRow[], profileId: string): 0 | 1 | null {
  return seats.find((s) => s.playerId === profileId)?.seat ?? null;
}

async function tableView(
  table: StoredHeadsUpTable,
  seats: HeadsUpSeatRow[],
  readerId: string,
): Promise<HeadsUpTableView> {
  return {
    id: table.id,
    status: table.status,
    version: table.version,
    tier: table.tier,
    stake: table.stake,
    pot: table.stake * 2,
    hostId: table.hostId,
    yourSeat: seatOf(seats, readerId),
    isHost: table.hostId === readerId,
    players: await playerViews(seats),
    winnerId: table.winnerId,
    gameId: table.gameId,
  };
}

/**
 * Deals the table the instant both seats are filled -- the one place
 * dealHeadsUpTable is called. Builds the real poker GameState from both
 * seated players' full profiles (createHeadsUpGame needs each seat's
 * cosmetics, not just an id) and persists it exactly like any other table
 * before linking heads_up_tables.game_id to it.
 *
 * Entrants are built from getHeadsUpSeats' own seat-ascending order, which is
 * what makes heads_up_table_players.seat and the dealt GameState's Seat.position
 * the same number for the same player -- settleHeadsUpIfFinished depends on
 * that correspondence to map a winning Seat.position back to a profile id.
 */
async function dealHeadsUpTableIfReady(tableId: string): Promise<StoredHeadsUpTable | null> {
  const [table, seats] = await Promise.all([getHeadsUpTableById(tableId), getHeadsUpSeats(tableId)]);
  if (!table || seats.length < 2) return null;

  const profiles = await Promise.all(seats.map((seat) => getProfileById(seat.playerId)));
  if (profiles.some((profile) => !profile)) {
    // A seated player's profile row is gone (deleted account). Nothing to
    // deal into -- the caller's own guard (dealt === null) surfaces as "try
    // again", the same honest answer a seat-count race gets.
    return null;
  }

  const entrants = seats.map((seat, index) => ({
    token: seat.token,
    profile: profiles[index] as PlayerProfile,
  }));
  const state: GameState = createHeadsUpGame(entrants, table.tier);
  await createStoredGame(state);

  const dealt = await dealHeadsUpTable({ tableId, expectedSeats: seats.length, gameId: state.id });
  if (!dealt) return null;

  // Every seated player wagered, so every seated player earns XP at the
  // ordinary rate -- same parity argument cribbage-service.ts's
  // dealTableIfReady makes. `null` throughout: only the caller who triggered
  // the deal has a live session token here, and awardWager's Gold-crediting
  // path is keyed just as well by profile id.
  await Promise.all(seats.map((seat) => awardWager(seat.playerId, null, dealt.stake).catch(() => null)));

  return dealt;
}

// ---- tables ------------------------------------------------------------

function requireTier(tier: string): StakesTier {
  if (!isStakesTier(tier)) throw new HeadsUpRequestError("Choose a real stakes tier.", 400);
  return tier;
}

/**
 * Quick play: joins the oldest open table at this tier, or opens one if none
 * is waiting. Debits the entry fee either way (rule 1) -- a join that lands
 * on a table which turns out to have just filled refunds and retries the
 * matchmaking search once, the same "somebody beat you to it" race every
 * other open-seat flow in this app accepts.
 */
export async function openHeadsUpQuickPlay(
  token: string,
  tierInput: string,
): Promise<{ table: HeadsUpTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const tier = requireTier(tierInput);
  const stake = TIER_CONFIG[tier].minBuyIn;

  if (await getActiveHeadsUpTableFor(profile.id)) {
    throw new HeadsUpRequestError("You are already in a heads-up match.", 409);
  }

  const debited = await spendGoldByProfile(profile.id, stake);
  if (!debited) throw new HeadsUpRequestError(`You need ${stake.toLocaleString()} Gold to play this tier.`, 400);

  const open = await findOpenHeadsUpTable(tier, profile.id);
  try {
    if (open) {
      await claimHeadsUpSeat(open.id, profile.id, token);
      const dealt = await dealHeadsUpTableIfReady(open.id);
      const current = dealt ?? (await getHeadsUpTableById(open.id)) ?? open;
      const seats = await getHeadsUpSeats(open.id);
      return { table: await tableView(current, seats, profile.id), profile: debited };
    }

    const created = await createHeadsUpTableRow(profile.id, tier, stake, null);
    await claimHeadsUpSeat(created.id, profile.id, token);
    const seats = await getHeadsUpSeats(created.id);
    return { table: await tableView(created, seats, profile.id), profile: debited };
  } catch (error) {
    await creditGoldByProfile(profile.id, stake).catch(() => null);
    if (error instanceof HeadsUpTableNotJoinable) throw new HeadsUpRequestError(error.message, 409);
    throw error;
  }
}

/**
 * Opens a table reserved for one specific friend and seats the host. The
 * friend sees it via readPendingHeadsUpInviteFor (their own drawer poll) and
 * joins it through the ordinary joinHeadsUpTable path -- no separate accept
 * step or notification row, since invitee_id on the table itself already IS
 * the reservation; see this file's own header on why that's simpler than
 * widening table_invites for a lobby row that isn't a dealt game yet.
 */
export async function openHeadsUpInvite(
  token: string,
  tierInput: string,
  friendProfileId: string,
): Promise<{ table: HeadsUpTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const tier = requireTier(tierInput);
  const stake = TIER_CONFIG[tier].minBuyIn;

  if (friendProfileId === profile.id) {
    throw new HeadsUpRequestError("You cannot invite yourself.", 400);
  }
  if (await getActiveHeadsUpTableFor(profile.id)) {
    throw new HeadsUpRequestError("You are already in a heads-up match.", 409);
  }

  const debited = await spendGoldByProfile(profile.id, stake);
  if (!debited) throw new HeadsUpRequestError(`You need ${stake.toLocaleString()} Gold to play this tier.`, 400);

  let table: StoredHeadsUpTable | null = null;
  try {
    table = await createHeadsUpTableRow(profile.id, tier, stake, friendProfileId);
    await claimHeadsUpSeat(table.id, profile.id, token);
  } catch (error) {
    await creditGoldByProfile(profile.id, stake).catch(() => null);
    if (table) await cancelEmptyHeadsUpTable(table.id, profile.id).catch(() => null);
    if (error instanceof HeadsUpTableNotJoinable) throw new HeadsUpRequestError(error.message, 409);
    throw error;
  }

  const seats = await getHeadsUpSeats(table.id);
  return { table: await tableView(table, seats, profile.id), profile: debited };
}

/** Tables a specific friend has invited the caller to, still waiting. */
export async function readPendingHeadsUpInviteFor(profileId: string): Promise<HeadsUpTableView[]> {
  const tables = await getHeadsUpTablesInvitingPlayer(profileId);
  if (tables.length === 0) return [];
  return Promise.all(
    tables.map(async (table) => tableView(table, await getHeadsUpSeats(table.id), profileId)),
  );
}

/** Joins an open or invite-locked table. If this join fills the 2nd seat, the table deals in the same call. */
export async function joinHeadsUpTable(
  token: string,
  tableId: string,
): Promise<{ table: HeadsUpTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getHeadsUpTableById(tableId);
  if (!table) throw new HeadsUpRequestError("No such table.", 404);
  if (await getActiveHeadsUpTableFor(profile.id)) {
    throw new HeadsUpRequestError("You are already in a heads-up match.", 409);
  }

  const debited = await spendGoldByProfile(profile.id, table.stake);
  if (!debited) {
    throw new HeadsUpRequestError(`You need ${table.stake.toLocaleString()} Gold to join this match.`, 400);
  }

  try {
    await claimHeadsUpSeat(tableId, profile.id, token);
  } catch (error) {
    await creditGoldByProfile(profile.id, table.stake).catch(() => null);
    if (error instanceof HeadsUpTableNotJoinable) throw new HeadsUpRequestError(error.message, 409);
    throw error;
  }

  const dealt = await dealHeadsUpTableIfReady(tableId);
  const current = dealt ?? (await getHeadsUpTableById(tableId)) ?? table;
  const seats = await getHeadsUpSeats(tableId);
  return { table: await tableView(current, seats, profile.id), profile: debited };
}

/** The caller's own live (waiting or active) table, or null -- the waiting-room poll. */
export async function readMyHeadsUpTable(token: string): Promise<{ table: HeadsUpTableView | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getActiveHeadsUpTableFor(profile.id);
  if (!table) return { table: null, profile };

  const seats = await getHeadsUpSeats(table.id);
  return { table: await tableView(table, seats, profile.id), profile };
}

/** A specific table by id. 403 unless the reader is seated at it. */
export async function readHeadsUpTableById(
  token: string,
  tableId: string,
): Promise<{ table: HeadsUpTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getHeadsUpTableById(tableId);
  if (!table) throw new HeadsUpRequestError("No such table.", 404);

  const seats = await getHeadsUpSeats(tableId);
  if (seatOf(seats, profile.id) === null) throw new HeadsUpRequestError("That is not your match.", 403);

  return { table: await tableView(table, seats, profile.id), profile };
}

/** Leaving before the match has dealt. Refunds exactly the caller's own stake. */
export async function leaveHeadsUpTable(token: string, tableId: string): Promise<{ profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getHeadsUpTableById(tableId);
  if (!table) throw new HeadsUpRequestError("No such table.", 404);

  const left = await leaveHeadsUpTableRow(tableId, profile.id);
  if (!left) throw new HeadsUpRequestError("You are not in that match, or it has already started.", 409);

  const refunded = await creditGoldByProfile(profile.id, table.stake);
  return { profile: refunded ?? profile };
}

/**
 * Settles a heads-up match once the poker engine says the loser is out of
 * chips (state.tournament.winnerProfileId set -- see lib/game/engine.ts's
 * setupHand). Called from both app/api/games/[id]/actions/route.ts and
 * .../advance/route.ts after every mutation, since either route can be the
 * one that discovers the finish; settleHeadsUpTable's version guard makes a
 * redundant call from the other route a safe no-op rather than a double
 * payout. Never throws -- a settlement failure here must not turn a
 * finished poker hand into a broken response for the players who just
 * played it.
 *
 * Identifies the winner by winnerProfileId directly, the same shape
 * settleSitAndGoIfFinished uses -- every tournament seat carries a real
 * profileId unconditionally (see TournamentState's own comment on why a
 * guest is not excluded here the way an ordinary seat normally would be),
 * so there's no seat-position indirection to resolve.
 */
export async function settleHeadsUpIfFinished(state: GameState): Promise<void> {
  const winnerId = state.tournament?.winnerProfileId;
  if (!winnerId) return;

  try {
    const table = await getHeadsUpTableByGameId(state.id);
    if (!table || table.status !== "active") return;

    const settled = await settleHeadsUpTable(table, winnerId);
    // Rule 2: a lost race did not happen, so it does not pay. Whoever won
    // that race is settling and paying this same table right now.
    if (!settled) return;

    const pot = table.stake * 2;
    try {
      await creditGoldByProfile(winnerId, pot);
    } catch (error) {
      console.error("heads_up.payout_credit_failed", { tableId: table.id, winnerId, pot, error });
    }

    // Awaited rather than fired-and-forgotten, same reasoning cribbage's own
    // payOutTable gives: a serverless invocation can be frozen right after
    // this function's caller responds.
    await applyMissionEvent(winnerId, { kind: "heads_up_won" });
    await applyAchievementEvent(winnerId, { kind: "heads_up_won" });
    const seats = await getHeadsUpSeats(table.id);
    const orderedPlayerIds: [string, string] = [
      seats.find((seat) => seat.seat === 0)?.playerId ?? winnerId,
      seats.find((seat) => seat.seat === 1)?.playerId ?? winnerId,
    ];
    const winnerSeat = seats.find((seat) => seat.playerId === winnerId)?.seat ?? 0;
    await recordDuelResult("heads-up", orderedPlayerIds, winnerSeat);
  } catch (error) {
    console.error("heads_up.settle_failed", { gameId: state.id, error });
  }
}

export function toHeadsUpErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That heads-up match could not be played.");
}

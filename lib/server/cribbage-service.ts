import "server-only";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { CRIBBAGE_GAME } from "@/lib/cribbage/engine";
import type { CribbageSeat, CribbageSnapshot } from "@/lib/cribbage/engine";
import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import type { PlayerProfile } from "@/lib/profile/types";
import { applyAchievementEvent } from "./achievement-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { recordMultiWayResult } from "./leaderboard-store";
import {
  advanceCribbageTable,
  cancelEmptyCribbageTable,
  claimCribbageSeat,
  createCribbageTableRow,
  dealCribbageTable,
  getActiveCribbageTableFor,
  getCribbageSeats,
  getCribbageTableById,
  getOpenCribbageTables,
  getSeatCountsForTables,
  leaveCribbageTable as leaveCribbageTableRow,
  CribbageTableNotJoinable,
  type CribbageSeatRow,
  type StoredCribbageTable,
} from "./cribbage-table-store";
import { applyMissionEvent } from "./mission-store";
import { creditGoldByProfile, ensureProfile, getPublicProfilesByIds, spendGoldByProfile } from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a cribbage table request and the wallet.
 *
 * ## The ordering rules
 *
 * A table is winner-take-all with NO HOUSE, generalized from pvp-match-
 * service.ts's own rules to N (3-4) payers instead of 2: every seated player
 * antes the same stake, the sole winner takes the whole pot. Gold is
 * conserved across a table -- the sum of every stake in equals the single
 * payout out -- and every rule below exists to keep that true under
 * retries, double-clicks, and several players acting at once.
 *
 *   1. **A stake leaves a wallet before the seat it pays for exists**, and
 *      anything that fails afterwards refunds it. Opening a table debits the
 *      host before the table row exists; joining debits the joiner before
 *      their seat row exists.
 *   2. **The pot is credited only after the version-guarded write that
 *      settles the table is confirmed.** advanceCribbageTable returns null
 *      when it loses that race, and null must never pay.
 *   3. **Settlement is a single credit, never a second debit.** Every stake
 *      already left in rule 1; cribbage has no draw, so a win always credits
 *      `stake * seatedCount` to exactly one profile.
 *   4. **A pre-start leave refunds exactly once**, via a status-guarded write
 *      (leave_cribbage_table) that returns the removed seat at most once.
 *
 * ## One code path deals a table
 *
 * Whether a table starts because its 4th seat just filled or because its
 * host started it early at 3, both routes through `dealTableIfReady`, which
 * is the only place `dealCribbageTable` is called. See that store function's
 * own header for why two such paths would be a real hazard.
 */

export class CribbageRequestError extends ArcadeRequestError<never> {
  readonly name = "CribbageRequestError";
}

/** Fewer than this and even the host cannot start early. The auto-start ceiling is always 4. */
const MIN_SEATS_TO_START = 3;
const MAX_SEATS = 4;

// ---- wire shapes -----------------------------------------------------------

export interface CribbagePlayerView {
  profileId: string;
  seat: CribbageSeat;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  accent: string;
}

export interface CribbageTableView {
  id: string;
  status: "waiting" | "active" | "completed" | "cancelled";
  version: number;
  stake: number;
  /** stake * seated count. Stated rather than left for the client to multiply. */
  pot: number;
  hostId: string;
  minSeatsToStart: number;
  maxSeats: number;
  yourSeat: CribbageSeat | null;
  isHost: boolean;
  /** Whether the READER may start this table early right now. */
  canStart: boolean;
  players: CribbagePlayerView[];
  winnerId: string | null;
  /** The game's own redacted view, for this reader. Null before the table has dealt. */
  state: CribbageSnapshot | null;
}

export interface CribbageOpenTableView {
  id: string;
  hostName: string;
  stake: number;
  seatedCount: number;
  maxSeats: number;
  createdAt: string;
  mine: boolean;
}

// ---- helpers ----------------------------------------------------------------

async function playerViews(seats: CribbageSeatRow[]): Promise<CribbagePlayerView[]> {
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

function seatOf(seats: CribbageSeatRow[], profileId: string): CribbageSeat | null {
  return seats.find((s) => s.playerId === profileId)?.seat ?? null;
}

async function tableView(
  table: StoredCribbageTable,
  seats: CribbageSeatRow[],
  readerId: string,
  now: number,
): Promise<CribbageTableView> {
  const yourSeat = seatOf(seats, readerId);
  const players = await playerViews(seats);
  return {
    id: table.id,
    status: table.status,
    version: table.version,
    stake: table.stake,
    pot: table.stake * seats.length,
    hostId: table.hostId,
    minSeatsToStart: MIN_SEATS_TO_START,
    maxSeats: MAX_SEATS,
    yourSeat,
    isHost: table.hostId === readerId,
    canStart: table.status === "waiting" && table.hostId === readerId && seats.length >= MIN_SEATS_TO_START,
    players,
    winnerId: table.winnerId,
    state: table.state ? CRIBBAGE_GAME.snapshot(table.state, yourSeat, now) : null,
  };
}

/**
 * Pays a completed table out. Never throws -- the table is already durably
 * settled by the time this runs, so a credit failure here must not turn a
 * finished game into an error response. Logged loudly instead, matching
 * pvp-match-service.ts's payOutMatch.
 */
async function payOutTable(table: StoredCribbageTable, seats: CribbageSeatRow[]): Promise<void> {
  if (!table.winnerId) return;
  const pot = table.stake * seats.length;
  try {
    await creditGoldByProfile(table.winnerId, pot);
  } catch (error) {
    console.error("cribbage.payout_credit_failed", { tableId: table.id, winnerId: table.winnerId, pot, error });
  }

  // Awaited, not fired-and-forgotten -- a serverless invocation can be frozen
  // right after this function's caller responds, and an un-awaited call
  // could simply never run. Neither call throws, so this adds no new
  // failure mode of its own.
  await applyMissionEvent(table.winnerId, { kind: "cribbage_won" });
  await applyAchievementEvent(table.winnerId, { kind: "cribbage_won" });
  // Every seated player, not just the winner: a leaderboard record needs a
  // loss row for the other 2-3 seats, which mission/achievement events never
  // did (cribbage_won only fires for the winner).
  await recordMultiWayResult("cribbage", seats.map((seat) => seat.playerId), table.winnerId);
}

/** Settles a table if the game says it is over, and pays it. Reads/writes off the already-durable state. */
async function settleIfFinished(
  table: StoredCribbageTable,
  seats: CribbageSeatRow[],
): Promise<StoredCribbageTable> {
  if (table.status !== "active" || !table.state) return table;
  const outcome = CRIBBAGE_GAME.result(table.state);
  if (!outcome) return table;

  const winnerId = seats.find((s) => s.seat === outcome.winner)?.playerId;
  if (!winnerId) return table; // Unreachable: every seat in the game's state maps to a real seat row.

  const settled = await advanceCribbageTable(table, table.state, { winnerId });
  // Rule 2: a lost race did not happen, so it does not pay. Whoever won that
  // race is settling and paying this same table right now.
  if (!settled) return (await getCribbageTableById(table.id)) ?? table;

  await payOutTable(settled, seats);
  return settled;
}

/**
 * Deals the table if -- and only if -- the guard actually allows it right
 * now: the caller is joining and just filled the 4th seat, or the caller is
 * the host starting early with at least 3 seated. Every other join simply
 * returns the table as-is, still waiting.
 *
 * This is the ONE place `dealCribbageTable` is called. See the store's own
 * header for why that matters.
 */
async function dealTableIfReady(
  tableId: string,
  actorId: string,
  requireHost: boolean,
  minSeats: number,
): Promise<StoredCribbageTable | null> {
  const seats = await getCribbageSeats(tableId);
  if (seats.length < minSeats) return null;

  const state = CRIBBAGE_GAME.createState(randomInt(0, 2 ** 31 - 1), Date.now(), seats.length);
  // `expectedSeats` is exactly what `state` was built for, not merely "at
  // least minSeats" -- the guarded write requires an exact match, so a seat
  // that joins or leaves in the gap between the read above and this call
  // fails the deal cleanly instead of persisting a state that does not
  // account for every seated (and already-debited) player. See dealCribbageTable's own header.
  const dealt = await dealCribbageTable({ tableId, actorId, requireHost, expectedSeats: seats.length, state });
  if (!dealt) return null;

  // Every seated player wagered, so every seated player earns XP at the
  // ordinary rate -- same parity argument pvp-match-service.ts's
  // acceptDuelChallenge makes. `null` throughout: only the caller who
  // triggered the deal has a live session token here, and the Gold-crediting
  // path awardWager takes `token` for is keyed just as well by profile id.
  await Promise.all(seats.map((seat) => awardWager(seat.playerId, null, dealt.stake).catch(() => null)));

  return dealt;
}

// ---- tables ------------------------------------------------------------

/**
 * Opens a table and seats the host at seat 0.
 *
 * Rule 1: the stake leaves before the table row exists, and a row that fails
 * to persist (or a seat claim that fails right after) refunds.
 */
export async function openCribbageTable(
  token: string,
  stake: number,
): Promise<{ table: CribbageTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  if (!Number.isInteger(stake) || stake < MIN_DUEL_STAKE) {
    throw new CribbageRequestError(`Wager at least ${MIN_DUEL_STAKE.toLocaleString()} Gold to open a table.`, 400);
  }
  if (await getActiveCribbageTableFor(profile.id)) {
    throw new CribbageRequestError("You are already at a cribbage table.", 409);
  }

  const debited = await spendGoldByProfile(profile.id, stake);
  if (!debited) throw new CribbageRequestError(`You need ${stake.toLocaleString()} Gold to stake this table.`, 400);

  let table: StoredCribbageTable | null = null;
  try {
    table = await createCribbageTableRow(profile.id, stake);
    await claimCribbageSeat(table.id, profile.id);
  } catch (error) {
    await creditGoldByProfile(profile.id, stake).catch(() => null);
    // The table row itself may have persisted even though seating the host
    // in it failed right after -- a host-less, permanently-empty 'waiting'
    // row would otherwise sit in the open-table list forever, since nobody
    // (including its own "host") is ever actually seated in it to start or
    // leave it. Best-effort: the stake is already refunded either way, so a
    // failure here costs nobody anything but a harmless stray row.
    if (table) await cancelEmptyCribbageTable(table.id, profile.id).catch(() => null);
    if (error instanceof CribbageTableNotJoinable) throw new CribbageRequestError(error.message, 409);
    throw error;
  }

  const seats = await getCribbageSeats(table.id);
  return { table: await tableView(table, seats, profile.id, Date.now()), profile: debited };
}

/** Open (waiting) tables, across every stake -- the lobby list. */
export async function listOpenCribbageTables(
  token: string,
): Promise<{ tables: CribbageOpenTableView[]; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const tables = await getOpenCribbageTables();
  if (tables.length === 0) return { tables: [], profile };

  const hostIds = [...new Set(tables.map((t) => t.hostId))];
  const [profiles, seatCounts] = await Promise.all([
    getPublicProfilesByIds(hostIds),
    getSeatCountsForTables(tables.map((t) => t.id)),
  ]);

  return {
    tables: tables.map((t) => ({
      id: t.id,
      hostName: profiles.get(t.hostId)?.displayName ?? "Player",
      stake: t.stake,
      seatedCount: seatCounts.get(t.id) ?? 0,
      maxSeats: MAX_SEATS,
      createdAt: t.createdAt,
      mine: t.hostId === profile.id,
    })),
    profile,
  };
}

/** The caller's own live (waiting or active) table, or null. */
export async function readMyCribbageTable(
  token: string,
): Promise<{ table: CribbageTableView | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getActiveCribbageTableFor(profile.id);
  if (!table) return { table: null, profile };

  const seats = await getCribbageSeats(table.id);
  const live = table.status === "active" ? await settleIfFinished(table, seats) : table;

  return { table: await tableView(live, seats, profile.id, Date.now()), profile };
}

/** A specific table by id. 403 unless the reader is seated at it. */
export async function readCribbageTableById(
  token: string,
  tableId: string,
): Promise<{ table: CribbageTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getCribbageTableById(tableId);
  if (!table) throw new CribbageRequestError("No such table.", 404);

  const seats = await getCribbageSeats(tableId);
  if (seatOf(seats, profile.id) === null) throw new CribbageRequestError("That is not your table.", 403);

  const live = table.status === "active" ? await settleIfFinished(table, seats) : table;
  return { table: await tableView(live, seats, profile.id, Date.now()), profile };
}

/**
 * Joins an open table, debiting the joiner's stake. If this join fills the
 * 4th seat, the table deals in the same call.
 */
export async function joinCribbageTable(
  token: string,
  tableId: string,
): Promise<{ table: CribbageTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getCribbageTableById(tableId);
  if (!table) throw new CribbageRequestError("No such table.", 404);
  if (await getActiveCribbageTableFor(profile.id)) {
    throw new CribbageRequestError("You are already at a cribbage table.", 409);
  }

  // Rule 1: the joiner's stake leaves before their seat exists.
  const debited = await spendGoldByProfile(profile.id, table.stake);
  if (!debited) {
    throw new CribbageRequestError(`You need ${table.stake.toLocaleString()} Gold to join this table.`, 400);
  }

  try {
    await claimCribbageSeat(tableId, profile.id);
  } catch (error) {
    await creditGoldByProfile(profile.id, table.stake).catch(() => null);
    if (error instanceof CribbageTableNotJoinable) throw new CribbageRequestError(error.message, 409);
    throw error;
  }

  const dealt = await dealTableIfReady(tableId, profile.id, false, MAX_SEATS);
  const current = dealt ?? (await getCribbageTableById(tableId)) ?? table;
  const seats = await getCribbageSeats(tableId);
  return { table: await tableView(current, seats, profile.id, Date.now()), profile: debited };
}

/** The host starting the table early, once at least 3 are seated. No new debit -- the host already paid at creation. */
export async function startCribbageTableAsHost(
  token: string,
  tableId: string,
): Promise<{ table: CribbageTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getCribbageTableById(tableId);
  if (!table) throw new CribbageRequestError("No such table.", 404);
  if (table.hostId !== profile.id) throw new CribbageRequestError("Only the host can start this table.", 403);
  if (table.status !== "waiting") throw new CribbageRequestError("That table has already started.", 409);

  // Covers two distinct causes with one honest message: genuinely fewer
  // than 3 seated, or the exact-match deal guard losing a race against a
  // seat that joined or left in the gap between the read above and the
  // guarded write (see dealCribbageTable's header) -- both are "try again",
  // not "you did something wrong".
  const dealt = await dealTableIfReady(tableId, profile.id, true, MIN_SEATS_TO_START);
  if (!dealt) throw new CribbageRequestError("Not enough players are seated yet — try again.", 409);

  const seats = await getCribbageSeats(tableId);
  return { table: await tableView(dealt, seats, profile.id, Date.now()), profile };
}

/** Leaving before the table has dealt. Refunds exactly the caller's own stake. */
export async function leaveCribbageTable(
  token: string,
  tableId: string,
): Promise<{ profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getCribbageTableById(tableId);
  if (!table) throw new CribbageRequestError("No such table.", 404);

  // Rule 4: only a seat leaveCribbageTableRow actually removed is refunded.
  const left = await leaveCribbageTableRow(tableId, profile.id);
  if (!left) throw new CribbageRequestError("You are not seated at that table, or it has already started.", 409);

  const refunded = await creditGoldByProfile(profile.id, table.stake);
  return { profile: refunded ?? profile };
}

/**
 * Applies one player's move, and settles the table if it ended.
 *
 * `version` pins the move to the exact state the player was looking at, the
 * same optimistic-concurrency contract every other staked game in this app
 * keeps.
 */
export async function playCribbageMove(
  token: string,
  input: { tableId: string; version: number; move: unknown },
): Promise<{ table: CribbageTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getCribbageTableById(input.tableId);
  if (!current) throw new CribbageRequestError("No such table.", 404);

  const seats = await getCribbageSeats(input.tableId);
  const seat = seatOf(seats, profile.id);
  if (seat === null) throw new CribbageRequestError("That is not your table.", 403);
  const now = Date.now();

  if (current.status !== "active" || !current.state) {
    throw new CribbageRequestError("That table is not active.", 409, {
      round: (await tableView(current, seats, profile.id, now)) as never,
    });
  }
  if (current.version !== input.version) {
    throw new CribbageRequestError("That table moved on. Here is where it actually stands.", 409, {
      round: (await tableView(current, seats, profile.id, now)) as never,
    });
  }

  const applied = CRIBBAGE_GAME.applyMove(current.state, seat, input.move, now);
  if ("reject" in applied) {
    throw new CribbageRequestError(applied.reject, 409, {
      round: (await tableView(current, seats, profile.id, now)) as never,
    });
  }

  const outcome = CRIBBAGE_GAME.result(applied.next);
  const winnerId = outcome ? seats.find((s) => s.seat === outcome.winner)?.playerId ?? null : null;
  const stored = await advanceCribbageTable(current, applied.next, winnerId ? { winnerId } : null);
  if (!stored) {
    const live = (await getCribbageTableById(current.id)) ?? current;
    throw new CribbageRequestError("That table moved on. Here is where it actually stands.", 409, {
      round: (await tableView(live, seats, profile.id, now)) as never,
    });
  }

  if (outcome) await payOutTable(stored, seats);
  return { table: await tableView(stored, seats, profile.id, now), profile };
}

/**
 * Resigning ends the WHOLE table, not just the resigning seat -- see
 * lib/cribbage/engine.ts's resignCribbage for why cribbage has no partial
 * "the rest keep playing" continuation.
 */
export async function resignCribbageTable(
  token: string,
  tableId: string,
): Promise<{ table: CribbageTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getCribbageTableById(tableId);
  if (!current) throw new CribbageRequestError("No such table.", 404);

  const seats = await getCribbageSeats(tableId);
  const seat = seatOf(seats, profile.id);
  if (seat === null) throw new CribbageRequestError("That is not your table.", 403);

  const now = Date.now();
  if (current.status !== "active" || !current.state) {
    return { table: await tableView(current, seats, profile.id, now), profile };
  }

  const next = CRIBBAGE_GAME.resign ? CRIBBAGE_GAME.resign(current.state, seat, now) : current.state;
  const outcome = CRIBBAGE_GAME.result(next);
  const winnerId = outcome ? seats.find((s) => s.seat === outcome.winner)?.playerId ?? null : null;

  const stored = await advanceCribbageTable(current, next, winnerId ? { winnerId } : null);
  if (!stored) {
    const live = (await getCribbageTableById(current.id)) ?? current;
    return { table: await tableView(live, seats, profile.id, now), profile };
  }

  if (outcome) await payOutTable(stored, seats);
  return { table: await tableView(stored, seats, profile.id, now), profile };
}

export function toCribbageErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That table could not be played.");
}

import "server-only";
import { randomInt, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { CRIBBAGE_GAME, cribbagePayouts } from "@/lib/cribbage/engine";
import type { CribbageSeat, CribbageSnapshot, CribbageState } from "@/lib/cribbage/engine";
import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import type { PlayerProfile } from "@/lib/profile/types";
import { applyAchievementEvent } from "./achievement-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { publicIdentity } from "./leaderboard-identity";
import { recordMultiWayResult } from "./leaderboard-store";
import {
  advanceCribbageTable,
  cancelEmptyCribbageTable,
  claimCribbageSeat,
  createCribbageTableRow,
  CRIBBAGE_MAX_SEATS,
  dealCribbageTable,
  getActiveCribbageTableFor,
  getCribbageSeats,
  getCribbageTableById,
  getOpenCribbageTables,
  getRecentlyCompletedCribbageTableFor,
  getSeatCountsForTables,
  leaveCribbageTable as leaveCribbageTableRow,
  CribbageTableNotJoinable,
  type CribbageSeatRow,
  type StoredCribbageTable,
} from "./cribbage-table-store";
import { applyMissionEvent } from "./mission-store";
import {
  confirmGoldDebitLedgered,
  creditGoldByProfile,
  creditGoldByProfileLedgered,
  ensureProfile,
  getPublicProfilesByIds,
  spendGoldByProfileLedgered,
} from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a cribbage table request and the wallet.
 *
 * A table is winner-take-all with no house, generalized from
 * pvp-match-service.ts's own rules to N (3-4) payers instead of 2: every
 * seated player antes the same stake and the sole winner takes the whole
 * pot. Gold is conserved across a table (the sum of every stake in equals
 * the single payout out), and every rule below exists to keep that true
 * under retries, double-clicks, and several players acting at once.
 *
 *   1. **A stake leaves a wallet before the seat it pays for exists**, and
 *      anything that fails afterwards refunds it. Opening a table debits
 *      the host before the table row exists; joining debits the joiner
 *      before their seat row exists.
 *   2. **The pot is credited only after the version-guarded write that
 *      settles the table is confirmed.** advanceCribbageTable returns null
 *      when it loses that race, and null must never pay.
 *   3. **Settlement is a single credit per seat, never a second debit.**
 *      Every stake already left in rule 1. A win credits `stake *
 *      seatedCount` to exactly one profile. A forfeit (a resign or a turn
 *      timeout) credits nothing to the forfeiting seats and each other seat
 *      its own stake plus an equal share of theirs, per cribbagePayouts.
 *   4. **A pre-start leave refunds exactly once**, via a status-guarded
 *      write (leave_cribbage_table) that returns the removed seat at most
 *      once.
 *
 * One code path deals a table: whether it starts because the 4th seat just
 * filled or because the host started it early at 3, both routes go through
 * `dealTableIfReady`, the only place `dealCribbageTable` is called. See
 * that store function's own header for why two such paths would be a real
 * hazard.
 */

export class CribbageRequestError extends ArcadeRequestError<never> {
  readonly name = "CribbageRequestError";
}

/** Fewer than this and even the host cannot start early. The auto-start ceiling is always CRIBBAGE_MAX_SEATS. */
const MIN_SEATS_TO_START = 3;
const MAX_SEATS = CRIBBAGE_MAX_SEATS;

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
  /** Null while playing, and on a table that ended on a forfeit. */
  winnerId: string | null;
  /** Who resigned or timed out, on a table that ended on a forfeit. */
  forfeitedIds: string[];
  /** What settling credited the READER, once completed. Null before then. */
  yourPayout: number | null;
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
  return seats.map((s) => ({ profileId: s.playerId, seat: s.seat, ...publicIdentity(profiles.get(s.playerId)) }));
}

function seatOf(seats: CribbageSeatRow[], profileId: string): CribbageSeat | null {
  return seats.find((s) => s.playerId === profileId)?.seat ?? null;
}

function playerAt(seats: CribbageSeatRow[], seat: CribbageSeat): string | null {
  return seats.find((s) => s.seat === seat)?.playerId ?? null;
}

/** Each seat's credit for a finished state, or null while it is still going. */
function payoutsFor(state: CribbageState, stake: number): number[] | null {
  const outcome = CRIBBAGE_GAME.result(state);
  return outcome ? cribbagePayouts(outcome, state.playerCount, stake) : null;
}

/**
 * The settle argument for the guarded write, or null while the table is
 * still going. A forfeit settles with no winner.
 */
function settlementOf(state: CribbageState, seats: CribbageSeatRow[]): { winnerId: string | null } | null {
  const outcome = CRIBBAGE_GAME.result(state);
  if (!outcome) return null;
  if (outcome.winner === null) return { winnerId: null };
  const winnerId = playerAt(seats, outcome.winner);
  // Unreachable: every seat in the game's state maps to a real seat row.
  return winnerId ? { winnerId } : null;
}

async function tableView(
  table: StoredCribbageTable,
  seats: CribbageSeatRow[],
  readerId: string,
  now: number,
): Promise<CribbageTableView> {
  const yourSeat = seatOf(seats, readerId);
  const players = await playerViews(seats);
  const outcome = table.status === "completed" && table.state ? CRIBBAGE_GAME.result(table.state) : null;
  const payouts = table.status === "completed" && table.state ? payoutsFor(table.state, table.stake) : null;
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
    forfeitedIds: (outcome?.forfeited ?? []).flatMap((seat) => playerAt(seats, seat) ?? []),
    yourPayout: payouts && yourSeat !== null ? payouts[yourSeat] ?? 0 : null,
    state: table.state ? CRIBBAGE_GAME.snapshot(table.state, yourSeat, now) : null,
  };
}

/**
 * Pays a completed table out. Never throws, since the table is already
 * durably settled by the time this runs and a credit failure here must
 * not turn a finished game into an error response. Logged loudly instead,
 * matching pvp-match-service.ts's payOutMatch.
 *
 * Rule 3: one credit per seat of exactly what cribbagePayouts says, so a
 * win pays the pot to the winner and a forfeit refunds and splits.
 */
async function payOutTable(table: StoredCribbageTable, seats: CribbageSeatRow[]): Promise<void> {
  const payouts = table.state ? payoutsFor(table.state, table.stake) : null;
  if (!payouts) return;

  // Independent profiles, no ordering between them, so run concurrently.
  await Promise.all(seats.map(async (seat) => {
    const amount = payouts[seat.seat] ?? 0;
    if (amount <= 0) return;
    try {
      await creditGoldByProfile(seat.playerId, amount);
    } catch (error) {
      console.error("cribbage.payout_credit_failed", { tableId: table.id, profileId: seat.playerId, amount, error });
    }
  }));

  // A forfeit has no winner to record: nobody reached 121.
  if (!table.winnerId) return;

  // Awaited rather than fired-and-forgotten: a serverless invocation can
  // be frozen right after this function's caller responds, and an
  // un-awaited call could simply never run. Neither call throws, so this
  // adds no new failure mode.
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
  const settle = settlementOf(table.state, seats);
  if (!settle) return table;

  const settled = await advanceCribbageTable(table, table.state, settle);
  // Rule 2: a lost race did not happen, so it does not pay. Whoever won that
  // race is settling and paying this same table right now.
  if (!settled) return (await getCribbageTableById(table.id)) ?? table;

  await payOutTable(settled, seats);
  return settled;
}

/**
 * Runs the turn clock, then settles the table if it is over, for a read.
 * This is what makes a stalled seat forfeit without anyone having to move:
 * every seated player's poll ticks it. A tick that ends the table settles
 * and pays in the same guarded write.
 */
async function tickAndSettle(
  table: StoredCribbageTable,
  seats: CribbageSeatRow[],
): Promise<StoredCribbageTable> {
  if (table.status !== "active" || !table.state) return table;

  const ticked = CRIBBAGE_GAME.tick?.(table.state, Date.now()) ?? null;
  if (ticked === null) return settleIfFinished(table, seats);

  const settle = settlementOf(ticked, seats);
  const advanced = await advanceCribbageTable(table, ticked, settle);
  // Rule 2: a lost race did not happen. Whoever won it wrote this same clock.
  if (!advanced) return settleIfFinished((await getCribbageTableById(table.id)) ?? table, seats);
  if (settle) {
    await payOutTable(advanced, seats);
    return advanced;
  }
  return settleIfFinished(advanced, seats);
}

/**
 * Deals the table only if the guard actually allows it right now: the
 * caller is joining and just filled the 4th seat, or the caller is the
 * host starting early with at least 3 seated. Every other join simply
 * returns the table as-is, still waiting.
 *
 * This is the one place `dealCribbageTable` is called. See the store's own
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
  // `expectedSeats` is exactly what `state` was built for, not "at least
  // minSeats": the guarded write requires an exact match, so a seat that
  // joins or leaves in the gap between the read above and this call fails
  // the deal cleanly instead of persisting a state that doesn't account for
  // every seated (and already-debited) player. See dealCribbageTable's own
  // header.
  const dealt = await dealCribbageTable({ tableId, actorId, requireHost, expectedSeats: seats.length, state });
  if (!dealt) return null;

  // Every seated player wagered, so every seated player earns XP at the
  // ordinary rate, the same parity argument pvp-match-service.ts's
  // acceptDuelChallenge makes. `null` throughout: only the caller who
  // triggered the deal has a live session token here, and the
  // Gold-crediting path awardWager takes `token` for is keyed just as well
  // by profile id.
  await Promise.all(seats.map((seat) => awardWager(seat.playerId, null, dealt.stake)));

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

  // Ledgered rather than plain spendGoldByProfile: an open table can sit
  // waiting for seats for a while, the same crash-window risk
  // openDuelChallenge in pvp-match-service.ts documents. See
  // app/api/cron/reconcile-stale-stakes.
  const stakeCorrelationId = `cribbage_open_stake:${randomUUID()}`;
  const debited = await spendGoldByProfileLedgered(profile.id, stake, stakeCorrelationId, "cribbage_open");
  if (!debited.success) {
    throw new CribbageRequestError(`You need ${stake.toLocaleString()} Gold to stake this table.`, 400);
  }

  let table: StoredCribbageTable | null = null;
  try {
    table = await createCribbageTableRow(profile.id, stake);
    await claimCribbageSeat(table.id, profile.id);
  } catch (error) {
    await creditGoldByProfileLedgered(profile.id, stake, stakeCorrelationId, "cribbage_open_refund").catch(
      (refundError) => {
        console.error("cribbage.open_refund_failed", { profileId: profile.id, stake, error: refundError });
      },
    );
    // The table row itself may have persisted even though seating the host
    // in it failed right after. A host-less, permanently-empty 'waiting'
    // row would otherwise sit in the open-table list forever, since nobody
    // (including its own "host") is ever actually seated in it to start or
    // leave it. Best-effort: the stake is already refunded either way, so a
    // failure here costs nobody anything but a harmless stray row.
    if (table) await cancelEmptyCribbageTable(table.id, profile.id).catch(() => null);
    if (error instanceof CribbageTableNotJoinable) throw new CribbageRequestError(error.message, 409);
    throw error;
  }

  // The table (and the host's own seat) now exist: this debit can
  // legitimately stay uncredited for as long as the table sits waiting.
  await confirmGoldDebitLedgered(stakeCorrelationId).catch((confirmError) => {
    console.error("cribbage.open_confirm_failed", { profileId: profile.id, stakeCorrelationId, error: confirmError });
  });

  const seats = await getCribbageSeats(table.id);
  return {
    table: await tableView(table, seats, profile.id, Date.now()),
    profile: { ...profile, goldBalance: debited.goldBalance },
  };
}

/** Open (waiting) tables, across every stake: the lobby list. */
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
  if (!table) {
    // No live table, but it may have just completed without this player's
    // own request being the one that settled it (someone else's move
    // crossed 121, or someone else resigned). Same fallback readDuelMatch's
    // own comment explains, generalized to N seats.
    const recent = await getRecentlyCompletedCribbageTableFor(profile.id);
    if (!recent) return { table: null, profile };
    const recentSeats = await getCribbageSeats(recent.id);
    return { table: await tableView(recent, recentSeats, profile.id, Date.now()), profile };
  }

  const seats = await getCribbageSeats(table.id);
  const live = await tickAndSettle(table, seats);

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

  const live = await tickAndSettle(table, seats);
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

  // Rule 1: the joiner's stake leaves before their seat exists. Ledgered for
  // the same reason openCribbageTable's stake is.
  const stakeCorrelationId = `cribbage_join_stake:${randomUUID()}`;
  const debited = await spendGoldByProfileLedgered(profile.id, table.stake, stakeCorrelationId, "cribbage_join");
  if (!debited.success) {
    throw new CribbageRequestError(`You need ${table.stake.toLocaleString()} Gold to join this table.`, 400);
  }

  try {
    await claimCribbageSeat(tableId, profile.id);
  } catch (error) {
    await creditGoldByProfileLedgered(profile.id, table.stake, stakeCorrelationId, "cribbage_join_refund").catch(
      (refundError) => {
        console.error("cribbage.join_refund_failed", { tableId, profileId: profile.id, stake: table.stake, error: refundError });
      },
    );
    if (error instanceof CribbageTableNotJoinable) throw new CribbageRequestError(error.message, 409);
    throw error;
  }

  // The seat now exists: this debit can legitimately stay uncredited for as
  // long as the table takes to fill and deal.
  await confirmGoldDebitLedgered(stakeCorrelationId).catch((confirmError) => {
    console.error("cribbage.join_confirm_failed", { profileId: profile.id, stakeCorrelationId, error: confirmError });
  });

  const dealt = await dealTableIfReady(tableId, profile.id, false, MAX_SEATS);
  const current = dealt ?? (await getCribbageTableById(tableId)) ?? table;
  const seats = await getCribbageSeats(tableId);
  return {
    table: await tableView(current, seats, profile.id, Date.now()),
    profile: { ...profile, goldBalance: debited.goldBalance },
  };
}

/** The host starting the table early, once at least 3 are seated. No new debit: the host already paid at creation. */
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
  // guarded write (see dealCribbageTable's header). Both are "try again",
  // not "you did something wrong".
  const dealt = await dealTableIfReady(tableId, profile.id, true, MIN_SEATS_TO_START);
  if (!dealt) throw new CribbageRequestError("Not enough players are seated yet — try again.", 409);

  const seats = await getCribbageSeats(tableId);
  return { table: await tableView(dealt, seats, profile.id, Date.now()), profile };
}

/**
 * Leaving before the table has dealt. Refunds exactly the caller's own stake.
 * Answers `table: null` so the client drops the waiting room straight away
 * rather than showing it until a poll, where a second Leave would 409.
 */
export async function leaveCribbageTable(
  token: string,
  tableId: string,
): Promise<{ table: null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getCribbageTableById(tableId);
  if (!table) throw new CribbageRequestError("No such table.", 404);

  // Rule 4: only a seat leaveCribbageTableRow actually removed is refunded.
  const left = await leaveCribbageTableRow(tableId, profile.id);
  if (!left) throw new CribbageRequestError("You are not seated at that table, or it has already started.", 409);

  const refunded = await creditGoldByProfile(profile.id, table.stake);
  return { table: null, profile: refunded ?? profile };
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

  // The engine checks the turn clock itself: a move sent after it ran out
  // comes back as the forfeited table, which settles below like any ending.
  const applied = CRIBBAGE_GAME.applyMove(current.state, seat, input.move, now);
  if ("reject" in applied) {
    throw new CribbageRequestError(applied.reject, 409, {
      round: (await tableView(current, seats, profile.id, now)) as never,
    });
  }

  const settle = settlementOf(applied.next, seats);
  const stored = await advanceCribbageTable(current, applied.next, settle);
  if (!stored) {
    const live = (await getCribbageTableById(current.id)) ?? current;
    throw new CribbageRequestError("That table moved on. Here is where it actually stands.", 409, {
      round: (await tableView(live, seats, profile.id, now)) as never,
    });
  }

  // Rule 2: paid only after the guarded write is confirmed.
  if (settle) await payOutTable(stored, seats);
  return { table: await tableView(stored, seats, profile.id, now), profile };
}

/**
 * Resigning ends the whole table, not just the resigning seat. See
 * lib/cribbage/engine.ts's resignCribbage for why cribbage has no partial
 * "the rest keep playing" continuation. The resigner forfeits their stake
 * and nobody wins: every other seat is refunded and splits it.
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
  const settle = settlementOf(next, seats);

  const stored = await advanceCribbageTable(current, next, settle);
  if (!stored) {
    const live = (await getCribbageTableById(current.id)) ?? current;
    return { table: await tableView(live, seats, profile.id, now), profile };
  }

  if (settle) await payOutTable(stored, seats);
  return { table: await tableView(stored, seats, profile.id, now), profile };
}

export function toCribbageErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That table could not be played.");
}

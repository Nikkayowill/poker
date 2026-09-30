import "server-only";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createTournamentGame, SEAT_COUNT } from "@/lib/game/engine";
import { isStakesTier, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { GameState, PlayerAction } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { applyAchievementEvent } from "./achievement-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { createStoredGame, getStoredGame, updateStoredGame } from "./game-store";
import { recordMultiWayResult } from "./leaderboard-store";
import { applyMissionEvent } from "./mission-store";
import {
  confirmGoldDebitLedgered,
  creditGoldByProfileLedgered,
  ensureProfile,
  getProfileById,
  getPublicProfilesByIds,
  spendStakeLedgered,
} from "./profile-store";
import { awardWager } from "./progression-store";
import {
  cancelEmptySitAndGoTable,
  cancelStaleSitAndGoTable,
  claimSitAndGoSeat,
  createSitAndGoTableRow,
  dealSitAndGoTable,
  getActiveSitAndGoTableFor,
  getOpenSitAndGoTables,
  getSeatCountsForSitAndGoTables,
  getSitAndGoSeats,
  getSitAndGoTableById,
  getSitAndGoTableByGameId,
  getUndealtActiveSitAndGoTables,
  leaveSitAndGoTable as leaveSitAndGoTableRow,
  settleSitAndGoTable,
  setSitAndGoGameId,
  SitAndGoTableNotJoinable,
  type SitAndGoSeatRow,
  type StoredSitAndGoTable,
} from "./sit-and-go-store";

/**
 * Everything between a Sit & Go registration/lobby request and the wallet,
 * plus the one hook (settleSitAndGoIfFinished) that the ordinary poker
 * routes call once a table's game reports a winner.
 *
 * A table is winner-take-all with no house: every registered seat pays the
 * chosen tier's own fixed buy-in, and the sole survivor takes the whole
 * pool. Same discipline every staked game in this app restates on its own
 * terms (see cribbage-service.ts, pvp-match-service.ts):
 *
 *   1. **A stake leaves a wallet before the row it pays for exists**, and
 *      anything that fails afterwards refunds it. Opening a table debits the
 *      host before the table row exists; joining debits the joiner before
 *      their seat row exists.
 *   2. **The prize pool is credited only after the version-guarded write
 *      that settles the table is confirmed.** settleSitAndGoTable returns
 *      null when it loses that race, and null must never pay.
 *   3. **Settlement is a single credit, never a second debit.** Every stake
 *      already left in rule 1; a Sit & Go has no draw, so a win always
 *      credits `entryFee * 6` to exactly one profile.
 *   4. **A pre-deal leave refunds exactly once**, via a status-guarded write
 *      (leave_sit_and_go_table) that returns the removed seat at most once.
 *
 * Dealing is genuinely different from cribbage's one-RPC deal_cribbage_table:
 * this game's actual state is a poker GameState, which lives in the existing
 * games/game_state_private tables so the ordinary /api/games/[id]/actions
 * and /advance routes keep working unchanged. That state can't be written
 * speculatively before the deal guard succeeds (a lost race would orphan a
 * games row), so dealing is two steps -- dealSitAndGoTableIfReady below is
 * the only place either half is called. If the second step fails, the table
 * is cancelled and every entry fee refunded once; a crash between the steps
 * is caught later by sweepUndealtSitAndGoTables.
 *
 * There is no host-early-start path at all, unlike cribbage: a Sit & Go has
 * no bot fill to cover a short-handed table, so a 4-of-6 start would just be
 * a worse table forever, not a faster one. The only way this table deals is
 * the join that fills its 6th seat.
 */

export class SitAndGoRequestError extends ArcadeRequestError<never> {
  readonly name = "SitAndGoRequestError";
}

// ---- wire shapes -----------------------------------------------------------

export interface SitAndGoTableView {
  id: string;
  status: "waiting" | "active" | "completed" | "cancelled";
  tier: StakesTier;
  entryFee: number;
  /** entryFee * seated count. Stated rather than left for the client to multiply. */
  prizePool: number;
  hostId: string;
  seatedCount: number;
  maxSeats: number;
  yourSeat: number | null;
  isHost: boolean;
  /** Non-null once dealt -- the client switches to polling /api/games/[gameId] from here. */
  gameId: string | null;
  winnerId: string | null;
}

export interface SitAndGoOpenTableView {
  id: string;
  hostName: string;
  tier: StakesTier;
  entryFee: number;
  seatedCount: number;
  maxSeats: number;
  createdAt: string;
  mine: boolean;
}

// ---- helpers ----------------------------------------------------------------

function seatOf(seats: SitAndGoSeatRow[], profileId: string): number | null {
  return seats.find((s) => s.playerId === profileId)?.seat ?? null;
}

function tableView(table: StoredSitAndGoTable, seats: SitAndGoSeatRow[], readerId: string): SitAndGoTableView {
  return {
    id: table.id,
    status: table.status,
    tier: table.tier,
    entryFee: table.entryFee,
    prizePool: table.prizePool ?? table.entryFee * seats.length,
    hostId: table.hostId,
    seatedCount: seats.length,
    maxSeats: SEAT_COUNT,
    yourSeat: seatOf(seats, readerId),
    isHost: table.hostId === readerId,
    gameId: table.gameId,
    winnerId: table.winnerId,
  };
}

/**
 * Whether `profileId` has already been knocked out of `table`'s dealt game.
 *
 * A busted seat's `sit_and_go_table_players` row is never deleted or
 * updated -- forfeitTournamentSeat (lib/game/tournament.ts) only touches the
 * in-memory poker GameState, and leave_sit_and_go_table is pre-deal only by
 * design (see its own migration comment), so there is no mid-tournament way
 * to clear a registration row at all. Without this check, an eliminated
 * player reads as "still registered here" for as long as the other five
 * seats take to decide a winner -- blocking them from opening or joining any
 * other table, and bouncing SitAndGoShell's own redirect straight back into
 * the game they already lost on every visit to the lobby.
 */
async function isEliminatedFrom(table: StoredSitAndGoTable, profileId: string): Promise<boolean> {
  if (table.status !== "active" || !table.gameId) return false;
  const game = await getStoredGame(table.gameId);
  const seat = game?.seats.find((s) => s.profileId === profileId);
  return Boolean(seat && seat.stack <= 0 && seat.status === "out");
}

/**
 * The caller's live registration, treating an already-eliminated seat as no
 * registration at all. The one thing every `getActiveSitAndGoTableFor` call
 * site actually wants -- see isEliminatedFrom above.
 */
async function activeRegistrationFor(profileId: string): Promise<StoredSitAndGoTable | null> {
  const table = await getActiveSitAndGoTableFor(profileId);
  if (!table) return null;
  return (await isEliminatedFrom(table, profileId)) ? null : table;
}

/**
 * The correlation id a seat's refund credits against: the entry fee's own
 * id, so the reconcile cron and this app can never both refund it. Seats
 * claimed before stake ids were stored get a fixed per-seat id instead.
 */
function seatRefundCorrelationId(tableId: string, seat: SitAndGoSeatRow): string {
  return seat.stakeCorrelationId ?? `sit_and_go_seat_refund:${tableId}:${seat.playerId}:${seat.joinedAt}`;
}

/**
 * Credits the prize pool under a correlation id fixed to the table, so a
 * retry can never pay it twice. Never throws: the table is already durably
 * settled by the time this runs, and a credit failure here must not turn a
 * finished tournament into an error response for whichever poker action
 * request happened to trigger it. Returns the winner's profile only when
 * this call is the one that paid.
 */
async function payPrizePool(table: StoredSitAndGoTable): Promise<PlayerProfile | null> {
  if (!table.winnerId || !table.prizePool) return null;
  try {
    const paid = await creditGoldByProfileLedgered(
      table.winnerId,
      table.prizePool,
      `sit_and_go_payout:${table.id}`,
      "sit_and_go_payout",
    );
    if (!paid.success || paid.alreadyApplied) return null;
    return await getProfileById(table.winnerId);
  } catch (error) {
    console.error("sit_and_go.payout_credit_failed", {
      tableId: table.id,
      winnerId: table.winnerId,
      prizePool: table.prizePool,
      error,
    });
    return null;
  }
}

/** Pays a just-settled table out, then records the win. Never throws. */
async function payOutSitAndGo(
  table: StoredSitAndGoTable,
  seats: SitAndGoSeatRow[],
): Promise<PlayerProfile | null> {
  if (!table.winnerId || !table.prizePool) return null;
  const profile = await payPrizePool(table);

  // Awaited, not fired-and-forgotten: a serverless invocation can freeze
  // right after this function's caller (the poker route) responds, and an
  // un-awaited call could simply never run. Neither call throws.
  await applyMissionEvent(table.winnerId, { kind: "sit_and_go_won" });
  await applyAchievementEvent(table.winnerId, { kind: "sit_and_go_won" });
  await recordMultiWayResult("sit-and-go", seats.map((seat) => seat.playerId), table.winnerId);
  return profile;
}

const RETIRE_ACTION: PlayerAction = { type: "leave-seat" };

/**
 * Archives a game that was written but could not be linked to its table.
 * Stale sweeps only look at "playing" games, so the full starting stacks in
 * it can never be credited out as cash.
 */
async function retireUnlinkedGame(state: GameState): Promise<void> {
  const retired: GameState = {
    ...state,
    status: "archived",
    version: state.version + 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    await updateStoredGame(retired, RETIRE_ACTION, state.hostToken);
  } catch (error) {
    console.error("sit_and_go.unlinked_game_retire_failed", { gameId: state.id, error });
  }
}

/**
 * Cancels a table that went 'active' but never got a playable game, and
 * refunds every entry fee once. The version-guarded cancel is what makes it
 * once: whoever loses that race (this path, the sweep, or a late link) pays
 * nothing, and each refund is keyed to the seat's own stake besides.
 */
async function unwindUndealtSitAndGo(
  table: StoredSitAndGoTable,
  seats: SitAndGoSeatRow[],
): Promise<StoredSitAndGoTable | null> {
  const cancelled = await cancelStaleSitAndGoTable(table.id, table.version);
  if (!cancelled) return getSitAndGoTableById(table.id);

  for (const seat of seats) {
    const correlationId = seatRefundCorrelationId(table.id, seat);
    try {
      await creditGoldByProfileLedgered(seat.playerId, table.entryFee, correlationId, "sit_and_go_deal_failed_refund");
    } catch (error) {
      console.error("sit_and_go.deal_failed_refund_failed", {
        tableId: table.id,
        playerId: seat.playerId,
        correlationId,
        error,
      });
    }
  }
  return cancelled;
}

/**
 * Step 2 of the deal: builds the poker game from the locked seats, persists
 * it, and links it to the table. Throws if the game ends up unlinked, after
 * archiving any game it wrote.
 */
async function startSitAndGoGame(
  dealt: StoredSitAndGoTable,
  seats: SitAndGoSeatRow[],
): Promise<StoredSitAndGoTable> {
  // Each seat's profile is resolved fresh off its own registered token, the
  // same way every other seat-construction path in this app resolves
  // identity from a token rather than trusting a stale cached copy.
  const profiles = await Promise.all(seats.map((seat) => ensureProfile(seat.token)));
  const game = createTournamentGame(
    seats.map((seat, index) => ({ token: seat.token, profile: profiles[index] })),
    dealt.tier,
  );
  // games.id is a foreign key target, so the game has to exist before the link.
  await createStoredGame(game);

  let linked: StoredSitAndGoTable | null;
  try {
    linked = await setSitAndGoGameId(dealt.id, game.id);
  } catch (error) {
    // The answer was lost, not necessarily the write.
    const current = await getSitAndGoTableById(dealt.id);
    if (current?.gameId === game.id) return current;
    await retireUnlinkedGame(game);
    throw error;
  }
  if (linked) return linked;
  await retireUnlinkedGame(game);
  throw new Error("The dealt table no longer accepts a game.");
}

/**
 * Deals a table the instant its 6th seat fills. The only caller of
 * dealSitAndGoTable/setSitAndGoGameId -- see this module's own header for
 * why there is exactly one deal path here, unlike cribbage's two.
 */
async function dealSitAndGoTableIfReady(tableId: string): Promise<StoredSitAndGoTable | null> {
  const seatCount = (await getSitAndGoSeats(tableId)).length;
  if (seatCount !== SEAT_COUNT) return null;

  // Step 1: flip the table active under the exact-seat-count guard, with no
  // state payload yet -- see the migration's header for why building the
  // GameState before this guard succeeds would risk an orphaned games row.
  const dealt = await dealSitAndGoTable(tableId, seatCount);
  if (!dealt) return null;

  // Read after the lock: an 'active' table takes no joins or leaves, so
  // these are exactly the players the game is built for.
  const seats = await getSitAndGoSeats(tableId);

  let started: StoredSitAndGoTable;
  try {
    started = await startSitAndGoGame(dealt, seats);
  } catch (error) {
    // Every fee is already debited and the table is 'active', so it can't
    // be left here: its players would read as registered forever. The
    // caller's own request still succeeds and shows the cancelled table.
    console.error("sit_and_go.deal_step_two_failed", { tableId: dealt.id, error });
    return unwindUndealtSitAndGo(dealt, seats).catch((unwindError: unknown) => {
      console.error("sit_and_go.deal_unwind_failed", { tableId: dealt.id, error: unwindError });
      return dealt;
    });
  }

  // Nothing below may fail the request: the tournament has started.
  try {
    // Confirming each fee again means a confirm that failed at join time
    // can't let the reconcile cron refund a player who is now playing.
    await Promise.all(
      seats.map((seat) =>
        seat.stakeCorrelationId
          ? confirmGoldDebitLedgered(seat.stakeCorrelationId).catch((error) => {
              console.error("sit_and_go.deal_confirm_failed", { tableId: dealt.id, playerId: seat.playerId, error });
            })
          : undefined,
      ),
    );
    // Every registered player wagered, so every registered player earns XP
    // at the ordinary rate -- same parity argument cribbage's
    // dealTableIfReady makes. `null` throughout: only the caller who
    // triggered the deal has a live session token here, and awardWager's
    // Gold-crediting path is keyed just as well by profile id.
    await Promise.all(seats.map((seat) => awardWager(seat.playerId, null, dealt.entryFee)));
  } catch (error) {
    console.error("sit_and_go.after_deal_failed", { tableId: dealt.id, error });
  }
  return started;
}

/** How long a table may sit 'active' with no game before the sweep unwinds it. */
const UNDEALT_TABLE_GRACE_MS = 5 * 60 * 1000;
const UNDEALT_SWEEP_LIMIT = 10;

/**
 * Cancels and refunds tables left 'active' with no game, which only a crash
 * between the two deal steps can produce. Their players otherwise read as
 * registered forever and can't open or join anything else. Runs at the top
 * of open and join; safe to call from anywhere else too, since each unwind
 * is version guarded and each refund keyed to its seat's stake. Returns how
 * many tables this call cancelled.
 */
export async function sweepUndealtSitAndGoTables(limit = UNDEALT_SWEEP_LIMIT): Promise<number> {
  const cutoffIso = new Date(Date.now() - UNDEALT_TABLE_GRACE_MS).toISOString();
  const stuck = await getUndealtActiveSitAndGoTables(cutoffIso, limit);
  let cancelled = 0;
  for (const table of stuck) {
    const seats = await getSitAndGoSeats(table.id);
    const after = await unwindUndealtSitAndGo(table, seats);
    if (after?.status === "cancelled" && after.version === table.version + 1) cancelled += 1;
  }
  return cancelled;
}

/** The sweep as a best-effort step in front of open/join. */
async function sweepUndealtQuietly(): Promise<void> {
  await sweepUndealtSitAndGoTables().catch((error: unknown) => {
    console.error("sit_and_go.undealt_sweep_failed", { error });
  });
}

// ---- tables ------------------------------------------------------------

/**
 * Opens a table at the chosen tier and registers the host at seat 0.
 *
 * Rule 1: the entry fee leaves before the table row exists, and anything
 * that fails right after refunds it.
 */
export async function openSitAndGoTable(
  token: string,
  tier: unknown,
): Promise<{ table: SitAndGoTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  if (!isStakesTier(tier)) {
    throw new SitAndGoRequestError("Choose a real stakes tier to open a table.", 400);
  }
  await sweepUndealtQuietly();
  if (await activeRegistrationFor(profile.id)) {
    throw new SitAndGoRequestError("You are already registered for a Sit & Go.", 409);
  }

  const entryFee = TIER_CONFIG[tier].minBuyIn;
  const feeCorrelationId = `sit_and_go_open_fee:${randomUUID()}`;
  const debited = await spendStakeLedgered(profile, entryFee, feeCorrelationId, "sit_and_go_open");
  if (!debited) {
    throw new SitAndGoRequestError(`You need ${entryFee.toLocaleString()} Gold to open this table.`, 400);
  }

  let table: StoredSitAndGoTable | null = null;
  try {
    table = await createSitAndGoTableRow(profile.id, tier, entryFee);
    await claimSitAndGoSeat(table.id, profile.id, token, feeCorrelationId);
  } catch (error) {
    await creditGoldByProfileLedgered(profile.id, entryFee, feeCorrelationId, "sit_and_go_open_refund").catch(
      (refundError) => {
        console.error("sit_and_go.open_refund_failed", { profileId: profile.id, entryFee, error: refundError });
      },
    );
    // Same reasoning as cribbage's openCribbageTable: the table row can
    // persist even though seating the host in it fails right after, and a
    // host-less 'waiting' row would sit in the lobby list forever with no
    // one able to start or leave it. Best-effort cleanup; the stake is
    // already refunded either way.
    if (table) await cancelEmptySitAndGoTable(table.id, profile.id).catch(() => null);
    if (error instanceof SitAndGoTableNotJoinable) throw new SitAndGoRequestError(error.message, 409);
    throw error;
  }

  // The host is seated, so this fee can legitimately wait uncredited until the table deals.
  await confirmGoldDebitLedgered(feeCorrelationId).catch((confirmError) => {
    console.error("sit_and_go.open_confirm_failed", { profileId: profile.id, feeCorrelationId, error: confirmError });
  });

  const seats = await getSitAndGoSeats(table.id);
  return { table: tableView(table, seats, profile.id), profile: debited };
}

/** Open (waiting) tables, across every tier, as seen by an already-resolved `profile`. */
async function openTablesFor(profile: PlayerProfile): Promise<SitAndGoOpenTableView[]> {
  const tables = await getOpenSitAndGoTables();
  if (tables.length === 0) return [];

  const hostIds = [...new Set(tables.map((t) => t.hostId))];
  const [profiles, seatCounts] = await Promise.all([
    getPublicProfilesByIds(hostIds),
    getSeatCountsForSitAndGoTables(tables.map((t) => t.id)),
  ]);

  return tables.map((t) => ({
    id: t.id,
    hostName: profiles.get(t.hostId)?.displayName ?? "Player",
    tier: t.tier,
    entryFee: t.entryFee,
    seatedCount: seatCounts.get(t.id) ?? 0,
    maxSeats: SEAT_COUNT,
    createdAt: t.createdAt,
    mine: t.hostId === profile.id,
  }));
}

/** Open (waiting) tables, across every tier: the lobby list. */
export async function listOpenSitAndGoTables(
  token: string,
): Promise<{ tables: SitAndGoOpenTableView[]; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  return { tables: await openTablesFor(profile), profile };
}

/**
 * The caller's own live (waiting or active) registration, or null.
 *
 * Deliberately does not fall back to a "recently completed" lookup the way
 * cribbage's readMyCribbageTable does: once a table deals, the ongoing game
 * (and its eventual result) is entirely owned by the poker GameState behind
 * `gameId` -- lib/game/types.ts's TournamentState carries the winner, and
 * the client reads it straight off the ordinary game snapshot it's already
 * polling. There is nothing this row can tell a finished player that the
 * game itself doesn't already say better.
 *
 * Also treats an already-eliminated seat as "no registration" (see
 * activeRegistrationFor) -- otherwise a busted player would be handed the
 * same active table forever, and SitAndGoShell's redirect effect would send
 * them straight back into the game they already lost every time they open
 * the lobby, for as long as the other five seats take to decide a winner.
 */
async function myActiveTableFor(profile: PlayerProfile): Promise<SitAndGoTableView | null> {
  const table = await activeRegistrationFor(profile.id);
  if (!table) return null;
  const seats = await getSitAndGoSeats(table.id);
  return tableView(table, seats, profile.id);
}

export async function readMySitAndGoTable(
  token: string,
): Promise<{ table: SitAndGoTableView | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  return { table: await myActiveTableFor(profile), profile };
}

/**
 * The GET /api/sit-and-go answer in one resolve: the caller's own live
 * registration if there is one, otherwise every open table. Exists
 * separately from readMySitAndGoTable + listOpenSitAndGoTables so the route
 * -- polled every 2s by every connected browser, per getSeatCountsForSitAndGoTables's
 * own comment -- doesn't re-run ensureProfile (a `player_sessions` upsert
 * plus a `profiles` select, unconditionally, on every call) a second time
 * for the common case of a player just browsing the open-table lobby.
 */
export async function readSitAndGoLobby(
  token: string,
): Promise<{ table: SitAndGoTableView | null; tables: SitAndGoOpenTableView[]; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await myActiveTableFor(profile);
  if (table) return { table, tables: [], profile };
  return { table: null, tables: await openTablesFor(profile), profile };
}

/** A specific table by id. 403 unless the reader is registered at it. */
export async function readSitAndGoTableById(
  token: string,
  tableId: string,
): Promise<{ table: SitAndGoTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getSitAndGoTableById(tableId);
  if (!table) throw new SitAndGoRequestError("No such table.", 404);

  const seats = await getSitAndGoSeats(tableId);
  if (seatOf(seats, profile.id) === null) throw new SitAndGoRequestError("That is not your table.", 403);

  return { table: tableView(table, seats, profile.id), profile };
}

/**
 * Registers for an open table, debiting the joiner's entry fee. If this join
 * fills the 6th seat, the table deals in the same call.
 */
export async function joinSitAndGoTable(
  token: string,
  tableId: string,
): Promise<{ table: SitAndGoTableView; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  await sweepUndealtQuietly();
  const table = await getSitAndGoTableById(tableId);
  if (!table) throw new SitAndGoRequestError("No such table.", 404);
  if (await activeRegistrationFor(profile.id)) {
    throw new SitAndGoRequestError("You are already registered for a Sit & Go.", 409);
  }

  // Rule 1: the joiner's entry fee leaves before their seat exists.
  const feeCorrelationId = `sit_and_go_join_fee:${randomUUID()}`;
  const debited = await spendStakeLedgered(profile, table.entryFee, feeCorrelationId, "sit_and_go_join");
  if (!debited) {
    throw new SitAndGoRequestError(`You need ${table.entryFee.toLocaleString()} Gold to join this table.`, 400);
  }

  try {
    await claimSitAndGoSeat(tableId, profile.id, token, feeCorrelationId);
  } catch (error) {
    await creditGoldByProfileLedgered(profile.id, table.entryFee, feeCorrelationId, "sit_and_go_join_refund").catch(
      (refundError) => {
        console.error("sit_and_go.join_refund_failed", {
          tableId,
          profileId: profile.id,
          entryFee: table.entryFee,
          error: refundError,
        });
      },
    );
    if (error instanceof SitAndGoTableNotJoinable) throw new SitAndGoRequestError(error.message, 409);
    throw error;
  }

  await confirmGoldDebitLedgered(feeCorrelationId).catch((confirmError) => {
    console.error("sit_and_go.join_confirm_failed", {
      tableId,
      profileId: profile.id,
      feeCorrelationId,
      error: confirmError,
    });
  });

  const dealt = await dealSitAndGoTableIfReady(tableId);
  const current = dealt ?? (await getSitAndGoTableById(tableId)) ?? table;
  const seats = await getSitAndGoSeats(tableId);
  return { table: tableView(current, seats, profile.id), profile: debited };
}

/** Leaving before the table has dealt. Refunds exactly the caller's own entry fee. */
export async function leaveSitAndGoTable(
  token: string,
  tableId: string,
): Promise<{ profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const table = await getSitAndGoTableById(tableId);
  if (!table) throw new SitAndGoRequestError("No such table.", 404);

  // Rule 4: only a seat leaveSitAndGoTableRow actually removed is refunded.
  const left = await leaveSitAndGoTableRow(tableId, profile.id);
  if (!left) throw new SitAndGoRequestError("You are not registered at that table, or it has already started.", 409);

  // Credited against the fee's own ledger id: if the reconcile cron already
  // refunded it (its confirm failed), this is a no-op, not a second refund.
  const correlationId = seatRefundCorrelationId(tableId, left);
  const refunded = await creditGoldByProfileLedgered(profile.id, table.entryFee, correlationId, "sit_and_go_leave_refund")
    .catch((error: unknown) => {
      console.error("sit_and_go.leave_refund_failed", { tableId, profileId: profile.id, correlationId, error });
      throw error;
    });
  return { profile: refunded.success ? { ...profile, goldBalance: refunded.goldBalance } : profile };
}

// ---- settlement, called from the ordinary poker routes ------------------

/**
 * Called after every poker action/advance against a tournament game. A no-op
 * for every cash table (`state.tournament` is null) and for a tournament
 * game that hasn't just decided a winner. Never throws -- see payOutSitAndGo
 * -- so callers can fire this without it ever turning an ordinary poker
 * action response into an error.
 *
 * Returns the winner's just-credited profile (or null if nothing was paid
 * here) so the calling route can hand it back to the browser that happens to
 * be the winner -- without it, the header's Gold balance would not reflect
 * the payout until some unrelated later request reloaded the profile.
 */
export async function settleSitAndGoIfFinished(state: GameState): Promise<PlayerProfile | null> {
  const winnerId = state.tournament?.winnerProfileId;
  if (!winnerId) return null;

  const table = await getSitAndGoTableByGameId(state.id);
  if (!table) return null;
  // A completed table is never paid again here. Tables settled before the
  // payout moved onto the ledger have no ledger row under its key, so a
  // "retry" would land a second pot. Only the call that wins the settle pays.
  // Cancelled, or never dealt -- nothing to pay.
  if (table.status !== "active") return null;

  const settled = await settleSitAndGoTable(table, winnerId);
  // Rule 2: a lost race did not happen, so it does not pay. Whoever won that
  // race is settling and paying this same table right now.
  if (!settled) return null;

  const seats = await getSitAndGoSeats(table.id);
  return payOutSitAndGo(settled, seats);
}

export function toSitAndGoErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That table could not be played.");
}

import "server-only";
import { randomUUID } from "crypto";
import type {
  PlayerObject,
  SessionSettlement,
  SessionSettlementPort,
} from "./table-manager/types";
import { creditGold, ensureProfile, spendGold } from "./profile-store";
import { adminClient } from "./supabase-admin";

type SessionStatus = "active" | "settled" | "refunded";

export interface CashGameSession {
  id: string;
  gameId: string;
  profileId: string;
  sessionToken: string;
  seatNumber: number;
  sessionStartChips: number;
  currentChips: number;
  handsWonCount: number;
  unlimitedGold: boolean;
  status: SessionStatus;
}

export interface OpenCashGameSessionInput {
  id?: string;
  gameId: string;
  profileId: string;
  sessionToken: string;
  seatNumber: number;
  buyIn: number;
}

export interface OpenCashGameSessionResult {
  session: CashGameSession;
  goldBalance: number;
  createdNow: boolean;
}

interface SettlementRpcRow {
  cash_session_id: string;
  current_chips: number;
  hands_won_count: number;
  net_earnings: number;
  multiplier_basis_points: number;
  payout_chips: number;
  credited_gold: number;
  gold_balance: number;
  settled_now: boolean;
}

declare global {
  var __riverRoomCashGameSessions: Map<string, CashGameSession> | undefined;
}

const memorySessions =
  globalThis.__riverRoomCashGameSessions ?? new Map<string, CashGameSession>();
globalThis.__riverRoomCashGameSessions = memorySessions;

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

export function earningsMultiplier(
  netEarnings: number,
  handsWonCount: number,
): SessionSettlement["multiplier"] {
  requireNonNegativeInteger("Hands won", handsWonCount);
  if (netEarnings <= 0 || handsWonCount < 5) return 1;
  if (handsWonCount >= 20) return 1.5;
  if (handsWonCount >= 10) return 1.25;
  return 1.1;
}

export function calculateSessionSettlement(
  sessionStartChips: number,
  currentChips: number,
  handsWonCount: number,
): Omit<SessionSettlement, "cashSessionId"> {
  requireNonNegativeInteger("Session start chips", sessionStartChips);
  requireNonNegativeInteger("Current chips", currentChips);
  requireNonNegativeInteger("Hands won", handsWonCount);
  const netEarnings = currentChips - sessionStartChips;
  const multiplier = earningsMultiplier(netEarnings, handsWonCount);
  const payout =
    netEarnings > 0
      ? sessionStartChips + Math.floor(netEarnings * multiplier)
      : currentChips;
  return {
    currentChips,
    handsWonCount,
    netEarnings,
    multiplier,
    payout,
  };
}

function multiplierFromBasisPoints(
  basisPoints: number,
): SessionSettlement["multiplier"] {
  switch (basisPoints) {
    case 10_000:
      return 1;
    case 11_000:
      return 1.1;
    case 12_500:
      return 1.25;
    case 15_000:
      return 1.5;
    default:
      throw new Error(`Unexpected earnings multiplier: ${basisPoints}.`);
  }
}

/**
 * Atomically deducts a buy-in and creates its durable accounting row. The
 * caller supplies/reuses the UUID so a network retry cannot charge twice.
 */
export async function openCashGameSession(
  input: OpenCashGameSessionInput,
): Promise<OpenCashGameSessionResult> {
  if (!Number.isInteger(input.seatNumber) || input.seatNumber < 1 || input.seatNumber > 6) {
    throw new Error("Seat number must be from 1 through 6.");
  }
  if (!Number.isInteger(input.buyIn) || input.buyIn <= 0) {
    throw new Error("Buy-in must be a positive integer.");
  }
  const id = input.id ?? randomUUID();
  const existing = memorySessions.get(id);
  const supabase = adminClient();

  if (!supabase) {
    if (existing) {
      const matches =
        existing.gameId === input.gameId &&
        existing.profileId === input.profileId &&
        existing.sessionToken === input.sessionToken &&
        existing.seatNumber === input.seatNumber &&
        existing.sessionStartChips === input.buyIn;
      if (!matches) throw new Error("Cash-game session idempotency conflict.");
      const profile = await ensureProfile(input.sessionToken);
      return {
        session: { ...existing },
        goldBalance: profile.goldBalance,
        createdNow: false,
      };
    }

    const active = [...memorySessions.values()].find(
      (session) => session.profileId === input.profileId && session.status === "active",
    );
    if (active) throw new Error("This profile already has an active cash-game session.");

    const profile = await spendGold(input.sessionToken, input.buyIn);
    const session: CashGameSession = {
      id,
      gameId: input.gameId,
      profileId: input.profileId,
      sessionToken: input.sessionToken,
      seatNumber: input.seatNumber,
      sessionStartChips: input.buyIn,
      currentChips: input.buyIn,
      handsWonCount: 0,
      unlimitedGold: profile.unlimitedGold,
      status: "active",
    };
    memorySessions.set(id, session);
    return { session: { ...session }, goldBalance: profile.goldBalance, createdNow: true };
  }

  const { data, error } = await supabase
    .rpc("open_cash_game_session", {
      p_session_id: id,
      p_game_id: input.gameId,
      p_token: input.sessionToken,
      p_seat_number: input.seatNumber,
      p_buy_in: input.buyIn,
    })
    .single();
  if (error) {
    console.error("cash_game_session.open_failed", {
      gameId: input.gameId,
      profileId: input.profileId,
      seatNumber: input.seatNumber,
      code: error.code,
      message: error.message,
    });
    if (error.message.includes("Not enough Gold")) throw new Error("Not enough Gold.");
    throw new Error(`Could not open cash-game session: ${error.message}`);
  }

  const row = data as {
    cash_session_id: string;
    profile_id: string;
    gold_balance: number;
    unlimited_gold: boolean;
    created_now: boolean;
  };
  return {
    session: {
      id: row.cash_session_id,
      gameId: input.gameId,
      profileId: row.profile_id,
      sessionToken: input.sessionToken,
      seatNumber: input.seatNumber,
      sessionStartChips: input.buyIn,
      currentChips: input.buyIn,
      handsWonCount: 0,
      unlimitedGold: row.unlimited_gold,
      status: "active",
    },
    goldBalance: Number(row.gold_balance),
    createdNow: Boolean(row.created_now),
  };
}

/**
 * The only normal-session cash-out write. The database function locks both
 * ledger and profile rows and is idempotent, so retries cannot pay twice.
 */
export async function handlePlayerLeaveSession(
  player: PlayerObject,
): Promise<SessionSettlement> {
  requireNonNegativeInteger("Current chips", player.currentChips);
  requireNonNegativeInteger("Hands won", player.handsWonCount);
  const supabase = adminClient();

  if (!supabase) {
    const session = memorySessions.get(player.cashSessionId);
    if (!session || session.sessionToken !== player.sessionToken) {
      throw new Error("Cash-game session not found.");
    }
    if (session.status !== "active") {
      return {
        cashSessionId: session.id,
        ...calculateSessionSettlement(
          session.sessionStartChips,
          session.currentChips,
          session.handsWonCount,
        ),
      };
    }

    const settlement = calculateSessionSettlement(
      session.sessionStartChips,
      player.currentChips,
      player.handsWonCount,
    );
    if (!session.unlimitedGold && settlement.payout > 0) {
      await creditGold(session.sessionToken, settlement.payout);
    }
    Object.assign(session, {
      currentChips: player.currentChips,
      handsWonCount: player.handsWonCount,
      status: "settled" as const,
    });
    return { cashSessionId: session.id, ...settlement };
  }

  const { data, error } = await supabase
    .rpc("settle_cash_game_session", {
      p_session_id: player.cashSessionId,
      p_token: player.sessionToken,
      p_current_chips: player.currentChips,
      p_hands_won_count: player.handsWonCount,
    })
    .single();
  if (error) {
    console.error("cash_game_session.settlement_failed", {
      cashSessionId: player.cashSessionId,
      profileId: player.profileId,
      code: error.code,
      message: error.message,
    });
    throw new Error(`Could not settle cash-game session: ${error.message}`);
  }

  const row = data as SettlementRpcRow;
  return {
    cashSessionId: row.cash_session_id,
    currentChips: Number(row.current_chips),
    handsWonCount: Number(row.hands_won_count),
    netEarnings: Number(row.net_earnings),
    multiplier: multiplierFromBasisPoints(Number(row.multiplier_basis_points)),
    payout: Number(row.payout_chips),
  };
}

export const cashGameSessionSettlements: SessionSettlementPort = {
  settle: handlePlayerLeaveSession,
};

/**
 * Compensates a buy-in only when table creation/seat persistence failed.
 * It is intentionally separate from cash-out and is also idempotent.
 */
export async function refundCashGameSession(
  cashSessionId: string,
  sessionToken: string,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const session = memorySessions.get(cashSessionId);
    if (!session || session.sessionToken !== sessionToken || session.status !== "active") return;
    if (!session.unlimitedGold) {
      await creditGold(sessionToken, session.sessionStartChips);
    }
    session.status = "refunded";
    return;
  }

  const { error } = await supabase.rpc("refund_cash_game_session", {
    p_session_id: cashSessionId,
    p_token: sessionToken,
  });
  if (error) {
    console.error("cash_game_session.refund_failed", {
      cashSessionId,
      code: error.code,
      message: error.message,
    });
    throw new Error(`Could not refund cash-game session: ${error.message}`);
  }
}

/** One cold-start read used to reconstruct a persistent worker-owned room. */
export async function listActiveCashGameSessions(
  gameId: string,
): Promise<CashGameSession[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memorySessions.values()]
      .filter((session) => session.gameId === gameId && session.status === "active")
      .map((session) => ({ ...session }));
  }

  const { data, error } = await supabase
    .from("cash_game_sessions")
    .select(
      "id, game_id, profile_id, session_token, seat_number, session_start_chips, current_chips, hands_won_count, status, profiles!inner(unlimited_gold)",
    )
    .eq("game_id", gameId)
    .eq("status", "active");
  if (error) {
    throw new Error(`Could not load active cash-game sessions: ${error.message}`);
  }
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: String(row.id),
      gameId: String(row.game_id),
      profileId: String(row.profile_id),
      sessionToken: String(row.session_token),
      seatNumber: Number(row.seat_number),
      sessionStartChips: Number(row.session_start_chips),
      currentChips: Number(row.current_chips),
      handsWonCount: Number(row.hands_won_count),
      unlimitedGold: Boolean(
        (profile as { unlimited_gold?: unknown } | null)?.unlimited_gold,
      ),
      status: String(row.status) as SessionStatus,
    };
  });
}

import "server-only";
import {
  MIDNIGHT_MERCHANT_CATALOG,
  isMidnightMerchantItemId,
  priceForNextPurchase,
  type MidnightMerchantItemId,
  type MidnightMerchantSnapshot,
  type MidnightMerchantStockLine,
  type MidnightMerchantTrigger,
} from "@/lib/stackacres/midnight-merchant";
import { adminClient } from "./supabase-admin";

/**
 * The persistence layer for the Midnight Merchant, mirroring
 * lib/server/stackacres-store.ts's own split: every function here either
 * calls one of the RPCs in
 * supabase/migrations/20260905130000_stackacres_midnight_merchant.sql, or,
 * absent Supabase env vars, keeps the identical contract in memory (see
 * CLAUDE.md's "absent env vars, stores use memory" rule) -- used by the full
 * `npx vitest run` suite and any local session with no Supabase project
 * configured.
 *
 * The memory-mode branch below is NOT a toy: it re-implements the same
 * lock-order/refusal semantics the SQL enforces (session-liveness sweep,
 * stock-then-Gold ordering, streak-gated pricing) so a contributor without
 * Supabase credentials still exercises the real state machine, not a stub
 * that always succeeds. It has no genuine concurrent-request race to guard
 * against -- Node's event loop already serializes these functions between
 * `await` points -- so it has no FOR UPDATE equivalent to write; the
 * ordering of the code IS the ordering the SQL's locks enforce.
 */

const SESSION_IDLE_MS = 30 * 60 * 1000;

interface MemoryVisit {
  spawnedAt: number;
  expiresAt: number;
  trigger: MidnightMerchantTrigger;
  purchaseStreak: number;
  stock: Map<MidnightMerchantItemId, { basePrice: number; remaining: number }>;
}

interface MemorySessionLookup {
  (profileId: string): number | null; // last-seen epoch ms, or null if unknown
}

const memoryVisits = new Map<string, MemoryVisit>();

/** Only used by the memory-mode branch, and only ever set by
 *  lib/server/midnight-merchant-service.ts through `__setMemorySessionLookup`
 *  for tests -- production memory-mode (no Supabase project) has no
 *  `player_sessions` table to sweep against either, so it treats every
 *  session as live rather than guessing; the real idle sweep only exists
 *  where the real table does. */
let sessionLookup: MemorySessionLookup = () => null;

export function __setMemorySessionLookupForTest(lookup: MemorySessionLookup): void {
  sessionLookup = lookup;
}

export function __resetMidnightMerchantStoreForTest(): void {
  memoryVisits.clear();
  sessionLookup = () => null;
}

function memorySessionLive(profileId: string, idleMs: number, now: number): boolean {
  const lastSeen = sessionLookup(profileId);
  if (lastSeen === null) return true;
  return now - lastSeen <= idleMs;
}

function sweepIfStale(profileId: string, now: number): void {
  const visit = memoryVisits.get(profileId);
  if (!visit) return;
  const stillLive = memorySessionLive(profileId, SESSION_IDLE_MS, now);
  if (!stillLive || visit.expiresAt <= now) {
    memoryVisits.delete(profileId);
  }
}

/**
 * Spawns a visit if none is currently live for this profile. Returns whether
 * a new visit was actually created -- false means an existing, unexpired
 * visit was left untouched (see `spawn_midnight_merchant`'s own idempotency
 * contract).
 */
export async function spawnMidnightMerchantVisit(
  profileId: string,
  trigger: MidnightMerchantTrigger,
  windowMs: number,
  now = new Date(),
): Promise<boolean> {
  const items = MIDNIGHT_MERCHANT_CATALOG.map((entry) => ({
    item_id: entry.itemId,
    base_price: entry.basePrice,
    quantity: entry.stockPerVisit,
  }));

  const supabase = adminClient();
  if (!supabase) {
    sweepIfStale(profileId, now.getTime());
    if (memoryVisits.has(profileId)) return false;
    const stock = new Map<MidnightMerchantItemId, { basePrice: number; remaining: number }>();
    for (const entry of MIDNIGHT_MERCHANT_CATALOG) {
      stock.set(entry.itemId, { basePrice: entry.basePrice, remaining: entry.stockPerVisit });
    }
    memoryVisits.set(profileId, {
      spawnedAt: now.getTime(),
      expiresAt: now.getTime() + windowMs,
      trigger,
      purchaseStreak: 0,
      stock,
    });
    return true;
  }

  const { data, error } = await supabase.rpc("spawn_midnight_merchant", {
    p_profile_id: profileId,
    p_trigger: trigger,
    p_window_ms: windowMs,
    p_items: items,
  });
  if (error) throw new Error(`Could not summon the Midnight Merchant: ${error.message}`);
  return Boolean(data);
}

/** Reads the live visit, or null if none is active -- sweeping an
 *  idle-session or clock-expired one first, same as the RPC. */
export async function readMidnightMerchantVisit(
  profileId: string,
  now = new Date(),
): Promise<MidnightMerchantSnapshot | null> {
  const supabase = adminClient();
  if (!supabase) {
    sweepIfStale(profileId, now.getTime());
    const visit = memoryVisits.get(profileId);
    if (!visit) return null;
    const stock: MidnightMerchantStockLine[] = [...visit.stock.entries()].map(
      ([itemId, row]) => ({ itemId, basePrice: row.basePrice, remaining: row.remaining }),
    );
    return {
      trigger: visit.trigger,
      spawnedAtIso: new Date(visit.spawnedAt).toISOString(),
      expiresAtIso: new Date(visit.expiresAt).toISOString(),
      purchaseStreak: visit.purchaseStreak,
      stock,
    };
  }

  const { data, error } = await supabase
    .rpc("get_midnight_merchant_state", { p_profile_id: profileId, p_idle_ms: SESSION_IDLE_MS })
    .maybeSingle();
  if (error) throw new Error(`Could not check the Midnight Merchant: ${error.message}`);
  if (!data) return null;

  const { data: stockRows, error: stockError } = await supabase.rpc("get_midnight_merchant_stock", {
    p_profile_id: profileId,
  });
  if (stockError) throw new Error(`Could not read the Midnight Merchant's stock: ${stockError.message}`);

  const row = data as { spawned_at: string; expires_at: string; trigger: string; purchase_streak: number };
  const stock: MidnightMerchantStockLine[] = ((stockRows ?? []) as {
    item_id: string;
    base_price: number;
    remaining: number;
  }[])
    .filter((line) => isMidnightMerchantItemId(line.item_id))
    .map((line) => ({
      itemId: line.item_id as MidnightMerchantItemId,
      basePrice: Number(line.base_price),
      remaining: Number(line.remaining),
    }));

  return {
    trigger: row.trigger as MidnightMerchantTrigger,
    spawnedAtIso: row.spawned_at,
    expiresAtIso: row.expires_at,
    purchaseStreak: row.purchase_streak,
    stock,
  };
}

export type MidnightMerchantRedeemFailureReason = "no_merchant" | "sold_out" | "insufficient_gold";

export interface MidnightMerchantRedeemResult {
  success: boolean;
  reason: MidnightMerchantRedeemFailureReason | null;
  pricePaid: number | null;
  purchaseStreak: number;
  remaining: number;
  goldBalance: number | null;
}

/**
 * The one function in this file that moves Gold, via
 * `redeem_midnight_merchant_item` -- see that function's own header for the
 * full lock/ordering contract. Never throws for a REFUSAL (sold out,
 * insufficient Gold, no active visit); those come back as
 * `success: false` with a `reason`, exactly like `spendGoldByProfile`
 * returning null is a refusal rather than a thrown error elsewhere in this
 * codebase. Only a genuine infrastructure failure (a dropped connection, a
 * malformed row) throws.
 */
export async function redeemMidnightMerchantItem(
  profileId: string,
  itemId: MidnightMerchantItemId,
  // The exact shape of `spendGoldByProfile` in lib/server/profile-store.ts --
  // taken as a parameter, not imported directly, so this module stays free
  // of a dependency the "server-only" store layer does not otherwise need
  // (see the file header). Its return is `PlayerProfile | null`, the same
  // "null means refused, never throws for an ordinary insufficient-Gold
  // refusal" contract every other Gold spend in this app already uses --
  // NOT the RPC's own `{success, gold_balance}` row shape, since that shape
  // only exists inside the SQL layer this function's Supabase branch calls
  // directly; the memory-mode branch below calls the real TypeScript
  // function instead and must match ITS real return type.
  spendGold: (profileId: string, amount: number) => Promise<{ goldBalance: number } | null>,
  now = new Date(),
): Promise<MidnightMerchantRedeemResult> {
  const supabase = adminClient();
  if (!supabase) {
    sweepIfStale(profileId, now.getTime());
    const visit = memoryVisits.get(profileId);
    if (!visit || visit.expiresAt <= now.getTime()) {
      return { success: false, reason: "no_merchant", pricePaid: null, purchaseStreak: 0, remaining: 0, goldBalance: null };
    }
    const line = visit.stock.get(itemId);
    if (!line || line.remaining <= 0) {
      return {
        success: false,
        reason: "sold_out",
        pricePaid: null,
        purchaseStreak: visit.purchaseStreak,
        remaining: line?.remaining ?? 0,
        goldBalance: null,
      };
    }
    const price = priceForNextPurchase(line.basePrice, visit.purchaseStreak);
    const spent = await spendGold(profileId, price);
    if (!spent) {
      return {
        success: false,
        reason: "insufficient_gold",
        pricePaid: price,
        purchaseStreak: visit.purchaseStreak,
        remaining: line.remaining,
        goldBalance: null,
      };
    }
    line.remaining -= 1;
    visit.purchaseStreak += 1;
    return {
      success: true,
      reason: null,
      pricePaid: price,
      purchaseStreak: visit.purchaseStreak,
      remaining: line.remaining,
      goldBalance: spent.goldBalance,
    };
  }

  const { data, error } = await supabase
    .rpc("redeem_midnight_merchant_item", {
      p_profile_id: profileId,
      p_item_id: itemId,
      p_idle_ms: SESSION_IDLE_MS,
    })
    .single();
  if (error) throw new Error(`Could not trade with the Midnight Merchant: ${error.message}`);

  const row = data as {
    success: boolean;
    reason: string | null;
    price_paid: number | null;
    streak: number;
    remaining: number;
    gold_balance: number | null;
  };
  return {
    success: row.success,
    reason: (row.reason as MidnightMerchantRedeemFailureReason | null) ?? null,
    pricePaid: row.price_paid,
    purchaseStreak: row.streak,
    remaining: row.remaining,
    goldBalance: row.gold_balance,
  };
}

export async function expireMidnightMerchantVisit(profileId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryVisits.delete(profileId);
    return;
  }
  const { error } = await supabase.rpc("expire_midnight_merchant_visit", { p_profile_id: profileId });
  if (error) throw new Error(`Could not close out the Midnight Merchant: ${error.message}`);
}

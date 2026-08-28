import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for verified AdMob SSV callbacks.
 *
 * A receipt is recorded once, keyed by Google's own `transaction_id` --
 * that's the idempotency key, the same role rewarded_ad_grants' status flip
 * plays for the web offer, except here the ticket is opened and closed in
 * one write instead of two, because the "issue" and "verify" steps both
 * happen on Google's side before this server ever sees the callback.
 *
 * Supabase when configured, an in-process Map otherwise -- same split as
 * every other store in this directory.
 */

export interface AdmobSsvReceipt {
  transactionId: string;
  profileId: string;
  rewardGold: number;
  /** Echoes the client's own nonce (AdMob's ssv.customData), so the native app can poll for its own callback landing. */
  customData: string | null;
  verifiedAt: string;
}

declare global {
  var __riverRoomAdmobSsvReceipts: Map<string, AdmobSsvReceipt> | undefined;
}

const memoryReceipts = globalThis.__riverRoomAdmobSsvReceipts ?? new Map<string, AdmobSsvReceipt>();
globalThis.__riverRoomAdmobSsvReceipts = memoryReceipts;

/** Test seam only: the memory branch is process-global, so suites must not leak receipts into each other. */
export function __resetAdmobSsvReceiptsForTest(): void {
  memoryReceipts.clear();
}

/** Thrown when recording a receipt would put a profile over its daily cap. The DB enforces this too (see the migration this table shipped with); this is the memory branch's own copy of the same rule. */
export class AdmobDailyLimitExceeded extends Error {
  constructor() {
    super("Daily AdMob reward limit reached for this profile.");
    this.name = "AdmobDailyLimitExceeded";
  }
}

interface ReceiptRow {
  transaction_id: string;
  profile_id: string;
  reward_gold: number | string;
  custom_data: string | null;
  verified_at: string;
}

function fromRow(row: ReceiptRow): AdmobSsvReceipt {
  return {
    transactionId: String(row.transaction_id),
    profileId: String(row.profile_id),
    rewardGold: Number(row.reward_gold),
    customData: row.custom_data === null ? null : String(row.custom_data),
    verifiedAt: String(row.verified_at),
  };
}

/**
 * Records a verified callback once. Returns null if `transactionId` was
 * already recorded -- Google redelivers an SSV callback the same way Stripe
 * redelivers a webhook, and a redelivery must find the row already there and
 * do nothing, never credit a second time.
 *
 * Enforced by a unique constraint on transaction_id, caught from the 23505,
 * rather than a read-then-insert -- the same reasoning
 * rewarded-ad-store.ts's createRewardedAdGrant gives for its own one-pending
 * guard.
 *
 * `dailyLimit`/`since` are the daily-cap gate, enforced here rather than only
 * by a check the caller made a moment earlier: two SSV callbacks for the same
 * profile arriving close together can both pass a check-then-insert, each
 * having read the count before either had written its row. The Supabase
 * branch's guard is a BEFORE INSERT trigger that serializes concurrent
 * inserts for one profile with an advisory lock before counting (see the
 * migration this table shipped with, admob_ssv_receipts_enforce_daily_cap) --
 * the same reasoning ante_up_attempts_enforce_wager_ceiling gives for being a
 * trigger and not a CHECK. The memory branch enforces the identical rule
 * itself, synchronously, since nothing here awaits between the count and the
 * write.
 */
export async function recordAdmobSsvReceipt(
  transactionId: string,
  profileId: string,
  rewardGold: number,
  customData: string | null,
  verifiedAt: string,
  dailyLimit: number,
  since: string,
): Promise<AdmobSsvReceipt | null> {
  const supabase = adminClient();
  if (!supabase) {
    if (memoryReceipts.has(transactionId)) return null;
    let claimedToday = 0;
    for (const receipt of memoryReceipts.values()) {
      if (receipt.profileId !== profileId) continue;
      if (Date.parse(receipt.verifiedAt) >= Date.parse(since)) claimedToday += 1;
    }
    if (claimedToday >= dailyLimit) throw new AdmobDailyLimitExceeded();
    const receipt: AdmobSsvReceipt = { transactionId, profileId, rewardGold, customData, verifiedAt };
    memoryReceipts.set(transactionId, receipt);
    return receipt;
  }

  const { data, error } = await supabase
    .from("admob_ssv_receipts")
    .insert({
      transaction_id: transactionId,
      profile_id: profileId,
      reward_gold: rewardGold,
      custom_data: customData,
      verified_at: verifiedAt,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return null;
    // check_violation from admob_ssv_receipts_enforce_daily_cap. The table's
    // only other CHECK (reward_gold > 0) can't fail here -- the caller always
    // passes ADMOB_REWARDED_AD_GOLD, a positive constant -- so this code is
    // unambiguously the daily-cap trigger in practice.
    if (error.code === "23514") throw new AdmobDailyLimitExceeded();
    throw new Error(`Could not record the ad-view receipt: ${error.message}`);
  }
  return fromRow(data as ReceiptRow);
}

/**
 * Undoes a recorded receipt when the Gold credit that should follow it never
 * lands (see the try/catch in admob-ssv-service.ts). Best-effort compensation,
 * not a transaction, same posture as rewarded-ad-store.ts's
 * releaseRewardedAdGrant: this only runs after nothing has been paid, so a
 * failure here costs the retry, never a double payout. Freeing the
 * transaction_id lets Google's own redelivery (it retries a non-2xx SSV
 * response) complete the credit cleanly next time.
 */
export async function deleteAdmobSsvReceipt(transactionId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryReceipts.delete(transactionId);
    return;
  }
  await supabase.from("admob_ssv_receipts").delete().eq("transaction_id", transactionId);
}

/** How many receipts this profile has been paid since `since`. Feeds the daily cap, the same shape countClaimedRewardedAdGrants gives the web offer. */
export async function countAdmobSsvReceipts(profileId: string, since: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    let count = 0;
    for (const receipt of memoryReceipts.values()) {
      if (receipt.profileId !== profileId) continue;
      if (Date.parse(receipt.verifiedAt) >= Date.parse(since)) count += 1;
    }
    return count;
  }
  const { count, error } = await supabase
    .from("admob_ssv_receipts")
    .select("transaction_id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gte("verified_at", since);
  if (error) throw new Error(`Could not read the ad-view reward history: ${error.message}`);
  return count ?? 0;
}

/**
 * Looks up a receipt by the nonce the native client generated before
 * showing the ad (AdMob's ssv.customData, round-tripped verbatim through
 * Google's callback). This is how the client learns its own watch was paid:
 * the SSV callback is server-to-server and never touches the player's
 * device, so the modal has nothing to await except polling this.
 */
export async function findAdmobSsvReceiptByCustomData(
  profileId: string,
  customData: string,
  since: string,
): Promise<AdmobSsvReceipt | null> {
  const supabase = adminClient();
  if (!supabase) {
    for (const receipt of memoryReceipts.values()) {
      if (receipt.profileId !== profileId) continue;
      if (receipt.customData !== customData) continue;
      if (Date.parse(receipt.verifiedAt) < Date.parse(since)) continue;
      return receipt;
    }
    return null;
  }
  const { data, error } = await supabase
    .from("admob_ssv_receipts")
    .select("*")
    .eq("profile_id", profileId)
    .eq("custom_data", customData)
    .gte("verified_at", since)
    .maybeSingle();
  if (error) throw new Error(`Could not read your ad-view status: ${error.message}`);
  return data ? fromRow(data as ReceiptRow) : null;
}

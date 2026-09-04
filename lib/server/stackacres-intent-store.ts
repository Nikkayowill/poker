import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * Idempotency keys for the StackAcres action route.
 *
 * WHY THIS EXISTS, given that most of the farm is already replay-safe. Every
 * action that mutates an EXISTING unit -- collect, feed, water, clear, retire
 * -- is guarded by that unit's own `version`, and a lost race returns null and
 * pays nothing (see stackacres-store.ts's own header). That covers a
 * double-tapped harvest completely.
 *
 * The ones that CREATE something are not covered by anything, because there is
 * no row yet to guard: `stock` and `buy-stock` insert a new unit and debit for
 * it, `buy-feed` adds servings and debits, `expand-capacity` buys a slot and
 * `clear-sector` buys land, both debiting Gold. A duplicate delivery of any of
 * those is a straight double spend, and no version column can see it. `sell`
 * and `exchange` sit in between -- both are bounded (by the barn, by the daily
 * ceiling), but a duplicate still moves real produce and real Gold.
 *
 * So the key is the natural-key trick the rest of this app already leans on
 * (a `version`, a `(game, hand)` pair, a day stamp), applied to a request that
 * has no natural key of its own: the CLIENT names the intent, and the primary
 * key on (profile_id, key) is what makes naming it twice free.
 *
 * The lifecycle is claim -> run -> complete, with a release on the way out of
 * a refusal:
 *
 *   * **claim** inserts the key. Winning the insert means this request owns
 *     the intent and should run it.
 *   * **complete** stores whatever small delta the client needs to be told
 *     twice (`collected`, `exchanged`). The farm view itself is never stored:
 *     a replay is answered with a FRESH view, so a duplicate can only ever
 *     return numbers at least as current as the original did.
 *   * **release** deletes the key when the action refused, so the retry a
 *     player makes after "you cannot afford that yet" is a real attempt
 *     rather than a replay of the refusal.
 *
 * A claim that loses the insert is either a replay (the twin finished) or
 * in-flight (the twin has not). Both are answered as success, never as a
 * refusal -- the whole point is that a duplicate must not sound like a denial.
 *
 * Keys are the caller's, so they are never trusted as identity: every read and
 * write below is scoped by profile_id, and one player's key says nothing about
 * anyone else's.
 */

/** What a claim found. `fresh` is the only one that should run the action. */
export type StackAcresIntent =
  | { kind: "fresh" }
  /** The twin already finished. Its delta, to answer with a second time. */
  | { kind: "replay"; result: Record<string, unknown> | null }
  /** A twin is running right now. Nothing to add to the view yet. */
  | { kind: "in-flight" };

interface StoredIntent {
  profileId: string;
  key: string;
  action: string;
  done: boolean;
  result: Record<string, unknown> | null;
  createdAt: number;
}

declare global {
  var __riverRoomStackAcresIntents: Map<string, StoredIntent> | undefined;
}

const memoryIntents = globalThis.__riverRoomStackAcresIntents ?? new Map<string, StoredIntent>();
globalThis.__riverRoomStackAcresIntents = memoryIntents;

/** Test seam only: the memory branch is process-global. */
export function __resetStackAcresIntentsForTest(): void {
  memoryIntents.clear();
}

const memoryKey = (profileId: string, key: string): string => `${profileId}:${key}`;

/**
 * How long a key is honoured for.
 *
 * Long enough to cover the only thing that legitimately replays a key -- a
 * retry of a request whose answer never arrived -- and short enough that a key
 * cannot silently swallow a deliberate second identical action days later.
 * The client only ever reuses a key while its own attempt is unresolved, so in
 * practice this is a backstop rather than the mechanism.
 */
export const STACKACRES_INTENT_TTL_MS = 10 * 60 * 1000;

/**
 * How often a claim also clears out expired keys.
 *
 * Nothing here runs on a schedule, so the sweep rides ordinary traffic the way
 * game-store.ts's `archiveStaleGames` does -- a small bounded pass on a small
 * fraction of calls, draining across many requests rather than scanning the
 * table on each one. Purely housekeeping: an expired key is already ignored on
 * read, so a sweep that never runs costs disk, never correctness.
 */
const SWEEP_CHANCE = 0.02;
const SWEEP_LIMIT = 200;

async function sweepExpired(now: number): Promise<void> {
  const supabase = adminClient();
  const cutoff = new Date(now - STACKACRES_INTENT_TTL_MS).toISOString();
  if (!supabase) {
    for (const [id, intent] of memoryIntents) {
      if (now - intent.createdAt >= STACKACRES_INTENT_TTL_MS) memoryIntents.delete(id);
    }
    return;
  }

  const { data, error } = await supabase
    .from("homestead_action_keys")
    .select("profile_id, key")
    .lt("created_at", cutoff)
    .limit(SWEEP_LIMIT);
  if (error || !data || data.length === 0) return;
  for (const row of data as { profile_id: string; key: string }[]) {
    await supabase
      .from("homestead_action_keys")
      .delete()
      .eq("profile_id", row.profile_id)
      .eq("key", row.key);
  }
}

/**
 * Claims one intent, or reports what the twin that beat us to it is doing.
 *
 * The insert is the whole race: exactly one caller can create the row, and
 * everyone else reads what that caller left. `ON CONFLICT DO NOTHING` plus a
 * follow-up read rather than an upsert, because an upsert would overwrite a
 * finished twin's stored result with an empty one.
 */
export async function claimStackAcresIntent(
  profileId: string,
  key: string,
  action: string,
  now = Date.now(),
): Promise<StackAcresIntent> {
  if (Math.random() < SWEEP_CHANCE) {
    // Housekeeping only, and never worth failing a real request over.
    await sweepExpired(now).catch((error) =>
      console.error("stackacres.intent_sweep_failed", { error }),
    );
  }

  const supabase = adminClient();
  if (!supabase) {
    const existing = memoryIntents.get(memoryKey(profileId, key));
    if (existing && now - existing.createdAt < STACKACRES_INTENT_TTL_MS) {
      return existing.done ? { kind: "replay", result: existing.result } : { kind: "in-flight" };
    }
    memoryIntents.set(memoryKey(profileId, key), {
      profileId,
      key,
      action,
      done: false,
      result: null,
      createdAt: now,
    });
    return { kind: "fresh" };
  }

  const { data, error } = await supabase
    .from("homestead_action_keys")
    .insert({ profile_id: profileId, key, action })
    .select("key")
    .maybeSingle();
  // 23505 is the unique violation, which is not an error here -- it is the
  // answer. Anything else genuinely failed.
  if (error && error.code !== "23505") {
    throw new Error(`Could not check that request: ${error.message}`);
  }
  if (!error && data) return { kind: "fresh" };

  const { data: twin, error: readError } = await supabase
    .from("homestead_action_keys")
    .select("done, result, created_at")
    .eq("profile_id", profileId)
    .eq("key", key)
    .maybeSingle();
  if (readError) throw new Error(`Could not check that request: ${readError.message}`);
  // Gone between the failed insert and this read: a sweep, or a release from
  // a refusal that landed in the gap. Treat it as ours rather than stalling a
  // request that now has nothing to replay.
  if (!twin) return { kind: "fresh" };

  const row = twin as { done: boolean | null; result: Record<string, unknown> | null; created_at: string };
  if (Date.parse(row.created_at) + STACKACRES_INTENT_TTL_MS <= now) return { kind: "fresh" };
  return row.done === true ? { kind: "replay", result: row.result ?? null } : { kind: "in-flight" };
}

/**
 * Marks a claimed intent finished, with whatever the client has to be told a
 * second time. Best-effort on purpose: the action itself has already landed
 * durably by the time this runs, and failing to record the key must not turn a
 * finished harvest into an error. The cost of losing it is that a duplicate
 * would act twice, which is the behaviour that existed before this file.
 */
export async function completeStackAcresIntent(
  profileId: string,
  key: string,
  result: Record<string, unknown> | null,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const existing = memoryIntents.get(memoryKey(profileId, key));
    if (existing) memoryIntents.set(memoryKey(profileId, key), { ...existing, done: true, result });
    return;
  }

  const { error } = await supabase
    .from("homestead_action_keys")
    .update({ done: true, result })
    .eq("profile_id", profileId)
    .eq("key", key);
  if (error) console.error("stackacres.intent_complete_failed", { profileId, key, error });
}

/**
 * Drops a claimed intent that never happened, so the same key is free again.
 *
 * Called when the action refused (it could not afford it, the unit moved on)
 * and when it threw. Both mean nothing was applied, and a player who fixes the
 * problem and presses again must not be told their old refusal has already
 * been dealt with.
 */
export async function releaseStackAcresIntent(profileId: string, key: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryIntents.delete(memoryKey(profileId, key));
    return;
  }

  const { error } = await supabase
    .from("homestead_action_keys")
    .delete()
    .eq("profile_id", profileId)
    .eq("key", key);
  if (error) console.error("stackacres.intent_release_failed", { profileId, key, error });
}

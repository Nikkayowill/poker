import "server-only";

import { adminClient } from "./supabase-admin";

/**
 * Persistence for the farm clock's offset (lib/stackacres/clock.ts), in
 * `homestead_clock` (20260927090000_stackacres_clock.sql). No row is offset 0.
 *
 * Writes are a compare-and-set on the old offset. Sleeping only ever moves it
 * forward, so the old value works as the row's version.
 */

declare global {
  var __riverRoomStackAcresClock: Map<string, number> | undefined;
}

const memoryClock = globalThis.__riverRoomStackAcresClock ?? new Map<string, number>();
globalThis.__riverRoomStackAcresClock = memoryClock;

export function __resetStackAcresClockForTest(): void {
  memoryClock.clear();
}

/** The batch row (or a plain select) as an offset. No row is 0. */
export function stackAcresClockFromBatchRow(row: { offset_ms: number | string } | null): number {
  if (!row) return 0;
  const offset = Number(row.offset_ms);
  return Number.isFinite(offset) ? offset : 0;
}

export async function readStackAcresClockOffset(profileId: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) return memoryClock.get(profileId) ?? 0;

  const { data, error } = await supabase
    .from("homestead_clock")
    .select("offset_ms")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your clock: ${error.message}`);
  return stackAcresClockFromBatchRow(data as { offset_ms: number | string } | null);
}

/**
 * Moves the offset from `expected` to `next` if it is still `expected`.
 * Returns false when another write got there first; the caller re-reads.
 */
export async function writeStackAcresClockOffset(
  profileId: string,
  expected: number,
  next: number,
  sleptAt: Date,
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    if ((memoryClock.get(profileId) ?? 0) !== expected) return false;
    memoryClock.set(profileId, next);
    return true;
  }

  const row = { offset_ms: next, slept_at: sleptAt.toISOString(), updated_at: new Date().toISOString() };
  if (expected === 0) {
    // No row yet reads as 0, so try the insert first.
    const { data, error } = await supabase
      .from("homestead_clock")
      .upsert({ profile_id: profileId, ...row }, { onConflict: "profile_id", ignoreDuplicates: true })
      .select("offset_ms");
    if (error) throw new Error(`Could not update your clock: ${error.message}`);
    if (Array.isArray(data) && data.length > 0) return true;
    // A row was already there. It may still hold 0, so fall through to the guarded update.
  }

  const { data, error } = await supabase
    .from("homestead_clock")
    .update(row)
    .eq("profile_id", profileId)
    .eq("offset_ms", expected)
    .select("offset_ms")
    .maybeSingle();
  if (error) throw new Error(`Could not update your clock: ${error.message}`);
  return data !== null;
}

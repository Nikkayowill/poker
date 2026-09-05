import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for Chrono-DeLorean Mode's per-profile time offset. Same
 * dual-path shape as every other piece of StackAcres state in
 * ./stackacres-store.ts: a Supabase RPC when configured, an in-memory Map
 * when it is not (local dev with no Supabase env, and every vitest run).
 *
 * This file has no opinion on whether Chrono-DeLorean Mode is ENABLED --
 * that gate lives in ./chrono-delorean.ts, checked before any of these
 * functions are ever called. A build with the flag off simply never reaches
 * here, so this module carries no runtime cost of its own to strip.
 */

const memoryOffsets = new Map<string, number>();

/** Test-only: clears every in-memory offset between runs, the same
 *  `__resetStackAcresForTest`-shaped escape hatch ./stackacres-store.ts
 *  exports for the same reason -- state here would otherwise leak from one
 *  test to the next. */
export function __resetChronoDeloreanOffsetsForTest(): void {
  memoryOffsets.clear();
}

/** The stored offset for a profile, or 0 when none has ever been set. Never
 *  throws on a missing row -- "no row" and "offset zero" are the same fact,
 *  the same convention `adjustStackAcresFeed`/`adjustStackAcresCapacity`
 *  already use for a profile with no row yet. */
export async function readChronoDeloreanOffsetMs(profileId: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) return memoryOffsets.get(profileId) ?? 0;

  const { data, error } = await supabase
    .from("chrono_delorean_offsets")
    .select("offset_ms")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Chrono-DeLorean offset: ${error.message}`);
  return data ? Number(data.offset_ms) : 0;
}

/** Sets the offset to an absolute value, returning what was stored. */
export async function writeChronoDeloreanOffsetMs(
  profileId: string,
  offsetMs: number,
): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    memoryOffsets.set(profileId, offsetMs);
    return offsetMs;
  }

  const { data, error } = await supabase.rpc("set_chrono_delorean_offset", {
    p_profile_id: profileId,
    p_offset_ms: offsetMs,
  });
  if (error) throw new Error(`Could not set the Chrono-DeLorean offset: ${error.message}`);
  return Number(data);
}

/**
 * Adds a signed delta to whatever offset is already stored (0 if none) and
 * returns the new total. Routed through its own RPC in Supabase mode --
 * see advance_chrono_delorean_offset's own comment in the migration -- rather
 * than a read-then-write from here, so two concurrent advances (an
 * auto-advance loop tick racing a second open tab) cannot both read the same
 * starting value and step forward by only one delta between them. The
 * memory branch has no such race to guard (a single Node event loop, one
 * step at a time), so a plain read-then-write is exactly as safe there as
 * the RPC is in Supabase mode.
 */
export async function advanceChronoDeloreanOffsetMs(
  profileId: string,
  deltaMs: number,
): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    const next = (memoryOffsets.get(profileId) ?? 0) + deltaMs;
    memoryOffsets.set(profileId, next);
    return next;
  }

  const { data, error } = await supabase.rpc("advance_chrono_delorean_offset", {
    p_profile_id: profileId,
    p_delta_ms: deltaMs,
  });
  if (error) throw new Error(`Could not advance the Chrono-DeLorean offset: ${error.message}`);
  return Number(data);
}

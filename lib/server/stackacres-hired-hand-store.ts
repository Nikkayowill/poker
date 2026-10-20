import "server-only";

import { adminClient } from "./supabase-admin";

/**
 * The farm's hired hand (lib/stackacres/hired-hand.ts), in `homestead_hired_hand`
 * (20261002194253_stackacres_market_stock_equipment_hand.sql). One row per farm.
 * Hiring is an insert guarded by the primary key; every later write is guarded
 * by `version`, so two tabs running the chores pass at once can't both pay a
 * day or both take a pass.
 */

export interface StoredHiredHand {
  profileId: string;
  name: string;
  paidThroughDay: number;
  choresAt: string;
  version: number;
  hiredAt: string;
}

interface HiredHandDbRow {
  profile_id: string;
  name: string;
  paid_through_day: number | string;
  chores_at: string;
  version: number | string;
  hired_at: string;
}

const COLUMNS = "profile_id, name, paid_through_day, chores_at, version, hired_at";

function fromRow(row: HiredHandDbRow): StoredHiredHand {
  return {
    profileId: row.profile_id,
    name: row.name,
    paidThroughDay: Number(row.paid_through_day),
    choresAt: row.chores_at,
    version: Number(row.version),
    hiredAt: row.hired_at,
  };
}

declare global {
  var __riverRoomStackAcresHiredHand: Map<string, StoredHiredHand> | undefined;
}

const memoryHands = globalThis.__riverRoomStackAcresHiredHand ?? new Map<string, StoredHiredHand>();
globalThis.__riverRoomStackAcresHiredHand = memoryHands;

export function __resetStackAcresHiredHandForTest(): void {
  memoryHands.clear();
}

export async function readStackAcresHiredHand(profileId: string): Promise<StoredHiredHand | null> {
  const supabase = adminClient();
  if (!supabase) {
    const stored = memoryHands.get(profileId);
    return stored ? { ...stored } : null;
  }
  const { data, error } = await supabase
    .from("homestead_hired_hand")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your hired hand: ${error.message}`);
  return data ? fromRow(data as HiredHandDbRow) : null;
}

/** Hires a hand the caller has already paid for. Null when the farm already has one. */
export async function insertStackAcresHiredHand(
  profileId: string,
  name: string,
  paidThroughDay: number,
  now: Date,
): Promise<StoredHiredHand | null> {
  const supabase = adminClient();
  if (!supabase) {
    if (memoryHands.has(profileId)) return null;
    const stored: StoredHiredHand = {
      profileId,
      name,
      paidThroughDay,
      choresAt: now.toISOString(),
      version: 1,
      hiredAt: now.toISOString(),
    };
    memoryHands.set(profileId, stored);
    return { ...stored };
  }
  const { data, error } = await supabase
    .from("homestead_hired_hand")
    .upsert(
      {
        profile_id: profileId,
        name,
        paid_through_day: paidThroughDay,
        chores_at: now.toISOString(),
        hired_at: now.toISOString(),
      },
      { onConflict: "profile_id", ignoreDuplicates: true },
    )
    .select(COLUMNS);
  if (error) throw new Error(`Could not hire ${name}: ${error.message}`);
  const rows = (data ?? []) as HiredHandDbRow[];
  return rows.length > 0 ? fromRow(rows[0]) : null;
}

/** Moves the row on under its version guard. Null when another write got there first. */
export async function updateStackAcresHiredHand(
  current: StoredHiredHand,
  patch: { paidThroughDay?: number; choresAt?: Date },
): Promise<StoredHiredHand | null> {
  const version = current.version + 1;
  const supabase = adminClient();
  if (!supabase) {
    const stored = memoryHands.get(current.profileId);
    if (!stored || stored.version !== current.version) return null;
    const updated: StoredHiredHand = {
      ...stored,
      ...(patch.paidThroughDay !== undefined ? { paidThroughDay: patch.paidThroughDay } : {}),
      ...(patch.choresAt ? { choresAt: patch.choresAt.toISOString() } : {}),
      version,
    };
    memoryHands.set(current.profileId, updated);
    return { ...updated };
  }
  const { data, error } = await supabase
    .from("homestead_hired_hand")
    .update({
      ...(patch.paidThroughDay !== undefined ? { paid_through_day: patch.paidThroughDay } : {}),
      ...(patch.choresAt ? { chores_at: patch.choresAt.toISOString() } : {}),
      version,
    })
    .eq("profile_id", current.profileId)
    .eq("version", current.version)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not update your hired hand: ${error.message}`);
  return data ? fromRow(data as HiredHandDbRow) : null;
}

/** Lets the hand go. With a version, only if nothing else wrote the row since it was read. */
export async function deleteStackAcresHiredHand(profileId: string, version?: number): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const stored = memoryHands.get(profileId);
    if (!stored || (version !== undefined && stored.version !== version)) return false;
    memoryHands.delete(profileId);
    return true;
  }
  let query = supabase.from("homestead_hired_hand").delete().eq("profile_id", profileId);
  if (version !== undefined) query = query.eq("version", version);
  const { data, error } = await query.select("profile_id");
  if (error) throw new Error(`Could not let your hired hand go: ${error.message}`);
  return (data ?? []).length > 0;
}

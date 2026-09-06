import "server-only";
import {
  FENCE_TIERS,
  FENCE_TIER_MAX_DURABILITY,
  LIVESTOCK_MAX_HEALTH,
  isFenceTier,
  isPredatorKind,
  type FenceTier,
  type PredatorEntity,
  type PredatorState,
} from "@/lib/stackacres/wildlife";
import type { ZoneId } from "@/lib/stackacres/zones";
import { ZONE_IDS } from "@/lib/stackacres/zones";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for Wildlife Ecosystem & Nighttime Predator Defense: fence
 * tier/durability per segment, one Predator Wave per player, and one
 * livestock-health value per district.
 *
 * A DELIBERATELY NEW STORE, matching lib/server/stackacres-crossbreeding-store.ts's
 * own shape exactly (twin memory/Supabase branch, version-guarded writes,
 * a lost race returns null and null is never treated as success) rather
 * than folding into stackacres-store.ts's own 2,000+-line file, which owns
 * an unrelated set of ledgers (units, capacity, harvests, upkeep...) that
 * this feature has no reason to share a table with. Nothing here moves
 * Gold; the version-guard discipline is mirrored anyway because a lost
 * race silently double-crediting damage or silently reviving a fence a
 * predator just broke is the exact same class of bug a lost race in a
 * money path is, just against game state instead of a balance.
 *
 * LIVESTOCK HEALTH IS PER DISTRICT, NOT PER UNIT. StackAcres deliberately
 * has no per-unit position (see world.ts's own header: "a unit you own has
 * no position of its own to look up" -- units.ts's `StackAcresUnitRow`
 * carries no coordinate). A predator's real target, and the thing
 * `defenseTargetRects` in lib/stackacres/wildlife.ts hands it, is a
 * district's `growAreaBounds` rect, not any one animal -- so "this
 * district's livestock took damage" is the health this store can
 * meaningfully track without inventing per-unit positions this feature has
 * no other reason to add.
 */

export interface StoredFenceSegment {
  profileId: string;
  zone: ZoneId;
  segmentIndex: number;
  tier: FenceTier;
  durability: number;
  version: number;
  updatedAt: string;
}

/** A segment nobody has ever upgraded or damaged: Basic Wood, full
 *  durability, version 0. `version: 0` is the store's own "no row exists
 *  yet" signal -- the same role a missing Map entry plays, restated as a
 *  real value so a caller can pass it straight back as `expectedVersion`
 *  on a first write without a special-cased "insert" branch of its own. */
function defaultFenceSegment(profileId: string, zone: ZoneId, segmentIndex: number): StoredFenceSegment {
  return {
    profileId,
    zone,
    segmentIndex,
    tier: "wood",
    durability: FENCE_TIER_MAX_DURABILITY.wood,
    version: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

export interface StoredPredatorWave {
  profileId: string;
  active: boolean;
  predators: PredatorEntity[];
  version: number;
  updatedAt: string;
}

function defaultPredatorWave(profileId: string): StoredPredatorWave {
  return { profileId, active: false, predators: [], version: 0, updatedAt: new Date(0).toISOString() };
}

export interface StoredLivestockHealth {
  profileId: string;
  zone: ZoneId;
  health: number;
  version: number;
  updatedAt: string;
}

function defaultLivestockHealth(profileId: string, zone: ZoneId): StoredLivestockHealth {
  return { profileId, zone, health: LIVESTOCK_MAX_HEALTH, version: 0, updatedAt: new Date(0).toISOString() };
}

declare global {
  var __riverRoomStackAcresFenceSegments: Map<string, StoredFenceSegment> | undefined;
  var __riverRoomStackAcresPredatorWaves: Map<string, StoredPredatorWave> | undefined;
  var __riverRoomStackAcresLivestockHealth: Map<string, StoredLivestockHealth> | undefined;
}

const memoryFences: Map<string, StoredFenceSegment> = (globalThis.__riverRoomStackAcresFenceSegments ??= new Map());
const memoryWaves: Map<string, StoredPredatorWave> = (globalThis.__riverRoomStackAcresPredatorWaves ??= new Map());
const memoryHealth: Map<string, StoredLivestockHealth> = (globalThis.__riverRoomStackAcresLivestockHealth ??=
  new Map());

function fenceKey(profileId: string, zone: ZoneId, segmentIndex: number): string {
  return `${profileId}:${zone}:${segmentIndex}`;
}
function healthKey(profileId: string, zone: ZoneId): string {
  return `${profileId}:${zone}`;
}

/* ------------------------------------------------------------------ */
/* Fence segments                                                       */
/* ------------------------------------------------------------------ */

interface FenceSegmentDbRow {
  profile_id: string;
  zone: string;
  segment_index: number;
  tier: string;
  durability: number | string;
  version: number | string;
  updated_at: string;
}

function fenceFromRow(row: FenceSegmentDbRow): StoredFenceSegment {
  const zone = ZONE_IDS.includes(row.zone as ZoneId) ? (row.zone as ZoneId) : "farmstead";
  const tier = isFenceTier(row.tier) ? row.tier : "wood";
  return {
    profileId: String(row.profile_id),
    zone,
    segmentIndex: Number(row.segment_index),
    tier,
    durability: Number(row.durability),
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

export async function getFenceSegment(profileId: string, zone: ZoneId, segmentIndex: number): Promise<StoredFenceSegment> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryFences.get(fenceKey(profileId, zone, segmentIndex));
    return found ? { ...found } : defaultFenceSegment(profileId, zone, segmentIndex);
  }

  const { data, error } = await supabase
    .from("stackacres_fence_segments")
    .select("profile_id, zone, segment_index, tier, durability, version, updated_at")
    .eq("profile_id", profileId)
    .eq("zone", zone)
    .eq("segment_index", segmentIndex)
    .maybeSingle();
  if (error) throw new Error(`Could not read that fence segment: ${error.message}`);
  return data ? fenceFromRow(data as FenceSegmentDbRow) : defaultFenceSegment(profileId, zone, segmentIndex);
}

export async function listFenceSegments(profileId: string, zone: ZoneId): Promise<StoredFenceSegment[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryFences.values()]
      .filter((segment) => segment.profileId === profileId && segment.zone === zone)
      .map((segment) => ({ ...segment }));
  }

  const { data, error } = await supabase
    .from("stackacres_fence_segments")
    .select("profile_id, zone, segment_index, tier, durability, version, updated_at")
    .eq("profile_id", profileId)
    .eq("zone", zone);
  if (error) throw new Error(`Could not read that district's fence line: ${error.message}`);
  return (data as FenceSegmentDbRow[]).map(fenceFromRow);
}

/**
 * Writes one fence segment's tier/durability, guarded on the version it
 * was last read at (0 meaning "no row exists yet"). Used for BOTH an
 * upgrade (a new tier, full durability) and battle damage (same tier,
 * reduced durability) -- both are "this segment's stored state changes,
 * guarded on the version I last saw", the same shape either way. Returns
 * null on a lost race (concurrent write already moved the version, or
 * already exists when `expectedVersion` was 0): the caller must never
 * treat that as a successful write.
 */
export async function writeFenceSegment(
  profileId: string,
  zone: ZoneId,
  segmentIndex: number,
  expectedVersion: number,
  tier: FenceTier,
  durability: number,
): Promise<StoredFenceSegment | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();
  const clampedDurability = Math.max(0, Math.min(FENCE_TIER_MAX_DURABILITY[tier], durability));

  if (!supabase) {
    const key = fenceKey(profileId, zone, segmentIndex);
    const existing = memoryFences.get(key);
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== expectedVersion) return null;
    const next: StoredFenceSegment = {
      profileId,
      zone,
      segmentIndex,
      tier,
      durability: clampedDurability,
      version: currentVersion + 1,
      updatedAt: now,
    };
    memoryFences.set(key, { ...next });
    return { ...next };
  }

  const { data, error } = await supabase
    .rpc("upsert_stackacres_fence_segment", {
      p_profile_id: profileId,
      p_zone: zone,
      p_segment_index: segmentIndex,
      p_expected_version: expectedVersion,
      p_tier: tier,
      p_durability: clampedDurability,
    })
    .maybeSingle();
  if (error) throw new Error(`Could not save that fence segment: ${error.message}`);
  if (!data) return null;
  return fenceFromRow(data as FenceSegmentDbRow);
}

/* ------------------------------------------------------------------ */
/* Predator wave                                                        */
/* ------------------------------------------------------------------ */

interface PredatorWaveDbRow {
  profile_id: string;
  active: boolean;
  predators: unknown;
  version: number | string;
  updated_at: string;
}

function isPredatorState(value: unknown): value is PredatorState {
  return value === "seeking" || value === "attacking" || value === "fleeing";
}

function parsePredators(raw: unknown): PredatorEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: PredatorEntity[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      isPredatorKind((entry as Record<string, unknown>).kind as string) &&
      typeof (entry as Record<string, unknown>).x === "number" &&
      typeof (entry as Record<string, unknown>).y === "number" &&
      isPredatorState((entry as Record<string, unknown>).state) &&
      typeof (entry as Record<string, unknown>).health === "number" &&
      typeof (entry as Record<string, unknown>).attackCooldownMs === "number"
    ) {
      const e = entry as unknown as PredatorEntity;
      out.push({ id: e.id, kind: e.kind, x: e.x, y: e.y, state: e.state, health: e.health, attackCooldownMs: e.attackCooldownMs });
    }
  }
  return out;
}

function waveFromRow(row: PredatorWaveDbRow): StoredPredatorWave {
  return {
    profileId: String(row.profile_id),
    active: Boolean(row.active),
    predators: parsePredators(row.predators),
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

export async function getPredatorWave(profileId: string): Promise<StoredPredatorWave> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryWaves.get(profileId);
    return found ? { ...found, predators: found.predators.map((p) => ({ ...p })) } : defaultPredatorWave(profileId);
  }

  const { data, error } = await supabase
    .from("stackacres_predator_waves")
    .select("profile_id, active, predators, version, updated_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read tonight's predator wave: ${error.message}`);
  return data ? waveFromRow(data as PredatorWaveDbRow) : defaultPredatorWave(profileId);
}

/** Saves the whole wave snapshot (active flag + every live predator),
 *  guarded on the version last read. This is a coarse write -- one row per
 *  player, replaced wholesale each tick the manager persists to -- rather
 *  than a row per predator, since a wave is small (at most a handful of
 *  predators) and read/written as one unit by the manager that owns it. */
export async function savePredatorWave(
  profileId: string,
  expectedVersion: number,
  active: boolean,
  predators: PredatorEntity[],
): Promise<StoredPredatorWave | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const existing = memoryWaves.get(profileId);
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== expectedVersion) return null;
    const next: StoredPredatorWave = {
      profileId,
      active,
      predators: predators.map((p) => ({ ...p })),
      version: currentVersion + 1,
      updatedAt: now,
    };
    memoryWaves.set(profileId, { ...next, predators: next.predators.map((p) => ({ ...p })) });
    return { ...next };
  }

  const { data, error } = await supabase
    .rpc("save_stackacres_predator_wave", {
      p_profile_id: profileId,
      p_expected_version: expectedVersion,
      p_active: active,
      p_predators: predators,
    })
    .maybeSingle();
  if (error) throw new Error(`Could not save tonight's predator wave: ${error.message}`);
  if (!data) return null;
  return waveFromRow(data as PredatorWaveDbRow);
}

/* ------------------------------------------------------------------ */
/* Livestock health                                                     */
/* ------------------------------------------------------------------ */

interface LivestockHealthDbRow {
  profile_id: string;
  zone: string;
  health: number | string;
  version: number | string;
  updated_at: string;
}

function healthFromRow(row: LivestockHealthDbRow): StoredLivestockHealth {
  const zone = ZONE_IDS.includes(row.zone as ZoneId) ? (row.zone as ZoneId) : "farmstead";
  return {
    profileId: String(row.profile_id),
    zone,
    health: Number(row.health),
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

export async function getLivestockHealth(profileId: string, zone: ZoneId): Promise<StoredLivestockHealth> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryHealth.get(healthKey(profileId, zone));
    return found ? { ...found } : defaultLivestockHealth(profileId, zone);
  }

  const { data, error } = await supabase
    .from("stackacres_livestock_health")
    .select("profile_id, zone, health, version, updated_at")
    .eq("profile_id", profileId)
    .eq("zone", zone)
    .maybeSingle();
  if (error) throw new Error(`Could not read that district's livestock health: ${error.message}`);
  return data ? healthFromRow(data as LivestockHealthDbRow) : defaultLivestockHealth(profileId, zone);
}

export async function writeLivestockHealth(
  profileId: string,
  zone: ZoneId,
  expectedVersion: number,
  health: number,
): Promise<StoredLivestockHealth | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();
  const clamped = Math.max(0, Math.min(LIVESTOCK_MAX_HEALTH, health));

  if (!supabase) {
    const key = healthKey(profileId, zone);
    const existing = memoryHealth.get(key);
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== expectedVersion) return null;
    const next: StoredLivestockHealth = { profileId, zone, health: clamped, version: currentVersion + 1, updatedAt: now };
    memoryHealth.set(key, { ...next });
    return { ...next };
  }

  const { data, error } = await supabase
    .rpc("apply_stackacres_livestock_damage", {
      p_profile_id: profileId,
      p_zone: zone,
      p_expected_version: expectedVersion,
      p_health: clamped,
    })
    .maybeSingle();
  if (error) throw new Error(`Could not update that district's livestock health: ${error.message}`);
  if (!data) return null;
  return healthFromRow(data as LivestockHealthDbRow);
}

/** Every fence tier this store knows about -- re-exported so a caller that
 *  only imports the store (not lib/stackacres/wildlife.ts directly) can
 *  still validate a requested tier without a second import. */
export { FENCE_TIERS };

export function __resetStackAcresDefenseForTest(): void {
  memoryFences.clear();
  memoryWaves.clear();
  memoryHealth.clear();
}

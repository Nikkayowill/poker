import "server-only";
import { randomUUID } from "node:crypto";
import { adminClient } from "./supabase-admin";
import { creditGoldByProfile, spendGoldByProfile } from "./profile-store";

/**
 * The durable half of the Mechanical Forage Drone: which drones a profile
 * has paid to deploy, and when each one last paid out a forage claim. A
 * drone's live tile/patrol/charge is never stored -- see
 * lib/stackacres/drone.ts's own module doc for why that split is
 * deliberate.
 *
 * Same two-branch shape as every other StackAcres store: a real Supabase
 * project reaches the row-locking RPCs from the `stackacres_forage_drone`
 * migration, which are the actual money-moving path; an absent one (local
 * dev with no Supabase env, or a test) falls back to memory. UNLIKE
 * `unlockStackAcresPerk` in ./stackacres-synergy-store.ts, the memory branch
 * here still spends and credits real Gold through
 * `spendGoldByProfile`/`creditGoldByProfile` (lib/server/profile-store.ts,
 * imported directly with no cycle -- several sibling `*-store.ts` files
 * already do the same): a drone moves several thousand Gold per deploy, not
 * a one-time perk unlock, and money-ordering rule 1 ("debit before the
 * thing it pays for exists") is exactly the property this feature's own
 * tests need memory-mode to actually enforce.
 */

declare global {
  var __riverRoomStackAcresDrones: Map<string, StoredDrone> | undefined;
}

export interface StoredDrone {
  droneId: string;
  profileId: string;
  deployedAt: string;
  lastForageAt: string | null;
}

const memoryDrones = globalThis.__riverRoomStackAcresDrones ?? new Map<string, StoredDrone>();
globalThis.__riverRoomStackAcresDrones = memoryDrones;

/** Test-only reset. */
export function resetStackAcresDroneStoreForTests(): void {
  memoryDrones.clear();
}

export interface DeployDroneOutcome {
  success: boolean;
  reason: "deployed" | "insufficient_gold";
  droneId: string | null;
  goldBalance: number;
}

/**
 * Deploys one drone: debits `cost` Gold and creates the ownership row,
 * atomically. See `deploy_stackacres_drone` in the migration for the real
 * transaction -- the only path that actually moves Gold.
 */
export async function deployStackAcresDrone(
  profileId: string,
  cost: number,
  now: Date,
): Promise<DeployDroneOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const spent = await spendGoldByProfile(profileId, cost);
    if (!spent) return { success: false, reason: "insufficient_gold", droneId: null, goldBalance: 0 };
    const droneId = randomUUID();
    memoryDrones.set(droneId, {
      droneId,
      profileId,
      deployedAt: now.toISOString(),
      lastForageAt: null,
    });
    return { success: true, reason: "deployed", droneId, goldBalance: spent.goldBalance };
  }

  const { data, error } = await supabase
    .rpc("deploy_stackacres_drone", { p_profile_id: profileId, p_cost: cost })
    .single();
  if (error) throw new Error(`Could not deploy the drone: ${error.message}`);
  const result = data as { success: boolean; reason: string; drone_id: string | null; gold_balance: number };
  return {
    success: result.success,
    reason: result.reason as DeployDroneOutcome["reason"],
    droneId: result.drone_id,
    goldBalance: result.gold_balance,
  };
}

/** Every drone a profile currently owns. Ownership is permanent (no
 *  retiring a drone yet), so this is the whole fleet. */
export async function listStackAcresDrones(profileId: string): Promise<StoredDrone[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryDrones.values()].filter((drone) => drone.profileId === profileId);
  }

  const { data, error } = await supabase
    .from("stackacres_drones")
    .select("drone_id, profile_id, deployed_at, last_forage_at")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read the drone hangar: ${error.message}`);
  return (data as { drone_id: string; profile_id: string; deployed_at: string; last_forage_at: string | null }[]).map(
    (row) => ({
      droneId: row.drone_id,
      profileId: row.profile_id,
      deployedAt: row.deployed_at,
      lastForageAt: row.last_forage_at,
    }),
  );
}

export interface CollectForageOutcome {
  success: boolean;
  reason: "collected" | "cooling_down" | "no_such_drone" | "no_such_profile";
  reward: number;
  goldBalance: number | null;
}

/**
 * Claims one forage pickup for a drone the caller owns, gated by
 * `cooldownSeconds` since that drone's last successful claim. Server-rolled
 * reward in `[min, max]`, inclusive -- see `collect_stackacres_drone_forage`
 * in the migration for why the roll happens inside the guarded transaction
 * rather than in application code.
 */
export async function collectStackAcresDroneForage(
  profileId: string,
  droneId: string,
  cooldownSeconds: number,
  min: number,
  max: number,
  now: Date,
): Promise<CollectForageOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const drone = memoryDrones.get(droneId);
    if (!drone || drone.profileId !== profileId) {
      return { success: false, reason: "no_such_drone", reward: 0, goldBalance: null };
    }
    const cooldownFloor = now.getTime() - cooldownSeconds * 1000;
    if (drone.lastForageAt && new Date(drone.lastForageAt).getTime() > cooldownFloor) {
      return { success: false, reason: "cooling_down", reward: 0, goldBalance: null };
    }
    const reward = min + Math.floor(Math.random() * (max - min + 1));
    memoryDrones.set(droneId, { ...drone, lastForageAt: now.toISOString() });
    if (reward <= 0) return { success: true, reason: "collected", reward: 0, goldBalance: null };
    const credited = await creditGoldByProfile(profileId, reward);
    if (!credited) return { success: false, reason: "no_such_profile", reward: 0, goldBalance: null };
    return { success: true, reason: "collected", reward, goldBalance: credited.goldBalance };
  }

  const { data, error } = await supabase
    .rpc("collect_stackacres_drone_forage", {
      p_profile_id: profileId,
      p_drone_id: droneId,
      p_cooldown_seconds: cooldownSeconds,
      p_min: min,
      p_max: max,
    })
    .single();
  if (error) throw new Error(`Could not collect the drone's forage: ${error.message}`);
  const result = data as { success: boolean; reason: string; reward: number; gold_balance: number | null };
  return {
    success: result.success,
    reason: result.reason as CollectForageOutcome["reason"],
    reward: result.reward,
    goldBalance: result.gold_balance,
  };
}

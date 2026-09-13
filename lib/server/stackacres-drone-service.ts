import "server-only";
import { stackacresMilestone, STACKACRES_MAX_MILESTONE, type StackAcresShopProgress } from "@/lib/stackacres/shop-locks";
import { DRONE_DEPLOY_COST_GOLD, DRONE_FORAGE_COOLDOWN_SECONDS } from "@/lib/stackacres/drone";
import {
  collectStackAcresDroneForage,
  deployStackAcresDrone,
  listStackAcresDrones,
  type CollectForageOutcome,
  type DeployDroneOutcome,
  type StoredDrone,
} from "./stackacres-drone-store";

/**
 * MONEY-ORDERING: this file moves Gold exactly twice -- deploying a drone
 * (a debit) and collecting its forage (a credit) -- and both are delegated
 * whole to a single row-locking RPC (`deploy_stackacres_drone` /
 * `collect_stackacres_drone_forage`), the same "one atomic call, no
 * separate refund path" shape `unlockSynergyPerk` documents in
 * ./stackacres-synergy-service.ts. Nothing here is a second way to move
 * Gold.
 *
 * GATED UNLOCK STATE: `isDroneHangarUnlocked` is DERIVED, never stored --
 * same rule lib/stackacres/shop-locks.ts's own header states and for the
 * same reason: every one of the farm's milestone flags is a permanent fact
 * that only ever grows, so this needs no migration and can never regress a
 * farm that has already earned it. The hangar unlocks once a profile has
 * earned every flag on the ladder (`stackacresMilestone(progress) >=
 * STACKACRES_MAX_MILESTONE`) -- the same difficulty the old museum-donation
 * gate this replaced asked for, in the farm's own permanent-quest currency
 * instead of a donation registry.
 *
 * NO INVENTORY MIRROR: the first drone migration also wrote each Gold
 * movement into the dead `homestead_inventory` table as a write-only
 * record. Its `quantity >= 0` check rejected the second deploy's negative
 * delta and rolled the whole purchase back, so
 * `20260908120000_stackacres_drone_drop_inventory_mirror.sql` removed both
 * writes. Nothing ever read them. If a drone ever needs durable state
 * beyond ownership, add a column to `stackacres_drones`.
 */

/** Whether this profile has unlocked the drone hangar: every one of the
 *  farm's permanent quest flags earned (lib/stackacres/shop-locks.ts). Pure
 *  and synchronous -- the caller reads whatever progress struct it already
 *  has (or a fresh one) rather than this function reaching for its own
 *  store read, the same "narrow, no Gold opinion" posture `readShopProgress`
 *  itself takes. Checked before either Gold movement below -- never trusted
 *  from the client, the same posture `requireUnlockedShopEntry` takes for
 *  every one of Ray's shop locks. */
export function isDroneHangarUnlocked(progress: StackAcresShopProgress): boolean {
  return stackacresMilestone(progress) >= STACKACRES_MAX_MILESTONE;
}

export type DeployDroneResult =
  | { success: true; droneId: string; goldBalance: number }
  | { success: false; reason: "hangar_locked" | "insufficient_gold" };

/**
 * Deploys one new drone for `profileId`, at the flat `DRONE_DEPLOY_COST_GOLD`
 * fee. Requirement 1's server half: the hangar gate is checked BEFORE
 * `deployStackAcresDrone` ever reaches the Gold-moving RPC, so a hand-rolled
 * request from a farm that has not earned every milestone can never spend
 * Gold it should not have been offered the chance to.
 */
export async function deployDrone(
  profileId: string,
  now: Date,
  progress: StackAcresShopProgress,
): Promise<DeployDroneResult> {
  if (!isDroneHangarUnlocked(progress)) {
    return { success: false, reason: "hangar_locked" };
  }

  const outcome: DeployDroneOutcome = await deployStackAcresDrone(profileId, DRONE_DEPLOY_COST_GOLD, now);
  if (!outcome.success || !outcome.droneId) {
    return { success: false, reason: "insufficient_gold" };
  }
  return { success: true, droneId: outcome.droneId, goldBalance: outcome.goldBalance };
}

/** Every drone this profile owns. */
export async function listDrones(profileId: string): Promise<StoredDrone[]> {
  return listStackAcresDrones(profileId);
}

/** Minimum forage reward, inclusive. Small next to `DRONE_DEPLOY_COST_GOLD`
 *  on purpose -- a drone earns back its own fee over many sweeps across a
 *  full patrol lifetime, it does not pay for itself in one lucky pickup. */
export const DRONE_FORAGE_MIN_GOLD = 15;
export const DRONE_FORAGE_MAX_GOLD = 60;

/** Re-exported from lib/stackacres/drone.ts, where it sits beside the rest
 *  of the flight tuning: the scene has to hold a drone's next drop for the
 *  same span this refuses a claim inside, or every drop it flies to is a
 *  refusal waiting to happen. This file stays the authority -- the check
 *  below runs in a locked transaction; the client copy only decides when to
 *  bother asking. */
export { DRONE_FORAGE_COOLDOWN_SECONDS };

export type CollectDroneForageResult =
  | { success: true; reward: number; goldBalance: number | null }
  | { success: false; reason: "cooling_down" | "no_such_drone" };

/**
 * Claims one forage pickup for `droneId`. Local-optimistic on the client
 * (the vacuum animation plays the instant the drone's simulated position
 * overlaps a simulated collectible -- see `stepDrone`'s `arrivedAtCollectible`
 * flag), authoritative here: the drone must actually belong to `profileId`
 * and be outside its own cooldown, both re-checked against the database
 * inside one locked transaction, so a doubled optimistic call can only ever
 * pay out once.
 *
 * NO DAILY CAP (2026-09-12, Kayo's call): StackAcres dropped its flat daily
 * Gold ceiling entirely, and a fielded drone earns like everything else now
 * -- uncapped, bounded only by `DRONE_FORAGE_COOLDOWN_SECONDS` per drone.
 * The guard against an idle fleet printing Gold moved to the front door
 * instead: `DRONE_DEPLOY_COST_GOLD` (lib/stackacres/drone.ts) is priced high
 * enough that fielding more drones costs real Gold, rather than a ceiling on
 * what a fielded fleet can bring back.
 */
export async function collectDroneForage(
  profileId: string,
  droneId: string,
  now: Date,
): Promise<CollectDroneForageResult> {
  const outcome: CollectForageOutcome = await collectStackAcresDroneForage(
    profileId,
    droneId,
    DRONE_FORAGE_COOLDOWN_SECONDS,
    DRONE_FORAGE_MIN_GOLD,
    DRONE_FORAGE_MAX_GOLD,
    now,
  );

  if (!outcome.success) {
    return {
      success: false,
      reason: outcome.reason === "cooling_down" ? "cooling_down" : "no_such_drone",
    };
  }

  return { success: true, reward: outcome.reward, goldBalance: outcome.goldBalance };
}

import "server-only";
import { MUSEUM_EXHIBITS, MUSEUM_EXHIBIT_CATALOGUE } from "@/lib/stackacres/museum";
import { DRONE_DEPLOY_COST_GOLD } from "@/lib/stackacres/drone";
import { STACKACRES_GOLD_CEILING, stackacresExchangeDay } from "@/lib/stackacres/exchange";
import { readStackAcresMuseum, releaseStackAcresExchange, reserveStackAcresExchange } from "./stackacres-store";
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
 * same reason: a permanent fact (museum donations only ever grow) needs no
 * migration and can never regress a farm that has already earned it. "Ray's
 * Museum" here means literally that table: a hangar unlocks once a profile
 * has donated at least one item to every exhibit in
 * `MUSEUM_EXHIBIT_CATALOGUE`.
 *
 * NO INVENTORY MIRROR: the first drone migration also wrote each Gold
 * movement into the dead `homestead_inventory` table as a write-only
 * record. Its `quantity >= 0` check rejected the second deploy's negative
 * delta and rolled the whole purchase back, so
 * `20260908120000_stackacres_drone_drop_inventory_mirror.sql` removed both
 * writes. Nothing ever read them. If a drone ever needs durable state
 * beyond ownership, add a column to `stackacres_drones`.
 */

/** Whether this profile has unlocked the drone hangar: at least one
 *  donation on record for every exhibit in Ray's Museum. Checked here, on
 *  the server, before either Gold movement below -- never trusted from the
 *  client, the same posture `requireUnlockedShopEntry` takes for every one
 *  of Ray's shop locks. */
export async function isDroneHangarUnlocked(profileId: string): Promise<boolean> {
  const donated = new Set(await readStackAcresMuseum(profileId));
  return MUSEUM_EXHIBITS.every((exhibitId) =>
    MUSEUM_EXHIBIT_CATALOGUE[exhibitId].items.some((item) => donated.has(item)),
  );
}

export type DeployDroneResult =
  | { success: true; droneId: string; goldBalance: number }
  | { success: false; reason: "hangar_locked" | "insufficient_gold" };

/**
 * Deploys one new drone for `profileId`, at the flat `DRONE_DEPLOY_COST_GOLD`
 * fee. Requirement 1's server half: the hangar gate is checked BEFORE
 * `deployStackAcresDrone` ever reaches the Gold-moving RPC, so a hand-rolled
 * request from a farm that has never completed the museum can never spend
 * Gold it should not have been offered the chance to.
 */
export async function deployDrone(profileId: string, now: Date): Promise<DeployDroneResult> {
  if (!(await isDroneHangarUnlocked(profileId))) {
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

/** How long a single drone must wait between paid forage claims. Matches
 *  roughly one lap of a district-sized perimeter at `DRONE_SPEED`, so the
 *  cooldown is not the thing throttling a well-piloted patrol -- the ring's
 *  own geometry already is. */
export const DRONE_FORAGE_COOLDOWN_SECONDS = 20;

export type CollectDroneForageResult =
  | { success: true; reward: number; goldBalance: number | null }
  | { success: false; reason: "cooling_down" | "no_such_drone" | "day-capped" };

/**
 * Claims one forage pickup for `droneId`. Local-optimistic on the client
 * (the vacuum animation plays the instant the drone's simulated position
 * overlaps a simulated collectible -- see `stepDrone`'s `arrivedAtCollectible`
 * flag), authoritative here: the drone must actually belong to `profileId`
 * and be outside its own cooldown, both re-checked against the database
 * inside one locked transaction, so a doubled optimistic call can only ever
 * pay out once.
 *
 * ALSO RESERVES AGAINST `STACKACRES_GOLD_CEILING`, the same flat daily cap
 * every other StackAcres payout answers to (harvest, Town Contracts). A
 * drone left patrolling all day is otherwise exactly the shape of faucet
 * that turned Ante Up into a money printer (see CLAUDE.md) -- no per-claim
 * amount is large, but nothing upstream bounds how many claims a day can
 * bring in. The exact reward is only known once the RPC rolls it (inside
 * its own locked transaction), so this reserves the worst case
 * (`DRONE_FORAGE_MAX_GOLD`) BEFORE the RPC runs -- refusing before any state
 * changes, same ordering `harvestStackAcres` uses -- and hands back the
 * unused difference afterward via `releaseStackAcresExchange`, the same
 * shape a harvest sweep does when a race settles fewer units than it
 * reserved for.
 */
export async function collectDroneForage(
  profileId: string,
  droneId: string,
  now: Date,
): Promise<CollectDroneForageResult> {
  const day = stackacresExchangeDay(now);
  const reserved = await reserveStackAcresExchange(profileId, day, DRONE_FORAGE_MAX_GOLD, STACKACRES_GOLD_CEILING);
  if (reserved === null) {
    return { success: false, reason: "day-capped" };
  }

  const outcome: CollectForageOutcome = await collectStackAcresDroneForage(
    profileId,
    droneId,
    DRONE_FORAGE_COOLDOWN_SECONDS,
    DRONE_FORAGE_MIN_GOLD,
    DRONE_FORAGE_MAX_GOLD,
    now,
  );

  if (!outcome.success) {
    // Nothing was paid -- hand the whole worst-case reservation back.
    await releaseStackAcresExchange(profileId, day, DRONE_FORAGE_MAX_GOLD);
    return {
      success: false,
      reason: outcome.reason === "cooling_down" ? "cooling_down" : "no_such_drone",
    };
  }

  const unused = DRONE_FORAGE_MAX_GOLD - outcome.reward;
  if (unused > 0) await releaseStackAcresExchange(profileId, day, unused);
  return { success: true, reward: outcome.reward, goldBalance: outcome.goldBalance };
}

import "server-only";
import { randomUUID } from "crypto";
import type { StackAcresUnitRow } from "@/lib/stackacres/units";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import { BUSHELS } from "@/lib/stackacres/items";
import type { SectorId } from "@/lib/stackacres/sectors";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for StackAcres: one row per owned unit (an animal or a crop,
 * no plot underneath it), plus the player's feed balance, purchased capacity
 * and Bushels.
 *
 * Same twin-branch shape as ante-up-store.ts (Supabase when configured, an
 * in-process Map otherwise), and the same core invariant: a version that only
 * ever advances from the value the caller last saw.
 *
 * The write that matters is collectStackAcresUnit: a single guarded write
 * from working to its next state (removed, mucked, or restarted) that also
 * re-checks readiness against the database's own view of `ready_at`. It
 * returns null on a lost race, a stale version, or an early tap, and null
 * must never pay -- that guard is the settlement idempotency key that makes
 * a double-tapped unit credit once.
 *
 * That same write is where the muck roll is applied. The roll happens in the
 * service and is passed in, so the decision is made once per settlement
 * rather than once per read: derived on read it would land differently every
 * refetch and let a player reroll it by pulling to refresh.
 *
 * Successor to the plot-grid version of this file. A unit has no position, so
 * there is no `StackAcresPlotExists`/`createStackAcresPlot`-then-
 * `stockStackAcresPlot` two-step any more -- a unit is born already working,
 * one INSERT. `homestead_plots` itself is untouched and unread from here on;
 * see the migration that added `homestead_units` for its one-time backfill.
 */

export interface StoredStackAcresUnit extends StackAcresUnitRow {
  profileId: string;
  createdAt: string;
}

declare global {
  var __riverRoomStackAcresUnits: Map<string, StoredStackAcresUnit> | undefined;
  var __riverRoomStackAcresCapacity: Map<string, number> | undefined;
  var __riverRoomStackAcresFeed: Map<string, number> | undefined;
  var __riverRoomStackAcresInventory: Map<string, StackAcresInventory> | undefined;
  var __riverRoomStackAcresExchanges: Map<string, number> | undefined;
  var __riverRoomStackAcresHarvests: StackAcresHarvestEntry[] | undefined;
  var __riverRoomStackAcresSectors: Map<string, string> | undefined;
  var __riverRoomStackAcresUpkeep: Map<string, number> | undefined;
}

const memoryUnits = globalThis.__riverRoomStackAcresUnits ?? new Map<string, StoredStackAcresUnit>();
globalThis.__riverRoomStackAcresUnits = memoryUnits;

/** Purchased capacity slots, keyed `${profileId}:${stock}`. */
const memoryCapacity = globalThis.__riverRoomStackAcresCapacity ?? new Map<string, number>();
globalThis.__riverRoomStackAcresCapacity = memoryCapacity;

const memoryFeed = globalThis.__riverRoomStackAcresFeed ?? new Map<string, number>();
globalThis.__riverRoomStackAcresFeed = memoryFeed;

const memoryInventory =
  globalThis.__riverRoomStackAcresInventory ?? new Map<string, StackAcresInventory>();
globalThis.__riverRoomStackAcresInventory = memoryInventory;

/** Gold taken out of the farm, keyed `${profileId}:${YYYY-MM-DD}`. */
const memoryExchanges = globalThis.__riverRoomStackAcresExchanges ?? new Map<string, number>();
globalThis.__riverRoomStackAcresExchanges = memoryExchanges;

const memoryHarvests = globalThis.__riverRoomStackAcresHarvests ?? [];
globalThis.__riverRoomStackAcresHarvests = memoryHarvests;

/** Land cleared, keyed `${profileId}:${sector}` and holding the ISO moment it
 *  was cleared. A missing key is land still under growth. */
const memorySectors = globalThis.__riverRoomStackAcresSectors ?? new Map<string, string>();
globalThis.__riverRoomStackAcresSectors = memorySectors;

/** Bushels paid TOWARD land maintenance so far today, keyed
 *  `${profileId}:${YYYY-MM-DD}`. A running total rather than a one-shot flag,
 *  because the day's bill can rise under a player who buys more room at noon
 *  -- see `raiseStackAcresUpkeep`. */
const memoryUpkeep = globalThis.__riverRoomStackAcresUpkeep ?? new Map<string, number>();
globalThis.__riverRoomStackAcresUpkeep = memoryUpkeep;

/** Test seam only: the memory branch is process-global. */
export function __resetStackAcresForTest(): void {
  memoryUnits.clear();
  memoryCapacity.clear();
  memoryFeed.clear();
  memoryInventory.clear();
  memoryExchanges.clear();
  memoryHarvests.length = 0;
  memorySectors.clear();
  memoryUpkeep.clear();
}

/** Test seam only: what the memory-branch collection ledger recorded. */
export function __stackacresHarvestsForTest(): readonly StackAcresHarvestEntry[] {
  return memoryHarvests;
}

const UNIT_COLUMNS =
  "id, profile_id, stock, status, stake, yield_quantity, started_at, ready_at, last_fed_at, last_watered_at, muck_fee, permanent, version, created_at";

interface UnitDbRow {
  id: string;
  profile_id: string;
  stock: string;
  status: string;
  stake: number | string;
  yield_quantity: number | string;
  started_at: string;
  ready_at: string;
  last_fed_at: string | null;
  last_watered_at: string | null;
  muck_fee: number | string | null;
  permanent: boolean | null;
  version: number | string;
  created_at: string;
}

function fromRow(row: UnitDbRow): StoredStackAcresUnit {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    stock: row.stock as StackAcresStock,
    status: row.status === "mucked" ? "mucked" : "working",
    stake: Number(row.stake),
    yieldQuantity: Number(row.yield_quantity),
    startedAt: String(row.started_at),
    readyAt: String(row.ready_at),
    lastFedAt: row.last_fed_at ? String(row.last_fed_at) : null,
    lastWateredAt: row.last_watered_at ? String(row.last_watered_at) : null,
    muckFee: row.muck_fee === null ? null : Number(row.muck_fee),
    permanent: row.permanent === true,
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}

function clone(unit: StoredStackAcresUnit): StoredStackAcresUnit {
  return { ...unit };
}

/** Every unit the player owns. What renders the farm. */
export async function listStackAcresUnits(profileId: string): Promise<StoredStackAcresUnit[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryUnits.values()]
      .filter((unit) => unit.profileId === profileId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map(clone);
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .select(UNIT_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load your stackacres: ${error.message}`);
  return (data as UnitDbRow[]).map(fromRow);
}

/** One unit by id, or null if it does not exist or belongs to someone else --
 *  the two cases are indistinguishable on purpose, the same way a plot index
 *  outside a player's own grid never leaked anything either. */
export async function getStackAcresUnit(
  profileId: string,
  unitId: string,
): Promise<StoredStackAcresUnit | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryUnits.get(unitId);
    return found && found.profileId === profileId ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .select(UNIT_COLUMNS)
    .eq("id", unitId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load that unit: ${error.message}`);
  return data ? fromRow(data as UnitDbRow) : null;
}

/**
 * How many of one stock kind this player OCCUPIES a slot with right now, for
 * the cap. Counted per exact kind, not per livestock-vs-crop track: see
 * catalogue.ts's `capFor`.
 *
 * Deliberately `working` OR `mucked`, not `working` alone. A mucked unit is
 * not earning, but it still has to be cleared before it lets go of its slot
 * -- the same way a mucked PLOT used to hold its tile until the fee was
 * paid. Counting only `working` would let muck stop mattering: buy a fresh
 * one instead of ever clearing the old one, and the fee -- "the cost of
 * turning ground over" -- would never actually cost anything. Mirrored by
 * the database's own `homestead_units_enforce_stock_shape` trigger.
 */
export async function countOccupiedStackAcresUnits(
  profileId: string,
  stock: StackAcresStock,
): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryUnits.values()].filter(
      (unit) => unit.profileId === profileId && unit.stock === stock,
    ).length;
  }

  const { count, error } = await supabase
    .from("homestead_units")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("stock", stock);
  if (error) throw new Error(`Could not count what you have: ${error.message}`);
  return count ?? 0;
}

/**
 * Creates a new working unit -- born stocked, not claimed empty and stocked
 * in two steps the way a plot was. The database's own
 * `homestead_units_stock_shape` trigger is the real cap/ceiling guard (see
 * the migration); the service checks both ahead of the debit purely for a
 * clean 409 rather than a raw constraint-violation 500.
 */
export async function createStackAcresUnit(
  profileId: string,
  entry: {
    stock: StackAcresStock;
    stake: number;
    yieldQuantity: number;
    startedAt: Date;
    readyAt: Date;
    lastFedAt: Date | null;
    /** Crops only: sowing waters the ground, so a new crop starts wet. Null
     *  for livestock, which never runs dry. */
    lastWateredAt: Date | null;
    /** True when this was bought outright with Gold rather than sown. */
    permanent: boolean;
  },
): Promise<StoredStackAcresUnit> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const unit: StoredStackAcresUnit = {
      id: randomUUID(),
      profileId,
      stock: entry.stock,
      status: "working",
      stake: entry.stake,
      yieldQuantity: entry.yieldQuantity,
      startedAt: entry.startedAt.toISOString(),
      readyAt: entry.readyAt.toISOString(),
      lastFedAt: entry.lastFedAt ? entry.lastFedAt.toISOString() : null,
      lastWateredAt: entry.lastWateredAt ? entry.lastWateredAt.toISOString() : null,
      muckFee: null,
      permanent: entry.permanent,
      version: 1,
      createdAt: now,
    };
    memoryUnits.set(unit.id, clone(unit));
    return clone(unit);
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .insert({
      profile_id: profileId,
      stock: entry.stock,
      status: "working",
      stake: entry.stake,
      yield_quantity: entry.yieldQuantity,
      started_at: entry.startedAt.toISOString(),
      ready_at: entry.readyAt.toISOString(),
      last_fed_at: entry.lastFedAt ? entry.lastFedAt.toISOString() : null,
      last_watered_at: entry.lastWateredAt ? entry.lastWateredAt.toISOString() : null,
      permanent: entry.permanent,
      version: 1,
    })
    .select(UNIT_COLUMNS)
    .single();
  if (error) throw new Error(`Could not stock that: ${error.message}`);
  return fromRow(data as UnitDbRow);
}

/**
 * Feeds a working animal: pushes ready_at forward by however long it spent
 * hungry, so the clock genuinely stopped. Guarded the same way everything
 * else is; null means someone else got there first and the caller must
 * refund the serving it spent.
 */
export async function feedStackAcresUnit(
  current: StoredStackAcresUnit,
  fedAt: Date,
  newReadyAt: Date,
): Promise<StoredStackAcresUnit | null> {
  const supabase = adminClient();
  const version = current.version + 1;

  if (!supabase) {
    const stored = memoryUnits.get(current.id);
    if (!stored || stored.status !== "working" || stored.version !== current.version) return null;
    const updated: StoredStackAcresUnit = {
      ...stored,
      lastFedAt: fedAt.toISOString(),
      readyAt: newReadyAt.toISOString(),
      version,
    };
    memoryUnits.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .update({ last_fed_at: fedAt.toISOString(), ready_at: newReadyAt.toISOString(), version })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "working")
    .select(UNIT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not feed that: ${error.message}`);
  return data ? fromRow(data as UnitDbRow) : null;
}

/**
 * Waters a dry crop: pushes ready_at forward by however long the soil stood
 * dry, so the clock genuinely stopped. Deliberately the same shape as
 * `feedStackAcresUnit` -- same version/status guard, same null-means-lost-race
 * contract -- because it is the same freeze-and-resume mechanic on the other
 * track. It differs in one way only, and the difference is upstream: watering
 * spends nothing, so a caller has nothing to refund when this returns null.
 */
export async function waterStackAcresUnit(
  current: StoredStackAcresUnit,
  wateredAt: Date,
  newReadyAt: Date,
): Promise<StoredStackAcresUnit | null> {
  const supabase = adminClient();
  const version = current.version + 1;

  if (!supabase) {
    const stored = memoryUnits.get(current.id);
    if (!stored || stored.status !== "working" || stored.version !== current.version) return null;
    const updated: StoredStackAcresUnit = {
      ...stored,
      lastWateredAt: wateredAt.toISOString(),
      readyAt: newReadyAt.toISOString(),
      version,
    };
    memoryUnits.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .update({
      last_watered_at: wateredAt.toISOString(),
      ready_at: newReadyAt.toISOString(),
      version,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "working")
    .select(UNIT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not water that: ${error.message}`);
  return data ? fromRow(data as UnitDbRow) : null;
}

/**
 * Settles a ready unit, exactly once. THREE OUTCOMES, decided by the caller
 * and passed in rather than derived here:
 *
 *   * `restartReadyAt` set -- bought outright with Gold. The animal does not
 *     leave when you take the milk, so the row stays working, keeps its
 *     stock, stake and yield, and simply starts its next cycle now.
 *     `last_fed_at` is deliberately NOT touched: a cow collected at the end
 *     of a 24h cycle is already hours past its last feed and should be
 *     hungry immediately. Resetting it would hand out a free serving on
 *     every collection and quietly delete the feed sink.
 *   * `restartReadyAt === null && muckFee === null` -- sown with Bushels and
 *     came back clean. Its seed was consumed by its own harvest, so the row
 *     is DELETED: there is no "empty" state to return it to any more, and
 *     the capacity it freed is simply room for a fresh purchase.
 *   * `restartReadyAt === null && muckFee !== null` -- sown with Bushels and
 *     needs maintenance. The row stays, marked mucked, until `clearStackAcresMuck`
 *     pays the fee.
 *
 * The guard is identical in every branch and is what makes a double-tapped
 * collection pay once: version, status and a database-side `ready_at` check,
 * so a fast-forwarded phone clock settles nothing.
 */
export async function collectStackAcresUnit(
  current: StoredStackAcresUnit,
  now: Date,
  muckFee: number | null,
  restartReadyAt: Date | null = null,
): Promise<StoredStackAcresUnit | null> {
  const supabase = adminClient();
  const version = current.version + 1;

  if (restartReadyAt) {
    // A re-sown crop goes into watered ground, exactly as a freshly stocked
    // one does. `last_fed_at` deliberately does NOT get this treatment (see
    // the doc comment above) and the asymmetry is the point: an animal can be
    // fed at any time, so being hungry the moment it restarts costs the
    // player a serving and nothing else. A crop cannot be watered until it is
    // actually dry, so carrying the old cycle's watering across would restart
    // it dry at progress 0 AND make the only available fix -- one Water tap --
    // add the whole stale gap to ready_at, turning a 15-minute cycle into
    // however long the unit sat ripe before anyone collected it.
    //
    // Keyed off the row's own value rather than the catalogue, so this needs
    // no import: livestock is null and stays null. A legacy crop row still
    // null here is correct either way, since `thirstyAtFor` falls back to
    // startedAt, which this branch has just reset to `now`.
    const restartWatered = current.lastWateredAt === null ? null : now.toISOString();
    const next: StoredStackAcresUnit = {
      ...current,
      status: "working",
      startedAt: now.toISOString(),
      readyAt: restartReadyAt.toISOString(),
      lastWateredAt: restartWatered,
      muckFee: null,
      version,
    };
    if (!supabase) {
      const stored = memoryUnits.get(current.id);
      if (
        !stored ||
        stored.status !== "working" ||
        stored.version !== current.version ||
        Date.parse(stored.readyAt) > now.getTime()
      ) {
        return null;
      }
      memoryUnits.set(current.id, clone(next));
      return clone(next);
    }
    const { data, error } = await supabase
      .from("homestead_units")
      .update({
        status: "working",
        started_at: next.startedAt,
        ready_at: next.readyAt,
        last_watered_at: next.lastWateredAt,
        muck_fee: null,
        version,
      })
      .eq("id", current.id)
      .eq("version", current.version)
      .eq("status", "working")
      .lte("ready_at", now.toISOString())
      .select(UNIT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`Could not collect from that: ${error.message}`);
    return data ? fromRow(data as UnitDbRow) : null;
  }

  if (muckFee === null) {
    // A clean, non-permanent collect removes the row outright.
    if (!supabase) {
      const stored = memoryUnits.get(current.id);
      if (
        !stored ||
        stored.status !== "working" ||
        stored.version !== current.version ||
        Date.parse(stored.readyAt) > now.getTime()
      ) {
        return null;
      }
      memoryUnits.delete(current.id);
      return clone(stored);
    }
    const { data, error } = await supabase
      .from("homestead_units")
      .delete()
      .eq("id", current.id)
      .eq("version", current.version)
      .eq("status", "working")
      .lte("ready_at", now.toISOString())
      .select(UNIT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`Could not collect from that: ${error.message}`);
    return data ? fromRow(data as UnitDbRow) : null;
  }

  const next: StoredStackAcresUnit = { ...current, status: "mucked", muckFee, version };
  if (!supabase) {
    const stored = memoryUnits.get(current.id);
    if (
      !stored ||
      stored.status !== "working" ||
      stored.version !== current.version ||
      Date.parse(stored.readyAt) > now.getTime()
    ) {
      return null;
    }
    memoryUnits.set(current.id, clone(next));
    return clone(next);
  }
  const { data, error } = await supabase
    .from("homestead_units")
    .update({ status: "mucked", muck_fee: muckFee, version })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "working")
    .lte("ready_at", now.toISOString())
    .select(UNIT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not collect from that: ${error.message}`);
  return data ? fromRow(data as UnitDbRow) : null;
}

/**
 * Sends bought stock away and removes the row entirely. No refund -- see
 * STACKACRES_RETIRE_REFUND.
 *
 * This exists so a cap can never trap anybody. Permanent stock occupies its
 * slot forever by design, and three permanent cattle fill the cattle cap;
 * without a way out, a player who bought three could never keep anything
 * else, and the purchase would be a trap rather than a prize.
 *
 * Guarded on version and on the unit still being permanent, so it can never
 * bulldoze a Bushel-sown unit the player is mid-way through -- that has its
 * own cost already sunk into it and its own harvest coming.
 */
export async function retireStackAcresUnit(current: StoredStackAcresUnit): Promise<StoredStackAcresUnit | null> {
  const supabase = adminClient();

  if (!supabase) {
    const stored = memoryUnits.get(current.id);
    if (!stored || !stored.permanent || stored.version !== current.version) return null;
    memoryUnits.delete(current.id);
    return clone(stored);
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .delete()
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("permanent", true)
    .select(UNIT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not retire that: ${error.message}`);
  return data ? fromRow(data as UnitDbRow) : null;
}

/** Clears a mucked unit, once the fee is paid -- removes the row, freeing the
 *  capacity it held. There is no "back to empty" to return it to; buying
 *  fresh stock is a new `stock`/`buy-stock` request. */
export async function clearStackAcresMuck(current: StoredStackAcresUnit): Promise<StoredStackAcresUnit | null> {
  const supabase = adminClient();

  if (!supabase) {
    const stored = memoryUnits.get(current.id);
    if (!stored || stored.status !== "mucked" || stored.version !== current.version) return null;
    memoryUnits.delete(current.id);
    return clone(stored);
  }

  const { data, error } = await supabase
    .from("homestead_units")
    .delete()
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "mucked")
    .select(UNIT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not clear that: ${error.message}`);
  return data ? fromRow(data as UnitDbRow) : null;
}

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

/** Every stock kind's purchased extra slots, for a player. Missing entries
 *  mean 0, same as a missing homestead_feed row means 0 servings. */
export async function readStackAcresCapacity(
  profileId: string,
): Promise<Partial<Record<StackAcresStock, number>>> {
  const supabase = adminClient();
  if (!supabase) {
    const out: Partial<Record<StackAcresStock, number>> = {};
    for (const [key, slots] of memoryCapacity) {
      const [id, stock] = key.split(":");
      if (id === profileId) out[stock as StackAcresStock] = slots;
    }
    return out;
  }

  const { data, error } = await supabase
    .from("homestead_capacity")
    .select("stock, extra_slots")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your capacity: ${error.message}`);
  const out: Partial<Record<StackAcresStock, number>> = {};
  for (const row of (data ?? []) as { stock: string; extra_slots: number | string }[]) {
    out[row.stock as StackAcresStock] = Number(row.extra_slots);
  }
  return out;
}

/**
 * Buys one extra capacity slot for a kind. Returns the new slot count, or
 * null when the 3-extra-slot ceiling would be broken -- the caller treats
 * that exactly like a lost race, the same posture adjustStackAcresFeed takes
 * on a negative balance.
 */
export async function adjustStackAcresCapacity(
  profileId: string,
  stock: StackAcresStock,
  delta: number,
): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const key = `${profileId}:${stock}`;
    const current = memoryCapacity.get(key) ?? 0;
    const next = current + delta;
    if (next < 0 || next > 3) return null;
    memoryCapacity.set(key, next);
    return next;
  }

  const { data, error } = await supabase.rpc("adjust_homestead_capacity", {
    p_profile_id: profileId,
    p_stock: stock,
    p_delta: delta,
  });
  if (error) {
    if (error.code === "23514") return null;
    throw new Error(`Could not update your capacity: ${error.message}`);
  }
  return data === null ? null : Number(data);
}

/* ------------------------------------------------------------------ */
/* Cleared land                                                        */
/* ------------------------------------------------------------------ */

/** Every sector this player has paid to clear. NOT the whole answer to "what
 *  may they work" -- lib/stackacres/sectors.ts's `unlockedSectors` also
 *  counts any district they already keep stock in, which is what carries
 *  farms that predate this feature. */
export async function readStackAcresSectors(profileId: string): Promise<SectorId[]> {
  const supabase = adminClient();
  if (!supabase) {
    const out: SectorId[] = [];
    for (const key of memorySectors.keys()) {
      const [id, sector] = key.split(":");
      if (id === profileId) out.push(sector as SectorId);
    }
    return out;
  }

  const { data, error } = await supabase
    .from("homestead_sectors")
    .select("sector")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your land: ${error.message}`);
  return ((data ?? []) as { sector: string }[]).map((row) => row.sector as SectorId);
}

/**
 * Records a sector as cleared, exactly once.
 *
 * Returns false when this player had already cleared it, which the caller
 * must treat as a lost race and REFUND on -- the same posture every other
 * write here takes, and it matters more than usual because the thing being
 * bought is permanent and the Gold has already left. Two tabs clearing the
 * Long Meadow together must pay for it once.
 *
 * The primary key is what makes that true; there is no read-then-write here
 * to race against.
 */
export async function recordStackAcresSectorCleared(
  profileId: string,
  sector: SectorId,
  clearedAt: Date,
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const key = `${profileId}:${sector}`;
    if (memorySectors.has(key)) return false;
    memorySectors.set(key, clearedAt.toISOString());
    return true;
  }

  const { data, error } = await supabase
    .from("homestead_sectors")
    .upsert(
      { profile_id: profileId, sector, cleared_at: clearedAt.toISOString() },
      { onConflict: "profile_id,sector", ignoreDuplicates: true },
    )
    .select("sector");
  if (error) throw new Error(`Could not clear that land: ${error.message}`);
  // `ignoreDuplicates` returns no row for a conflict, which is exactly the
  // "somebody else got here first" signal the caller needs.
  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------------ */
/* Land maintenance                                                    */
/* ------------------------------------------------------------------ */

/**
 * Bushels already taken for land maintenance on this UTC day. Read-only and
 * advisory, the same caveat `readStackAcresExchanged` carries: it is what the
 * HUD shows, never what a charge is decided on. The decision is made inside
 * `reserveStackAcresUpkeep`, atomically, because anything read first can be
 * raced by a second tab.
 */
export async function readStackAcresUpkeep(profileId: string, day: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) return memoryUpkeep.get(`${profileId}:${day}`) ?? 0;

  const { data, error } = await supabase
    .from("homestead_upkeep")
    .select("bushels")
    .eq("profile_id", profileId)
    .eq("day", day)
    .maybeSingle();
  if (error) throw new Error(`Could not read today's land fee: ${error.message}`);
  return data ? Number((data as { bushels: number | string }).bushels) : 0;
}

/**
 * Raises today's paid total to `target`, and says whether this call is the
 * one that moved it.
 *
 * RAISE-TO, NOT ADD, and that is the whole reason this is not shaped like
 * `reserveStackAcresExchange`. A day's bill is not fixed when the day starts:
 * a player who buys a capacity slot at noon owes more for the afternoon than
 * they did for the morning, so the ledger has to hold "what has been paid
 * toward today" and the caller has to settle the DIFFERENCE. A plain
 * insert-once would charge the morning's bill and never the rise; a plain add
 * would charge the whole afternoon bill on top of the morning's.
 *
 * The conditional update is what makes it safe to race: two requests that
 * both find today unpaid will both debit, one will raise the total and the
 * other gets false and refunds. Two racing on DIFFERENT targets (a capacity
 * purchase landed between them) settle at the higher, and the lower's refund
 * leaves the day slightly under-collected until the next action re-reads it
 * -- a rounding error in the player's favour, not a double charge.
 *
 * The caller debits BEFORE calling this (rule 1) and refunds on false,
 * exactly like `reserveStackAcresExchange`'s null.
 */
export async function raiseStackAcresUpkeep(
  profileId: string,
  day: string,
  target: number,
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const key = `${profileId}:${day}`;
    if ((memoryUpkeep.get(key) ?? 0) >= target) return false;
    memoryUpkeep.set(key, target);
    return true;
  }

  const { data, error } = await supabase.rpc("raise_homestead_upkeep", {
    p_profile_id: profileId,
    p_day: day,
    p_target: target,
  });
  if (error) throw new Error(`Could not settle today's land fee: ${error.message}`);
  return data === true;
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

export async function readStackAcresFeed(profileId: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) return memoryFeed.get(profileId) ?? 0;

  const { data, error } = await supabase
    .from("homestead_feed")
    .select("servings")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your feed store: ${error.message}`);
  return data ? Number((data as { servings: number | string }).servings) : 0;
}

/**
 * Moves the feed balance by `delta`, refusing to go negative. Returns the new
 * balance, or null when there was not enough to spend -- which the caller must
 * treat exactly like a lost race, because it is one.
 */
export async function adjustStackAcresFeed(profileId: string, delta: number): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryFeed.get(profileId) ?? 0;
    const next = current + delta;
    if (next < 0) return null;
    memoryFeed.set(profileId, next);
    return next;
  }

  const { data, error } = await supabase.rpc("adjust_homestead_feed", {
    p_profile_id: profileId,
    p_delta: delta,
  });
  if (error) {
    if (error.code === "23514") return null;
    throw new Error(`Could not update your feed store: ${error.message}`);
  }
  return data === null ? null : Number(data);
}

/* ------------------------------------------------------------------ */
/* Inventory and Bushels                                               */
/* ------------------------------------------------------------------ */

/** Every held line for one player, keyed by item id. Bushels are one of them. */
export type StackAcresInventory = Record<string, number>;

export async function readStackAcresInventory(profileId: string): Promise<StackAcresInventory> {
  const supabase = adminClient();
  if (!supabase) return { ...(memoryInventory.get(profileId) ?? {}) };

  const { data, error } = await supabase
    .from("homestead_inventory")
    .select("item_id, quantity")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your barn: ${error.message}`);

  const inventory: StackAcresInventory = {};
  for (const row of (data ?? []) as { item_id: string; quantity: number | string }[]) {
    inventory[row.item_id] = Number(row.quantity);
  }
  return inventory;
}

/**
 * Moves one inventory line by `delta`, refusing to go negative. Returns the new
 * quantity, or null when there was not enough to spend -- which the caller must
 * treat exactly like a lost race, because it is one. Same posture as
 * adjustStackAcresFeed and, above it, credit_gold.
 */
export async function adjustStackAcresInventory(
  profileId: string,
  itemId: string,
  delta: number,
): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const held = memoryInventory.get(profileId) ?? {};
    const next = (held[itemId] ?? 0) + delta;
    if (next < 0) return null;
    memoryInventory.set(profileId, { ...held, [itemId]: next });
    return next;
  }

  const { data, error } = await supabase.rpc("adjust_homestead_inventory", {
    p_profile_id: profileId,
    p_item_id: itemId,
    p_delta: delta,
  });
  if (error) {
    if (error.code === "23514") return null;
    throw new Error(`Could not update your barn: ${error.message}`);
  }
  return data === null ? null : Number(data);
}

/**
 * Seeds a new farm's Bushels exactly once. Returns true only on the write that
 * actually created the row -- a profile whose bushels row already exists is
 * never topped up, even sitting at zero, because the primary key is the
 * idempotency guard rather than a balance check. A player who spends the grant
 * does not get another by clearing their farm.
 */
export async function grantStartingBushels(profileId: string, amount: number): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const held = memoryInventory.get(profileId);
    if (held && BUSHELS in held) return false;
    memoryInventory.set(profileId, { ...(held ?? {}), [BUSHELS]: Math.max(amount, 0) });
    return true;
  }

  const { data, error } = await supabase.rpc("grant_homestead_starting_bushels", {
    p_profile_id: profileId,
    p_amount: amount,
  });
  if (error) throw new Error(`Could not open your barn: ${error.message}`);
  return data === true;
}

/* ------------------------------------------------------------------ */
/* The exchange window                                                  */
/* ------------------------------------------------------------------ */

/**
 * How much Gold this player has already taken out of the farm today. Read-only
 * and advisory: it is what the store sheet shows, never what a reservation is
 * decided on. The decision is made inside reserveStackAcresExchange, atomically,
 * because anything read first can be raced.
 */
export async function readStackAcresExchanged(profileId: string, day: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) return memoryExchanges.get(`${profileId}:${day}`) ?? 0;

  const { data, error } = await supabase
    .from("homestead_exchanges")
    .select("gold")
    .eq("profile_id", profileId)
    .eq("day", day)
    .maybeSingle();
  if (error) throw new Error(`Could not read today's exchange: ${error.message}`);
  return data ? Number((data as { gold: number | string }).gold) : 0;
}

/**
 * Reserves `gold` against today's ceiling, atomically, and returns the day's
 * new total -- or null when the reservation would break the ceiling.
 *
 * Null is the whole point of this function. It is the same posture every other
 * write here takes: a null is a refusal or a lost race, the two are
 * indistinguishable from the caller, and null must never pay. Two requests
 * racing for the last of the day's allowance cannot both win, because the RPC
 * takes a row lock rather than reading and then writing.
 *
 * `ceiling` can only ever TIGHTEN what the database allows: the SQL function
 * carries its own hard copy of the constant and takes the smaller of the two,
 * so raising the farm's Gold faucet needs a migration rather than a deploy.
 */
export async function reserveStackAcresExchange(
  profileId: string,
  day: string,
  gold: number,
  ceiling: number,
): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const key = `${profileId}:${day}`;
    const used = memoryExchanges.get(key) ?? 0;
    const next = used + gold;
    if (next > ceiling) return null;
    memoryExchanges.set(key, next);
    return next;
  }

  const { data, error } = await supabase.rpc("reserve_homestead_exchange", {
    p_profile_id: profileId,
    p_day: day,
    p_gold: gold,
    p_ceiling: ceiling,
  });
  if (error) throw new Error(`Could not reach the exchange window: ${error.message}`);
  return data === null ? null : Number(data);
}

/** One settled collection, for the append-only economy ledger. */
export interface StackAcresHarvestEntry {
  profileId: string;
  unitId: string;
  stock: StackAcresStock;
  /**
   * The seed cost in Bushels. NOTIONAL when `permanent` is true: bought stock
   * pays nothing per cycle, so this is the catalogue's price rather than money
   * that changed hands. It cannot simply be 0 -- the column carries
   * `check (stake > 0)` -- which is exactly why the flag below exists.
   */
  stake: number;
  payout: number;
  startedAt: string;
  collectedAt: string;
  /** True when this came off stock bought outright with Gold. */
  permanent: boolean;
}

/**
 * Best-effort telemetry, written after the credit. The StackAcres is a
 * guaranteed win, so the economy dashboard's view of how much this faucet
 * pours matters more than usual -- but a ledger failure must never turn a
 * settled, paid collection into an error response.
 */
export async function recordStackAcresHarvest(entry: StackAcresHarvestEntry): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryHarvests.push({ ...entry });
    return;
  }

  const { error } = await supabase.from("homestead_harvests").insert({
    profile_id: entry.profileId,
    unit_id: entry.unitId,
    stock: entry.stock,
    stake: entry.stake,
    payout: entry.payout,
    started_at: entry.startedAt,
    collected_at: entry.collectedAt,
    permanent: entry.permanent,
  });
  if (error) console.error("stackacres.harvest_ledger_failed", { entry, error });
}

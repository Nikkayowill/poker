import "server-only";
import { randomUUID } from "crypto";
import type { HomesteadPlotRow } from "@/lib/homestead/plots";
import type { HomesteadStock } from "@/lib/homestead/catalogue";
import { BUSHELS } from "@/lib/homestead/items";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the StackChips Homestead: one row per owned plot carrying at
 * most one working crop or pen, plus the player's feed balance.
 *
 * Same twin-branch shape as ante-up-store.ts (Supabase when configured, an
 * in-process Map otherwise), and the same two invariants: one row per
 * (profile, plot) -- caught from the unique index (23505) rather than a
 * read-first check -- and a version that only ever advances from the value the
 * caller last saw.
 *
 * The write that matters is collectHomesteadPlot: a single guarded UPDATE from
 * working to empty-or-mucked that also re-checks readiness against the
 * database's own view of `ready_at`. It returns null on a lost race, a stale
 * version, or an early tap, and null must never pay -- that guard is the
 * settlement idempotency key that makes a double-tapped plot credit once.
 *
 * That same write is where the muck roll is applied. The roll happens in the
 * service and is passed in, so the decision is made once per settlement rather
 * than once per read: derived on read it would land differently every refetch
 * and let a player reroll it by pulling to refresh.
 */

export interface StoredHomesteadPlot extends HomesteadPlotRow {
  id: string;
  profileId: string;
  createdAt: string;
}

declare global {
  var __riverRoomHomesteadPlots: Map<string, StoredHomesteadPlot> | undefined;
  var __riverRoomHomesteadFeed: Map<string, number> | undefined;
  var __riverRoomHomesteadInventory: Map<string, HomesteadInventory> | undefined;
  var __riverRoomHomesteadExchanges: Map<string, number> | undefined;
  var __riverRoomHomesteadHarvests: HomesteadHarvestEntry[] | undefined;
}

const memoryPlots = globalThis.__riverRoomHomesteadPlots ?? new Map<string, StoredHomesteadPlot>();
globalThis.__riverRoomHomesteadPlots = memoryPlots;

const memoryFeed = globalThis.__riverRoomHomesteadFeed ?? new Map<string, number>();
globalThis.__riverRoomHomesteadFeed = memoryFeed;

const memoryInventory =
  globalThis.__riverRoomHomesteadInventory ?? new Map<string, HomesteadInventory>();
globalThis.__riverRoomHomesteadInventory = memoryInventory;

/** Gold taken out of the farm, keyed `${profileId}:${YYYY-MM-DD}`. */
const memoryExchanges = globalThis.__riverRoomHomesteadExchanges ?? new Map<string, number>();
globalThis.__riverRoomHomesteadExchanges = memoryExchanges;

const memoryHarvests = globalThis.__riverRoomHomesteadHarvests ?? [];
globalThis.__riverRoomHomesteadHarvests = memoryHarvests;

/** Test seam only: the memory branch is process-global. */
export function __resetHomesteadForTest(): void {
  memoryPlots.clear();
  memoryFeed.clear();
  memoryInventory.clear();
  memoryExchanges.clear();
  memoryHarvests.length = 0;
}

/** Test seam only: what the memory-branch collection ledger recorded. */
export function __homesteadHarvestsForTest(): readonly HomesteadHarvestEntry[] {
  return memoryHarvests;
}

/** Thrown when this plot already has a row (a replayed or racing purchase). */
export class HomesteadPlotExists extends Error {
  constructor() {
    super("You already own this plot.");
    this.name = "HomesteadPlotExists";
  }
}

const PLOT_COLUMNS =
  "id, profile_id, plot_index, status, stock, stake, yield_quantity, started_at, ready_at, last_fed_at, muck_fee, version, created_at";

interface PlotDbRow {
  id: string;
  profile_id: string;
  plot_index: number | string;
  status: string;
  stock: string | null;
  stake: number | string | null;
  yield_quantity: number | string | null;
  started_at: string | null;
  ready_at: string | null;
  last_fed_at: string | null;
  muck_fee: number | string | null;
  version: number | string;
  created_at: string;
}

function statusOf(value: string): StoredHomesteadPlot["status"] {
  if (value === "working") return "working";
  if (value === "mucked") return "mucked";
  return "empty";
}

function fromRow(row: PlotDbRow): StoredHomesteadPlot {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    plotIndex: Number(row.plot_index),
    status: statusOf(row.status),
    stock: (row.stock as HomesteadStock | null) ?? null,
    stake: row.stake === null ? null : Number(row.stake),
    yieldQuantity: row.yield_quantity === null ? null : Number(row.yield_quantity),
    startedAt: row.started_at ? String(row.started_at) : null,
    readyAt: row.ready_at ? String(row.ready_at) : null,
    lastFedAt: row.last_fed_at ? String(row.last_fed_at) : null,
    muckFee: row.muck_fee === null ? null : Number(row.muck_fee),
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}

function clone(plot: StoredHomesteadPlot): StoredHomesteadPlot {
  return { ...plot };
}

/** Every plot the player owns, in grid order. What renders the farm. */
export async function listHomesteadPlots(profileId: string): Promise<StoredHomesteadPlot[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryPlots.values()]
      .filter((plot) => plot.profileId === profileId)
      .sort((a, b) => a.plotIndex - b.plotIndex)
      .map(clone);
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .select(PLOT_COLUMNS)
    .eq("profile_id", profileId)
    .order("plot_index", { ascending: true });
  if (error) throw new Error(`Could not load your homestead: ${error.message}`);
  return (data as PlotDbRow[]).map(fromRow);
}

/** One plot by grid position, or null while it is still locked/unowned. */
export async function getHomesteadPlot(
  profileId: string,
  plotIndex: number,
): Promise<StoredHomesteadPlot | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = [...memoryPlots.values()].find(
      (plot) => plot.profileId === profileId && plot.plotIndex === plotIndex,
    );
    return found ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .select(PLOT_COLUMNS)
    .eq("profile_id", profileId)
    .eq("plot_index", plotIndex)
    .maybeSingle();
  if (error) throw new Error(`Could not load that plot: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/**
 * Creates an empty plot row. Throws HomesteadPlotExists when the player
 * already owns it, from the unique index rather than a read-first check, so a
 * double-clicked purchase refunds cleanly instead of charging twice.
 */
export async function createHomesteadPlot(
  profileId: string,
  plotIndex: number,
): Promise<StoredHomesteadPlot> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const exists = [...memoryPlots.values()].some(
      (plot) => plot.profileId === profileId && plot.plotIndex === plotIndex,
    );
    if (exists) throw new HomesteadPlotExists();
    const plot: StoredHomesteadPlot = {
      id: randomUUID(),
      profileId,
      plotIndex,
      status: "empty",
      stock: null,
      stake: null,
      yieldQuantity: null,
      startedAt: null,
      readyAt: null,
      lastFedAt: null,
      muckFee: null,
      version: 1,
      createdAt: now,
    };
    memoryPlots.set(plot.id, clone(plot));
    return clone(plot);
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .insert({ profile_id: profileId, plot_index: plotIndex, status: "empty", version: 1 })
    .select(PLOT_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new HomesteadPlotExists();
    throw new Error(`Could not claim that plot: ${error.message}`);
  }
  return fromRow(data as PlotDbRow);
}

/**
 * How many crops or pens this player has working right now, for the caps.
 * Counted separately because the two tracks have separate caps.
 */
export async function countWorkingHomesteadPlots(
  profileId: string,
  animals: readonly string[],
  wantAnimals: boolean,
): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryPlots.values()].filter(
      (plot) =>
        plot.profileId === profileId &&
        plot.status === "working" &&
        plot.stock !== null &&
        animals.includes(plot.stock) === wantAnimals,
    ).length;
  }

  const query = supabase
    .from("homestead_plots")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "working");
  const { count, error } = await (wantAnimals
    ? query.in("stock", animals as string[])
    : query.not("stock", "in", `(${animals.join(",")})`));
  if (error) throw new Error(`Could not count what you have working: ${error.message}`);
  return count ?? 0;
}

/**
 * Stocks an empty plot: a guarded UPDATE from the exact row the service just
 * read. Returns null on a lost race (another tab stocked, or anything else
 * moved the row), and the caller must refund on null -- the stake was already
 * debited under rule 1.
 */
export async function stockHomesteadPlot(
  current: StoredHomesteadPlot,
  entry: {
    stock: HomesteadStock;
    stake: number;
    yieldQuantity: number;
    startedAt: Date;
    readyAt: Date;
    lastFedAt: Date | null;
  },
): Promise<StoredHomesteadPlot | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const next = {
    status: "working" as const,
    stock: entry.stock,
    stake: entry.stake,
    yieldQuantity: entry.yieldQuantity,
    startedAt: entry.startedAt.toISOString(),
    readyAt: entry.readyAt.toISOString(),
    lastFedAt: entry.lastFedAt ? entry.lastFedAt.toISOString() : null,
    muckFee: null,
    version,
  };

  if (!supabase) {
    const stored = memoryPlots.get(current.id);
    if (!stored || stored.status !== "empty" || stored.version !== current.version) return null;
    const updated: StoredHomesteadPlot = { ...stored, ...next };
    memoryPlots.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .update({
      status: next.status,
      stock: next.stock,
      stake: next.stake,
      yield_quantity: next.yieldQuantity,
      started_at: next.startedAt,
      ready_at: next.readyAt,
      last_fed_at: next.lastFedAt,
      muck_fee: null,
      version,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "empty")
    .select(PLOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not stock that plot: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/**
 * Feeds a working animal: pushes ready_at forward by however long it spent
 * hungry, so the clock genuinely stopped. Guarded the same way everything else
 * is; null means someone else got there first and the caller must refund the
 * serving it spent.
 */
export async function feedHomesteadPlot(
  current: StoredHomesteadPlot,
  fedAt: Date,
  newReadyAt: Date,
): Promise<StoredHomesteadPlot | null> {
  const supabase = adminClient();
  const version = current.version + 1;

  if (!supabase) {
    const stored = memoryPlots.get(current.id);
    if (!stored || stored.status !== "working" || stored.version !== current.version) return null;
    const updated: StoredHomesteadPlot = {
      ...stored,
      lastFedAt: fedAt.toISOString(),
      readyAt: newReadyAt.toISOString(),
      version,
    };
    memoryPlots.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .update({
      last_fed_at: fedAt.toISOString(),
      ready_at: newReadyAt.toISOString(),
      version,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "working")
    .select(PLOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not feed that pen: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/**
 * Settles a ready plot. The one write that pays: guarded on id + version +
 * status AND on the database's own ready_at <= now, so a doctored client
 * clock, a double-tap, or two tabs can produce at most one non-null return --
 * and only a non-null return is ever credited.
 *
 * `muckFee` is the already-rolled outcome: a number sends the plot to mucked,
 * null sends it back to empty. Passed in rather than decided here so the roll
 * happens exactly once per settlement attempt that wins.
 */
export async function collectHomesteadPlot(
  current: StoredHomesteadPlot,
  now: Date,
  muckFee: number | null,
): Promise<StoredHomesteadPlot | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const cleared = {
    status: (muckFee === null ? "empty" : "mucked") as "empty" | "mucked",
    stock: null,
    stake: null,
    yieldQuantity: null,
    startedAt: null,
    readyAt: null,
    lastFedAt: null,
    muckFee,
    version,
  };

  if (!supabase) {
    const stored = memoryPlots.get(current.id);
    if (
      !stored ||
      stored.status !== "working" ||
      stored.version !== current.version ||
      !stored.readyAt ||
      Date.parse(stored.readyAt) > now.getTime()
    ) {
      return null;
    }
    const updated: StoredHomesteadPlot = { ...stored, ...cleared };
    memoryPlots.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .update({
      status: cleared.status,
      stock: null,
      stake: null,
      yieldQuantity: null,
      started_at: null,
      ready_at: null,
      last_fed_at: null,
      muck_fee: muckFee,
      version,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "working")
    .lte("ready_at", now.toISOString())
    .select(PLOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not collect from that plot: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/** Clears a mucked plot back to empty, once the fee is paid. */
export async function clearHomesteadMuck(
  current: StoredHomesteadPlot,
): Promise<StoredHomesteadPlot | null> {
  const supabase = adminClient();
  const version = current.version + 1;

  if (!supabase) {
    const stored = memoryPlots.get(current.id);
    if (!stored || stored.status !== "mucked" || stored.version !== current.version) return null;
    const updated: StoredHomesteadPlot = { ...stored, status: "empty", muckFee: null, version };
    memoryPlots.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("homestead_plots")
    .update({ status: "empty", muck_fee: null, version })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "mucked")
    .select(PLOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not clear that plot: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

export async function readHomesteadFeed(profileId: string): Promise<number> {
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
export async function adjustHomesteadFeed(profileId: string, delta: number): Promise<number | null> {
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
export type HomesteadInventory = Record<string, number>;

export async function readHomesteadInventory(profileId: string): Promise<HomesteadInventory> {
  const supabase = adminClient();
  if (!supabase) return { ...(memoryInventory.get(profileId) ?? {}) };

  const { data, error } = await supabase
    .from("homestead_inventory")
    .select("item_id, quantity")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your barn: ${error.message}`);

  const inventory: HomesteadInventory = {};
  for (const row of (data ?? []) as { item_id: string; quantity: number | string }[]) {
    inventory[row.item_id] = Number(row.quantity);
  }
  return inventory;
}

/**
 * Moves one inventory line by `delta`, refusing to go negative. Returns the new
 * quantity, or null when there was not enough to spend -- which the caller must
 * treat exactly like a lost race, because it is one. Same posture as
 * adjustHomesteadFeed and, above it, credit_gold.
 */
export async function adjustHomesteadInventory(
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
 * decided on. The decision is made inside reserveHomesteadExchange, atomically,
 * because anything read first can be raced.
 */
export async function readHomesteadExchanged(profileId: string, day: string): Promise<number> {
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
export async function reserveHomesteadExchange(
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
export interface HomesteadHarvestEntry {
  profileId: string;
  plotIndex: number;
  stock: HomesteadStock;
  stake: number;
  payout: number;
  startedAt: string;
  collectedAt: string;
}

/**
 * Best-effort telemetry, written after the credit. The Homestead is a
 * guaranteed win, so the economy dashboard's view of how much this faucet
 * pours matters more than usual -- but a ledger failure must never turn a
 * settled, paid collection into an error response.
 */
export async function recordHomesteadHarvest(entry: HomesteadHarvestEntry): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryHarvests.push({ ...entry });
    return;
  }

  const { error } = await supabase.from("homestead_harvests").insert({
    profile_id: entry.profileId,
    plot_index: entry.plotIndex,
    stock: entry.stock,
    stake: entry.stake,
    payout: entry.payout,
    started_at: entry.startedAt,
    collected_at: entry.collectedAt,
  });
  if (error) console.error("homestead.harvest_ledger_failed", { entry, error });
}

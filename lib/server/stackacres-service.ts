import "server-only";
import { NextResponse } from "next/server";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_FEED,
  STACKACRES_MAX_EXTRA_CAP,
  STACKACRES_MUCK_CHANCE,
  capFor,
  stackacresCapacityPrice,
  isStackAcresStock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import {
  hungryAtFor,
  isStackAcresUnitHungry,
  isStackAcresUnitReady,
  toStackAcresUnitSnapshots,
  type StackAcresUnitSnapshot,
} from "@/lib/stackacres/units";
import { STACKACRES_YIELDS, type StackAcresItem } from "@/lib/stackacres/items";
import {
  STACKACRES_GOLD_CEILING,
  exchangeState,
  stackacresExchangeDay,
  type StackAcresExchangeState,
} from "@/lib/stackacres/exchange";
import {
  harvestTally,
  settleHarvest,
  type HarvestCandidate,
  type HarvestSettlement,
} from "@/lib/stackacres/harvest";
import type { BountifulHarvest } from "@/lib/stackacres/bounty";
import {
  stackacresUpkeepDay,
  stackacresUpkeepDue,
  upkeepState,
  type StackAcresUpkeepState,
} from "@/lib/stackacres/upkeep";
import { stackacresStockPrice } from "@/lib/stackacres/market";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  adjustStackAcresCapacity,
  adjustStackAcresFeed,
  clearStackAcresMuck,
  collectStackAcresUnit,
  countOccupiedStackAcresUnits,
  createStackAcresUnit,
  feedStackAcresUnit,
  getStackAcresUnit,
  listStackAcresUnits,
  readStackAcresCapacity,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresUpkeep,
  recordStackAcresHarvest,
  recordStackAcresUpkeep,
  releaseStackAcresExchange,
  reserveStackAcresExchange,
  retireStackAcresUnit,
  type StoredStackAcresUnit,
} from "./stackacres-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";

/**
 * Everything between a StackAcres request and the player's purse.
 *
 * ONE CURRENCY NOW. This used to run on two: Bushels inside the farm, Gold
 * outside it, joined by a daily exchange window. A harvest is valued and paid
 * in Gold in one step, so Bushels had nothing left to denominate and are gone,
 * along with the barn and the store shelf that stood between a crop and its
 * money.
 *
 * WHAT THE SECOND CURRENCY WAS ACTUALLY PROTECTING, and what still protects
 * it. The Bushel firewall let the farm's internal numbers be wrong cheaply. It
 * was never the thing that stopped the farm printing money -- that was, and
 * still is, **the flat daily ceiling on how much Gold one player may take out
 * of the farm**, mirrored as a hard limit inside `reserve_homestead_exchange`
 * and applied here to the harvest itself. Not a percentage, not scaled by
 * stock owned, not scaled by a Bountiful Harvest multiplier. See
 * lib/stackacres/exchange.ts.
 *
 * THE GOLD PATHS, and the asymmetry that is the whole safety story:
 *
 *   * FIVE SPEND. `expandStackAcresCapacity` buys a slot, `buyStackAcresStock`
 *     buys stock outright, `stockStackAcres` buys a cycle's seed,
 *     `buyStackAcresFeed` buys a shipment, `clearStackAcresUnit` pays a muck
 *     fee. All sinks.
 *   * ONE PAYS. `harvestStackAcres`, under the flat daily ceiling, net of
 *     Land Maintenance. Nothing else here may credit Gold.
 *
 * Every refund goes through `refundGold` rather than calling
 * `creditGoldByProfile` directly, so that the credit function has exactly TWO
 * call sites in this file: the refund helper, and the harvest payout. That is
 * not a style preference -- it is what lets a test state the real invariant
 * ("there is one payout") instead of counting call sites that grow with every
 * new refund. A new direct `creditGoldByProfile` is a new faucet and is the
 * change to stop over.
 *
 * A StackAcres unit is a *guaranteed* win -- nothing here can lose your seed,
 * animals go hungry but never die -- so the ordering discipline every staked
 * service restates still applies:
 *
 *   1. **The money leaves the purse before the thing it pays for exists.**
 *      Buying capacity, stock, seed or feed debits Gold before the write
 *      lands. Either write failing refunds.
 *   2. **Payment lands only after the version-guarded harvest write is
 *      confirmed.** collectStackAcresUnit returns null on a lost race, a stale
 *      version, or a not-actually-ready row, and null must never pay: the
 *      writer that wins the race is the one that is paid.
 *   3. **Settlement credits the yield snapshotted at stocking, never a
 *      re-read of the catalogue.** A retune between stocking and harvest
 *      gives the player what they agreed to. The per-item VALUE is read live,
 *      because that is the price of produce at the moment it is sold and no
 *      agreement was made about it.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * ONE ORDERING HERE IS DELIBERATELY THE OTHER WAY ROUND, and it is worth
 * naming because it looks like a rule-2 violation. A harvest RESERVES against
 * the day's ceiling before it settles any unit, not after. Settling first
 * would mean a full day is discovered only once the crops are already gone,
 * consuming a harvest and paying nothing for it. The cost of reserving first
 * is that a sweep which then loses a race has over-reserved, so it hands the
 * difference back through `releaseStackAcresExchange`, and the payout is
 * capped at what was actually reserved so the ceiling can never be exceeded
 * in the other direction either.
 *
 * THE MUCK ROLL is the one thing here that is not a pure function of
 * timestamps, and it lives in exactly one place: rollMuck, called once per
 * unit inside the harvest, after the guarded write has confirmed which rows
 * settled. Rolling it anywhere a read can reach would let a player reroll it
 * by pulling to refresh. Bought stock is not rolled at all.
 *
 * THERE IS NO PLOT ANY MORE (see 2026-09-03's CLAUDE.md entry -- "districts
 * hold stock, not plots"). Every action here takes a `unitId` instead of a
 * `plotIndex`, buying a plot is gone, and buying capacity replaces it as the
 * Gold sink that bounds how much of one kind a player can run at once.
 */

/** Refuses a StackAcres request in a way the player can act on. */
export class StackAcresRequestError extends ArcadeRequestError<StackAcresUnitSnapshot[], never> {
  readonly name = "StackAcresRequestError";
}

export interface StackAcresView {
  units: StackAcresUnitSnapshot[];
  profile: PlayerProfile;
  feed: number;
  /** Purchased extra capacity slots, by stock kind. */
  capacity: Partial<Record<StackAcresStock, number>>;
  /** Today's allowance: the flat ceiling, and what is left of it. */
  exchange: StackAcresExchangeState;
  /** Today's Land Maintenance: what the estate costs, and what it has paid. */
  upkeep: StackAcresUpkeepState;
}

function parseUnitId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StackAcresRequestError("Not a real unit.", 400);
  }
  return value;
}

async function snapshots(profileId: string, now: Date): Promise<StackAcresUnitSnapshot[]> {
  return toStackAcresUnitSnapshots(await listStackAcresUnits(profileId), now);
}

async function view(profile: PlayerProfile, now: Date): Promise<StackAcresView> {
  const [rows, feed, capacity, exchanged, upkeepPaid] = await Promise.all([
    listStackAcresUnits(profile.id),
    readStackAcresFeed(profile.id),
    readStackAcresCapacity(profile.id),
    readStackAcresExchanged(profile.id, stackacresExchangeDay(now)),
    readStackAcresUpkeep(profile.id, stackacresUpkeepDay(now)),
  ]);

  return {
    units: toStackAcresUnitSnapshots(rows, now),
    profile,
    feed,
    capacity,
    exchange: exchangeState(exchanged, now),
    // Assessed on every field and pen standing, mucked ones included: a unit
    // waiting to be cleared is still land being held.
    upkeep: upkeepState(rows.length, upkeepPaid),
  };
}

/**
 * Hands back Gold that was just taken for something that then did not happen.
 *
 * THE ONLY REASON THIS EXISTS as a function rather than five inline calls: it
 * keeps `creditGoldByProfile` down to two call sites in this file -- this one
 * and the harvest payout -- so "there is exactly one way Gold is paid out of
 * StackAcres" is a claim a test can hold by reading the source, instead of a
 * count that has to be edited every time a refund is added. See the header.
 *
 * Never throws. A refund is already the failure path; turning it into a
 * second failure would leave the player short AND looking at a different
 * error than the one that actually happened.
 */
async function refundGold(profileId: string, gold: number): Promise<void> {
  if (gold <= 0) return;
  await creditGoldByProfile(profileId, gold).catch(() => null);
}

/**
 * The whole farm, as the client renders it.
 *
 * THERE IS NO STARTING GRANT ANY MORE. There used to be one -- 150 Bushels,
 * handed over on the first read -- because a farm with no Bushels could not
 * stock anything and so could not begin. Seed is bought with Gold now, and
 * every player already has Gold from the daily grant, the streak and the
 * backstop, so the farm needs no faucet of its own to get started. Deleting it
 * removes a credit path rather than converting one, which is the direction
 * this file's header says to prefer.
 */
export async function readStackAcres(token: string, now = new Date()): Promise<StackAcresView> {
  return view(await ensureProfile(token), now);
}

/** How many of `stock` this player may OCCUPY a slot with at once right now
 *  (working or mucked -- see `countOccupiedStackAcresUnits`'s own comment
 *  for why mucked still counts). */
async function capacityFor(profileId: string, stock: StackAcresStock): Promise<number> {
  const capacity = await readStackAcresCapacity(profileId);
  return capFor(capacity[stock] ?? 0);
}

/**
 * Buys one extra capacity slot for a kind, at the flat per-kind price, IN ANY
 * ORDER -- there is nothing to unlock first, the same reasoning that
 * flattened the old plot ladder. Replaces `buyStackAcresPlot`.
 */
export async function expandStackAcresCapacity(
  token: string,
  stockInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(stockInput)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = stockInput;
  const def = STACKACRES_CATALOGUE[stock];
  const profile = await ensureProfile(token);

  const capacity = await readStackAcresCapacity(profile.id);
  const extraSlots = capacity[stock] ?? 0;
  if (extraSlots >= STACKACRES_MAX_EXTRA_CAP) {
    throw new StackAcresRequestError(`Every ${def.label} slot is already expanded.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const price = stackacresCapacityPrice(stock);
  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`Expanding ${def.label} capacity costs ${price.toLocaleString()} Gold.`, 400);
  }

  const next = await adjustStackAcresCapacity(profile.id, stock, 1);
  if (next === null) {
    // Lost the race against the DB's own 0..3 bound (another tab expanded
    // this same kind between the read above and now): refund.
    await refundGold(profile.id, price);
    throw new StackAcresRequestError(`Every ${def.label} slot is already expanded.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/**
 * Buys an animal or a crop OUTRIGHT, with Gold.
 *
 * The difference from stockStackAcres, and the reason both exist: a sowing
 * buys ONE CYCLE and is consumed by its own harvest, so it is gone once
 * collected and you buy another. Bought stock is permanent and re-sows itself
 * forever -- you own the cow, you do not own one cow-cycle. That is what makes
 * 60,000 Gold and 1,200 Gold honest prices for the same animal: they are not
 * the same thing. With one currency the gap between them is finally legible on
 * the shelf, which it never was while one price was in Bushels.
 *
 * Cash on the counter. Nothing here is financed, there is no balance and no
 * credit -- the Gold either leaves the purse now or the sale does not happen.
 *
 * Rule 1 throughout: the Gold is debited before the unit exists, and every
 * failure path after that refunds it. A cap violation is caught before the
 * debit ever happens; the database's own trigger is the real guard against a
 * race.
 */
export async function buyStackAcresStock(
  token: string,
  input: { stock: string },
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const price = stackacresStockPrice(stock);
  const profile = await ensureProfile(token);

  const [occupied, cap] = await Promise.all([
    countOccupiedStackAcresUnits(profile.id, stock),
    capacityFor(profile.id, stock),
  ]);
  if (occupied >= cap) {
    throw new StackAcresRequestError(
      `You already have ${cap} ${def.label}${cap === 1 ? "" : "s"} going. Retire or clear one first, or expand capacity.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`A ${def.label} costs ${price.toLocaleString()} Gold.`, 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const produce = STACKACRES_YIELDS[stock];
  try {
    await createStackAcresUnit(profile.id, {
      stock,
      // The one-cycle seed cost is what lands in `stake`, notionally: nothing
      // was paid at that price here. The column is required for a working row
      // and carries `check (stake > 0)`, so writing the catalogue's own figure
      // keeps the ledger describing what is standing there, and `permanent`
      // below is what tells a dashboard the difference. The outright price is
      // deliberately NOT stored: it is spent, gone, and re-derivable from the
      // stock whenever it is needed.
      stake: def.seedCost,
      yieldQuantity: produce.quantity,
      startedAt: now,
      readyAt: new Date(now.getTime() + def.durationMs),
      lastFedAt: def.hungerMs === null ? null : now,
      permanent: true,
    });
  } catch (error) {
    // The database refused (the trigger's own cap/ceiling race) or threw for
    // any other reason, and nothing came into existence, so the player must
    // not have paid for it.
    await refundGold(profile.id, price);
    throw error;
  }

  return view(debited, now);
}

/**
 * Sows one cycle of a crop or an animal, with Gold.
 *
 * A SINK, and the cheapest way into the farm: the seed price is a fiftieth of
 * what the same tier costs outright (see STACKACRES_SEED_MULTIPLE_TO_OWN),
 * and it buys exactly one harvest rather than an animal that keeps going.
 *
 * The yield and readiness written here are snapshots (rule 3): the catalogue
 * is read exactly once, now, and never again for this unit.
 */
export async function stockStackAcres(
  token: string,
  input: { stock: string },
  now = new Date(),
): Promise<StackAcresView> {
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const profile = await ensureProfile(token);

  // The caps are what bound this faucet; see lib/stackacres/catalogue.ts.
  // Checked here for a clean 409, enforced for real by the advisory-locked
  // trigger in the migration, which two racing requests cannot squeeze past.
  const [occupied, cap] = await Promise.all([
    countOccupiedStackAcresUnits(profile.id, stock),
    capacityFor(profile.id, stock),
  ]);
  if (occupied >= cap) {
    throw new StackAcresRequestError(
      `You already have ${cap} ${def.label}${cap === 1 ? "" : "s"} going. Collect from or clear one first, or expand capacity.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the seed is paid for first. A null here is an empty purse or a
  // lost race, and both mean nothing was sown.
  const produce = STACKACRES_YIELDS[stock];
  const debited = await spendGoldByProfile(profile.id, def.seedCost);
  if (!debited) {
    throw new StackAcresRequestError(
      `${def.label} seed costs ${def.seedCost.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  try {
    await createStackAcresUnit(profile.id, {
      stock,
      stake: def.seedCost,
      yieldQuantity: produce.quantity,
      startedAt: now,
      readyAt: new Date(now.getTime() + def.durationMs),
      // An animal counts as fed the moment it arrives; a crop never eats.
      lastFedAt: def.hungerMs === null ? null : now,
      permanent: false,
    });
  } catch (error) {
    // The database refused outright -- the trigger raising on a cap race or a
    // ceiling desync arrives HERE as a throw -- and nothing came into
    // existence, so the player must not have paid for it.
    await refundGold(profile.id, def.seedCost);
    throw error;
  }

  return view(debited, now);
}

/**
 * Sends bought stock away. NO REFUND, and the UI has to say so before it asks
 * -- see STACKACRES_RETIRE_REFUND.
 *
 * This is not an undo. It exists because permanent stock holds its slot
 * forever and three permanent cattle fill the cattle cap: without a way out,
 * buying three would lock a player out of ever keeping anything else and the
 * prize would be a trap. Refunding would make owning stock somewhere to park
 * Gold and take it back out again, which is the one shape this subsystem is
 * built not to have.
 */
export async function retireStackAcresStock(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || !unit.permanent) {
    throw new StackAcresRequestError("There is nothing here to retire.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const retired = await retireStackAcresUnit(unit);
  if (!retired) {
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Buys a shipment of feed. Pure sink: Gold out, servings in. */
export async function buyStackAcresFeed(
  token: string,
  itemId: string,
  now = new Date(),
): Promise<StackAcresView> {
  const item = STACKACRES_FEED[itemId];
  if (!item) throw new StackAcresRequestError("No such shipment.", 400);
  const profile = await ensureProfile(token);

  // Rule 1: the Gold leaves before the servings land.
  const debited = await spendGoldByProfile(profile.id, item.cost);
  if (!debited) {
    throw new StackAcresRequestError(
      `A ${item.label} costs ${item.cost.toLocaleString()} Gold.`,
      400,
    );
  }

  try {
    await adjustStackAcresFeed(profile.id, item.servings);
  } catch (error) {
    await refundGold(profile.id, item.cost);
    throw error;
  }

  return view(debited, now);
}

/**
 * Feeds a hungry animal, spending one serving.
 *
 * A hungry unit's clock is frozen, and this is where that is actually made
 * true: ready_at moves forward by however long the animal spent waiting, so
 * the time it was neglected is not silently credited as work. The yield is
 * untouched -- neglect costs you time, never Gold.
 */
export async function feedStackAcres(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "working") {
    throw new StackAcresRequestError("Nothing here eats.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const hungryAt = hungryAtFor(unit);
  const hungrySince = hungryAt ? Date.parse(hungryAt) : NaN;
  const starvedMs = Number.isFinite(hungrySince) ? Math.max(0, now.getTime() - hungrySince) : 0;

  // Rule 1 again, in servings rather than Gold: the feed is spent before the
  // write it pays for. Null is "not enough", which reads exactly like a lost
  // race because it is one.
  const remaining = await adjustStackAcresFeed(profile.id, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const readyAt = Date.parse(unit.readyAt);
  const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + starvedMs);

  let fed: StoredStackAcresUnit | null;
  try {
    fed = await feedStackAcresUnit(unit, now, pushed);
  } catch (error) {
    await adjustStackAcresFeed(profile.id, 1).catch(() => null);
    throw error;
  }
  if (!fed) {
    await adjustStackAcresFeed(profile.id, 1).catch(() => null);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Pays the maintenance fee on a mucked unit, clearing it -- see
 *  clearStackAcresMuck in the store for why this removes the row. */
export async function clearStackAcresUnit(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "mucked" || unit.muckFee === null) {
    throw new StackAcresRequestError("Nothing to clear here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const fee = unit.muckFee;
  const debited = await spendGoldByProfile(profile.id, fee);
  if (!debited) {
    throw new StackAcresRequestError(
      `Clearing this costs ${fee.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let cleared: StoredStackAcresUnit | null;
  try {
    cleared = await clearStackAcresMuck(unit);
  } catch (error) {
    await refundGold(profile.id, fee);
    throw error;
  }
  if (!cleared) {
    await refundGold(profile.id, fee);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/**
 * Decides whether a settled unit needs maintenance. The only randomness in
 * the feature, deliberately reachable from exactly one call site, and only
 * after a guarded write has confirmed a settlement actually happened.
 */
function rollMuck(stock: StackAcresStock): number | null {
  return Math.random() < STACKACRES_MUCK_CHANCE ? STACKACRES_CATALOGUE[stock].muckFee : null;
}

/** What one harvest brought in, as the client renders the toast. */
export interface StackAcresHarvestResult {
  /** How many fields and pens were brought in together. */
  units: number;
  /** Produce gathered, summed per item. */
  tally: { item: StackAcresItem; quantity: number }[];
  /** Every unit's yield at today's value, before any synergy. */
  gross: number;
  /** Which Bountiful Harvest applied, if any, and what it multiplied by. */
  bounty: BountifulHarvest;
  /** Gold the synergy added. Zero when none applied. */
  bonus: number;
  /** Land Maintenance taken out of this harvest. */
  upkeep: number;
  /** What actually landed in the player's balance. */
  gold: number;
  /** How many of the settled units came up weather-worn. */
  mucked: number;
}

/**
 * Brings in every ready field and pen at once, values the lot in Gold and pays
 * it in a single step.
 *
 * THIS IS THE WHOLE HARVEST LOOP NOW. It used to be three acts -- collect
 * produce into a barn, sell produce for Bushels at the store, queue at an
 * exchange window to turn Bushels into Gold -- and it is one. What a sweep is
 * worth is decided by `settleHarvest` in lib/stackacres/harvest.ts, which is
 * pure and where the arithmetic is tested.
 *
 * IT IS A SWEEP RATHER THAN A UNIT, and that is what makes a synergy possible
 * at all: Bountiful Harvest is a property of what was gathered TOGETHER, so it
 * cannot be expressed one row at a time. Tapping a single unit still works --
 * the client passes that one id -- and gets a one-unit sweep, which by
 * construction earns no synergy, because three is the fewest a bonus considers.
 *
 * ALLOWED WHILE BANNED, same posture as resigning a duel: it only returns
 * produce already grown, and stranding a crop inside a suspended account's
 * farm forever is a punishment nobody designed.
 *
 * THE ORDER, which is deliberately not rule 2's:
 *
 *   1. Price the sweep, net of the day's remaining Land Maintenance.
 *   2. **Reserve the net against today's flat ceiling, BEFORE settling
 *      anything.** A full day has to refuse while the crops are still
 *      standing; discovering it afterwards would consume a harvest and pay
 *      nothing for it. Nothing has been touched at this point, so a refusal
 *      costs the player only the tap.
 *   3. Settle each unit under its own version guard. A unit that loses its
 *      race is simply not in the sweep -- null never pays.
 *   4. Re-price against what actually settled, hand back the over-reservation,
 *      and cap the payout at what was reserved so the ceiling cannot be
 *      exceeded from the other direction either.
 *   5. Credit once, record the maintenance, write the ledger.
 */
export async function harvestStackAcres(
  token: string,
  input: { unitIds?: readonly string[] } = {},
  now = new Date(),
): Promise<StackAcresView & { harvest: StackAcresHarvestResult }> {
  const profile = await ensureProfile(token);
  const rows = await listStackAcresUnits(profile.id);

  // A named set is the single-tap path; no set at all is "bring in everything
  // that is ready". Naming a unit that is not ready is answered with the
  // specific reason, because that tap was aimed at that unit and "nothing is
  // ready" would be a lie about it.
  const named = input.unitIds && input.unitIds.length > 0 ? new Set(input.unitIds) : null;
  if (named) {
    for (const unitId of named) {
      const row = rows.find((candidate) => candidate.id === unitId);
      if (!row || row.status !== "working") {
        throw new StackAcresRequestError("Nothing to collect here.", 404, {
          round: toStackAcresUnitSnapshots(rows, now),
        });
      }
      if (isStackAcresUnitHungry(row, now)) {
        throw new StackAcresRequestError("Feed them first.", 409, {
          round: toStackAcresUnitSnapshots(rows, now),
        });
      }
      // The client's clock is decoration; this is the answer that counts, and
      // the store's own ready_at guard backs it even if this check is raced.
      if (!isStackAcresUnitReady(row, now)) {
        throw new StackAcresRequestError("Not ready yet.", 409, {
          round: toStackAcresUnitSnapshots(rows, now),
        });
      }
    }
  }

  const ready = rows.filter(
    (row) => (!named || named.has(row.id)) && isStackAcresUnitReady(row, now),
  );
  if (ready.length === 0) {
    throw new StackAcresRequestError("Nothing is ready yet.", 409, {
      round: toStackAcresUnitSnapshots(rows, now),
    });
  }

  const day = stackacresExchangeDay(now);
  const upkeepPaid = await readStackAcresUpkeep(profile.id, day);
  // Assessed on everything standing, mucked units included: a unit waiting to
  // be cleared is still land being held.
  const upkeepDue = stackacresUpkeepDue(rows.length, upkeepPaid);

  const candidateOf = (row: StoredStackAcresUnit): HarvestCandidate => ({
    unitId: row.id,
    stock: row.stock,
    // Rule 3: the snapshot taken at stocking, never a re-read of the catalogue.
    yieldQuantity: row.yieldQuantity,
  });

  const planned = settleHarvest(ready.map(candidateOf), upkeepDue);

  // Step 2. A sweep whose whole value is eaten by maintenance reserves
  // nothing, and must not: the RPC raises on a non-positive amount on purpose,
  // and there is genuinely no Gold leaving the farm to account for.
  let reserved = 0;
  if (planned.net > 0) {
    const taken = await reserveStackAcresExchange(
      profile.id,
      day,
      planned.net,
      STACKACRES_GOLD_CEILING,
    );
    if (taken === null) {
      // Hitting the ceiling is the feature working, not a fault, so it reads
      // as a closing time rather than an error -- and nothing was settled, so
      // every crop is still standing and still ready tomorrow.
      const state = exchangeState(await readStackAcresExchanged(profile.id, day), now);
      throw new StackAcresRequestError(
        state.remaining > 0
          ? `This farm can send out ${state.remaining.toLocaleString()} more Gold today, and that harvest is worth ${planned.net.toLocaleString()}. Bring in less, or come back after midnight UTC.`
          : "This farm has sent out all the Gold it can today. Everything keeps until midnight UTC.",
        409,
        { round: toStackAcresUnitSnapshots(rows, now) },
      );
    }
    reserved = planned.net;
  }

  // Step 3. Bought stock never mucks and never leaves: the animal stays and
  // starts its next cycle the moment you take what it made. Muck is the cost
  // of turning ground over between sowings, and there is no gap between
  // sowings here to charge for.
  const settled: StoredStackAcresUnit[] = [];
  let mucked = 0;
  for (const row of ready) {
    const muckFee = row.permanent ? null : rollMuck(row.stock);
    const restartReadyAt = row.permanent
      ? new Date(now.getTime() + STACKACRES_CATALOGUE[row.stock].durationMs)
      : null;
    const done = await collectStackAcresUnit(row, now, muckFee, restartReadyAt);
    // Rule 2: a lost race did not happen here; whoever won it was paid instead.
    if (!done) continue;
    settled.push(row);
    if (muckFee !== null) mucked += 1;
  }

  if (settled.length === 0) {
    await releaseReservation(profile.id, day, reserved);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Step 4. Re-price against what actually settled. Capped at what was
  // reserved: removing a unit can in principle change which synergy applies,
  // and the ceiling must hold whichever way that lands.
  const actual: HarvestSettlement =
    settled.length === ready.length ? planned : settleHarvest(settled.map(candidateOf), upkeepDue);
  const gold = Math.min(actual.net, reserved);
  await releaseReservation(profile.id, day, reserved - gold);

  // Step 5. The credit lands only after every guarded write above is durable,
  // so this one never refunds -- a retry could pay twice, which is the one
  // outcome worth avoiding more than a missing credit. Logged loudly, same
  // reasoning as ante-up-service.ts's payOutWin.
  let paid: PlayerProfile | null = null;
  if (gold > 0) {
    try {
      paid = await creditGoldByProfile(profile.id, gold);
    } catch (error) {
      console.error("stackacres.harvest_credit_failed", {
        profileId: profile.id,
        day,
        units: settled.length,
        gold,
        error,
      });
    }
  }

  // Recorded after the credit, and never allowed to throw: the harvest is
  // already durable and already paid NET of this fee, so failing here must not
  // turn it into an error response -- and leaving the day looking unpaid would
  // bill the player for the same day twice.
  if (actual.upkeepCharged > 0) {
    await recordStackAcresUpkeep(profile.id, day, actual.upkeepCharged);
  }

  for (const line of actual.lines) {
    const row = settled.find((candidate) => candidate.id === line.unitId);
    if (!row) continue;
    await recordStackAcresHarvest({
      profileId: profile.id,
      unitId: line.unitId,
      stock: line.stock,
      stake: row.stake,
      // The line's own gross, before the sweep's synergy and before
      // maintenance: what this unit grew, which is the question a per-unit
      // ledger row is asked. The sweep's totals are in the response.
      payout: line.gold,
      startedAt: row.startedAt,
      collectedAt: now.toISOString(),
      // Bought stock spends nothing per cycle, so `stake` above is notional
      // for these rows. The flag is what lets a dashboard tell the difference
      // rather than counting a seed price nobody paid.
      permanent: row.permanent,
    });
  }

  return {
    ...(await view(paid ?? (await ensureProfile(token)), now)),
    harvest: {
      units: settled.length,
      tally: harvestTally(actual),
      gross: actual.gross,
      bounty: actual.bounty,
      bonus: actual.bonus,
      upkeep: actual.upkeepCharged,
      gold,
      mucked,
    },
  };
}

/**
 * Hands back allowance a sweep reserved and then did not use. Best-effort by
 * construction -- the player has already been paid correctly either way, and
 * the only casualty of a failure is reaching today's ceiling sooner than they
 * should have.
 */
async function releaseReservation(profileId: string, day: string, gold: number): Promise<void> {
  if (gold <= 0) return;
  await releaseStackAcresExchange(profileId, day, gold).catch((error) => {
    console.error("stackacres.allowance_release_failed", { profileId, day, gold, error });
    return null;
  });
}

/** Maps a thrown error to the response every StackAcres route sends. */
export function toStackAcresErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That could not be worked.");
}

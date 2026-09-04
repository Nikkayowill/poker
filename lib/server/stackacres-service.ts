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
  isStackAcresUnitDry,
  isStackAcresUnitHungry,
  isStackAcresUnitReady,
  thirstyAtFor,
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
import { emptyMuseumRegistry, museumDiscoveryBonus, type MuseumRegistry } from "@/lib/stackacres/museum";
import {
  STACKACRES_SECTORS,
  isSectorUnlocked,
  sectorClearCheck,
  sectorLabel,
  unlockedPlotCount,
  unlockedSectors,
  type SectorId,
} from "@/lib/stackacres/sectors";
import { ZONE_IDS, type ZoneId } from "@/lib/stackacres/zones";
import { stockZone } from "@/lib/stackacres/world";
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
  markStackAcresDonated,
  readStackAcresCapacity,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresMuseum,
  raiseStackAcresUpkeep,
  readStackAcresSectors,
  readStackAcresUpkeep,
  recordStackAcresHarvest,
  recordStackAcresSectorCleared,
  releaseStackAcresExchange,
  reserveStackAcresExchange,
  retireStackAcresUnit,
  waterStackAcresUnit,
  type StoredStackAcresUnit,
} from "./stackacres-store";
import {
  claimStackAcresIntent,
  completeStackAcresIntent,
  releaseStackAcresIntent,
} from "./stackacres-intent-store";
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
 * RAY'S MUSEUM rides inside that one payout rather than beside it. The first
 * time this player ever harvests a given item, `harvestStackAcres` folds a
 * one-time "New Discovery!" bonus into the SAME Gold figure the sweep already
 * pays -- see the museum section down there. It is bigger, not a second
 * payout, and it is reserved against the same daily ceiling as everything
 * else, so it does not reopen the "ONE PAYS" invariant this file is built
 * around.
 *
 * LAND. Three of the four districts start under wild growth and are cleared
 * once, with Gold, for good (`clearStackAcresSector`). Keeping cleared land
 * then costs a daily fee that compounds with the number of slots the player
 * keeps -- taken out of what a harvest pays and clamped at it, so it can
 * leave a harvest worth nothing and can never reach a balance. Curve and
 * reasoning in lib/stackacres/upkeep.ts.
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
  /** Ray's Museum: which produce items this player has ever donated. Total
   *  over every item, never partial -- see emptyMuseumRegistry. */
  museum: MuseumRegistry;
  /**
   * Land the player may work. DERIVED, not just the stored clear list -- see
   * `unlockedSectors` in lib/stackacres/sectors.ts, which also counts any
   * district they already keep stock in. The client draws everything else as
   * wild ground.
   */
  sectors: SectorId[];
  /** Today's Land Maintenance: what it is charged on, what is owed, and what
   *  the next harvest will be docked. */
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

/** Every donation flag for a player, overlaid onto a fresh registry so a
 *  legacy or partial row never leaves an item undefined. */
async function museumView(profileId: string): Promise<MuseumRegistry> {
  const donated = await readStackAcresMuseum(profileId);
  const registry = { ...emptyMuseumRegistry() } as Record<string, boolean>;
  for (const itemId of donated) {
    if (itemId in registry) registry[itemId] = true;
  }
  return registry as MuseumRegistry;
}

async function view(profile: PlayerProfile, now: Date): Promise<StackAcresView> {
  const day = stackacresExchangeDay(now);
  const [rows, feed, capacity, exchanged, cleared, upkeepPaid, museum] = await Promise.all([
    listStackAcresUnits(profile.id),
    readStackAcresFeed(profile.id),
    readStackAcresCapacity(profile.id),
    readStackAcresExchanged(profile.id, day),
    readStackAcresSectors(profile.id),
    readStackAcresUpkeep(profile.id, day),
    museumView(profile.id),
  ]);

  const units = toStackAcresUnitSnapshots(rows, now);
  const sectors = unlockedSectors(cleared, units);
  return {
    units,
    profile,
    feed,
    capacity,
    exchange: exchangeState(exchanged, now),
    museum,
    sectors,
    // Reported, never charged, from here: a read must not move a purse. The
    // charge happens inside a harvest, netted out of what it pays.
    upkeep: upkeepState(unlockedPlotCount(sectors, capacity), upkeepPaid),
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
 * Everything any action can add to the view. Exactly ONE action returns
 * anything beyond the farm itself now -- a harvest, which has to say what it
 * brought in and what it paid -- which is why a replayed intent only has to
 * remember this much (see `replayDelta`).
 */
export type StackAcresActionResult = StackAcresView & {
  harvest?: unknown;
};

/**
 * The part of a result a duplicate has to be told a second time.
 *
 * Never the view: a replay is answered with a freshly read one, so a duplicate
 * can only ever hand back numbers at least as current as the original did.
 * Storing the view instead would mean a request replayed ten minutes later
 * repainted the farm as it looked ten minutes ago.
 */
function replayDelta(result: StackAcresActionResult): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  if (result.harvest !== undefined) delta.harvest = result.harvest;
  return Object.keys(delta).length > 0 ? delta : null;
}

/**
 * Runs one action at most once per intent.
 *
 * `key` is the client's own name for what it is trying to do, and this is the
 * only thing standing between a duplicated request and a double spend for the
 * four actions that CREATE something -- `stock`, `buy-stock`, `buy-feed` and
 * `expand-capacity` have no row to version-guard, so nothing else can tell a
 * duplicate from a second deliberate purchase. See
 * ./stackacres-intent-store.ts for why the other six were already safe.
 *
 * `key` is optional, and a request without one runs exactly as it always did.
 * That is deliberate: the guard belongs to callers who can name their intent,
 * and an older client (or a phone that reloaded mid-deploy) must not start
 * failing because it does not send one.
 *
 * Three outcomes, and NONE of them is a refusal -- a duplicate that sounds
 * like a denial is the bug this exists to avoid:
 *
 *   * **fresh** -- nobody has claimed this intent. Run it, then record the
 *     small delta a twin would need. A throw releases the claim, because a
 *     refusal did not happen and the player's next press must be a real
 *     attempt.
 *   * **replay** -- the twin already finished. Answer with a fresh view plus
 *     the delta it recorded, so the duplicate reads exactly like the original
 *     succeeding.
 *   * **in-flight** -- the twin is still running. Answer with the farm as it
 *     stands; the client's own clock re-reads a second later and picks up
 *     whatever the twin lands.
 */
export async function runStackAcresAction(
  token: string,
  key: string | null,
  action: string,
  run: () => Promise<StackAcresActionResult>,
  now = new Date(),
): Promise<StackAcresActionResult> {
  if (!key) return run();

  const profile = await ensureProfile(token);
  const claim = await claimStackAcresIntent(profile.id, key, action, now.getTime());
  if (claim.kind === "replay") return { ...(await view(profile, now)), ...(claim.result ?? {}) };
  if (claim.kind === "in-flight") return view(profile, now);

  try {
    const result = await run();
    await completeStackAcresIntent(profile.id, key, replayDelta(result));
    return result;
  } catch (error) {
    await releaseStackAcresIntent(profile.id, key);
    throw error;
  }
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

/* ------------------------------------------------------------------ */
/* Land: what is cleared, and what keeping it costs                    */
/* ------------------------------------------------------------------ */

/**
 * Reads the land a player may work and what they own on it. A PURE READ:
 * nothing here moves a purse.
 *
 * IT USED TO CHARGE. The Bushel version settled the day's fee here, off every
 * mutating action, and `landGate` then refused to let an unpaid farm grow.
 * Both are gone with the second currency, and the reason is worth writing
 * down rather than rediscovering:
 *
 *   * **The fee is netted out of a harvest now** (see lib/stackacres/harvest.ts
 *     and lib/stackacres/upkeep.ts), clamped at what that harvest is worth. It
 *     cannot reach a balance, so there is nothing for a gate to protect
 *     against and no arrears to chase.
 *   * **Gating growth on an unpaid bill achieved nothing once that was true.**
 *     The gate existed because a Bushel debit could go unpaid while the farm
 *     kept earning through other paths. A farm nobody is harvesting produces
 *     no Gold at all, so there is nothing to sink and nobody to press -- and
 *     dropping it removes the one shape this fee must never have, a debt a
 *     player cannot work their way out of.
 *
 * The sectors and units are handed back together rather than read separately,
 * and that is not premature tidiness: every caller needs both a line later
 * (which land is open, how much stock is going), and re-reading them made the
 * hot stocking path do four queries where two will do.
 */
async function readLand(
  profileId: string,
): Promise<{ sectors: SectorId[]; units: StoredStackAcresUnit[] }> {
  const [cleared, units] = await Promise.all([
    readStackAcresSectors(profileId),
    listStackAcresUnits(profileId),
  ]);
  return { sectors: unlockedSectors(cleared, units), units };
}

/** Refuses an action aimed at land nobody has cleared yet. The client hides
 *  these controls entirely (a locked sector paints no pens to tap), so this
 *  is the guard against a hand-rolled request rather than a UI state. */
function requireOpenSector(sectors: readonly SectorId[], zone: ZoneId, what: string): void {
  if (isSectorUnlocked(zone, sectors)) return;
  throw new StackAcresRequestError(
    `${sectorLabel(zone)} is still under wild growth. Clear the land before you keep ${what} there.`,
    409,
  );
}

/**
 * Clears a sector: the one-off Gold price of turning wild ground into land
 * you can farm.
 *
 * A pure Gold SINK, permanent, and never refunded once the row lands -- the
 * same category as `expandStackAcresCapacity`, and the reason the asymmetry
 * note at the top of this file is untouched by it.
 *
 * Rule 1 the whole way down: the requirements are checked before a piece of
 * Gold moves, the Gold leaves before the land is recorded, and every failure
 * after the debit refunds. The permanent thing here is a single row with the
 * (profile, sector) primary key as its idempotency guard, so two tabs
 * clearing the same land together pay for it once and the loser is refunded.
 */
export async function clearStackAcresSector(
  token: string,
  sectorInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  if (!(ZONE_IDS as readonly string[]).includes(sectorInput)) {
    throw new StackAcresRequestError("There is no such place.", 400);
  }
  const sector = sectorInput as SectorId;
  const def = STACKACRES_SECTORS[sector];
  const profile = await ensureProfile(token);

  // Owing rent on the land you have is a reason not to be sold more of it,
  // and this settles the bill on the way past -- and hands over the two
  // answers the requirement check is about to ask for.
  const { sectors, units } = await readLand(profile.id);
  const check = sectorClearCheck(sector, { unlocked: sectors, unitCount: units.length });
  if (check.alreadyOpen) {
    throw new StackAcresRequestError(`${sectorLabel(sector)} is already yours.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!check.ok) {
    // The first thing still missing, worded exactly as the modal's own
    // checklist words it -- both read the same `sectorClearCheck`.
    const missing = check.requirements.find((requirement) => !requirement.met);
    throw new StackAcresRequestError(missing?.label ?? "Not yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, def.clearCost);
  if (!debited) {
    throw new StackAcresRequestError(
      `Clearing ${sectorLabel(sector)} costs ${def.clearCost.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let recorded: boolean;
  try {
    recorded = await recordStackAcresSectorCleared(profile.id, sector, now);
  } catch (error) {
    await refundGold(profile.id, def.clearCost);
    throw error;
  }
  if (!recorded) {
    // Another tab cleared it between the check above and now. The land is
    // theirs either way; this request must not have been charged for it.
    await refundGold(profile.id, def.clearCost);
    throw new StackAcresRequestError(`${sectorLabel(sector)} is already yours.`, 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
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

  // Buying room is taking on more land, so both land rules apply: the ground
  // has to be cleared, and the fee on what is already kept has to be settled.
  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);

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

  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);

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
      // Sowing waters the ground; an animal never runs dry.
      lastWateredAt: def.thirstMs === null ? null : now,
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

  const land = await readLand(profile.id);
  requireOpenSector(land.sectors, stockZone(stock), `${def.label}s`);

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
      // And a crop goes into watered ground; an animal has no soil to dry out.
      lastWateredAt: def.thirstMs === null ? null : now,
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

/**
 * Waters a dry crop, spending nothing.
 *
 * The mirror of `feedStackAcres` on the crop track, and the same guarantee:
 * ready_at moves forward by however long the soil stood dry, so neglected
 * time is never credited as work, and the yield is untouched.
 *
 * It is deliberately FREE. Every money-ordering rule at the top of this file
 * is about a debit and the thing it pays for, and watering has neither -- it
 * costs attention, which is the resource this loop is actually asking for.
 * That is why there is no spend to reverse when the guarded write loses its
 * race: a lost race here is just a 409, not a refund.
 *
 * Watering a crop that is not dry is refused rather than treated as a
 * top-up. Allowing it would let a player push ready_at forward by zero all
 * day, which does nothing, and reset the thirst clock for free, which is the
 * whole tending loop -- so a drink only counts once the ground actually
 * needs it.
 */
export async function waterStackAcres(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<StackAcresView> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "working") {
    throw new StackAcresRequestError("Nothing here to water.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const thirstyAt = thirstyAtFor(unit);
  if (!thirstyAt) {
    throw new StackAcresRequestError("That does not grow in soil.", 400, {
      round: await snapshots(profile.id, now),
    });
  }
  // Wet ground is a NO-OP, not a refusal, and the distinction matters on a
  // phone. `withLocalClock` decides dryness from the device's own clock, so a
  // handset running a few minutes fast paints a faded crop with a Water button
  // over ground the server still calls wet -- and an error banner for pressing
  // the button the app just drew is a bug the player cannot act on.
  //
  // Returning early rather than watering is what keeps the guard: nothing is
  // written, so the thirst clock is not reset and there is no free top-up to
  // farm. It costs nothing to allow because watering costs nothing.
  if (!isStackAcresUnitDry(unit, now)) return view(profile, now);

  const driedAt = Date.parse(thirstyAt);
  const dryMs = Number.isFinite(driedAt) ? Math.max(0, now.getTime() - driedAt) : 0;
  const readyAt = Date.parse(unit.readyAt);
  const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + dryMs);

  const watered = await waterStackAcresUnit(unit, now, pushed);
  if (!watered) {
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
  /** What actually landed in the player's balance. Includes any Ray's Museum
   *  discovery bonus below -- there is no separate figure for it. */
  gold: number;
  /** How many of the settled units came up weather-worn. */
  mucked: number;
  /** Items donated to Ray's Museum for the very first time in this sweep,
   *  and what each paid. Empty when nothing here was new -- most harvests. */
  discoveries: { item: StackAcresItem; bonus: number }[];
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
 *   5. Ray's Museum: fold in any first-ever discovery bonus, reserved against
 *      the same ceiling and dropped (never queued) if there is no room left.
 *   6. Credit once, record the maintenance, write the ledger.
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
  const [upkeepPaid, cleared, capacity] = await Promise.all([
    readStackAcresUpkeep(profile.id, day),
    readStackAcresSectors(profile.id),
    readStackAcresCapacity(profile.id),
  ]);
  // Charged on SLOTS ON CLEARED GROUND, not on what is standing in them.
  // Billing what is planted would let a player clear every district, leave it
  // empty and pay nothing for the room -- which is the one-way ratchet the fee
  // exists to prevent. See lib/stackacres/upkeep.ts.
  const upkeepDue = stackacresUpkeepDue(
    unlockedPlotCount(unlockedSectors(cleared, toStackAcresUnitSnapshots(rows, now)), capacity),
    upkeepPaid,
  );

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
  const produceGold = Math.min(actual.net, reserved);
  await releaseReservation(profile.id, day, reserved - produceGold);

  // Step 5. Ray's Museum: a first-ever donation is automatic, not a player
  // action, and folds its "New Discovery!" bonus straight into this same
  // Gold credit -- there is no second payout path here, only a bigger one,
  // so ONE PAYS (see the module doc) still holds. markStackAcresDonated is
  // the idempotency guard (the (profile, item) pair is a primary key), and
  // only the call that actually donates an item for the first time ever pays
  // for it; a later harvest of that same item, by this player or a replayed
  // request, reports false and adds nothing. `quantity` is the item's total
  // across the WHOLE sweep, since a sweep can bring several units of a
  // freshly-discovered item home together. Reserved against today's ceiling
  // exactly like the rest of the sweep, and simply dropped -- not queued,
  // not partially paid -- when there is no room left: the discovery itself
  // still registers, since that costs nothing, but the bonus is not owed to
  // tomorrow. Best-effort like the ledger write below: the harvest itself is
  // already settled and paid, and a museum hiccup must not turn that into an
  // error response.
  let museumBonus = 0;
  const discoveries: { item: StackAcresItem; bonus: number }[] = [];
  for (const { item, quantity } of harvestTally(actual)) {
    try {
      const firstDiscovery = await markStackAcresDonated(profile.id, item);
      if (!firstDiscovery) continue;
      const bonus = museumDiscoveryBonus(item, quantity);
      const afterBonus = await reserveStackAcresExchange(profile.id, day, bonus, STACKACRES_GOLD_CEILING);
      if (afterBonus === null) continue;
      museumBonus += bonus;
      discoveries.push({ item, bonus });
    } catch (error) {
      console.error("stackacres.museum_donation_failed", { profileId: profile.id, item, quantity, error });
    }
  }
  const gold = produceGold + museumBonus;

  // Step 6. The credit lands only after every guarded write above is durable,
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
  // RAISE-TO, not add. The day's bill is not fixed when the day starts -- buy
  // a capacity slot at noon and it goes up -- so the ledger holds what has
  // been paid TOWARD today and each charge settles to a new total. Adding
  // would double-charge the morning every afternoon. False is "another tab
  // already got there", which is not an error: it settled the same day.
  if (actual.upkeepCharged > 0) {
    await raiseStackAcresUpkeep(profile.id, day, upkeepPaid + actual.upkeepCharged).catch(
      (error) => {
        console.error("stackacres.upkeep_record_failed", { profileId: profile.id, day, error });
        return false;
      },
    );
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
      discoveries,
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

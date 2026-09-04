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
import {
  BUSHELS,
  STACKACRES_ITEM_CATALOGUE,
  STACKACRES_STARTING_BUSHELS,
  STACKACRES_YIELDS,
  isStackAcresItem,
  itemLabel,
  type StackAcresItem,
} from "@/lib/stackacres/items";
import {
  STACKACRES_GOLD_CEILING,
  STACKACRES_MAX_EXCHANGE_BUSHELS,
  exchangeState,
  goldForBushels,
  stackacresExchangeDay,
  type StackAcresExchangeState,
} from "@/lib/stackacres/exchange";
import { stackacresStockPrice } from "@/lib/stackacres/market";
import {
  STACKACRES_SECTORS,
  isSectorUnlocked,
  landUpkeepDue,
  sectorClearCheck,
  sectorLabel,
  unlockedPlotCount,
  unlockedSectors,
  upkeepState,
  type SectorId,
  type StackAcresUpkeepState,
} from "@/lib/stackacres/sectors";
import { ZONE_IDS, type ZoneId } from "@/lib/stackacres/zones";
import { stockZone } from "@/lib/stackacres/world";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  adjustStackAcresCapacity,
  adjustStackAcresFeed,
  adjustStackAcresInventory,
  clearStackAcresMuck,
  collectStackAcresUnit,
  countOccupiedStackAcresUnits,
  createStackAcresUnit,
  feedStackAcresUnit,
  getStackAcresUnit,
  grantStartingBushels,
  listStackAcresUnits,
  readStackAcresCapacity,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresInventory,
  readStackAcresSectors,
  readStackAcresUpkeep,
  raiseStackAcresUpkeep,
  recordStackAcresHarvest,
  recordStackAcresSectorCleared,
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
 * Everything between a StackAcres request and the player's purses.
 *
 * TWO CURRENCIES, and which is which is the whole safety story:
 *
 *   * **Bushels** are the farm's own money. Seed, feed and muck are priced in
 *     them, produce sells for them, and they never leave the StackAcres. A bug
 *     in any of it costs a save state, not money.
 *   * **Gold** moves in exactly FOUR places, and the asymmetry between them
 *     is the whole safety story. THREE SPEND: `expandStackAcresCapacity` buys
 *     an extra slot for one kind, `buyStackAcresStock` buys an animal or a
 *     crop outright, and `clearStackAcresSector` buys a district's wild
 *     ground outright. ONE PAYS: `exchangeStackAcresBushels`, at the daily
 *     window, under a flat per-player ceiling. Nothing else here may move
 *     Gold.
 *
 *     An earlier version of this comment said there must never be a third
 *     Gold path at all, on the grounds that Gold -> Bushels would let a
 *     player launder Gold through the capped window and back. That reasoning
 *     only holds when the inbound rate is at least as good as the outbound
 *     one. STACKACRES_GOLD_PER_SEED_BUSHEL is 100 against an exchange that
 *     pays 2, so a round trip returns a fraction of what it cost on every
 *     tier -- market.test.ts holds that -- and the outbound ceiling is
 *     untouched. What genuinely must never change is the direction of the
 *     asymmetry: adding a path that PAYS Gold is the thing to stop over.
 *     Adding one that spends it is a sink.
 *
 * LAND. Three of the four districts start under wild growth and are cleared
 * once, with Gold, for good (`clearStackAcresSector`). Keeping cleared land
 * costs a daily fee in BUSHELS that compounds with the number of slots the
 * player keeps (`settleLandUpkeep`, curve in lib/stackacres/sectors.ts) --
 * charged off a mutating action rather than a background job, since nothing
 * in this subsystem has one. It is a soft gate: an unpaid farm can still be
 * harvested, fed, sold from and exchanged, and only GROWING is blocked, so
 * the fee can never be a debt a player cannot work their way out of.
 *
 * A StackAcres unit is a *guaranteed* win -- nothing here can lose your seed,
 * animals go hungry but never die -- so the ordering discipline every staked
 * service restates still applies, now mostly to Bushels:
 *
 *   1. **The money leaves the purse before the thing it pays for exists.**
 *      Buying capacity or stock debits Gold before the write lands; a sowing
 *      debits Bushels before the guarded write; feed debits before the
 *      servings land. Either write failing refunds.
 *   2. **Produce is credited only after the version-guarded harvest write is
 *      confirmed.** collectStackAcresUnit returns null on a lost race, a
 *      stale version, or a not-actually-ready row, and null must never pay:
 *      the writer that wins the race is the one that is paid.
 *   3. **Settlement credits the yield snapshotted at stocking, never a
 *      re-read of the catalogue.** A retune between stocking and harvest
 *      gives the player what they agreed to.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * THE MUCK ROLL is the one thing here that is not a pure function of
 * timestamps, and it lives in exactly one place: rollMuck, called once inside
 * collect, after the guarded write has confirmed which row settled. Rolling it
 * anywhere a read can reach would let a player reroll it by pulling to
 * refresh. Bought stock is not rolled at all -- see collectStackAcres.
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
  /** Produce held, by item id. Excludes Bushels, which get their own field. */
  inventory: Record<string, number>;
  bushels: number;
  /** Today's exchange window: the rate, the flat ceiling, what is left of it. */
  exchange: StackAcresExchangeState;
  /**
   * Land the player may work. DERIVED, not just the stored clear list -- see
   * `unlockedSectors` in lib/stackacres/sectors.ts, which also counts any
   * district they already keep stock in. The client draws everything else as
   * wild ground.
   */
  sectors: SectorId[];
  /** Today's land maintenance: what it is charged on, what is owed, whether
   *  it is settled. The gate on taking on more land. */
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
  const day = stackacresExchangeDay(now);
  const [units, feed, capacity, held, exchanged, cleared, upkeepPaid] = await Promise.all([
    snapshots(profile.id, now),
    readStackAcresFeed(profile.id),
    readStackAcresCapacity(profile.id),
    readStackAcresInventory(profile.id),
    readStackAcresExchanged(profile.id, day),
    readStackAcresSectors(profile.id),
    readStackAcresUpkeep(profile.id, day),
  ]);

  const { [BUSHELS]: bushels = 0, ...inventory } = held;
  const sectors = unlockedSectors(cleared, units);
  return {
    units,
    profile,
    feed,
    capacity,
    inventory,
    bushels,
    exchange: exchangeState(exchanged, now),
    sectors,
    // Reported, never charged, from here: a read must not move a purse. The
    // charge happens in `settleLandUpkeep`, off a mutating action.
    upkeep: upkeepState(unlockedPlotCount(sectors, capacity), upkeepPaid),
  };
}

/**
 * Everything any action can add to the view. Exactly three actions return
 * anything beyond the farm itself, and these are they -- which is why a
 * replayed intent only has to remember this much (see `replayDelta`).
 */
export type StackAcresActionResult = StackAcresView & {
  collected?: unknown;
  sold?: unknown;
  exchanged?: unknown;
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
  if (result.collected !== undefined) delta.collected = result.collected;
  if (result.sold !== undefined) delta.sold = result.sold;
  if (result.exchanged !== undefined) delta.exchanged = result.exchanged;
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
 * The starting grant happens here, on the first read, because a farm with no
 * Bushels cannot stock anything and so cannot begin. It is safe to attempt on
 * every read: the store's INSERT ... ON CONFLICT DO NOTHING means a profile
 * that already has a bushels row is never topped up, even sitting at zero, so
 * a player who spends the grant does not get another by refreshing.
 */
export async function readStackAcres(token: string, now = new Date()): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  await grantStartingBushels(profile.id, STACKACRES_STARTING_BUSHELS);
  return view(profile, now);
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
 * Takes today's land maintenance, at most once per UTC day.
 *
 * ROUTINE, not a button. Called at the top of the actions that touch the land
 * itself -- collecting off it, putting something new on it, buying more room
 * on it, clearing more of it, and taking Gold out through the window -- so a
 * played farm settles its bill within a tap or two of midnight without
 * anybody having to go and pay it. Feeding, watering, selling and clearing
 * muck deliberately do NOT charge: they are tending what is already standing
 * there, and a player has to be able to sell what is in the bag to afford the
 * bill.
 *
 * THE ORDERING IS RULE 1, in Bushels:
 *
 *   1. Only the DIFFERENCE between today's bill and what has already been
 *      paid toward it leaves the barn. The bill is not fixed when the day
 *      starts -- buying a capacity slot at noon raises it -- so this settles
 *      up rather than charging a flat daily amount, and a farm that grows
 *      twice in a day pays the rise twice, never the whole bill twice.
 *   2. Null on that debit is an empty barn, and an empty barn is ARREARS
 *      rather than an error -- the farm keeps running, the day stays part
 *      paid, and `landGate` is what stops the player taking on MORE land
 *      until it is settled. Nothing is ever seized and nothing is ever
 *      destroyed for non-payment; the worst it does is stop you growing.
 *   3. Then the day's total is raised, atomically. False is "somebody else
 *      already got there" -- another tab, or this same request retried -- and
 *      the Bushels go straight back.
 *
 * Only the CURRENT day is ever owed. Yesterday's unpaid bill lapses rather
 * than compounding into a debt a returning player cannot dig out of, which is
 * a deliberate softening: this fee exists to make owning everything a
 * commitment, not to punish somebody for going on holiday.
 */
async function settleLandUpkeep(
  profileId: string,
  now: Date,
): Promise<{ upkeep: StackAcresUpkeepState; sectors: SectorId[]; units: StoredStackAcresUnit[] }> {
  const day = stackacresExchangeDay(now);
  // The sectors and units are handed back rather than kept private, and that
  // is not premature tidiness: every caller that GATES on this then needs the
  // same two answers a line later (which land is open, how much stock is
  // going), and re-reading them made the hot stocking path do four queries
  // where two will do.
  const [cleared, units, capacity, paid] = await Promise.all([
    readStackAcresSectors(profileId),
    listStackAcresUnits(profileId),
    readStackAcresCapacity(profileId),
    readStackAcresUpkeep(profileId, day),
  ]);
  const sectors = unlockedSectors(cleared, units);
  const plots = unlockedPlotCount(sectors, capacity);
  const due = landUpkeepDue(plots);
  // Nothing owed, or today is already settled. The read above can be raced,
  // which is why it only ever short-circuits work -- the raise below is the
  // authority on whether this request is the one that pays.
  const outstanding = due - paid;
  if (outstanding <= 0) return { upkeep: upkeepState(plots, paid), sectors, units };

  const left = await adjustStackAcresInventory(profileId, BUSHELS, -outstanding);
  if (left === null) return { upkeep: upkeepState(plots, paid), sectors, units };

  const claimed = await raiseStackAcresUpkeep(profileId, day, due);
  if (!claimed) {
    await adjustStackAcresInventory(profileId, BUSHELS, outstanding).catch(() => null);
  }
  return { upkeep: upkeepState(plots, due), sectors, units };
}

/**
 * Settles the day's land fee, refuses if it could not be paid, and hands back
 * what the caller is about to need anyway.
 *
 * The gate on GROWING, and only on growing. An unpaid farm can still be
 * harvested, fed, sold from and exchanged -- those are how the Bushels to pay
 * come in, and locking them would be a debt trap rather than a fee.
 */
async function landGate(
  profileId: string,
  now: Date,
): Promise<{ sectors: SectorId[]; units: StoredStackAcresUnit[] }> {
  const { upkeep, sectors, units } = await settleLandUpkeep(profileId, now);
  if (upkeep.settled) return { sectors, units };
  throw new StackAcresRequestError(
    `Land maintenance is due: ${upkeep.outstanding.toLocaleString()} Bushels for the ${upkeep.plots} plots you keep. Sell some produce and it comes off automatically.`,
    409,
    { round: await snapshots(profileId, now) },
  );
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
  const { sectors, units } = await landGate(profile.id, now);
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
    await creditGoldByProfile(profile.id, def.clearCost).catch(() => null);
    throw error;
  }
  if (!recorded) {
    // Another tab cleared it between the check above and now. The land is
    // theirs either way; this request must not have been charged for it.
    await creditGoldByProfile(profile.id, def.clearCost).catch(() => null);
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
  const land = await landGate(profile.id, now);
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
    await creditGoldByProfile(profile.id, price).catch(() => null);
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
 * costs Bushels and is CONSUMED by its own harvest, so it is gone once
 * collected and you buy another. Bought stock costs Gold, is permanent, and
 * re-sows itself forever -- you own the cow, you do not own one cow-cycle.
 * That is what makes 60,000 Gold and 600 Bushels honest prices for the same
 * animal: they are not the same thing.
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

  const land = await landGate(profile.id, now);
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
      // The Bushel seed cost is still what lands in `stake`. Nothing reads it
      // as money any more (payout went inert two migrations ago) and the
      // column is required for a working row, so writing the catalogue's own
      // figure keeps the ledger describing what is standing there. The Gold
      // price is deliberately NOT stored: it is spent, gone, and re-derivable
      // from the stock whenever it is needed.
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
    await creditGoldByProfile(profile.id, price).catch(() => null);
    throw error;
  }

  return view(debited, now);
}

/**
 * Sows a crop or an animal with Bushels.
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

  const land = await landGate(profile.id, now);
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

  // Rule 1: the seed is paid for first. Bushels, not Gold -- a null here is a
  // lost race or an empty purse, and both mean nothing was sown.
  const produce = STACKACRES_YIELDS[stock];
  const paid = await adjustStackAcresInventory(profile.id, BUSHELS, -def.seedCost);
  if (paid === null) {
    throw new StackAcresRequestError(
      `${def.label} seed costs ${def.seedCost.toLocaleString()} Bushels.`,
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
    await adjustStackAcresInventory(profile.id, BUSHELS, def.seedCost).catch(() => null);
    throw error;
  }

  return view(profile, now);
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

/** Buys a shipment of feed. Pure sink: Bushels out, servings in. */
export async function buyStackAcresFeed(
  token: string,
  itemId: string,
  now = new Date(),
): Promise<StackAcresView> {
  const item = STACKACRES_FEED[itemId];
  if (!item) throw new StackAcresRequestError("No such shipment.", 400);
  const profile = await ensureProfile(token);

  // Rule 1: the Bushels leave before the servings land.
  const paid = await adjustStackAcresInventory(profile.id, BUSHELS, -item.cost);
  if (paid === null) {
    throw new StackAcresRequestError(
      `A ${item.label} costs ${item.cost.toLocaleString()} Bushels.`,
      400,
    );
  }

  try {
    await adjustStackAcresFeed(profile.id, item.servings);
  } catch (error) {
    await adjustStackAcresInventory(profile.id, BUSHELS, item.cost).catch(() => null);
    throw error;
  }

  return view(profile, now);
}

/**
 * Sells produce at the supply store. This is where a harvest finally becomes
 * money, and it is deliberately a separate act from harvesting: a market can
 * only swing a price if there is something you are holding while it swings,
 * which is what phase 4 needs.
 *
 * Priced from the catalogue at the moment of sale rather than snapshotted --
 * unlike a stocked unit, nothing was agreed in advance here. When phase 4
 * makes prices move, THIS is the call that reads the moving price.
 */
export async function sellStackAcresProduce(
  token: string,
  input: { item: string; quantity: number },
  now = new Date(),
): Promise<StackAcresView & { sold: { item: StackAcresItem; quantity: number; bushels: number } }> {
  if (!isStackAcresItem(input.item)) throw new StackAcresRequestError("No such produce.", 400);
  const item: StackAcresItem = input.item;
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new StackAcresRequestError("Sell at least one.", 400);
  }
  const profile = await ensureProfile(token);

  // Rule 1 in the other direction: the produce leaves before the money lands,
  // so a failure here cannot pay for goods the player still holds. A null is
  // "you do not have that many", which is also what a racing second tab looks
  // like from here.
  const remaining = await adjustStackAcresInventory(profile.id, item, -input.quantity);
  if (remaining === null) {
    throw new StackAcresRequestError(
      `You do not have ${itemLabel(item, input.quantity)} to sell.`,
      400,
    );
  }

  const bushels = STACKACRES_ITEM_CATALOGUE[item].price * input.quantity;
  try {
    await adjustStackAcresInventory(profile.id, BUSHELS, bushels);
  } catch (error) {
    // The produce is already gone from the bag; put it back rather than leave
    // the player short of both.
    await adjustStackAcresInventory(profile.id, item, input.quantity).catch(() => null);
    throw error;
  }

  return { ...(await view(profile, now)), sold: { item, quantity: input.quantity, bushels } };
}

/**
 * The exchange window: Bushels out of the farm, Gold in to the player. THE
 * ONLY PLACE GOLD LEAVES THE STACKACRES, and the only one there may ever be.
 *
 * What makes it safe is not the rate, it is the ceiling, and the ceiling is a
 * flat daily constant that does not vary with anything -- not stock owned, not
 * Bushels held, not Gold balance, not how well the player traded. Skill decides
 * how quickly the day's bucket fills; nothing decides how big it is. See
 * lib/stackacres/exchange.ts.
 *
 * The ordering is rule 1 with the currencies swapped, and the order is the
 * whole correctness argument:
 *
 *   1. **The Bushels leave first.** Nothing can be paid for produce the player
 *      still holds.
 *   2. **Then the day's allowance is reserved**, atomically, in the same write
 *      that checks it. A null is a refusal or a lost race and the two are
 *      indistinguishable here on purpose -- either way nothing was reserved, so
 *      the Bushels go straight back.
 *   3. **Only then is Gold credited.** By that point the debit and the
 *      reservation are both durable, so a failure at the last step cannot pay
 *      twice; it is logged loudly and the response carries the player's real
 *      balance, re-read, rather than an optimistic one.
 *
 * The rate is read now rather than snapshotted (unlike a sown unit's yield):
 * an exchange is instantaneous, so there is no in-flight agreement a retune
 * could break.
 */
export async function exchangeStackAcresBushels(
  token: string,
  bushelsInput: number,
  now = new Date(),
): Promise<StackAcresView & { exchanged: { bushels: number; gold: number } }> {
  if (
    !Number.isInteger(bushelsInput) ||
    bushelsInput < 1 ||
    bushelsInput > STACKACRES_MAX_EXCHANGE_BUSHELS
  ) {
    throw new StackAcresRequestError("Choose how many Bushels to exchange.", 400);
  }
  const profile = await ensureProfile(token);
  const day = stackacresExchangeDay(now);
  const gold = goldForBushels(bushelsInput);

  // Step 0: the land fee has first claim on the barn, before any of it is
  // allowed to leave the farm as Gold. Best-effort and never blocking -- an
  // unpayable bill is arrears (see `settleLandUpkeep`), and refusing the
  // exchange would be the debt trap this fee is deliberately not.
  await settleLandUpkeep(profile.id, now).catch(() => null);

  // Step 1: the Bushels leave. Null is an empty barn or a racing second tab,
  // and both mean nothing was exchanged.
  const left = await adjustStackAcresInventory(profile.id, BUSHELS, -bushelsInput);
  if (left === null) {
    throw new StackAcresRequestError(
      `You only have ${(await bushelBalance(profile.id)).toLocaleString()} Bushels.`,
      400,
    );
  }

  // Step 2: reserve the day's allowance. This is the valve, and it is one
  // atomic write rather than a read followed by a write, so two requests
  // racing for the last of the day cannot both take it.
  let reserved: number | null;
  try {
    reserved = await reserveStackAcresExchange(profile.id, day, gold, STACKACRES_GOLD_CEILING);
  } catch (error) {
    await adjustStackAcresInventory(profile.id, BUSHELS, bushelsInput).catch(() => null);
    throw error;
  }
  if (reserved === null) {
    await adjustStackAcresInventory(profile.id, BUSHELS, bushelsInput).catch(() => null);
    // Hitting the ceiling is the feature working, not a fault, so it reads as
    // a closing time rather than an error -- and the caller gets the true
    // remaining allowance in the view attached to the refusal.
    const state = exchangeState(await readStackAcresExchanged(profile.id, day), now);
    throw new StackAcresRequestError(
      state.remaining > 0
        ? `The window has ${state.remaining.toLocaleString()} Gold left today. Exchange ${state.maxBushels.toLocaleString()} Bushels or fewer.`
        : "You have exchanged all the Gold this farm can send out today. The window opens again at midnight UTC.",
      409,
    );
  }

  // Step 3: the Gold lands. Both writes above are already durable, so this one
  // never refunds -- a retry could pay twice, which is the one outcome worth
  // avoiding more than a missing credit. Logged loudly, same reasoning as
  // ante-up-service.ts's payOutWin.
  let credited: PlayerProfile | null = null;
  try {
    credited = await creditGoldByProfile(profile.id, gold);
  } catch (error) {
    console.error("stackacres.exchange_credit_failed", {
      profileId: profile.id,
      day,
      bushels: bushelsInput,
      gold,
      error,
    });
  }

  return {
    ...(await view(credited ?? (await ensureProfile(token)), now)),
    exchanged: { bushels: bushelsInput, gold },
  };
}

/** What is actually in the barn, for a refusal message that names a number. */
async function bushelBalance(profileId: string): Promise<number> {
  return (await readStackAcresInventory(profileId))[BUSHELS] ?? 0;
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
  const paid = await adjustStackAcresInventory(profile.id, BUSHELS, -fee);
  if (paid === null) {
    throw new StackAcresRequestError(
      `Clearing this costs ${fee.toLocaleString()} Bushels.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let cleared: StoredStackAcresUnit | null;
  try {
    cleared = await clearStackAcresMuck(unit);
  } catch (error) {
    await adjustStackAcresInventory(profile.id, BUSHELS, fee).catch(() => null);
    throw error;
  }
  if (!cleared) {
    await adjustStackAcresInventory(profile.id, BUSHELS, fee).catch(() => null);
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * Decides whether a settled unit needs maintenance. The only randomness in
 * the feature, deliberately reachable from exactly one call site, and only
 * after a guarded write has confirmed a settlement actually happened.
 */
function rollMuck(stock: StackAcresStock): number | null {
  return Math.random() < STACKACRES_MUCK_CHANCE ? STACKACRES_CATALOGUE[stock].muckFee : null;
}

/**
 * Harvests a ready unit into the bag. Allowed while banned, same posture as
 * resigning a duel: it only returns produce already grown, and stranding a
 * crop inside a suspended account's farm forever is a punishment nobody
 * designed.
 *
 * NOTE this no longer pays anything. It moves produce into the inventory and
 * that is all; turning produce into Bushels is sellStackAcresProduce, and
 * turning Bushels into Gold is the exchange. No Gold moves in this function,
 * and none should ever be added to it.
 */
export async function collectStackAcres(
  token: string,
  unitIdInput: string,
  now = new Date(),
): Promise<
  StackAcresView & {
    collected: {
      stock: StackAcresStock;
      item: StackAcresItem;
      quantity: number;
      mucked: boolean;
    };
  }
> {
  const unitId = parseUnitId(unitIdInput);
  const profile = await ensureProfile(token);

  // Harvesting is the routine touch on the land, so it is where the day's
  // maintenance is taken from a farm that is actually being played. Never
  // gated and never fatal: a collection returns produce already grown, and a
  // bill that cannot be paid must not turn into a lost harvest.
  await settleLandUpkeep(profile.id, now).catch(() => null);

  const unit = await getStackAcresUnit(profile.id, unitId);
  if (!unit || unit.status !== "working") {
    throw new StackAcresRequestError("Nothing to collect here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }
  if (isStackAcresUnitHungry(unit, now)) {
    throw new StackAcresRequestError("Feed them first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!isStackAcresUnitReady(unit, now)) {
    // The client's clock is decoration; this is the answer that counts, and
    // the store's own ready_at guard backs it even if this check is raced.
    throw new StackAcresRequestError("Not ready yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const stock = unit.stock;
  // Bought stock never mucks and never leaves: the animal stays and starts
  // its next cycle the moment you take what it made. Muck is the cost of
  // turning ground over between sowings, and there is no gap between
  // sowings here to charge for.
  const muckFee = unit.permanent ? null : rollMuck(stock);
  const restartReadyAt = unit.permanent
    ? new Date(now.getTime() + STACKACRES_CATALOGUE[stock].durationMs)
    : null;

  const settled = await collectStackAcresUnit(unit, now, muckFee, restartReadyAt);
  if (!settled) {
    // Rule 2: a lost race did not happen; whoever won it was paid instead.
    throw new StackAcresRequestError("That moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The guarded write above confirmed `unit` was exactly the row settled, so
  // its snapshotted yield is the truth about what it grew. Rule 3: the
  // snapshot, never a re-read of the catalogue -- a retune while it grew does
  // not change what the player agreed to stock.
  const item = STACKACRES_YIELDS[stock].item;
  const quantity = unit.yieldQuantity;
  const collected = { stock, item, quantity, mucked: muckFee !== null };

  // Rule 2 satisfied: the produce lands only after the guarded write. Never
  // throws -- the unit is already durably settled, and a failure here must
  // not turn a finished harvest into an error response on top of the missing
  // produce. Logged loudly, same reasoning as ante-up-service.ts's payOutWin.
  try {
    await adjustStackAcresInventory(profile.id, item, quantity);
  } catch (error) {
    console.error("stackacres.yield_credit_failed", {
      profileId: profile.id,
      unitId,
      item,
      quantity,
      error,
    });
  }

  await recordStackAcresHarvest({
    profileId: profile.id,
    unitId,
    stock,
    // Both in Bushels, so the economy dashboard sees one currency: what the
    // seed cost, and what the produce was worth at today's price.
    stake: unit.stake,
    payout: STACKACRES_ITEM_CATALOGUE[item].price * quantity,
    startedAt: unit.startedAt,
    collectedAt: now.toISOString(),
    // Bought stock spends no Bushels per cycle, so `stake` above is notional
    // for these rows. The flag is what lets a dashboard tell the difference
    // rather than counting a seed price nobody paid.
    permanent: unit.permanent,
  });

  return { ...(await view(profile, now)), collected };
}

/** Maps a thrown error to the response every StackAcres route sends. */
export function toStackAcresErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That could not be worked.");
}

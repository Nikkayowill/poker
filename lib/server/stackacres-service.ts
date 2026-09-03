import "server-only";
import { NextResponse } from "next/server";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_FEED,
  STACKACRES_FREE_PLOTS,
  STACKACRES_GRID_PLOTS,
  STACKACRES_LIVESTOCK,
  STACKACRES_MUCK_CHANCE,
  capFor,
  stackacresPlotPrice,
  isStackAcresStock,
  isLivestock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import {
  hungryAtFor,
  isStackAcresPlotHungry,
  isStackAcresPlotReady,
  toStackAcresPlotSnapshots,
  type StackAcresPlotSnapshot,
} from "@/lib/stackacres/plots";
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
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  StackAcresPlotExists,
  adjustStackAcresFeed,
  adjustStackAcresInventory,
  clearStackAcresMuck,
  collectStackAcresPlot,
  countWorkingStackAcresPlots,
  createStackAcresPlot,
  feedStackAcresPlot,
  getStackAcresPlot,
  grantStartingBushels,
  listStackAcresPlots,
  readStackAcresExchanged,
  readStackAcresFeed,
  readStackAcresInventory,
  recordStackAcresHarvest,
  reserveStackAcresExchange,
  retireStackAcresPlot,
  stockStackAcresPlot,
  type StoredStackAcresPlot,
} from "./stackacres-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";

/**
 * Everything between a StackAcres request and the player's purses.
 *
 * TWO CURRENCIES, and which is which is the whole safety story:
 *
 *   * **Bushels** are the farm's own money. Seed, feed and muck are priced in
 *     them, produce sells for them, and they never leave the StackAcres. A bug
 *     in any of it costs a save state, not money.
 *   * **Gold** moves in exactly THREE places, and the asymmetry between them
 *     is the whole safety story. TWO SPEND: buyStackAcresPlot buys acreage and
 *     buyStackAcresStock buys an animal or a crop outright. ONE PAYS:
 *     exchangeStackAcresBushels, at the daily window, under a flat per-player
 *     ceiling. Nothing else here may move Gold.
 *
 *     An earlier version of this comment said there must never be a third Gold
 *     path at all, on the grounds that Gold -> Bushels would let a player
 *     launder Gold through the capped window and back. That reasoning only
 *     holds when the inbound rate is at least as good as the outbound one.
 *     STACKACRES_GOLD_PER_SEED_BUSHEL is 100 against an exchange that pays 2,
 *     so a round trip returns a fraction of what it cost on every tier --
 *     market.test.ts holds that -- and the outbound ceiling is untouched. What
 *     genuinely must never change is the direction of the asymmetry: adding a
 *     path that PAYS Gold is the thing to stop over. Adding one that spends it
 *     is a sink.
 *
 *     The honest consequence, worth knowing before tuning anything: bought
 *     stock makes the existing 5,000/day ceiling reliably reachable where it
 *     used to take constant attention. Nobody takes out more than they could
 *     before; the ceiling is still what bounds every player's total draw.
 *
 * A StackAcres plot is a *guaranteed* win -- nothing here can lose your seed,
 * animals go hungry but never die -- so the ordering discipline every staked
 * service restates still applies, now mostly to Bushels:
 *
 *   1. **The money leaves the purse before the thing it pays for exists.**
 *      A plot purchase debits Gold before the row inserts; buying stock debits
 *      Gold before the plot turns working; a planting debits Bushels before
 *      the guarded write; feed debits before the servings land. Either write
 *      failing refunds.
 *   2. **Produce is credited only after the version-guarded harvest write is
 *      confirmed.** collectStackAcresPlot returns null on a lost race, a stale
 *      version, or a not-actually-ready row, and null must never pay: the
 *      writer that wins the race is the one that is paid.
 *   3. **Settlement credits the yield snapshotted at planting, never a re-read
 *      of the catalogue.** A retune between planting and harvest gives the
 *      player what they agreed to.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * Deliberately absent: awardWager. Ante Up grants XP on a wager because the
 * wager can lose; a StackAcres planting cannot, and XP for parking Bushels
 * would make this a progression faucet on top of everything else.
 *
 * THE MUCK ROLL is the one thing here that is not a pure function of
 * timestamps, and it lives in exactly one place: rollMuck, called once inside
 * collect, after the guarded write has confirmed which row settled. Rolling it
 * anywhere a read can reach would let a player reroll it by pulling to
 * refresh. Bought stock is not rolled at all -- see collectStackAcres.
 */

/** Refuses a StackAcres request in a way the player can act on. */
export class StackAcresRequestError extends ArcadeRequestError<StackAcresPlotSnapshot[], never> {
  readonly name = "StackAcresRequestError";
}

export interface StackAcresView {
  plots: StackAcresPlotSnapshot[];
  profile: PlayerProfile;
  feed: number;
  /** Produce held, by item id. Excludes Bushels, which get their own field. */
  inventory: Record<string, number>;
  bushels: number;
  /** Today's exchange window: the rate, the flat ceiling, what is left of it. */
  exchange: StackAcresExchangeState;
}

function parsePlotIndex(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > STACKACRES_GRID_PLOTS) {
    throw new StackAcresRequestError("Not a real plot.", 400);
  }
  return value;
}

async function snapshots(profileId: string, now: Date): Promise<StackAcresPlotSnapshot[]> {
  return toStackAcresPlotSnapshots(await listStackAcresPlots(profileId), now);
}

async function view(profile: PlayerProfile, now: Date): Promise<StackAcresView> {
  const [plots, feed, held, exchanged] = await Promise.all([
    snapshots(profile.id, now),
    readStackAcresFeed(profile.id),
    readStackAcresInventory(profile.id),
    readStackAcresExchanged(profile.id, stackacresExchangeDay(now)),
  ]);

  const { [BUSHELS]: bushels = 0, ...inventory } = held;
  return { plots, profile, feed, inventory, bushels, exchange: exchangeState(exchanged, now) };
}

/**
 * The whole farm, as the client renders it.
 *
 * The starting grant happens here, on the first read, because a farm with no
 * Bushels cannot plant anything and so cannot begin. It is safe to attempt on
 * every read: the store's INSERT ... ON CONFLICT DO NOTHING means a profile
 * that already has a bushels row is never topped up, even sitting at zero, so
 * a player who spends the grant does not get another by refreshing.
 */
export async function readStackAcres(token: string, now = new Date()): Promise<StackAcresView> {
  const profile = await ensureProfile(token);
  await grantStartingBushels(profile.id, STACKACRES_STARTING_BUSHELS);
  return view(profile, now);
}

/**
 * Buys one locked plot, at the flat price, IN ANY ORDER.
 *
 * There used to be an order here: the loop below walked the ladder and refused
 * a gap. That rule only ever existed because the price doubled per tile, so
 * without it a cheap tile could be left unbought beneath a dear one. The price
 * is flat now, nothing is left for an order to protect, and a player buying
 * the corner of the grid they actually want is the point of the change.
 */
export async function buyStackAcresPlot(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<StackAcresView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const price = stackacresPlotPrice(plotIndex);
  if (price === null) throw new StackAcresRequestError("That plot is not for sale.", 400);

  const owned = await listStackAcresPlots(profile.id);
  const ownedIndexes = new Set(owned.map((plot) => plot.plotIndex));
  if (ownedIndexes.has(plotIndex)) {
    throw new StackAcresRequestError("You already own this plot.", 409, {
      round: toStackAcresPlotSnapshots(owned, now),
    });
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new StackAcresRequestError(`You need ${price.toLocaleString()} Gold to expand.`, 400);
  }

  try {
    await createStackAcresPlot(profile.id, plotIndex);
  } catch (error) {
    // The plot never came into existence, so the player must not have paid.
    await creditGoldByProfile(profile.id, price).catch(() => null);
    if (error instanceof StackAcresPlotExists) {
      throw new StackAcresRequestError(error.message, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    throw error;
  }

  return view(debited, now);
}

/**
 * Buys an animal or a crop OUTRIGHT, with Gold, and stands it on a plot.
 *
 * The difference from stockStackAcres, and the reason both exist: a planting
 * costs Bushels and is CONSUMED by its own harvest, so the tile goes back to
 * empty and you sow it again. Bought stock costs Gold, is permanent, and
 * re-sows itself forever -- you own the cow, you do not own one cow-cycle.
 * That is what makes 60,000 Gold and 600 Bushels honest prices for the same
 * animal: they are not the same thing.
 *
 * Cash on the counter. Nothing here is financed, there is no balance and no
 * credit -- the Gold either leaves the purse now or the sale does not happen.
 *
 * Rule 1 throughout: the Gold is debited before the plot turns working, and
 * every failure path after that refunds it. A lost race refunds; a database
 * refusal refunds; a cap violation is caught before the debit ever happens.
 */
export async function buyStackAcresStock(
  token: string,
  input: { plotIndex: number; stock: string },
  now = new Date(),
): Promise<StackAcresView> {
  const plotIndex = parsePlotIndex(input.plotIndex);
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const price = stackacresStockPrice(stock);
  const profile = await ensureProfile(token);

  const plot =
    plotIndex <= STACKACRES_FREE_PLOTS
      ? await ensureFreePlotRow(profile.id, plotIndex)
      : await getStackAcresPlot(profile.id, plotIndex);
  if (!plot) {
    throw new StackAcresRequestError("Buy this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status === "mucked") {
    throw new StackAcresRequestError("Clear this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status !== "empty") {
    throw new StackAcresRequestError("Something is already working here.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // Checked before the debit so a capped player is never charged, and enforced
  // for real by the advisory-locked trigger, which two racing buys cannot
  // squeeze past. Bought stock counts toward the same caps as a planting -- it
  // stands on the same plot and eats the same hours.
  const animal = isLivestock(stock);
  const working = await countWorkingStackAcresPlots(profile.id, STACKACRES_LIVESTOCK, animal);
  const cap = capFor(stock);
  if (working >= cap) {
    throw new StackAcresRequestError(
      animal
        ? `Your hands can only tend ${cap} pens at once. Retire one first.`
        : `You can only have ${cap} fields growing at once. Harvest one first.`,
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
  let stocked: StoredStackAcresPlot | null;
  try {
    stocked = await stockStackAcresPlot(plot, {
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
      permanent: true,
    });
  } catch (error) {
    // The database refused and nothing came into existence, so the player must
    // not have paid for it.
    await creditGoldByProfile(profile.id, price).catch(() => null);
    throw error;
  }
  if (!stocked) {
    // Lost the guarded write: same rule, the Gold goes back.
    await creditGoldByProfile(profile.id, price).catch(() => null);
    throw new StackAcresRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/**
 * Sends bought stock away and frees the plot. NO REFUND, and the UI has to say
 * so before it asks -- see STACKACRES_RETIRE_REFUND.
 *
 * This is not an undo. It exists because permanent stock holds its plot
 * forever and three permanent cattle fill the livestock cap: without a way
 * out, buying three would lock a player out of ever keeping anything else and
 * the prize would be a trap. Refunding would make a plot somewhere to park
 * Gold and take it back out again, which is the one shape this subsystem is
 * built not to have.
 */
export async function retireStackAcresStock(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<StackAcresView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getStackAcresPlot(profile.id, plotIndex);
  if (!plot || !plot.permanent) {
    throw new StackAcresRequestError("There is nothing here to retire.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const retired = await retireStackAcresPlot(plot);
  if (!retired) {
    throw new StackAcresRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * A free plot's row is created lazily on first use, uncharged. A 23505 race
 * here just means another tab created it first; read it back.
 */
async function ensureFreePlotRow(profileId: string, plotIndex: number): Promise<StoredStackAcresPlot> {
  const existing = await getStackAcresPlot(profileId, plotIndex);
  if (existing) return existing;
  try {
    return await createStackAcresPlot(profileId, plotIndex);
  } catch (error) {
    if (error instanceof StackAcresPlotExists) {
      const raced = await getStackAcresPlot(profileId, plotIndex);
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * Puts a crop or an animal on an empty plot the player owns.
 *
 * The payout and readiness written here are snapshots (rule 3): the catalogue
 * is read exactly once, now, and never again for this plot.
 */
export async function stockStackAcres(
  token: string,
  input: { plotIndex: number; stock: string },
  now = new Date(),
): Promise<StackAcresView> {
  const plotIndex = parsePlotIndex(input.plotIndex);
  if (!isStackAcresStock(input.stock)) throw new StackAcresRequestError("Not a real stock.", 400);
  const stock: StackAcresStock = input.stock;
  const def = STACKACRES_CATALOGUE[stock];
  const profile = await ensureProfile(token);

  const plot =
    plotIndex <= STACKACRES_FREE_PLOTS
      ? await ensureFreePlotRow(profile.id, plotIndex)
      : await getStackAcresPlot(profile.id, plotIndex);
  if (!plot) {
    throw new StackAcresRequestError("Unlock this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status === "mucked") {
    throw new StackAcresRequestError("Clear this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status !== "empty") {
    throw new StackAcresRequestError("Something is already working here.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The caps are what bound this faucet; see lib/stackacres/catalogue.ts.
  // Checked here for a clean 409, enforced for real by the advisory-locked
  // trigger in the migration, which two racing requests cannot squeeze past.
  const animal = isLivestock(stock);
  const working = await countWorkingStackAcresPlots(profile.id, STACKACRES_LIVESTOCK, animal);
  const cap = capFor(stock);
  if (working >= cap) {
    throw new StackAcresRequestError(
      animal
        ? `Your hands can only tend ${cap} pens at once. Collect from one first.`
        : `You can only have ${cap} fields growing at once. Harvest one first.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the seed is paid for first. Bushels, not Gold -- a null here is a
  // lost race or an empty purse, and both mean nothing was planted.
  const produce = STACKACRES_YIELDS[stock];
  const paid = await adjustStackAcresInventory(profile.id, BUSHELS, -def.seedCost);
  if (paid === null) {
    throw new StackAcresRequestError(
      `${def.label} seed costs ${def.seedCost.toLocaleString()} Bushels.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let stocked: StoredStackAcresPlot | null;
  try {
    stocked = await stockStackAcresPlot(plot, {
      stock,
      stake: def.seedCost,
      yieldQuantity: produce.quantity,
      startedAt: now,
      readyAt: new Date(now.getTime() + def.durationMs),
      // An animal counts as fed the moment it arrives; a crop never eats.
      lastFedAt: def.hungerMs === null ? null : now,
    });
  } catch (error) {
    // The database refused outright -- the trigger raising on a cap race or a
    // ceiling desync arrives HERE as a throw, never as the null below -- and
    // nothing came into existence, so the player must not have paid for it.
    await adjustStackAcresInventory(profile.id, BUSHELS, def.seedCost).catch(() => null);
    throw error;
  }
  if (!stocked) {
    // Lost the guarded write (another tab moved this plot first): same rule,
    // the seed goes back.
    await adjustStackAcresInventory(profile.id, BUSHELS, def.seedCost).catch(() => null);
    throw new StackAcresRequestError("That plot moved on.", 409, {
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
 * unlike a planted plot, nothing was agreed in advance here. When phase 4
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
 * flat daily constant that does not vary with anything -- not land owned, not
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
 * The rate is read now rather than snapshotted (unlike a planted plot's yield):
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
 * A hungry plot's clock is frozen, and this is where that is actually made
 * true: ready_at moves forward by however long the animal spent waiting, so
 * the time it was neglected is not silently credited as work. The payout is
 * untouched -- neglect costs you time, never Gold.
 */
export async function feedStackAcres(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<StackAcresView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getStackAcresPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "working" || !plot.stock || !isLivestock(plot.stock)) {
    throw new StackAcresRequestError("Nothing here eats.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const hungryAt = hungryAtFor(plot);
  const hungrySince = hungryAt ? Date.parse(hungryAt) : NaN;
  const starvedMs = Number.isFinite(hungrySince)
    ? Math.max(0, now.getTime() - hungrySince)
    : 0;

  // Rule 1 again, in servings rather than Gold: the feed is spent before the
  // write it pays for. Null is "not enough", which reads exactly like a lost
  // race because it is one.
  const remaining = await adjustStackAcresFeed(profile.id, -1);
  if (remaining === null) {
    throw new StackAcresRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const readyAt = plot.readyAt ? Date.parse(plot.readyAt) : NaN;
  const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + starvedMs);

  let fed: StoredStackAcresPlot | null;
  try {
    fed = await feedStackAcresPlot(plot, now, pushed);
  } catch (error) {
    await adjustStackAcresFeed(profile.id, 1).catch(() => null);
    throw error;
  }
  if (!fed) {
    await adjustStackAcresFeed(profile.id, 1).catch(() => null);
    throw new StackAcresRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Pays the maintenance fee on a mucked plot. */
export async function clearStackAcresPlot(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<StackAcresView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getStackAcresPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "mucked" || plot.muckFee === null) {
    throw new StackAcresRequestError("Nothing to clear here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const fee = plot.muckFee;
  const paid = await adjustStackAcresInventory(profile.id, BUSHELS, -fee);
  if (paid === null) {
    throw new StackAcresRequestError(
      `Clearing this costs ${fee.toLocaleString()} Bushels.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let cleared: StoredStackAcresPlot | null;
  try {
    cleared = await clearStackAcresMuck(plot);
  } catch (error) {
    await adjustStackAcresInventory(profile.id, BUSHELS, fee).catch(() => null);
    throw error;
  }
  if (!cleared) {
    await adjustStackAcresInventory(profile.id, BUSHELS, fee).catch(() => null);
    throw new StackAcresRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/**
 * Decides whether a settled plot needs maintenance. The only randomness in the
 * feature, deliberately reachable from exactly one call site, and only after a
 * guarded write has confirmed a settlement actually happened.
 */
function rollMuck(stock: StackAcresStock): number | null {
  return Math.random() < STACKACRES_MUCK_CHANCE ? STACKACRES_CATALOGUE[stock].muckFee : null;
}

/**
 * Harvests a ready plot into the bag. Allowed while banned, same posture as
 * resigning a duel: it only returns produce already grown, and stranding a
 * crop inside a suspended account's grid forever is a punishment nobody
 * designed.
 *
 * NOTE this no longer pays anything. It moves produce into the inventory and
 * that is all; turning produce into Bushels is sellStackAcresProduce, and
 * turning Bushels into Gold is phase 3's exchange. No Gold moves in this
 * function, and none should ever be added to it.
 */
export async function collectStackAcres(
  token: string,
  plotIndexInput: number,
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
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getStackAcresPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "working") {
    throw new StackAcresRequestError("Nothing to collect here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }
  if (isStackAcresPlotHungry(plot, now)) {
    throw new StackAcresRequestError("Feed them first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!isStackAcresPlotReady(plot, now)) {
    // The client's clock is decoration; this is the answer that counts, and
    // the store's own ready_at guard backs it even if this check is raced.
    throw new StackAcresRequestError("Not ready yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const stock = plot.stock as StackAcresStock;
  // Bought stock never mucks and never empties: the animal stays and starts
  // its next cycle the moment you take what it made. Muck is the cost of
  // turning a field over between plantings, and there is no gap between
  // plantings here to charge for.
  const muckFee = plot.permanent ? null : rollMuck(stock);
  const restartReadyAt = plot.permanent
    ? new Date(now.getTime() + STACKACRES_CATALOGUE[stock].durationMs)
    : null;

  const settled = await collectStackAcresPlot(plot, now, muckFee, restartReadyAt);
  if (!settled) {
    // Rule 2: a lost race did not happen; whoever won it was paid instead.
    throw new StackAcresRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The guarded write above confirmed `plot` was exactly the row settled, so
  // its snapshotted yield is the truth about what this plot grew. Rule 3: the
  // snapshot, never a re-read of the catalogue -- a retune while it grew does
  // not change what the player agreed to plant.
  const item = STACKACRES_YIELDS[stock].item;
  const quantity = plot.yieldQuantity ?? STACKACRES_YIELDS[stock].quantity;
  const collected = { stock, item, quantity, mucked: muckFee !== null };

  // Rule 2 satisfied: the produce lands only after the guarded write. Never
  // throws -- the plot is already durably settled, and a failure here must not
  // turn a finished harvest into an error response on top of the missing
  // produce. Logged loudly, same reasoning as ante-up-service.ts's payOutWin.
  try {
    await adjustStackAcresInventory(profile.id, item, quantity);
  } catch (error) {
    console.error("stackacres.yield_credit_failed", {
      profileId: profile.id,
      plotIndex,
      item,
      quantity,
      error,
    });
  }

  await recordStackAcresHarvest({
    profileId: profile.id,
    plotIndex,
    stock,
    // Both in Bushels, so the economy dashboard sees one currency: what the
    // seed cost, and what the produce was worth at today's price.
    stake: plot.stake ?? 0,
    payout: STACKACRES_ITEM_CATALOGUE[item].price * quantity,
    startedAt: plot.startedAt ?? now.toISOString(),
    collectedAt: now.toISOString(),
    // Bought stock spends no Bushels per cycle, so `stake` above is notional
    // for these rows. The flag is what lets a dashboard tell the difference
    // rather than counting a seed price nobody paid.
    permanent: plot.permanent,
  });

  return { ...(await view(profile, now)), collected };
}

/** Maps a thrown error to the response every StackAcres route sends. */
export function toStackAcresErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That plot could not be worked.");
}

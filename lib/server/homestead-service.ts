import "server-only";
import { NextResponse } from "next/server";
import {
  HOMESTEAD_CATALOGUE,
  HOMESTEAD_FEED,
  HOMESTEAD_FREE_PLOTS,
  HOMESTEAD_GRID_PLOTS,
  HOMESTEAD_LIVESTOCK,
  HOMESTEAD_MUCK_CHANCE,
  capFor,
  homesteadPlotPrice,
  isHomesteadStock,
  isLivestock,
  type HomesteadStock,
} from "@/lib/homestead/catalogue";
import {
  hungryAtFor,
  isHomesteadPlotHungry,
  isHomesteadPlotReady,
  toHomesteadPlotSnapshots,
  type HomesteadPlotSnapshot,
} from "@/lib/homestead/plots";
import {
  BUSHELS,
  HOMESTEAD_ITEM_CATALOGUE,
  HOMESTEAD_STARTING_BUSHELS,
  HOMESTEAD_YIELDS,
  isHomesteadItem,
  itemLabel,
  type HomesteadItem,
} from "@/lib/homestead/items";
import {
  HOMESTEAD_GOLD_CEILING,
  HOMESTEAD_MAX_EXCHANGE_BUSHELS,
  exchangeState,
  goldForBushels,
  homesteadExchangeDay,
  type HomesteadExchangeState,
} from "@/lib/homestead/exchange";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  HomesteadPlotExists,
  adjustHomesteadFeed,
  adjustHomesteadInventory,
  clearHomesteadMuck,
  collectHomesteadPlot,
  countWorkingHomesteadPlots,
  createHomesteadPlot,
  feedHomesteadPlot,
  getHomesteadPlot,
  grantStartingBushels,
  listHomesteadPlots,
  readHomesteadExchanged,
  readHomesteadFeed,
  readHomesteadInventory,
  recordHomesteadHarvest,
  reserveHomesteadExchange,
  stockHomesteadPlot,
  type StoredHomesteadPlot,
} from "./homestead-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";

/**
 * Everything between a StackChips Homestead request and the player's purses.
 *
 * TWO CURRENCIES, and which is which is the whole safety story:
 *
 *   * **Bushels** are the farm's own money. Seed, feed and muck are priced in
 *     them, produce sells for them, and they never leave the Homestead. A bug
 *     in any of it costs a save state, not money.
 *   * **Gold** touches the farm in exactly TWO places, and there must never be
 *     a third: buyHomesteadPlot spends it on acreage, and
 *     exchangeHomesteadBushels pays it out at the daily window, under a flat
 *     per-player ceiling. Nothing else here may move Gold. If a future change
 *     adds a third Gold path, that is the thing to stop and think about,
 *     because the farm's maximum Gold output being a flat constant is what
 *     keeps this out of the category Ante Up was in when it printed money.
 *     There is deliberately no Gold -> Bushels path in either direction other
 *     than acreage: a round trip would let a player launder Gold through the
 *     capped window and back, which is a second faucet wearing a sink's coat.
 *
 * A Homestead plot is a *guaranteed* win -- nothing here can lose your seed,
 * animals go hungry but never die -- so the ordering discipline every staked
 * service restates still applies, now mostly to Bushels:
 *
 *   1. **The money leaves the purse before the thing it pays for exists.**
 *      A plot purchase debits Gold before the row inserts; a planting debits
 *      Bushels before the guarded write; feed debits before the servings land.
 *      Either write failing refunds.
 *   2. **Produce is credited only after the version-guarded harvest write is
 *      confirmed.** collectHomesteadPlot returns null on a lost race, a stale
 *      version, or a not-actually-ready row, and null must never pay: the
 *      writer that wins the race is the one that is paid.
 *   3. **Settlement credits the yield snapshotted at planting, never a re-read
 *      of the catalogue.** A retune between planting and harvest gives the
 *      player what they agreed to.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * Deliberately absent: awardWager. Ante Up grants XP on a wager because the
 * wager can lose; a Homestead planting cannot, and XP for parking Bushels
 * would make this a progression faucet on top of everything else.
 *
 * THE MUCK ROLL is the one thing here that is not a pure function of
 * timestamps, and it lives in exactly one place: rollMuck, called once inside
 * collect, after the guarded write has confirmed which row settled. Rolling it
 * anywhere a read can reach would let a player reroll it by pulling to
 * refresh.
 */

/** Refuses a Homestead request in a way the player can act on. */
export class HomesteadRequestError extends ArcadeRequestError<HomesteadPlotSnapshot[], never> {
  readonly name = "HomesteadRequestError";
}

export interface HomesteadView {
  plots: HomesteadPlotSnapshot[];
  profile: PlayerProfile;
  feed: number;
  /** Produce held, by item id. Excludes Bushels, which get their own field. */
  inventory: Record<string, number>;
  bushels: number;
  /** Today's exchange window: the rate, the flat ceiling, what is left of it. */
  exchange: HomesteadExchangeState;
}

function parsePlotIndex(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > HOMESTEAD_GRID_PLOTS) {
    throw new HomesteadRequestError("Not a real plot.", 400);
  }
  return value;
}

async function snapshots(profileId: string, now: Date): Promise<HomesteadPlotSnapshot[]> {
  return toHomesteadPlotSnapshots(await listHomesteadPlots(profileId), now);
}

async function view(profile: PlayerProfile, now: Date): Promise<HomesteadView> {
  const [plots, feed, held, exchanged] = await Promise.all([
    snapshots(profile.id, now),
    readHomesteadFeed(profile.id),
    readHomesteadInventory(profile.id),
    readHomesteadExchanged(profile.id, homesteadExchangeDay(now)),
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
export async function readHomestead(token: string, now = new Date()): Promise<HomesteadView> {
  const profile = await ensureProfile(token);
  await grantStartingBushels(profile.id, HOMESTEAD_STARTING_BUSHELS);
  return view(profile, now);
}

/**
 * Buys the next locked plot. Plots unlock strictly in ladder order -- the
 * doubling prices assume it -- so the request names the plot only to confirm
 * the player bought the tile they were looking at.
 */
export async function buyHomesteadPlot(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<HomesteadView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const price = homesteadPlotPrice(plotIndex);
  if (price === null) throw new HomesteadRequestError("That plot is not for sale.", 400);

  const owned = await listHomesteadPlots(profile.id);
  const ownedIndexes = new Set(owned.map((plot) => plot.plotIndex));
  for (let index = HOMESTEAD_FREE_PLOTS + 1; index < plotIndex; index += 1) {
    if (!ownedIndexes.has(index)) {
      throw new HomesteadRequestError("Plots unlock in order. Buy the cheaper one first.", 409, {
        round: toHomesteadPlotSnapshots(owned, now),
      });
    }
  }
  if (ownedIndexes.has(plotIndex)) {
    throw new HomesteadRequestError("You already own this plot.", 409, {
      round: toHomesteadPlotSnapshots(owned, now),
    });
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new HomesteadRequestError(`You need ${price.toLocaleString()} Gold to expand.`, 400);
  }

  try {
    await createHomesteadPlot(profile.id, plotIndex);
  } catch (error) {
    // The plot never came into existence, so the player must not have paid.
    await creditGoldByProfile(profile.id, price).catch(() => null);
    if (error instanceof HomesteadPlotExists) {
      throw new HomesteadRequestError(error.message, 409, {
        round: await snapshots(profile.id, now),
      });
    }
    throw error;
  }

  return view(debited, now);
}

/**
 * A free plot's row is created lazily on first use, uncharged. A 23505 race
 * here just means another tab created it first; read it back.
 */
async function ensureFreePlotRow(profileId: string, plotIndex: number): Promise<StoredHomesteadPlot> {
  const existing = await getHomesteadPlot(profileId, plotIndex);
  if (existing) return existing;
  try {
    return await createHomesteadPlot(profileId, plotIndex);
  } catch (error) {
    if (error instanceof HomesteadPlotExists) {
      const raced = await getHomesteadPlot(profileId, plotIndex);
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
export async function stockHomestead(
  token: string,
  input: { plotIndex: number; stock: string },
  now = new Date(),
): Promise<HomesteadView> {
  const plotIndex = parsePlotIndex(input.plotIndex);
  if (!isHomesteadStock(input.stock)) throw new HomesteadRequestError("Not a real stock.", 400);
  const stock: HomesteadStock = input.stock;
  const def = HOMESTEAD_CATALOGUE[stock];
  const profile = await ensureProfile(token);

  const plot =
    plotIndex <= HOMESTEAD_FREE_PLOTS
      ? await ensureFreePlotRow(profile.id, plotIndex)
      : await getHomesteadPlot(profile.id, plotIndex);
  if (!plot) {
    throw new HomesteadRequestError("Unlock this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status === "mucked") {
    throw new HomesteadRequestError("Clear this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status !== "empty") {
    throw new HomesteadRequestError("Something is already working here.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The caps are what bound this faucet; see lib/homestead/catalogue.ts.
  // Checked here for a clean 409, enforced for real by the advisory-locked
  // trigger in the migration, which two racing requests cannot squeeze past.
  const animal = isLivestock(stock);
  const working = await countWorkingHomesteadPlots(profile.id, HOMESTEAD_LIVESTOCK, animal);
  const cap = capFor(stock);
  if (working >= cap) {
    throw new HomesteadRequestError(
      animal
        ? `Your hands can only tend ${cap} pens at once. Collect from one first.`
        : `You can only have ${cap} fields growing at once. Harvest one first.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the seed is paid for first. Bushels, not Gold -- a null here is a
  // lost race or an empty purse, and both mean nothing was planted.
  const produce = HOMESTEAD_YIELDS[stock];
  const paid = await adjustHomesteadInventory(profile.id, BUSHELS, -def.seedCost);
  if (paid === null) {
    throw new HomesteadRequestError(
      `${def.label} seed costs ${def.seedCost.toLocaleString()} Bushels.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let stocked: StoredHomesteadPlot | null;
  try {
    stocked = await stockHomesteadPlot(plot, {
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
    await adjustHomesteadInventory(profile.id, BUSHELS, def.seedCost).catch(() => null);
    throw error;
  }
  if (!stocked) {
    // Lost the guarded write (another tab moved this plot first): same rule,
    // the seed goes back.
    await adjustHomesteadInventory(profile.id, BUSHELS, def.seedCost).catch(() => null);
    throw new HomesteadRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Buys a shipment of feed. Pure sink: Bushels out, servings in. */
export async function buyHomesteadFeed(
  token: string,
  itemId: string,
  now = new Date(),
): Promise<HomesteadView> {
  const item = HOMESTEAD_FEED[itemId];
  if (!item) throw new HomesteadRequestError("No such shipment.", 400);
  const profile = await ensureProfile(token);

  // Rule 1: the Bushels leave before the servings land.
  const paid = await adjustHomesteadInventory(profile.id, BUSHELS, -item.cost);
  if (paid === null) {
    throw new HomesteadRequestError(
      `A ${item.label} costs ${item.cost.toLocaleString()} Bushels.`,
      400,
    );
  }

  try {
    await adjustHomesteadFeed(profile.id, item.servings);
  } catch (error) {
    await adjustHomesteadInventory(profile.id, BUSHELS, item.cost).catch(() => null);
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
export async function sellHomesteadProduce(
  token: string,
  input: { item: string; quantity: number },
  now = new Date(),
): Promise<HomesteadView & { sold: { item: HomesteadItem; quantity: number; bushels: number } }> {
  if (!isHomesteadItem(input.item)) throw new HomesteadRequestError("No such produce.", 400);
  const item: HomesteadItem = input.item;
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new HomesteadRequestError("Sell at least one.", 400);
  }
  const profile = await ensureProfile(token);

  // Rule 1 in the other direction: the produce leaves before the money lands,
  // so a failure here cannot pay for goods the player still holds. A null is
  // "you do not have that many", which is also what a racing second tab looks
  // like from here.
  const remaining = await adjustHomesteadInventory(profile.id, item, -input.quantity);
  if (remaining === null) {
    throw new HomesteadRequestError(
      `You do not have ${itemLabel(item, input.quantity)} to sell.`,
      400,
    );
  }

  const bushels = HOMESTEAD_ITEM_CATALOGUE[item].price * input.quantity;
  try {
    await adjustHomesteadInventory(profile.id, BUSHELS, bushels);
  } catch (error) {
    // The produce is already gone from the bag; put it back rather than leave
    // the player short of both.
    await adjustHomesteadInventory(profile.id, item, input.quantity).catch(() => null);
    throw error;
  }

  return { ...(await view(profile, now)), sold: { item, quantity: input.quantity, bushels } };
}

/**
 * The exchange window: Bushels out of the farm, Gold in to the player. THE
 * ONLY PLACE GOLD LEAVES THE HOMESTEAD, and the only one there may ever be.
 *
 * What makes it safe is not the rate, it is the ceiling, and the ceiling is a
 * flat daily constant that does not vary with anything -- not land owned, not
 * Bushels held, not Gold balance, not how well the player traded. Skill decides
 * how quickly the day's bucket fills; nothing decides how big it is. See
 * lib/homestead/exchange.ts.
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
export async function exchangeHomesteadBushels(
  token: string,
  bushelsInput: number,
  now = new Date(),
): Promise<HomesteadView & { exchanged: { bushels: number; gold: number } }> {
  if (
    !Number.isInteger(bushelsInput) ||
    bushelsInput < 1 ||
    bushelsInput > HOMESTEAD_MAX_EXCHANGE_BUSHELS
  ) {
    throw new HomesteadRequestError("Choose how many Bushels to exchange.", 400);
  }
  const profile = await ensureProfile(token);
  const day = homesteadExchangeDay(now);
  const gold = goldForBushels(bushelsInput);

  // Step 1: the Bushels leave. Null is an empty barn or a racing second tab,
  // and both mean nothing was exchanged.
  const left = await adjustHomesteadInventory(profile.id, BUSHELS, -bushelsInput);
  if (left === null) {
    throw new HomesteadRequestError(
      `You only have ${(await bushelBalance(profile.id)).toLocaleString()} Bushels.`,
      400,
    );
  }

  // Step 2: reserve the day's allowance. This is the valve, and it is one
  // atomic write rather than a read followed by a write, so two requests
  // racing for the last of the day cannot both take it.
  let reserved: number | null;
  try {
    reserved = await reserveHomesteadExchange(profile.id, day, gold, HOMESTEAD_GOLD_CEILING);
  } catch (error) {
    await adjustHomesteadInventory(profile.id, BUSHELS, bushelsInput).catch(() => null);
    throw error;
  }
  if (reserved === null) {
    await adjustHomesteadInventory(profile.id, BUSHELS, bushelsInput).catch(() => null);
    // Hitting the ceiling is the feature working, not a fault, so it reads as
    // a closing time rather than an error -- and the caller gets the true
    // remaining allowance in the view attached to the refusal.
    const state = exchangeState(await readHomesteadExchanged(profile.id, day), now);
    throw new HomesteadRequestError(
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
    console.error("homestead.exchange_credit_failed", {
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
  return (await readHomesteadInventory(profileId))[BUSHELS] ?? 0;
}

/**
 * Feeds a hungry animal, spending one serving.
 *
 * A hungry plot's clock is frozen, and this is where that is actually made
 * true: ready_at moves forward by however long the animal spent waiting, so
 * the time it was neglected is not silently credited as work. The payout is
 * untouched -- neglect costs you time, never Gold.
 */
export async function feedHomestead(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<HomesteadView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getHomesteadPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "working" || !plot.stock || !isLivestock(plot.stock)) {
    throw new HomesteadRequestError("Nothing here eats.", 404, {
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
  const remaining = await adjustHomesteadFeed(profile.id, -1);
  if (remaining === null) {
    throw new HomesteadRequestError("You are out of feed. Buy a shipment first.", 400, {
      round: await snapshots(profile.id, now),
    });
  }

  const readyAt = plot.readyAt ? Date.parse(plot.readyAt) : NaN;
  const pushed = new Date((Number.isFinite(readyAt) ? readyAt : now.getTime()) + starvedMs);

  let fed: StoredHomesteadPlot | null;
  try {
    fed = await feedHomesteadPlot(plot, now, pushed);
  } catch (error) {
    await adjustHomesteadFeed(profile.id, 1).catch(() => null);
    throw error;
  }
  if (!fed) {
    await adjustHomesteadFeed(profile.id, 1).catch(() => null);
    throw new HomesteadRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(profile, now);
}

/** Pays the maintenance fee on a mucked plot. */
export async function clearHomesteadPlot(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<HomesteadView> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getHomesteadPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "mucked" || plot.muckFee === null) {
    throw new HomesteadRequestError("Nothing to clear here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }

  const fee = plot.muckFee;
  const paid = await adjustHomesteadInventory(profile.id, BUSHELS, -fee);
  if (paid === null) {
    throw new HomesteadRequestError(
      `Clearing this costs ${fee.toLocaleString()} Bushels.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let cleared: StoredHomesteadPlot | null;
  try {
    cleared = await clearHomesteadMuck(plot);
  } catch (error) {
    await adjustHomesteadInventory(profile.id, BUSHELS, fee).catch(() => null);
    throw error;
  }
  if (!cleared) {
    await adjustHomesteadInventory(profile.id, BUSHELS, fee).catch(() => null);
    throw new HomesteadRequestError("That plot moved on.", 409, {
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
function rollMuck(stock: HomesteadStock): number | null {
  return Math.random() < HOMESTEAD_MUCK_CHANCE ? HOMESTEAD_CATALOGUE[stock].muckFee : null;
}

/**
 * Harvests a ready plot into the bag. Allowed while banned, same posture as
 * resigning a duel: it only returns produce already grown, and stranding a
 * crop inside a suspended account's grid forever is a punishment nobody
 * designed.
 *
 * NOTE this no longer pays anything. It moves produce into the inventory and
 * that is all; turning produce into Bushels is sellHomesteadProduce, and
 * turning Bushels into Gold is phase 3's exchange. No Gold moves in this
 * function, and none should ever be added to it.
 */
export async function collectHomestead(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<
  HomesteadView & {
    collected: {
      stock: HomesteadStock;
      item: HomesteadItem;
      quantity: number;
      mucked: boolean;
    };
  }
> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getHomesteadPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "working") {
    throw new HomesteadRequestError("Nothing to collect here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }
  if (isHomesteadPlotHungry(plot, now)) {
    throw new HomesteadRequestError("Feed them first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!isHomesteadPlotReady(plot, now)) {
    // The client's clock is decoration; this is the answer that counts, and
    // the store's own ready_at guard backs it even if this check is raced.
    throw new HomesteadRequestError("Not ready yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const stock = plot.stock as HomesteadStock;
  const muckFee = rollMuck(stock);

  const settled = await collectHomesteadPlot(plot, now, muckFee);
  if (!settled) {
    // Rule 2: a lost race did not happen; whoever won it was paid instead.
    throw new HomesteadRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The guarded write above confirmed `plot` was exactly the row settled, so
  // its snapshotted yield is the truth about what this plot grew. Rule 3: the
  // snapshot, never a re-read of the catalogue -- a retune while it grew does
  // not change what the player agreed to plant.
  const item = HOMESTEAD_YIELDS[stock].item;
  const quantity = plot.yieldQuantity ?? HOMESTEAD_YIELDS[stock].quantity;
  const collected = { stock, item, quantity, mucked: muckFee !== null };

  // Rule 2 satisfied: the produce lands only after the guarded write. Never
  // throws -- the plot is already durably settled, and a failure here must not
  // turn a finished harvest into an error response on top of the missing
  // produce. Logged loudly, same reasoning as ante-up-service.ts's payOutWin.
  try {
    await adjustHomesteadInventory(profile.id, item, quantity);
  } catch (error) {
    console.error("homestead.yield_credit_failed", {
      profileId: profile.id,
      plotIndex,
      item,
      quantity,
      error,
    });
  }

  await recordHomesteadHarvest({
    profileId: profile.id,
    plotIndex,
    stock,
    // Both in Bushels, so the economy dashboard sees one currency: what the
    // seed cost, and what the produce was worth at today's price.
    stake: plot.stake ?? 0,
    payout: HOMESTEAD_ITEM_CATALOGUE[item].price * quantity,
    startedAt: plot.startedAt ?? now.toISOString(),
    collectedAt: now.toISOString(),
  });

  return { ...(await view(profile, now)), collected };
}

/** Maps a thrown error to the response every Homestead route sends. */
export function toHomesteadErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That plot could not be worked.");
}

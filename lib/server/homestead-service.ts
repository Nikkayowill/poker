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
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  HomesteadPlotExists,
  adjustHomesteadFeed,
  clearHomesteadMuck,
  collectHomesteadPlot,
  countWorkingHomesteadPlots,
  createHomesteadPlot,
  feedHomesteadPlot,
  getHomesteadPlot,
  listHomesteadPlots,
  readHomesteadFeed,
  recordHomesteadHarvest,
  stockHomesteadPlot,
  type StoredHomesteadPlot,
} from "./homestead-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";

/**
 * Everything between a StackChips Homestead request and the wallet.
 *
 * A Homestead plot is a *guaranteed* win -- nothing here can lose your stake,
 * animals go hungry but never die -- so the ordering discipline every staked
 * service restates matters with nothing to hide behind:
 *
 *   1. **The Gold leaves the wallet before the thing it pays for exists.**
 *      A plot purchase debits before the row inserts; a stocking debits before
 *      the guarded write; feed debits before the servings land. Either write
 *      failing refunds.
 *   2. **A payout is credited only after the version-guarded collection write
 *      is confirmed.** collectHomesteadPlot returns null on a lost race, a
 *      stale version, or a not-actually-ready row, and null must never pay:
 *      the writer that wins the race is the one that pays.
 *   3. **Settlement is a single credit of the payout snapshotted at stocking,
 *      never a second debit and never a re-read of the catalogue.** A retune
 *      between stocking and collection pays what the player agreed to.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * Deliberately absent: awardWager. Ante Up grants XP on a wager because the
 * wager can lose; a Homestead stake cannot, and XP for parking Gold would make
 * this a progression faucet on top of a Gold faucet.
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
  return {
    plots: await snapshots(profile.id, now),
    profile,
    feed: await readHomesteadFeed(profile.id),
  };
}

/** The whole farm, as the client renders it. */
export async function readHomestead(token: string, now = new Date()): Promise<HomesteadView> {
  return view(await ensureProfile(token), now);
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

  // Rule 1: the stake leaves first.
  const debited = await spendGoldByProfile(profile.id, def.stake);
  if (!debited) {
    throw new HomesteadRequestError(
      `You need ${def.stake.toLocaleString()} Gold for that.`,
      400,
    );
  }

  let stocked: StoredHomesteadPlot | null;
  try {
    stocked = await stockHomesteadPlot(plot, {
      stock,
      stake: def.stake,
      payout: def.payout,
      startedAt: now,
      readyAt: new Date(now.getTime() + def.durationMs),
      // An animal counts as fed the moment it arrives; a crop never eats.
      lastFedAt: def.hungerMs === null ? null : now,
    });
  } catch (error) {
    // The database refused outright -- the trigger raising on a cap race or a
    // ceiling desync arrives HERE as a throw, never as the null below -- and
    // nothing came into existence, so the player must not have paid for it.
    await creditGoldByProfile(profile.id, def.stake).catch(() => null);
    throw error;
  }
  if (!stocked) {
    // Lost the guarded write (another tab moved this plot first): same rule,
    // the stake goes back.
    await creditGoldByProfile(profile.id, def.stake).catch(() => null);
    throw new HomesteadRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
}

/** Buys a shipment of feed. Pure sink: Gold out, servings in. */
export async function buyHomesteadFeed(
  token: string,
  itemId: string,
  now = new Date(),
): Promise<HomesteadView> {
  const item = HOMESTEAD_FEED[itemId];
  if (!item) throw new HomesteadRequestError("No such shipment.", 400);
  const profile = await ensureProfile(token);

  // Rule 1: the Gold leaves before the servings land.
  const debited = await spendGoldByProfile(profile.id, item.cost);
  if (!debited) {
    throw new HomesteadRequestError(
      `You need ${item.cost.toLocaleString()} Gold for a ${item.label}.`,
      400,
    );
  }

  try {
    await adjustHomesteadFeed(profile.id, item.servings);
  } catch (error) {
    await creditGoldByProfile(profile.id, item.cost).catch(() => null);
    throw error;
  }

  return view(debited, now);
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
  const debited = await spendGoldByProfile(profile.id, fee);
  if (!debited) {
    throw new HomesteadRequestError(
      `Clearing this costs ${fee.toLocaleString()} Gold.`,
      400,
      { round: await snapshots(profile.id, now) },
    );
  }

  let cleared: StoredHomesteadPlot | null;
  try {
    cleared = await clearHomesteadMuck(plot);
  } catch (error) {
    await creditGoldByProfile(profile.id, fee).catch(() => null);
    throw error;
  }
  if (!cleared) {
    await creditGoldByProfile(profile.id, fee).catch(() => null);
    throw new HomesteadRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return view(debited, now);
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
 * Sells a ready plot's produce. Allowed while banned, same posture as
 * resigning a duel: it only returns Gold already committed, and stranding a
 * stake inside a suspended account's grid forever is a punishment nobody
 * designed.
 */
export async function collectHomestead(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<
  HomesteadView & { collected: { stock: HomesteadStock; stake: number; payout: number; mucked: boolean } }
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
  // its snapshotted stake/payout are the truth about what was staked and what
  // is owed.
  const collected = {
    stock,
    stake: plot.stake ?? 0,
    payout: plot.payout ?? 0,
    mucked: muckFee !== null,
  };

  // Rule 3: one credit, of the snapshot. Never throws -- the plot is already
  // durably settled, and a credit failure must not turn a finished collection
  // into an error response on top of the missing Gold. Logged loudly, same
  // reasoning as ante-up-service.ts's payOutWin.
  if (collected.payout > 0) {
    try {
      await creditGoldByProfile(profile.id, collected.payout);
    } catch (error) {
      console.error("homestead.payout_credit_failed", {
        profileId: profile.id,
        plotIndex,
        payout: collected.payout,
        error,
      });
    }
  }

  await recordHomesteadHarvest({
    profileId: profile.id,
    plotIndex,
    stock,
    stake: collected.stake,
    payout: collected.payout,
    startedAt: plot.startedAt ?? now.toISOString(),
    collectedAt: now.toISOString(),
  });

  return { ...(await view(profile, now)), collected };
}

/** Maps a thrown error to the response every Homestead route sends. */
export function toHomesteadErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That plot could not be worked.");
}

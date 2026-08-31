import "server-only";
import { NextResponse } from "next/server";
import {
  MINT_CONCURRENT_NODE_CAP,
  MINT_FREE_PLOTS,
  MINT_GRID_PLOTS,
  MINT_NODES,
  isMintNodeType,
  mintPlotPrice,
  type MintNodeType,
} from "@/lib/mint/nodes";
import { isMintPlotRipe, toMintPlotSnapshots, type MintPlotSnapshot } from "@/lib/mint/plots";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import {
  MintPlotExists,
  countGrowingMintNodes,
  createMintPlot,
  getMintPlot,
  harvestMintNode,
  listMintPlots,
  plantMintNode,
  recordMintHarvest,
  type StoredMintPlot,
} from "./mint-store";
import { creditGoldByProfile, ensureProfile, spendGoldByProfile } from "./profile-store";

/**
 * Everything between a Sovereign Mint request and the wallet.
 *
 * A Mint node is a *guaranteed* win -- the only staked thing in the app with
 * no way to lose -- so the ordering discipline every staked service restates
 * matters here with nothing to hide behind:
 *
 *   1. **The Gold leaves the wallet before the thing it pays for exists.**
 *      A plot purchase debits before the row inserts; a plant debits before
 *      the guarded plant write. Either write failing refunds.
 *   2. **A payout is credited only after the version-guarded harvest write
 *      is confirmed.** harvestMintNode returns null on a lost race, a stale
 *      version, or a not-actually-ripe row, and null must never pay: the
 *      writer that wins the race is the one that pays.
 *   3. **Settlement is a single credit of the payout snapshotted at plant,
 *      never a second debit and never a re-read of MINT_NODES.** A retune
 *      between plant and harvest pays what the player agreed to.
 *
 * There is no rule 4 (escrow released exactly once): no second party.
 *
 * Deliberately absent: awardWager. Ante Up grants XP on a wager because the
 * wager can lose; a Mint stake cannot, and XP for parking Gold would make
 * this a progression faucet on top of a Gold faucet.
 */

/** Refuses a Mint request in a way the player can act on. */
export class MintRequestError extends ArcadeRequestError<MintPlotSnapshot[], never> {
  readonly name = "MintRequestError";
}

function parsePlotIndex(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MINT_GRID_PLOTS) {
    throw new MintRequestError("Not a real plot.", 400);
  }
  return value;
}

async function snapshots(profileId: string, now: Date): Promise<MintPlotSnapshot[]> {
  return toMintPlotSnapshots(await listMintPlots(profileId), now);
}

/** The whole treasury, as the client renders it. */
export async function readMintTreasury(
  token: string,
  now = new Date(),
): Promise<{ plots: MintPlotSnapshot[]; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  return { plots: await snapshots(profile.id, now), profile };
}

/**
 * Buys the next locked plot. Plots unlock strictly in ladder order -- the
 * doubling prices assume it -- so the request names the plot only to confirm
 * the player bought the tile they were looking at.
 */
export async function buyMintPlot(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<{ plots: MintPlotSnapshot[]; profile: PlayerProfile }> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const price = mintPlotPrice(plotIndex);
  if (price === null) throw new MintRequestError("That plot is not for sale.", 400);

  const owned = await listMintPlots(profile.id);
  const ownedIndexes = new Set(owned.map((plot) => plot.plotIndex));
  for (let index = MINT_FREE_PLOTS + 1; index < plotIndex; index += 1) {
    if (!ownedIndexes.has(index)) {
      throw new MintRequestError("Plots unlock in order. Buy the cheaper one first.", 409, {
        round: toMintPlotSnapshots(owned, now),
      });
    }
  }
  if (ownedIndexes.has(plotIndex)) {
    throw new MintRequestError("You already own this plot.", 409, {
      round: toMintPlotSnapshots(owned, now),
    });
  }

  // Rule 1: the Gold leaves first. Null is "cannot afford", not an error --
  // spendGoldByProfile is the authority.
  const debited = await spendGoldByProfile(profile.id, price);
  if (!debited) {
    throw new MintRequestError(`You need ${price.toLocaleString()} Gold to expand.`, 400);
  }

  try {
    await createMintPlot(profile.id, plotIndex);
  } catch (error) {
    // The plot never came into existence, so the player must not have paid
    // for it.
    await creditGoldByProfile(profile.id, price).catch(() => null);
    if (error instanceof MintPlotExists) {
      throw new MintRequestError(error.message, 409, { round: await snapshots(profile.id, now) });
    }
    throw error;
  }

  return { plots: await snapshots(profile.id, now), profile: debited };
}

/**
 * A free plot's row is created lazily on first plant, uncharged. A 23505
 * race here just means another tab created it first; read it back.
 */
async function ensureFreePlotRow(profileId: string, plotIndex: number): Promise<StoredMintPlot> {
  const existing = await getMintPlot(profileId, plotIndex);
  if (existing) return existing;
  try {
    return await createMintPlot(profileId, plotIndex);
  } catch (error) {
    if (error instanceof MintPlotExists) {
      const raced = await getMintPlot(profileId, plotIndex);
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * Stakes Gold into a node on an empty plot the player owns.
 *
 * The payout and maturity written here are snapshots (rule 3): MINT_NODES is
 * read exactly once, now, and never again for this node.
 */
export async function plantMintNodeOnPlot(
  token: string,
  input: { plotIndex: number; nodeType: string },
  now = new Date(),
): Promise<{ plots: MintPlotSnapshot[]; profile: PlayerProfile }> {
  const plotIndex = parsePlotIndex(input.plotIndex);
  if (!isMintNodeType(input.nodeType)) throw new MintRequestError("Not a real node.", 400);
  const nodeType: MintNodeType = input.nodeType;
  const node = MINT_NODES[nodeType];
  const profile = await ensureProfile(token);

  const plot =
    plotIndex <= MINT_FREE_PLOTS
      ? await ensureFreePlotRow(profile.id, plotIndex)
      : await getMintPlot(profile.id, plotIndex);
  if (!plot) {
    throw new MintRequestError("Unlock this plot first.", 409, {
      round: await snapshots(profile.id, now),
    });
  }
  if (plot.status !== "empty") {
    throw new MintRequestError("Something is already growing here.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The cap is what bounds this faucet; see lib/mint/nodes.ts. Checked here
  // for a clean 409, enforced for real by the advisory-locked trigger in the
  // migration, which two racing requests cannot squeeze past.
  const growing = await countGrowingMintNodes(profile.id);
  if (growing >= MINT_CONCURRENT_NODE_CAP) {
    throw new MintRequestError(
      `Your crews can only tend ${MINT_CONCURRENT_NODE_CAP} nodes at once. Harvest one first.`,
      409,
      { round: await snapshots(profile.id, now) },
    );
  }

  // Rule 1: the stake leaves first.
  const debited = await spendGoldByProfile(profile.id, node.stake);
  if (!debited) {
    throw new MintRequestError(`You need ${node.stake.toLocaleString()} Gold to plant this.`, 400);
  }

  let planted: StoredMintPlot | null;
  try {
    planted = await plantMintNode(plot, {
      nodeType,
      stake: node.stake,
      payout: node.payout,
      plantedAt: now,
      maturesAt: new Date(now.getTime() + node.durationMs),
    });
  } catch (error) {
    // The database refused the plant outright -- the trigger raising on the
    // cap race or a ceiling desync arrives HERE as a throw, never as the
    // null below -- and the node never came into existence, so the player
    // must not have paid for it. Same try/catch-refund shape as buyMintPlot
    // above; missing it was a real found-in-review money bug.
    await creditGoldByProfile(profile.id, node.stake).catch(() => null);
    throw error;
  }
  if (!planted) {
    // Lost the guarded write (another tab moved this plot first): same
    // rule, the stake goes back.
    await creditGoldByProfile(profile.id, node.stake).catch(() => null);
    throw new MintRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  return { plots: await snapshots(profile.id, now), profile: debited };
}

/**
 * Cashes a ripe node. Allowed while banned, same posture as resigning a
 * duel: it only returns Gold already committed, and stranding a stake inside
 * a suspended account's grid forever is a punishment nobody designed.
 */
export async function harvestMintPlot(
  token: string,
  plotIndexInput: number,
  now = new Date(),
): Promise<{ plots: MintPlotSnapshot[]; profile: PlayerProfile; harvested: { nodeType: MintNodeType; stake: number; payout: number } }> {
  const plotIndex = parsePlotIndex(plotIndexInput);
  const profile = await ensureProfile(token);

  const plot = await getMintPlot(profile.id, plotIndex);
  if (!plot || plot.status !== "growing") {
    throw new MintRequestError("Nothing to harvest here.", 404, {
      round: await snapshots(profile.id, now),
    });
  }
  if (!isMintPlotRipe(plot, now)) {
    // The client's clock is decoration; this is the answer that counts, and
    // the store's own matures_at guard backs it even if this check is raced.
    throw new MintRequestError("Not ripe yet.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  const settled = await harvestMintNode(plot, now);
  if (!settled) {
    // Rule 2: a lost race did not happen; whoever won it was paid instead.
    throw new MintRequestError("That plot moved on.", 409, {
      round: await snapshots(profile.id, now),
    });
  }

  // The guarded write above confirmed `plot` was exactly the row settled, so
  // its snapshotted stake/payout are the truth about what was staked and
  // what is owed.
  const harvested = {
    nodeType: plot.nodeType as MintNodeType,
    stake: plot.stake ?? 0,
    payout: plot.payout ?? 0,
  };

  // Rule 3: one credit, of the snapshot. Never throws -- the node is already
  // durably settled, and a credit failure must not turn a finished harvest
  // into an error response on top of the missing Gold. Logged loudly, same
  // reasoning as ante-up-service.ts's payOutWin.
  if (harvested.payout > 0) {
    try {
      await creditGoldByProfile(profile.id, harvested.payout);
    } catch (error) {
      console.error("mint.payout_credit_failed", { profileId: profile.id, plotIndex, payout: harvested.payout, error });
    }
  }

  await recordMintHarvest({
    profileId: profile.id,
    plotIndex,
    nodeType: harvested.nodeType,
    stake: harvested.stake,
    payout: harvested.payout,
    plantedAt: plot.plantedAt ?? now.toISOString(),
    harvestedAt: now.toISOString(),
  });

  return { plots: await snapshots(profile.id, now), profile, harvested };
}

/** Maps a thrown error to the response every Mint route sends. */
export function toMintErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That plot could not be worked.");
}

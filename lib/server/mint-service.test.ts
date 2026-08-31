import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MintRequestError,
  buyMintPlot,
  harvestMintPlot,
  plantMintNodeOnPlot,
  readMintTreasury,
} from "./mint-service";
import {
  __mintHarvestsForTest,
  __resetMintPlotsForTest,
  createMintPlot,
  getMintPlot,
  harvestMintNode,
  plantMintNode,
} from "./mint-store";
import { adjustGold, ensureProfile } from "./profile-store";
import { MINT_CONCURRENT_NODE_CAP, MINT_FREE_PLOTS, MINT_NODES, mintPlotPrice } from "@/lib/mint/nodes";

// Passthrough by default; one test swaps plantMintNode's next call for a
// thrown error, standing in for the DB trigger raising (which the memory
// branch cannot do). Found in security review: that throw once skipped the
// refund entirely.
vi.mock("./mint-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mint-store")>();
  return { ...actual, plantMintNode: vi.fn(actual.plantMintNode) };
});

/**
 * The Sovereign Mint money contract, in memory mode.
 *
 * A Mint node is a guaranteed win, so there is no losing branch to check --
 * what has to hold is exact and it all sits on the guards: the stake leaves
 * exactly once at plant, the snapshotted payout is credited exactly once at
 * harvest and never before maturity, and every failure path either never
 * debits or refunds.
 */

const T0 = new Date("2026-08-31T12:00:00.000Z");
const PULSE_RIPE = new Date(T0.getTime() + MINT_NODES.pulse.durationMs);

async function funded(gold = 500_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

beforeEach(() => {
  __resetMintPlotsForTest();
});

describe("planting", () => {
  it("debits the stake and snapshots payout and maturity onto the plot", async () => {
    const { token, id } = await funded();
    const before = await balance(token);

    await plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0);

    expect(await balance(token)).toBe(before - MINT_NODES.pulse.stake);
    const row = await getMintPlot(id, 1);
    expect(row?.status).toBe("growing");
    expect(row?.stake).toBe(MINT_NODES.pulse.stake);
    expect(row?.payout).toBe(MINT_NODES.pulse.payout);
    expect(row?.maturesAt).toBe(PULSE_RIPE.toISOString());
  });

  it("creates a free plot's row lazily without charging for the plot", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await plantMintNodeOnPlot(token, { plotIndex: MINT_FREE_PLOTS, nodeType: "pulse" }, T0);
    // Only the stake left; no plot price on a free tile.
    expect(await balance(token)).toBe(before - MINT_NODES.pulse.stake);
  });

  it("refuses a stake the player cannot cover, without debiting", async () => {
    const { token } = await funded(MINT_NODES.pulse.stake - 1);
    await expect(plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0)).rejects.toBeInstanceOf(
      MintRequestError,
    );
    expect(await balance(token)).toBe(MINT_NODES.pulse.stake - 1);
  });

  it("refuses an occupied plot without touching the wallet", async () => {
    const { token } = await funded();
    await plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0);
    const after = await balance(token);
    await expect(plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "core" }, T0)).rejects.toBeInstanceOf(
      MintRequestError,
    );
    expect(await balance(token)).toBe(after);
  });

  it("refuses a locked plot without touching the wallet", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(
      plantMintNodeOnPlot(token, { plotIndex: MINT_FREE_PLOTS + 1, nodeType: "pulse" }, T0),
    ).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("caps concurrent nodes, and the refused plant costs nothing", async () => {
    const { token } = await funded();
    for (let plot = 1; plot <= MINT_CONCURRENT_NODE_CAP; plot += 1) {
      await plantMintNodeOnPlot(token, { plotIndex: plot, nodeType: "pulse" }, T0);
    }
    const after = await balance(token);
    await expect(
      plantMintNodeOnPlot(token, { plotIndex: MINT_CONCURRENT_NODE_CAP + 1, nodeType: "pulse" }, T0),
    ).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(after);
  });

  it("refunds the stake when the store write throws (the DB trigger refusing)", async () => {
    const { token } = await funded();
    const before = await balance(token);
    vi.mocked(plantMintNode).mockRejectedValueOnce(new Error("Could not plant that node: check_violation"));

    await expect(plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "matrix" }, T0)).rejects.toThrow(
      "check_violation",
    );
    // Rule 1's second half: the write failed, so the debit came back.
    expect(await balance(token)).toBe(before);
  });

  it("settles a two-tab race to one node and one stake", async () => {
    const { token } = await funded();
    const before = await balance(token);

    // Whichever interleaving happens, exactly one plant wins; the loser
    // either never debits (it read the row late) or debits and refunds (it
    // lost the guarded write). Both end with one stake gone.
    const results = await Promise.allSettled([
      plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0),
      plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balance(token)).toBe(before - MINT_NODES.pulse.stake);
  });
});

describe("harvesting", () => {
  it("refuses before maturity and credits nothing", async () => {
    const { token } = await funded();
    await plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0);
    const after = await balance(token);

    const early = new Date(PULSE_RIPE.getTime() - 1);
    await expect(harvestMintPlot(token, 1, early)).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(after);
  });

  it("credits the payout exactly once, and a second harvest finds nothing", async () => {
    const { token } = await funded();
    await plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0);
    const staked = await balance(token);

    const { harvested, plots } = await harvestMintPlot(token, 1, PULSE_RIPE);
    expect(harvested.payout).toBe(MINT_NODES.pulse.payout);
    expect(plots[0].state).toBe("empty");
    expect(await balance(token)).toBe(staked + MINT_NODES.pulse.payout);

    await expect(harvestMintPlot(token, 1, PULSE_RIPE)).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(staked + MINT_NODES.pulse.payout);
  });

  it("pays the payout snapshotted on the row, not today's tuning table", async () => {
    // A plant under old tuning, simulated by writing the node through the
    // store with a payout MINT_NODES has never offered.
    const { token, id } = await funded();
    const row = await createMintPlot(id, 1);
    await plantMintNode(row, {
      nodeType: "pulse",
      stake: 1000,
      payout: 7777,
      plantedAt: T0,
      maturesAt: PULSE_RIPE,
    });
    const before = await balance(token);

    const { harvested } = await harvestMintPlot(token, 1, PULSE_RIPE);
    expect(harvested.payout).toBe(7777);
    expect(await balance(token)).toBe(before + 7777);
  });

  it("lets a doubly-read row settle at most once at the store", async () => {
    const { id } = await funded();
    const created = await createMintPlot(id, 1);
    await plantMintNode(created, {
      nodeType: "pulse",
      stake: 1000,
      payout: 1050,
      plantedAt: T0,
      maturesAt: PULSE_RIPE,
    });
    const current = await getMintPlot(id, 1);

    expect(await harvestMintNode(current!, PULSE_RIPE)).not.toBeNull();
    // The second writer read the same version; it lost, and null never pays.
    expect(await harvestMintNode(current!, PULSE_RIPE)).toBeNull();
  });

  it("refuses an early settle at the store even when the service check is bypassed", async () => {
    const { id } = await funded();
    const created = await createMintPlot(id, 1);
    await plantMintNode(created, {
      nodeType: "pulse",
      stake: 1000,
      payout: 1050,
      plantedAt: T0,
      maturesAt: PULSE_RIPE,
    });
    const current = await getMintPlot(id, 1);
    expect(await harvestMintNode(current!, new Date(PULSE_RIPE.getTime() - 1))).toBeNull();
  });

  it("records every settled harvest in the ledger", async () => {
    const { token, id } = await funded();
    await plantMintNodeOnPlot(token, { plotIndex: 2, nodeType: "pulse" }, T0);
    await harvestMintPlot(token, 2, PULSE_RIPE);

    const entries = __mintHarvestsForTest().filter((entry) => entry.profileId === id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      plotIndex: 2,
      nodeType: "pulse",
      stake: MINT_NODES.pulse.stake,
      payout: MINT_NODES.pulse.payout,
    });
  });
});

describe("buying plots", () => {
  const firstPaid = MINT_FREE_PLOTS + 1;

  it("debits the ladder price and unlocks the plot", async () => {
    const { token } = await funded();
    const before = await balance(token);
    const { plots } = await buyMintPlot(token, firstPaid, T0);
    expect(await balance(token)).toBe(before - (mintPlotPrice(firstPaid) as number));
    expect(plots[firstPaid - 1].state).toBe("empty");
    expect(plots.filter((plot) => plot.purchasable).map((plot) => plot.plotIndex)).toEqual([firstPaid + 1]);
  });

  it("refuses skipping ahead on the ladder, without debiting", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(buyMintPlot(token, firstPaid + 1, T0)).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a plot already owned, without debiting again", async () => {
    const { token } = await funded();
    await buyMintPlot(token, firstPaid, T0);
    const after = await balance(token);
    await expect(buyMintPlot(token, firstPaid, T0)).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(after);
  });

  it("refuses a price the player cannot cover, without debiting", async () => {
    const { token } = await funded((mintPlotPrice(firstPaid) as number) - 1);
    const before = await balance(token);
    await expect(buyMintPlot(token, firstPaid, T0)).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("refuses to sell a free plot", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(buyMintPlot(token, 1, T0)).rejects.toBeInstanceOf(MintRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("settles a two-tab race to one plot and one price", async () => {
    const { token } = await funded();
    const before = await balance(token);
    const results = await Promise.allSettled([buyMintPlot(token, firstPaid, T0), buyMintPlot(token, firstPaid, T0)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balance(token)).toBe(before - (mintPlotPrice(firstPaid) as number));
  });
});

describe("reading", () => {
  it("shows a fresh treasury as four empty plots and a priced ladder", async () => {
    const { token } = await funded();
    const { plots } = await readMintTreasury(token, T0);
    expect(plots.filter((plot) => plot.state === "empty")).toHaveLength(MINT_FREE_PLOTS);
    expect(plots.filter((plot) => plot.state === "locked")).toHaveLength(plots.length - MINT_FREE_PLOTS);
  });

  it("derives ripeness from the maturity snapshot", async () => {
    const { token } = await funded();
    await plantMintNodeOnPlot(token, { plotIndex: 1, nodeType: "pulse" }, T0);

    const mid = await readMintTreasury(token, new Date(T0.getTime() + MINT_NODES.pulse.durationMs / 2));
    expect(mid.plots[0].state).toBe("growing");

    const ripe = await readMintTreasury(token, PULSE_RIPE);
    expect(ripe.plots[0].state).toBe("ripe");
  });
});

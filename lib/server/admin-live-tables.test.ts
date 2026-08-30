import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { cancelWaitingPvpTable, listWaitingPvpTables } from "./admin-live-tables";
import { TIER_CONFIG } from "@/lib/game/tiers";
import { claimHeadsUpSeat, createHeadsUpTableRow, __resetHeadsUpTablesForTest } from "./heads-up-store";
import { claimCribbageSeat, createCribbageTableRow, __resetCribbageTablesForTest } from "./cribbage-table-store";
import { claimSitAndGoSeat, createSitAndGoTableRow, __resetSitAndGoTablesForTest } from "./sit-and-go-store";
import { adjustGold, ensureProfile, spendGoldByProfile } from "./profile-store";

/**
 * Covers the exact bug found live 2026-08-30: a heads-up table opened
 * 2026-08-26 sat in `waiting` with zero rows in heads_up_table_players (debris
 * from openHeadsUpQuickPlay's own create-new-table branch not cleaning up on
 * a failed seat claim, unlike its invite/cribbage/Sit & Go siblings -- fixed
 * alongside this file). Cancelling it through the admin console returned a
 * clean, empty "success" and the row never moved -- it "came back" on the
 * next page load because nothing had actually changed. See
 * admin-live-tables.ts's own comment on cancelWaitingPvpTable.
 */

const STAKE = TIER_CONFIG["1k"].minBuyIn;

async function funded(gold = 10_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

beforeEach(() => {
  __resetHeadsUpTablesForTest();
  __resetCribbageTablesForTest();
  __resetSitAndGoTablesForTest();
});

describe("cancelWaitingPvpTable", () => {
  it("refunds and removes a normal waiting table with a seated host", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    const table = await createHeadsUpTableRow(host.id, "1k", STAKE, null);
    await claimHeadsUpSeat(table.id, host.id, host.token);

    const result = await cancelWaitingPvpTable("heads-up", table.id);
    expect(result).toEqual({ cancelledSeats: 1, refunded: STAKE, refundFailures: 0 });

    const listed = await listWaitingPvpTables();
    expect(listed.find((row) => row.id === table.id)).toBeUndefined();
    expect((await ensureProfile(host.token)).goldBalance).toBe(10_000);
  });

  it("cancels and refunds a heads-up table that never got a seat claimed -- the exact live repro", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    // Deliberately skips claimHeadsUpSeat, reproducing the orphaned row: a
    // table stuck in 'waiting' with nobody in heads_up_table_players at all.
    const table = await createHeadsUpTableRow(host.id, "1k", STAKE, null);

    expect((await listWaitingPvpTables()).find((row) => row.id === table.id)?.seatedCount).toBe(0);

    const result = await cancelWaitingPvpTable("heads-up", table.id);
    expect(result).toEqual({ cancelledSeats: 1, refunded: STAKE, refundFailures: 0 });

    // The whole point: it must not still be there to "come back" on a refresh.
    const listed = await listWaitingPvpTables();
    expect(listed.find((row) => row.id === table.id)).toBeUndefined();
    expect((await ensureProfile(host.token)).goldBalance).toBe(10_000);
  });

  it("cancels and refunds a seatless cribbage table the same way", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    const table = await createCribbageTableRow(host.id, STAKE);

    const result = await cancelWaitingPvpTable("cribbage", table.id);
    expect(result).toEqual({ cancelledSeats: 1, refunded: STAKE, refundFailures: 0 });
    expect((await listWaitingPvpTables()).find((row) => row.id === table.id)).toBeUndefined();
    expect((await ensureProfile(host.token)).goldBalance).toBe(10_000);
  });

  it("cancels and refunds a seatless Sit & Go table the same way", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    const table = await createSitAndGoTableRow(host.id, "1k", STAKE);

    const result = await cancelWaitingPvpTable("sit-and-go", table.id);
    expect(result).toEqual({ cancelledSeats: 1, refunded: STAKE, refundFailures: 0 });
    expect((await listWaitingPvpTables()).find((row) => row.id === table.id)).toBeUndefined();
    expect((await ensureProfile(host.token)).goldBalance).toBe(10_000);
  });

  it("lists and cancels a seated cribbage table normally", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    const table = await createCribbageTableRow(host.id, STAKE);
    await claimCribbageSeat(table.id, host.id);

    expect((await listWaitingPvpTables()).find((row) => row.id === table.id)).toMatchObject({
      seatedCount: 1,
      capacity: 4,
      stake: STAKE,
    });

    const result = await cancelWaitingPvpTable("cribbage", table.id);
    expect(result).toEqual({ cancelledSeats: 1, refunded: STAKE, refundFailures: 0 });
    expect((await ensureProfile(host.token)).goldBalance).toBe(10_000);
  });

  it("lists and cancels a seated Sit & Go table normally", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    const table = await createSitAndGoTableRow(host.id, "1k", STAKE);
    await claimSitAndGoSeat(table.id, host.id, host.token);

    expect((await listWaitingPvpTables()).find((row) => row.id === table.id)).toMatchObject({
      seatedCount: 1,
      capacity: 6,
      stake: STAKE,
    });

    const result = await cancelWaitingPvpTable("sit-and-go", table.id);
    expect(result).toEqual({ cancelledSeats: 1, refunded: STAKE, refundFailures: 0 });
    expect((await ensureProfile(host.token)).goldBalance).toBe(10_000);
  });

  it("throws instead of reporting a quiet no-op success when the table already changed", async () => {
    const host = await funded();
    await spendGoldByProfile(host.id, STAKE);
    const table = await createHeadsUpTableRow(host.id, "1k", STAKE, null);
    await claimHeadsUpSeat(table.id, host.id, host.token);

    // Cancel it once for real, then try again on the now-cancelled table.
    await cancelWaitingPvpTable("heads-up", table.id);
    await expect(cancelWaitingPvpTable("heads-up", table.id)).rejects.toThrow();
  });
});

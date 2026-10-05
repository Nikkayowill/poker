import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STACKACRES_DAY_MS } from "@/lib/stackacres/clock";
import { HIRED_HAND_BEDS_TO_HIRE, HIRED_HAND_DAILY_WAGE } from "@/lib/stackacres/hired-hand";
import { SECTOR_LADDER } from "@/lib/stackacres/sectors";
import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS } from "@/lib/stackacres/world";
import { adjustGold, ensureProfile } from "./profile-store";
import { __resetStackAcresHiredHandForTest } from "./stackacres-hired-hand-store";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSeedStockForTest, adjustStackAcresSeedStock } from "./stackacres-seed-store";
import {
  dismissStackAcresHand,
  hireStackAcresHand,
  payStackAcresUpkeep,
  runStackAcresHiredHand,
} from "./stackacres-service";
import { __resetStackAcresSoilTilesForTest, placeStackAcresSoilTile } from "./stackacres-soil-store";
import {
  __resetStackAcresForTest,
  recordStackAcresCropFieldsUnlocked,
  takeStackAcresUpkeep,
  recordStackAcresSectorCleared,
} from "./stackacres-store";

/**
 * The nightly reconcile cron refunds every ledgered debit that has no credit
 * or confirm row under its own correlation id (find_orphaned_gold_debits).
 * Memory mode has no sweep, so this records what the farm writes to the
 * ledger and runs the same rule over it.
 */
const ledger = vi.hoisted(() => ({
  debits: new Map<string, number>(),
  settled: new Set<string>(),
}));

vi.mock("./profile-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profile-store")>();
  return {
    ...actual,
    spendGoldByProfileLedgered: async (profileId: string, amount: number, correlationId: string, reason: string) => {
      const result = await actual.spendGoldByProfileLedgered(profileId, amount, correlationId, reason);
      if (result.success && !result.alreadyApplied) ledger.debits.set(correlationId, amount);
      return result;
    },
    creditGoldByProfileLedgered: async (profileId: string, amount: number, correlationId: string, reason: string) => {
      const result = await actual.creditGoldByProfileLedgered(profileId, amount, correlationId, reason);
      if (result.success) ledger.settled.add(correlationId);
      return result;
    },
    confirmGoldDebitLedgered: async (correlationId: string) => {
      await actual.confirmGoldDebitLedgered(correlationId);
      if (ledger.debits.has(correlationId)) ledger.settled.add(correlationId);
    },
  };
});

vi.mock("./stackacres-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stackacres-store")>();
  return { ...actual, takeStackAcresUpkeep: vi.fn(actual.takeStackAcresUpkeep) };
});

/** What the 05:00 sweep would hand back. */
function sweepRefund(): number {
  let total = 0;
  for (const [correlation, amount] of ledger.debits) if (!ledger.settled.has(correlation)) total += amount;
  return total;
}

const T0 = new Date(Math.floor(Date.parse("2026-10-04T12:00:00.000Z") / STACKACRES_DAY_MS) * STACKACRES_DAY_MS + 60_000);

async function farm(gold: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  await recordStackAcresCropFieldsUnlocked(profile.id, T0);
  await adjustStackAcresSeedStock(profile.id, "wheat", 100);
  const origin = soilTileAt(CROP_FIELD_BEDS.x + SOIL_TILE, CROP_FIELD_BEDS.y + SOIL_TILE);
  for (let i = 0; i < HIRED_HAND_BEDS_TO_HIRE; i += 1) {
    await placeStackAcresSoilTile(profile.id, origin.tx + (i % 3), origin.ty + Math.floor(i / 3));
  }
  return token;
}

async function gold(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

beforeEach(() => {
  ledger.debits.clear();
  ledger.settled.clear();
  __resetStackAcresForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresHiredHandForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresIntentsForTest();
  __resetStackAcresRevisionsForTest();
});

describe("farm Gold spends and the nightly orphan sweep", () => {
  it("leaves nothing to refund after Earl is hired and paid his next day", async () => {
    const token = await farm(1_000);
    await hireStackAcresHand(token, T0);
    await runStackAcresHiredHand(token, new Date(T0.getTime() + STACKACRES_DAY_MS));
    expect(ledger.debits.size).toBe(2);
    expect(sweepRefund()).toBe(0);
  });

  it("pays nothing extra for a burst of hires, then or overnight", async () => {
    const token = await farm(1_000);
    for (let round = 0; round < 3; round += 1) {
      await Promise.allSettled(Array.from({ length: 5 }, () => hireStackAcresHand(token, T0)));
      await dismissStackAcresHand(token, T0);
    }
    const spent = 1_000 - (await gold(token));
    expect(spent).toBe(3 * HIRED_HAND_DAILY_WAGE);
    expect(sweepRefund()).toBe(0);
  });

  it("leaves nothing to refund after the farm's upkeep is paid on open", async () => {
    const token = await farm(500_000);
    const profile = await ensureProfile(token);
    for (const sector of SECTOR_LADDER) await recordStackAcresSectorCleared(profile.id, sector, T0);
    const paid = await payStackAcresUpkeep(token, T0);
    expect(paid.upkeepCharged).toBeGreaterThan(0);
    expect(sweepRefund()).toBe(0);
  });

  it("refunds a lost upkeep charge once, not again overnight", async () => {
    const token = await farm(500_000);
    const profile = await ensureProfile(token);
    for (const sector of SECTOR_LADDER) await recordStackAcresSectorCleared(profile.id, sector, T0);
    const before = await gold(token);
    vi.mocked(takeStackAcresUpkeep).mockResolvedValueOnce(0);
    expect((await payStackAcresUpkeep(token, T0)).upkeepCharged).toBe(0);
    expect(await gold(token)).toBe(before);
    expect(ledger.debits.size).toBe(1);
    expect(sweepRefund()).toBe(0);
  });
});

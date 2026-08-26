import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSitAndGoTablesForTest,
  cancelStaleSitAndGoTable,
  claimSitAndGoSeat,
  createSitAndGoTableRow,
  dealSitAndGoTable,
  getSitAndGoSeats,
  leaveSitAndGoTable,
  settleSitAndGoTable,
  setSitAndGoGameId,
} from "./sit-and-go-store";

beforeEach(() => {
  __resetSitAndGoTablesForTest();
});

describe("claimSitAndGoSeat", () => {
  it("assigns the lowest OPEN seat, not the seated count -- a vacated seat is a real gap, not a collision", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    const a = await claimSitAndGoSeat(table.id, randomUUID(), randomUUID()); // seat 0
    const b = await claimSitAndGoSeat(table.id, randomUUID(), randomUUID()); // seat 1
    const c = await claimSitAndGoSeat(table.id, randomUUID(), randomUUID()); // seat 2
    expect([a.seat, b.seat, c.seat]).toEqual([0, 1, 2]);

    const bPlayerId = (await getSitAndGoSeats(table.id)).find((s) => s.seat === 1)!.playerId;
    await leaveSitAndGoTable(table.id, bPlayerId);

    const d = await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    expect(d.seat).toBe(1);

    const seats = await getSitAndGoSeats(table.id);
    expect(seats.map((s) => s.seat).sort()).toEqual([0, 1, 2]);
    expect(new Set(seats.map((s) => s.playerId)).size).toBe(seats.length);
  });

  it("refuses a 7th registration -- the table caps at SIT_AND_GO_SEATS (6)", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    for (let i = 0; i < 6; i += 1) {
      await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    }
    await expect(claimSitAndGoSeat(table.id, randomUUID(), randomUUID())).rejects.toThrow(/full/);
  });
});

describe("dealSitAndGoTable", () => {
  async function seatSix(table: { id: string }) {
    for (let i = 0; i < 6; i += 1) {
      await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    }
  }

  it("refuses to deal when the actual seated count no longer matches expectedSeats", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    for (let i = 0; i < 5; i += 1) {
      await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    }
    // A 6th registration lands in the gap before the deal call arrives --
    // exactly the race an exact-match guard, not a >=, is built to catch.
    await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());

    const dealt = await dealSitAndGoTable(table.id, 5); // stale -- 6 are actually seated
    expect(dealt).toBeNull();

    const stillWaiting = await getSitAndGoSeats(table.id);
    expect(stillWaiting).toHaveLength(6); // nobody's seat or stake was touched by the failed deal
  });

  it("deals when the expected count matches, and sets the prize pool", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    await seatSix(table);
    const dealt = await dealSitAndGoTable(table.id, 6);
    expect(dealt?.status).toBe("active");
    expect(dealt?.prizePool).toBe(6000);
    expect(dealt?.gameId).toBeNull(); // step 2 hasn't happened yet
  });

  it("records the game id exactly once, idempotent against a retry", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    await seatSix(table);
    const dealt = await dealSitAndGoTable(table.id, 6);
    const gameId = randomUUID();
    const recorded = await setSitAndGoGameId(dealt!.id, gameId);
    expect(recorded?.gameId).toBe(gameId);

    // A retry with a DIFFERENT game id must not overwrite the first one --
    // that's what makes step 2 safe to retry after a crash.
    const secondAttempt = await setSitAndGoGameId(dealt!.id, randomUUID());
    expect(secondAttempt).toBeNull();
    const reread = await getSitAndGoSeats(table.id);
    expect(reread).toHaveLength(6);
  });
});

describe("settleSitAndGoTable", () => {
  it("pays out exactly once under a simulated lost race", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    for (let i = 0; i < 6; i += 1) await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    const dealt = (await dealSitAndGoTable(table.id, 6))!;
    await setSitAndGoGameId(dealt.id, randomUUID());

    const winnerId = randomUUID();
    const first = await settleSitAndGoTable(dealt, winnerId);
    expect(first?.status).toBe("completed");
    expect(first?.winnerId).toBe(winnerId);

    // A second settlement attempt against the SAME stale `dealt` snapshot
    // (as if two requests both noticed the win at once) must lose the race.
    const second = await settleSitAndGoTable(dealt, winnerId);
    expect(second).toBeNull();
  });
});

describe("cancelStaleSitAndGoTable", () => {
  it("cancels an abandoned active table with no winner", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    for (let i = 0; i < 6; i += 1) await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    const dealt = (await dealSitAndGoTable(table.id, 6))!;

    const cancelled = await cancelStaleSitAndGoTable(dealt.id, dealt.version);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.winnerId).toBeNull();
  });

  it("loses the race against a real settlement -- whichever lands first wins", async () => {
    const table = await createSitAndGoTableRow(randomUUID(), "1k", 1000);
    for (let i = 0; i < 6; i += 1) await claimSitAndGoSeat(table.id, randomUUID(), randomUUID());
    const dealt = (await dealSitAndGoTable(table.id, 6))!;

    await settleSitAndGoTable(dealt, randomUUID());
    const cancelled = await cancelStaleSitAndGoTable(dealt.id, dealt.version);
    expect(cancelled).toBeNull();
  });
});

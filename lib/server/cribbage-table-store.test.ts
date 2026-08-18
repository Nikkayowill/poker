import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createCribbageState } from "@/lib/cribbage/engine";
import {
  __resetCribbageTablesForTest,
  claimCribbageSeat,
  createCribbageTableRow,
  dealCribbageTable,
  getCribbageSeats,
  leaveCribbageTable,
} from "./cribbage-table-store";

beforeEach(() => {
  __resetCribbageTablesForTest();
});

describe("claimCribbageSeat", () => {
  it("assigns the lowest OPEN seat, not the seated count -- a vacated seat is a real gap, not a collision", async () => {
    const table = await createCribbageTableRow(randomUUID(), 1000);
    const a = await claimCribbageSeat(table.id, randomUUID()); // seat 0
    const b = await claimCribbageSeat(table.id, randomUUID()); // seat 1
    const c = await claimCribbageSeat(table.id, randomUUID()); // seat 2
    expect([a.seat, b.seat, c.seat]).toEqual([0, 1, 2]);

    // Seat 1 leaves pre-deal.
    const bPlayerId = (await getCribbageSeats(table.id)).find((s) => s.seat === 1)!.playerId;
    await leaveCribbageTable(table.id, bPlayerId);

    // A new joiner must land on the now-open seat 1, NOT on seat 3 (which
    // would leave seat 1 permanently empty and collide with nobody only by
    // accident) and NOT on seat 2 (already held by `c`).
    const d = await claimCribbageSeat(table.id, randomUUID());
    expect(d.seat).toBe(1);

    const seats = await getCribbageSeats(table.id);
    expect(seats.map((s) => s.seat).sort()).toEqual([0, 1, 2]);
    // Every seat number is held by exactly one player -- no collision.
    expect(new Set(seats.map((s) => s.playerId)).size).toBe(seats.length);
  });
});

describe("dealCribbageTable", () => {
  it("refuses to deal when the actual seated count no longer matches what the state was built for", async () => {
    const table = await createCribbageTableRow(randomUUID(), 1000);
    const host = await claimCribbageSeat(table.id, randomUUID());
    await claimCribbageSeat(table.id, randomUUID());
    await claimCribbageSeat(table.id, randomUUID());
    // 3 seated. A state is built for 3 players (as the host-start path would).
    const state = createCribbageState(1, Date.now(), 3);

    // A 4th player joins in the gap before the deal call lands -- exactly
    // the race a ">=" guard would miss.
    await claimCribbageSeat(table.id, randomUUID());

    const dealt = await dealCribbageTable({
      tableId: table.id,
      actorId: host.hostId,
      requireHost: true,
      expectedSeats: 3, // stale -- 4 are actually seated now
      state,
    });
    expect(dealt).toBeNull();

    const stillWaiting = await getCribbageSeats(table.id);
    expect(stillWaiting).toHaveLength(4); // nobody's seat or stake was touched by the failed deal
  });

  it("deals when the expected count still matches", async () => {
    const table = await createCribbageTableRow(randomUUID(), 1000);
    const host = await claimCribbageSeat(table.id, randomUUID());
    await claimCribbageSeat(table.id, randomUUID());
    await claimCribbageSeat(table.id, randomUUID());
    const state = createCribbageState(1, Date.now(), 3);

    const dealt = await dealCribbageTable({
      tableId: table.id,
      actorId: host.hostId,
      requireHost: true,
      expectedSeats: 3,
      state,
    });
    expect(dealt?.status).toBe("active");
  });
});

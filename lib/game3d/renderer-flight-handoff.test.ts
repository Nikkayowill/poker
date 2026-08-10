import { describe, expect, it } from "vitest";
import { chipBreakdown } from "./denominations";
import { betSpotPosition, seatPosition } from "./seat-layout";
import { resumedBetFlight } from "./renderer-flight-handoff";

describe("renderer bet-flight handoff", () => {
  it("recreates an in-progress bet from the seat hands to its own bet spot", () => {
    const resumed = resumedBetFlight({ id: "hand-8-river-seat-2-450", slot: 2, amount: 150 });
    const seat = seatPosition(2);

    expect(resumed.key).toBe("resume-hand-8-river-seat-2-450");
    expect(resumed.kind).toBe("bet");
    expect(resumed.amount).toBe(150);
    expect(resumed.chips).toEqual(chipBreakdown(150));
    expect(resumed.from).toEqual({ x: seat.x * 0.82, y: 1.05, z: seat.z * 0.82 });
    expect(resumed.to).toEqual(betSpotPosition(2));
    expect(resumed.slot).toBe(2);
  });
});

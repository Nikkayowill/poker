import { describe, expect, it } from "vitest";
import { chipBreakdown } from "./denominations";
import { handLaunchPosition } from "./seat-layout";
import { pushStyleFor } from "./chip-push";
import { resumedBetFlight } from "./renderer-flight-handoff";

describe("renderer bet-flight handoff", () => {
  it("recreates an in-progress bet leaving the bettor's own hands", () => {
    const resumed = resumedBetFlight({ id: "hand-8-river-seat-2-450", slot: 2, amount: 150 });

    expect(resumed.key).toBe("resume-hand-8-river-seat-2-450");
    expect(resumed.kind).toBe("bet");
    expect(resumed.amount).toBe(150);
    expect(resumed.chips).toEqual(chipBreakdown(150));
    expect(resumed.hand).toEqual(handLaunchPosition(2));
    expect(resumed.slot).toBe(2);
  });

  it("takes the neutral bet cadence, since a handoff carries no action label", () => {
    const resumed = resumedBetFlight({ id: "x", slot: 1, amount: 100 });
    expect(resumed.style).toBe(pushStyleFor("bet"));
  });
});

import { describe, expect, it } from "vitest";
import { isSeatRebuyEligible } from "./rebuy";

describe("isSeatRebuyEligible", () => {
  it("refuses a seat still contesting the hand that busted it", () => {
    expect(isSeatRebuyEligible("playing", "all-in")).toBe(false);
  });

  it("allows a seat already parked out for the hand in progress", () => {
    expect(isSeatRebuyEligible("playing", "out")).toBe(true);
  });

  it("allows any status once the hand has resolved", () => {
    expect(isSeatRebuyEligible("complete", "all-in")).toBe(true);
    expect(isSeatRebuyEligible("complete", "folded")).toBe(true);
    expect(isSeatRebuyEligible("complete", "out")).toBe(true);
  });

  it("allows an archived table's seat regardless of status", () => {
    expect(isSeatRebuyEligible("archived", "all-in")).toBe(true);
  });
});

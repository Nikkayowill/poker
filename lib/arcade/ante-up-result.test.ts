import { describe, expect, it } from "vitest";
import { anteUpResultLine } from "./ante-up-result";

/**
 * The boards used to key their celebration off `payout > 0`, which was only
 * safe while every winning rung paid above 1x. These pin the case that broke
 * that assumption: a win that still costs the player Gold.
 */

describe("anteUpResultLine", () => {
  it("reports profit as the net, not the gross payout", () => {
    // The wager already left the wallet, so 2,500 credited on a 1,000 stake is
    // +1,500 to the player, not +2,500.
    const result = anteUpResultLine(1000, 2500);
    expect(result.net).toBe(1500);
    expect(result.profited).toBe(true);
    expect(result.label).toContain("1,500");
  });

  it("does not call a sub-1x win a profit", () => {
    const result = anteUpResultLine(1000, 600);
    expect(result.profited).toBe(false);
    expect(result.net).toBe(-400);
  });

  it("names both halves of a sub-1x win so it cannot read as a gain", () => {
    const { label } = anteUpResultLine(1000, 600);
    expect(label).toContain("600");
    expect(label).toContain("400");
    expect(label).not.toContain("+");
  });

  it("does not call an exact-1x return a profit", () => {
    const result = anteUpResultLine(1000, 1000);
    expect(result.net).toBe(0);
    expect(result.profited).toBe(false);
  });

  it("reports a total loss as the whole wager", () => {
    const result = anteUpResultLine(1000, 0);
    expect(result.net).toBe(-1000);
    expect(result.profited).toBe(false);
    expect(result.label).toContain("1,000");
  });

  it("never claims a profit on free practice, won or lost", () => {
    expect(anteUpResultLine(0, 0).profited).toBe(false);
    expect(anteUpResultLine(0, 0).net).toBe(0);
    expect(anteUpResultLine(0, 0).label).toContain("Practice");
  });
});

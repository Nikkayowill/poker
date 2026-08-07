import { describe, expect, it } from "vitest";
import { STAKES_TIERS, TIER_CONFIG } from "@/lib/game/tiers";
import { TIP_LINE } from "./dealer";
import {
  TIP_AMOUNTS,
  TIP_COOLDOWN_HANDS,
  TIP_OFFER_AFTER_HANDS,
  isTipAmount,
  shouldOfferTip,
  tipThanks,
  type TipOfferState,
} from "./tipping";

const idle = (over: Partial<TipOfferState> = {}): TipOfferState => ({
  handsPlayed: 0,
  resolvedAtHand: null,
  roundLive: false,
  ...over,
});

describe("when the pair ask", () => {
  it("says nothing at all for the first few hands", () => {
    for (let hands = 0; hands < TIP_OFFER_AFTER_HANDS; hands += 1) {
      expect(shouldOfferTip(idle({ handsPlayed: hands })), `${hands} hands`).toBe(false);
    }
  });

  it("asks once the player has actually been dealt to", () => {
    expect(shouldOfferTip(idle({ handsPlayed: TIP_OFFER_AFTER_HANDS }))).toBe(true);
  });

  it("never interrupts a live hand", () => {
    // The tip button shares a felt with Hit and Stand. Something appearing
    // between a player's eye and the Stand button mid-hand is a misclick that
    // charges them, which is worse than never asking.
    expect(shouldOfferTip(idle({ handsPlayed: 40, roundLive: true }))).toBe(false);
  });

  it("goes quiet for a good while once it has been resolved", () => {
    const resolvedAt = 6;
    for (let since = 0; since < TIP_COOLDOWN_HANDS; since += 1) {
      const state = idle({ handsPlayed: resolvedAt + since, resolvedAtHand: resolvedAt });
      expect(shouldOfferTip(state), `${since} hands later`).toBe(false);
    }
    const after = idle({ handsPlayed: resolvedAt + TIP_COOLDOWN_HANDS, resolvedAtHand: resolvedAt });
    expect(shouldOfferTip(after)).toBe(true);
  });

  it("waits exactly as long after a tip as after a refusal", () => {
    // The state carries no record of WHICH way it was resolved, which is the
    // point: asking a payer back sooner than a refuser is how a tip jar turns
    // into a dark pattern, and the only way to be sure it cannot happen is for
    // the cadence to be unable to tell them apart.
    const keys = Object.keys(idle());
    expect(keys).not.toContain("tipped");
    expect(keys).toEqual(["handsPlayed", "resolvedAtHand", "roundLive"]);
  });

  it("never nags across a whole session", () => {
    // Walk 200 hands, resolving every offer the moment it appears, and count.
    // A cadence bug shows up here as a number in the dozens.
    let resolvedAtHand: number | null = null;
    let asks = 0;
    for (let handsPlayed = 0; handsPlayed <= 200; handsPlayed += 1) {
      if (shouldOfferTip({ handsPlayed, resolvedAtHand, roundLive: false })) {
        asks += 1;
        resolvedAtHand = handsPlayed;
      }
    }
    expect(asks).toBeLessThanOrEqual(Math.ceil(200 / TIP_COOLDOWN_HANDS) + 1);
    // And it does keep asking -- a cooldown that silently latched off would
    // pass every assertion above.
    expect(asks).toBeGreaterThan(1);
  });
});

describe("what a tip costs", () => {
  it("offers three amounts, ascending", () => {
    expect(TIP_AMOUNTS).toHaveLength(3);
    expect([...TIP_AMOUNTS]).toEqual([...TIP_AMOUNTS].sort((a, b) => a - b));
  });

  it("stays well under the smallest stake the table can deal", () => {
    // Deliberately NOT on the STAKES_TIERS ladder -- that rule is about
    // stakes, where a price no button can charge is a lie. The smallest tier
    // is 1,000, and a tip equal to the whole bet is not a tip.
    const smallestStake = Math.min(...STAKES_TIERS.map((tier) => TIER_CONFIG[tier].minBuyIn));
    for (const amount of TIP_AMOUNTS) {
      expect(amount, `${amount} vs ${smallestStake}`).toBeLessThan(smallestStake);
    }
  });

  it("recognises exactly the amounts it offers", () => {
    for (const amount of TIP_AMOUNTS) expect(isTipAmount(amount)).toBe(true);
    // The route validates with this, so a hand-rolled body asking to tip a
    // fraction, a negative, or somebody's whole balance is refused here.
    for (const bad of [0, -25, 24, 26, 1000, 500_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isTipAmount(bad), String(bad)).toBe(false);
    }
  });
});

describe("what the pair say", () => {
  it("thanks the player differently for each amount", () => {
    const lines = TIP_AMOUNTS.map(tipThanks);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("keeps every line inside the bubble", () => {
    // Same cap dealerLine is held to: this renders in the speech bubble over
    // two dogs, and variable-length prose on a felt is what clipped the
    // per-seat status pills off the poker table.
    for (const amount of TIP_AMOUNTS) {
      expect(tipThanks(amount).length, `tip ${amount}`).toBeLessThanOrEqual(28);
    }
    // The ask is TIP_LINE from dealer.ts, not a second string here -- the
    // bubble that offers the tip and the bubble that thanks for it are the
    // same bubble, and they have to fit the same box.
    expect(TIP_LINE.length).toBeLessThanOrEqual(28);
  });
});

import { describe, expect, it } from "vitest";
import type { BlackjackOutcome } from "./blackjack";
import { DEALER_NAME, dealerLine } from "./dealer";

describe("dealerLine", () => {
  it("has something to say before a round exists", () => {
    expect(dealerLine(null, null)).toBe("Take a seat. Pick your stake.");
  });

  it("speaks once the cards are out", () => {
    expect(dealerLine("player-turn", null)).toBe("Cards are out.");
    expect(dealerLine("dealer-turn", null)).toBe("Playing it out.");
  });

  it("covers every outcome the engine can produce", () => {
    // Not a list restated by hand -- if BlackjackOutcome grows a member, this
    // fails to compile rather than silently returning undefined on the felt.
    const outcomes: Record<BlackjackOutcome, true> = {
      "player-blackjack": true,
      "player-win": true,
      "dealer-bust": true,
      "dealer-win": true,
      "player-bust": true,
      push: true,
    };
    for (const outcome of Object.keys(outcomes) as BlackjackOutcome[]) {
      const line = dealerLine("settled", outcome);
      expect(line, outcome).toBeTruthy();
      // Short enough to sit on one line beside the name; see .bj-hand-caption.
      expect(line.length, outcome).toBeLessThanOrEqual(28);
    }
  });

  it("distinguishes the two ways a player wins and the two ways they lose", () => {
    expect(dealerLine("settled", "player-blackjack")).not.toBe(dealerLine("settled", "player-win"));
    expect(dealerLine("settled", "dealer-bust")).not.toBe(dealerLine("settled", "player-win"));
    expect(dealerLine("settled", "player-bust")).not.toBe(dealerLine("settled", "dealer-win"));
  });

  it("names the dealer in the same register as the bot pool", () => {
    expect(DEALER_NAME).toMatch(/^[A-Z][a-z]+$/);
  });
});

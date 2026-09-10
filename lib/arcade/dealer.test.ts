import { describe, expect, it } from "vitest";
import type { BlackjackOutcome } from "./blackjack";
import { DEALER_DOGS, DEALER_NAME, TIP_LINE, dealerLine } from "./dealer";

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
      "player-resign": true,
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

  it("names both dogs as themselves, not as players", () => {
    // Two single first names joined, not a product name. Deliberately NOT the
    // register the poker table's bot pool moved to on 2026-08-21 (gamer tags):
    // these two are Kayo's actual dogs dealing the game, staff rather than
    // someone you are playing against, and a handle over the dealer's chair
    // would make them one more seat.
    expect(DEALER_NAME).toMatch(/^[A-Z][a-z]+ & [A-Z][a-z]+$/);
    for (const dog of DEALER_DOGS) expect(DEALER_NAME).toContain(dog.name);
  });

  it("asks for a tip in a line short enough to sit in a bubble", () => {
    expect(TIP_LINE).toBe("Tip the dealer!");
    expect(TIP_LINE.length).toBeLessThanOrEqual(24);
  });
});

describe("the cast", () => {
  const [loki, finn] = DEALER_DOGS;

  it("is two different dogs, not one dog twice", () => {
    expect(loki.id).not.toBe(finn.id);
    expect(loki.name).not.toBe(finn.name);
  });

  it("names a breed and a colour for each, so the joke has an explanation", () => {
    for (const dog of DEALER_DOGS) {
      expect(dog.breed.length, dog.name).toBeGreaterThan(8);
      // One line under a name in .dealer-stage-name -- two dogs' breeds
      // wrapping would push the caption up over their own paws.
      expect(dog.breed.length, dog.name).toBeLessThanOrEqual(40);
    }
  });
});

import { describe, expect, it } from "vitest";
import { betFlightKind } from "./bet-flight";
import { MOTION } from "./chip-motion";

describe("classifying a flight", () => {
  it("calls a call a call", () => {
    // Matching what is already out there. The quickest thing at the table.
    expect(betFlightKind({ allIn: false, previousHighBet: 200, streetBet: 200 }))
      .toBe("call");
  });

  it("reads the first aggression of a street as a bet", () => {
    expect(betFlightKind({ allIn: false, previousHighBet: 0, streetBet: 50 }))
      .toBe("bet");
  });

  it("reads going past a standing bet as a raise", () => {
    expect(betFlightKind({ allIn: false, previousHighBet: 50, streetBet: 200 }))
      .toBe("raise");
  });

  it("lets all-in win over everything else", () => {
    // A shove is a shove whether it happens to land on the current bet or
    // past it, and it is the one action that has earned the slow animation.
    expect(betFlightKind({ allIn: true, previousHighBet: 200, streetBet: 200 }))
      .toBe("all_in");
    expect(betFlightKind({ allIn: true, previousHighBet: 0, streetBet: 9_000 }))
      .toBe("all_in");
  });

  it("treats a posted blind as an opening bet", () => {
    // Which is what it is: an opening bet the rules made for you.
    expect(betFlightKind({ allIn: false, previousHighBet: 0, streetBet: 10 }))
      .toBe("bet");
  });

  it("classifies a short call rather than a raise", () => {
    // A seat topping up from 50 to 150 against a standing 200 has still only
    // called; the increase alone cannot tell you that.
    expect(betFlightKind({ allIn: false, previousHighBet: 200, streetBet: 150 }))
      .toBe("call");
  });

  it("only ever produces a kind the timing table knows", () => {
    const cases = [
      { allIn: false, previousHighBet: 0, streetBet: 10 },
      { allIn: false, previousHighBet: 10, streetBet: 10 },
      { allIn: false, previousHighBet: 10, streetBet: 30 },
      { allIn: true, previousHighBet: 10, streetBet: 400 },
    ];
    for (const context of cases) {
      expect(MOTION[betFlightKind(context)]).toBeDefined();
    }
  });
});

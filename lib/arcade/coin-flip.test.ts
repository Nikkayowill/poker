import { describe, expect, it } from "vitest";
import {
  COIN_FLIP_HOUSE_EDGE,
  COIN_FLIP_MULTIPLIER,
  MAX_STREAK,
  bankCoinFlip,
  canBank,
  canCall,
  coinFlipOutcomeLabel,
  coinFlipPayout,
  flipCoin,
  nextPot,
  startCoinFlipRound,
  toCoinFlipSnapshot,
  type CoinFlipRound,
  type CoinSide,
} from "./coin-flip";

/** A coin that always lands on the named side. */
const lands = (side: CoinSide) => () => (side === "heads" ? 0 : 1);

/** Rides a fresh round through `wins` winning flips. */
function runOf(wins: number, stake = 1000): CoinFlipRound {
  let round = startCoinFlipRound({ stake });
  for (let index = 0; index < wins; index += 1) {
    round = flipCoin(round, "heads", lands("heads"));
  }
  return round;
}

describe("the price", () => {
  it("is a real house edge, not the break-even game the catalogue promised", () => {
    // A fair coin paying exactly 2x returns 1.00 -- zero edge, which is a hole
    // in the economy rather than a generous game. This is the whole reason
    // COIN_FLIP_MULTIPLIER is not 2.
    expect(COIN_FLIP_MULTIPLIER).toBeLessThan(2);
    const expectedReturn = 0.5 * COIN_FLIP_MULTIPLIER;
    expect(expectedReturn).toBeLessThan(1);
  });

  it("charges the cut only on the half of the time the player wins", () => {
    // 3% off the fair price is a 1.5% house edge on an even-money bet. Stated
    // as a test because it is the sentence the felt makes to the player.
    const houseEdge = 1 - 0.5 * COIN_FLIP_MULTIPLIER;
    expect(houseEdge).toBeCloseTo(COIN_FLIP_HOUSE_EDGE / 2, 12);
  });

  it("keeps the coin honest -- the margin is in the payout, never in the flip", () => {
    // Both sides must be reachable, and each from exactly one draw of two.
    const draws = [0, 1].map((value) => flipCoin(startCoinFlipRound({ stake: 100 }), "heads", (max) => {
      expect(max).toBe(2);
      return value;
    }));
    expect(draws[0].results).toEqual(["heads"]);
    expect(draws[1].results).toEqual(["tails"]);
  });

  it("floors the pot the house's way at every step", () => {
    // 1001 * 1.97 = 1971.97 -- the fraction falls to the house, as it does on
    // blackjack's 3:2 and Hi-Lo's multiplier.
    expect(nextPot(1001)).toBe(1971);
    expect(nextPot(1000)).toBe(1970);
  });
});

describe("flipCoin", () => {
  it("compounds the pot on a win and offers the choice again", () => {
    const round = flipCoin(startCoinFlipRound({ stake: 1000 }), "heads", lands("heads"));
    expect(round.phase).toBe("decide");
    expect(round.streak).toBe(1);
    expect(round.pot).toBe(1970);
    expect(round.netGold).toBe(0);
    expect(canBank(round)).toBe(true);
  });

  it("takes the whole run on a miss, not just the last win", () => {
    // This is what makes riding a decision rather than a formality.
    const three = runOf(3);
    expect(three.pot).toBeGreaterThan(3000);
    const missed = flipCoin(three, "heads", lands("tails"));
    expect(missed.phase).toBe("settled");
    expect(missed.banked).toBe(false);
    expect(missed.pot).toBe(0);
    expect(coinFlipPayout(missed)).toBe(0);
    expect(missed.netGold).toBe(-1000);
  });

  it("loses only the stake, however long the run was", () => {
    for (const wins of [0, 1, 3, 5]) {
      const missed = flipCoin(runOf(wins), "heads", lands("tails"));
      expect(missed.netGold).toBe(-1000);
    }
  });

  it("banks itself at the cap rather than offering a ride that does not exist", () => {
    const capped = runOf(MAX_STREAK);
    expect(capped.streak).toBe(MAX_STREAK);
    expect(capped.phase).toBe("settled");
    expect(capped.banked).toBe(true);
    expect(canCall(capped)).toBe(false);
    expect(coinFlipPayout(capped)).toBe(capped.pot);
    expect(capped.netGold).toBe(capped.pot - 1000);
  });

  it("caps a run at roughly 58x the stake", () => {
    // The cap is what stops a 500k run minting tens of millions out of a game
    // with a 1.5% edge. Pinned loosely, as the exact figure follows the
    // multiplier.
    const capped = runOf(MAX_STREAK);
    expect(capped.pot / capped.stake).toBeGreaterThan(50);
    expect(capped.pot / capped.stake).toBeLessThan(70);
  });

  it("records every result in order", () => {
    let round = startCoinFlipRound({ stake: 1000 });
    round = flipCoin(round, "heads", lands("heads"));
    round = flipCoin(round, "tails", lands("tails"));
    round = flipCoin(round, "heads", lands("tails"));
    expect(round.results).toEqual(["heads", "tails", "tails"]);
    expect(round.phase).toBe("settled");
  });

  it("is inert once the run is over", () => {
    const settled = flipCoin(startCoinFlipRound({ stake: 1000 }), "heads", lands("tails"));
    expect(canCall(settled)).toBe(false);
    expect(flipCoin(settled, "heads", lands("heads"))).toBe(settled);
  });

  it("does not mutate the round it was given", () => {
    const round = startCoinFlipRound({ stake: 1000 });
    flipCoin(round, "heads", lands("heads"));
    expect(round.phase).toBe("call");
    expect(round.pot).toBe(1000);
    expect(round.results).toEqual([]);
  });
});

describe("bankCoinFlip", () => {
  it("takes the pot and nets it against the stake", () => {
    const banked = bankCoinFlip(runOf(2));
    expect(banked.phase).toBe("settled");
    expect(banked.banked).toBe(true);
    expect(coinFlipPayout(banked)).toBe(banked.pot);
    expect(banked.netGold).toBe(banked.pot - 1000);
    expect(banked.netGold).toBeGreaterThan(0);
  });

  it("refuses to bank before a win", () => {
    // Banking a fresh round would be taking Gold out of the wallet and putting
    // it straight back, which is not a game.
    const fresh = startCoinFlipRound({ stake: 1000 });
    expect(canBank(fresh)).toBe(false);
    expect(bankCoinFlip(fresh)).toBe(fresh);
  });

  it("refuses to bank a run that already ended", () => {
    const missed = flipCoin(startCoinFlipRound({ stake: 1000 }), "heads", lands("tails"));
    expect(bankCoinFlip(missed)).toBe(missed);
    expect(coinFlipPayout(missed)).toBe(0);
  });

  it("cannot be banked twice into a double payout", () => {
    const banked = bankCoinFlip(runOf(1));
    expect(bankCoinFlip(banked)).toBe(banked);
  });
});

describe("coinFlipPayout", () => {
  it("pays nothing on a run still in progress", () => {
    expect(coinFlipPayout(startCoinFlipRound({ stake: 1000 }))).toBe(0);
    expect(coinFlipPayout(runOf(2))).toBe(0);
  });

  it("never pays a run that ended on a miss", () => {
    expect(coinFlipPayout(flipCoin(runOf(4), "heads", lands("tails")))).toBe(0);
  });
});

describe("startCoinFlipRound", () => {
  it("opens with the stake riding and nothing flipped", () => {
    const round = startCoinFlipRound({ stake: 5000 });
    expect(round.pot).toBe(5000);
    expect(round.streak).toBe(0);
    expect(round.phase).toBe("call");
    expect(canBank(round)).toBe(false);
  });

  it("refuses a non-positive stake", () => {
    expect(() => startCoinFlipRound({ stake: 0 })).toThrow(/positive stake/i);
  });
});

describe("toCoinFlipSnapshot", () => {
  it("quotes what one more win is worth, before it is risked", () => {
    const snapshot = toCoinFlipSnapshot(runOf(1), { id: "r1", version: 2 });
    expect(snapshot.potIfWon).toBe(nextPot(snapshot.pot));
    expect(snapshot.potIfWon).toBeGreaterThan(snapshot.pot);
    expect(snapshot.maxStreak).toBe(MAX_STREAK);
  });

  it("copies the results, so a caller cannot reach back into the round", () => {
    const round = runOf(1);
    const snapshot = toCoinFlipSnapshot(round, { id: "r1", version: 1 });
    snapshot.results.push("tails");
    expect(round.results).toHaveLength(1);
  });
});

describe("coinFlipOutcomeLabel", () => {
  it("names each state without saying `undefined`", () => {
    const states = [
      startCoinFlipRound({ stake: 1000 }),
      runOf(2),
      bankCoinFlip(runOf(2)),
      flipCoin(runOf(1), "heads", lands("tails")),
      runOf(MAX_STREAK),
    ];
    for (const round of states) {
      const label = coinFlipOutcomeLabel(round);
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/undefined|NaN/);
    }
    expect(coinFlipOutcomeLabel(runOf(MAX_STREAK))).toMatch(/capped out/);
    expect(coinFlipOutcomeLabel(bankCoinFlip(runOf(2)))).toBe("Banked on 2");
  });
});

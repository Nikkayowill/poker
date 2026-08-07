import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/game/types";
import {
  BACCARAT_DECKS,
  BANKER_COMMISSION,
  TIE_ODDS,
  baccaratOutcomeLabel,
  baccaratPayout,
  bankerDraws,
  cardPoints,
  dealBaccaratCoup,
  handTotal,
  isLegalSide,
  isNatural,
  playBaccaratCoup,
  playerDraws,
  payoutMultiplier,
  sideLabel,
  sideOdds,
  startBaccaratRound,
  toBaccaratSnapshot,
  type BaccaratSide,
} from "./baccarat";

function card(rank: Card["rank"], suit: Card["suit"] = "spades"): Card {
  return { rank, suit };
}

/**
 * Cards are taken with pop(), and the deal order is player, banker, player,
 * banker, then any thirds. This builds a shoe that deals exactly that
 * sequence, so every rule below is asserted against an exact coup.
 */
function shoeDealing(...cards: Card[]): Card[] {
  return [...cards].reverse();
}

function coup(bet: BaccaratSide, ...cards: Card[]) {
  return playBaccaratCoup(startBaccaratRound({ stake: 1000, bet }), shoeDealing(...cards));
}

const SIDES: BaccaratSide[] = ["player", "banker", "tie"];

describe("card values", () => {
  it("counts an ace as one and every ten or court card as zero", () => {
    expect(cardPoints(card("A"))).toBe(1);
    for (const rank of ["10", "J", "Q", "K"] as const) {
      expect(cardPoints(card(rank))).toBe(0);
    }
    for (const rank of ["2", "5", "9"] as const) {
      expect(cardPoints(card(rank))).toBe(Number(rank));
    }
  });

  it("totals modulo ten -- 7 and 8 is 5, not 15", () => {
    expect(handTotal([card("7"), card("8")])).toBe(5);
    expect(handTotal([card("K"), card("Q")])).toBe(0);
    expect(handTotal([card("9"), card("A")])).toBe(0);
    expect(handTotal([])).toBe(0);
  });

  it("calls an 8 or 9 in two cards a natural, and nothing else", () => {
    expect(isNatural([card("9"), card("K")])).toBe(true);
    expect(isNatural([card("5"), card("3")])).toBe(true);
    expect(isNatural([card("7"), card("K")])).toBe(false);
    // Three cards totalling 9 is not a natural, however good it looks.
    expect(isNatural([card("3"), card("3"), card("3")])).toBe(false);
  });
});

describe("the tableau", () => {
  it("draws for the player on 0-5 and stands on 6-7", () => {
    for (let total = 0; total <= 5; total += 1) expect(playerDraws(total)).toBe(true);
    for (const total of [6, 7]) expect(playerDraws(total)).toBe(false);
  });

  it("plays the player's own rule for the banker when the player stood", () => {
    for (let total = 0; total <= 5; total += 1) expect(bankerDraws(total, null)).toBe(true);
    for (const total of [6, 7]) expect(bankerDraws(total, null)).toBe(false);
  });

  /**
   * Every cell of the standard table, transcribed independently of the
   * implementation. A wrong cell is not a visible bug -- the game still plays
   * and still pays, just at the wrong price -- so this is the guard that
   * matters most in the file.
   */
  it("matches the standard third-card table, cell for cell", () => {
    // Rows are the banker's two-card total 0..6; columns are the value of the
    // player's third card 0..9. true = banker draws.
    const TABLE: Record<number, boolean[]> = {
      //     0      1      2      3      4      5      6      7      8      9
      0: [true, true, true, true, true, true, true, true, true, true],
      1: [true, true, true, true, true, true, true, true, true, true],
      2: [true, true, true, true, true, true, true, true, true, true],
      3: [true, true, true, true, true, true, true, true, false, true],
      4: [false, false, true, true, true, true, true, true, false, false],
      5: [false, false, false, false, true, true, true, true, false, false],
      6: [false, false, false, false, false, false, true, true, false, false],
    };
    for (const [total, row] of Object.entries(TABLE)) {
      row.forEach((draws, playerThird) => {
        expect({ total: Number(total), playerThird, draws: bankerDraws(Number(total), playerThird) })
          .toEqual({ total: Number(total), playerThird, draws });
      });
    }
  });

  it("stands the banker on 7 whatever the player drew", () => {
    for (let third = 0; third <= 9; third += 1) expect(bankerDraws(7, third)).toBe(false);
  });
});

describe("playBaccaratCoup", () => {
  it("deals player, banker, player, banker", () => {
    const round = coup("player", card("2"), card("3"), card("4", "hearts"), card("5", "hearts"));
    expect(round.playerHand.slice(0, 2)).toEqual([card("2"), card("4", "hearts")]);
    expect(round.bankerHand.slice(0, 2)).toEqual([card("3"), card("5", "hearts")]);
  });

  it("stops dead on a natural -- no third card is dealt to either side", () => {
    // Player 9, banker 5. Without the natural rule the banker would draw.
    const round = coup("player", card("9"), card("2"), card("K"), card("3"));
    expect(round.playerHand).toHaveLength(2);
    expect(round.bankerHand).toHaveLength(2);
    expect(round.result).toBe("player");
  });

  it("stops on a banker natural too", () => {
    const round = coup("banker", card("2"), card("9"), card("3"), card("K"));
    expect(round.playerHand).toHaveLength(2);
    expect(round.bankerHand).toHaveLength(2);
    expect(round.result).toBe("banker");
  });

  it("gives the player a third card and then applies the banker's rule to it", () => {
    // Player 0 (K,K) draws; banker 3 (3,K). Player's third is an 8, which is
    // the single cell where a banker on 3 stands.
    const round = coup("player", card("K"), card("3"), card("K", "hearts"), card("K", "clubs"), card("8"));
    expect(round.playerHand).toHaveLength(3);
    expect(round.bankerHand).toHaveLength(2);
    expect(handTotal(round.playerHand)).toBe(8);
    expect(round.result).toBe("player");
  });

  it("draws for the banker when the cell says so", () => {
    // Same shape, but the player's third is a 7 -- banker on 3 draws.
    const round = coup("player", card("K"), card("3"), card("K", "hearts"), card("K", "clubs"), card("7"), card("2"));
    expect(round.bankerHand).toHaveLength(3);
    expect(handTotal(round.bankerHand)).toBe(5);
  });

  it("settles a tie as a tie", () => {
    const round = coup("tie", card("7"), card("7"), card("K"), card("K", "hearts"));
    expect(round.result).toBe("tie");
  });

  it("is inert on a round that has already been dealt", () => {
    const settled = coup("player", card("9"), card("2"), card("K"), card("3"));
    expect(playBaccaratCoup(settled, shoeDealing(card("A"), card("A")))).toBe(settled);
  });

  it("does not mutate the round it was given", () => {
    const round = startBaccaratRound({ stake: 1000, bet: "player" });
    playBaccaratCoup(round, shoeDealing(card("9"), card("2"), card("K"), card("3")));
    expect(round.playerHand).toEqual([]);
    expect(round.phase).toBe("bet");
  });
});

describe("the price of each side", () => {
  it("pays player even money and banker at a 5% commission", () => {
    expect(payoutMultiplier("player", "player")).toBe(2);
    expect(payoutMultiplier("banker", "banker")).toBe(2 - BANKER_COMMISSION);
    expect(BANKER_COMMISSION).toBe(0.05);
  });

  it("pushes a player or banker bet on a tie rather than taking it", () => {
    // A house that took the stake on a tie would be charging for a hand
    // nobody lost. Gross 1 IS the push.
    expect(payoutMultiplier("player", "tie")).toBe(1);
    expect(payoutMultiplier("banker", "tie")).toBe(1);
  });

  it("pays a tie bet at 9 to 1, and pays nothing when the coup is not a tie", () => {
    expect(payoutMultiplier("tie", "tie")).toBe(TIE_ODDS + 1);
    expect(payoutMultiplier("tie", "player")).toBe(0);
    expect(payoutMultiplier("tie", "banker")).toBe(0);
  });

  it("pays nothing for backing the losing side", () => {
    expect(payoutMultiplier("player", "banker")).toBe(0);
    expect(payoutMultiplier("banker", "player")).toBe(0);
  });

  it("never offers a positive-expectation side", () => {
    // The real punto banco frequencies for an eight-deck shoe.
    const P = { player: 0.446247, banker: 0.458597, tie: 0.095156 };
    for (const bet of SIDES) {
      const expectedReturn =
        P.player * payoutMultiplier(bet, "player") +
        P.banker * payoutMultiplier(bet, "banker") +
        P.tie * payoutMultiplier(bet, "tie");
      expect(expectedReturn).toBeLessThan(1);
    }
  });

  it("leaves the classic edges: banker cheapest, then player, tie dearest", () => {
    const P = { player: 0.446247, banker: 0.458597, tie: 0.095156 };
    const edge = (bet: BaccaratSide) =>
      1 -
      (P.player * payoutMultiplier(bet, "player") +
        P.banker * payoutMultiplier(bet, "banker") +
        P.tie * payoutMultiplier(bet, "tie"));

    expect(edge("banker")).toBeCloseTo(0.0106, 3);
    expect(edge("player")).toBeCloseTo(0.0124, 3);
    // 4.8% at 9:1. At the more common 8:1 this is 14.4%, which is five times
    // anything else in the arcade -- see the note at the top of baccarat.ts.
    expect(edge("tie")).toBeCloseTo(0.0484, 3);
    expect(edge("banker")).toBeLessThan(edge("player"));
    expect(edge("player")).toBeLessThan(edge("tie"));
  });
});

describe("baccaratPayout", () => {
  it("returns exactly the stake on a pushed tie", () => {
    const round = coup("player", card("7"), card("7"), card("K"), card("K", "hearts"));
    expect(round.result).toBe("tie");
    expect(baccaratPayout(round)).toBe(1000);
    expect(round.netGold).toBe(0);
  });

  it("floors the banker commission the house's way", () => {
    // 1001 * 1.95 = 1951.95.
    const base = startBaccaratRound({ stake: 1001, bet: "banker" });
    const round = playBaccaratCoup(base, shoeDealing(card("2"), card("9"), card("3"), card("K")));
    expect(round.result).toBe("banker");
    expect(baccaratPayout(round)).toBe(1951);
    expect(round.netGold).toBe(950);
  });

  it("pays nothing before the cards are out", () => {
    expect(baccaratPayout(startBaccaratRound({ stake: 1000, bet: "player" }))).toBe(0);
  });

  it("loses the whole stake on the wrong side", () => {
    const round = coup("banker", card("9"), card("2"), card("K"), card("3"));
    expect(round.result).toBe("player");
    expect(baccaratPayout(round)).toBe(0);
    expect(round.netGold).toBe(-1000);
  });
});

describe("dealBaccaratCoup", () => {
  it("deals from an eight-deck shoe and keeps no cards it did not show", () => {
    const round = dealBaccaratCoup(startBaccaratRound({ stake: 1000, bet: "player" }), (max) => max - 1);
    expect(BACCARAT_DECKS).toBe(8);
    expect(round.phase).toBe("settled");
    expect(round.playerHand.length).toBeGreaterThanOrEqual(2);
    // The shoe is built inside the call and discarded -- there is no field on
    // the round for it, so nothing undealt is ever stored or sent.
    expect("shoe" in round).toBe(false);
  });

  it("always reaches a result", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const round = dealBaccaratCoup(
        startBaccaratRound({ stake: 1000, bet: "player" }),
        (max) => (seed * 7 + max) % max,
      );
      expect(round.result).not.toBeNull();
      expect(round.playerHand.length).toBeLessThanOrEqual(3);
      expect(round.bankerHand.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("startBaccaratRound", () => {
  it("opens with the bet placed and no cards out", () => {
    const round = startBaccaratRound({ stake: 5000, bet: "tie" });
    expect(round.playerHand).toEqual([]);
    expect(round.bankerHand).toEqual([]);
    expect(round.phase).toBe("bet");
  });

  it("refuses a bad stake or a side the table does not offer", () => {
    expect(() => startBaccaratRound({ stake: 0, bet: "player" })).toThrow(/positive stake/i);
    expect(() => startBaccaratRound({ stake: 100, bet: "dragon" as BaccaratSide })).toThrow(/not a side/i);
    expect(isLegalSide("dragon")).toBe(false);
    for (const side of SIDES) expect(isLegalSide(side)).toBe(true);
  });
});

describe("labels", () => {
  it("names every side and price without saying `undefined`", () => {
    for (const side of SIDES) {
      expect(sideLabel(side)).toBeTruthy();
      expect(sideOdds(side)).not.toMatch(/undefined|NaN/);
    }
    expect(sideOdds("banker")).toBe("0.95:1");
    expect(sideOdds("tie")).toBe("9:1");
  });

  it("reads out the coup", () => {
    expect(baccaratOutcomeLabel(startBaccaratRound({ stake: 100, bet: "player" }))).toBe("Place your bet");
    expect(baccaratOutcomeLabel(coup("player", card("9"), card("2"), card("K"), card("3")))).toBe("Player 9 beats 5");
    expect(baccaratOutcomeLabel(coup("tie", card("7"), card("7"), card("K"), card("K", "hearts")))).toBe("Tie on 7");
  });
});

describe("toBaccaratSnapshot", () => {
  it("carries the totals so the felt cannot compute them differently", () => {
    const round = coup("player", card("9"), card("2"), card("K"), card("3"));
    const snapshot = toBaccaratSnapshot(round, { id: "r1", version: 2 });
    expect(snapshot.playerTotal).toBe(9);
    expect(snapshot.bankerTotal).toBe(5);
    expect("shoe" in snapshot).toBe(false);
  });

  it("copies the hands, so a caller cannot reach back into the round", () => {
    const round = coup("player", card("9"), card("2"), card("K"), card("3"));
    const snapshot = toBaccaratSnapshot(round, { id: "r1", version: 1 });
    snapshot.playerHand[0].rank = "2";
    expect(round.playerHand[0].rank).toBe("9");
  });
});

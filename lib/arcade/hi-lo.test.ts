import { describe, expect, it } from "vitest";
import { RANKS } from "@/lib/game/deck";
import type { Card, Rank, Suit } from "@/lib/game/types";
import {
  HI_LO_HOUSE_EDGE,
  HI_LO_UNSEEN,
  callHiLo,
  dealHiLoRound,
  hiLoOdds,
  hiLoOutcomeLabel,
  hiLoPayout,
  legalHiLoCalls,
  rankOrdinal,
  startHiLoRound,
  toHiLoSnapshot,
  type HiLoCall,
} from "./hi-lo";

const suitOf: Record<string, Suit> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
function card(code: string): Card {
  return { rank: code.slice(0, -1) as Rank, suit: suitOf[code.slice(-1)] };
}
/** startHiLoRound pops the base card off the END, then callHiLo pops the next. */
function stacked(base: string, next?: string): Card[] {
  return (next ? [next, base] : [base]).map(card);
}
function open(base: string, next?: string, stake = 1000) {
  return startHiLoRound({ stake, deck: stacked(base, next) });
}

describe("rankOrdinal", () => {
  it("runs 2 low to ace high, matching the shared deck's own order", () => {
    expect(rankOrdinal("2")).toBe(0);
    expect(rankOrdinal("A")).toBe(12);
    expect(rankOrdinal("K")).toBe(11);
    // Not a restated table -- the ordering IS RANKS, so the arcade cannot
    // disagree with the deck it draws from.
    expect(RANKS.map(rankOrdinal)).toEqual(RANKS.map((_, i) => i));
  });
});

describe("hiLoOdds", () => {
  it("accounts for every one of the 51 unseen cards", () => {
    for (const rank of RANKS) {
      const odds = hiLoOdds(card(`${rank}S`));
      expect(odds.higher.winners + odds.lower.winners + odds.ties, rank).toBe(HI_LO_UNSEEN);
    }
  });

  it("counts four of each rank above and below, minus the one face up", () => {
    const seven = hiLoOdds(card("7S"));
    expect(seven.higher.winners).toBe(28); // 8,9,10,J,Q,K,A
    expect(seven.lower.winners).toBe(20); // 2,3,4,5,6
    expect(seven.ties).toBe(3);
  });

  it("closes the call that no card can win", () => {
    // Nothing is lower than a 2, and nothing is higher than an ace. Offering
    // these would be a button that can only ever take money.
    const two = hiLoOdds(card("2S"));
    expect(two.lower).toEqual({ winners: 0, multiplier: 0, available: false });
    expect(two.higher.available).toBe(true);

    const ace = hiLoOdds(card("AS"));
    expect(ace.higher).toEqual({ winners: 0, multiplier: 0, available: false });
    expect(ace.lower.available).toBe(true);
  });

  it("prices a call from the deck, not a flat rate", () => {
    // A flat 1:1 table would be a money pump: "higher" on a 2 wins 48/51.
    // The safe call must pay accordingly little and the coin-flip a lot more.
    const safe = hiLoOdds(card("2S")).higher.multiplier;
    const even = hiLoOdds(card("8S")).higher.multiplier;
    expect(safe).toBeLessThan(0.1);
    expect(even).toBeGreaterThan(1);
    expect(hiLoOdds(card("7S")).higher.multiplier).toBeCloseTo((23 / 28) * (1 - HI_LO_HOUSE_EDGE), 10);
  });

  it("is symmetric -- a 2 called high prices the same as an ace called low", () => {
    expect(hiLoOdds(card("2S")).higher.multiplier).toBeCloseTo(hiLoOdds(card("AS")).lower.multiplier, 10);
  });
});

describe("the house edge", () => {
  /**
   * The exploit guard, and the reason the payout is derived rather than
   * tabled: NO base card and NO call may be positive expectation for the
   * player. Checked exactly rather than by simulation -- the whole space is
   * 13 ranks x 2 calls.
   *
   * EV works out to -edge * stake * (51 - w)/51, so the house's take scales
   * with how much is genuinely at risk. A near-certain call is nearly free;
   * it is never free, and it is never profitable.
   */
  it("is never positive for the player, on any card, on either call", () => {
    const stake = 10_000;
    for (const rank of RANKS) {
      const base = card(`${rank}S`);
      const odds = hiLoOdds(base);
      for (const call of ["higher", "lower"] as HiLoCall[]) {
        const side = odds[call];
        if (!side.available) continue;
        const winners = side.winners;
        const payout = Math.floor(stake * side.multiplier);
        const ev = (winners / HI_LO_UNSEEN) * payout - ((HI_LO_UNSEEN - winners) / HI_LO_UNSEEN) * stake;
        expect(ev, `${rank} ${call}`).toBeLessThan(0);
        // And the house never takes more than its stated cut of the stake.
        expect(ev, `${rank} ${call}`).toBeGreaterThanOrEqual(-HI_LO_HOUSE_EDGE * stake - 1);
      }
    }
  });

  it("charges the tie to the player, which is what keeps a safe call payable", () => {
    // With ties pushing, "higher" on a 2 would be a certainty and fair odds
    // would pay zero. Counting them as a loss is load-bearing, not greed.
    expect(hiLoOdds(card("2S")).higher.winners).toBe(48);
    expect(hiLoOdds(card("2S")).ties).toBe(3);
  });
});

describe("callHiLo", () => {
  it("pays a correct high call at the quoted price", () => {
    const round = callHiLo(open("7S", "KH"), "higher");
    expect(round.outcome).toBe("win");
    expect(round.drawnCard).toEqual(card("KH"));
    expect(round.netGold).toBe(Math.floor(1000 * hiLoOdds(card("7S")).higher.multiplier));
    expect(hiLoPayout(round)).toBe(1000 + round.netGold);
  });

  it("pays a correct low call", () => {
    const round = callHiLo(open("7S", "3H"), "lower");
    expect(round.outcome).toBe("win");
    expect(round.netGold).toBeGreaterThan(0);
  });

  it("takes the stake on a miss", () => {
    const round = callHiLo(open("7S", "3H"), "higher");
    expect(round.outcome).toBe("miss");
    expect(round.netGold).toBe(-1000);
    expect(hiLoPayout(round)).toBe(0);
  });

  it("takes the stake on a tie, on either call", () => {
    for (const call of ["higher", "lower"] as HiLoCall[]) {
      const round = callHiLo(open("7S", "7H"), call);
      expect(round.outcome, call).toBe("tie");
      expect(round.netGold, call).toBe(-1000);
      expect(hiLoPayout(round), call).toBe(0);
    }
  });

  it("compares by rank alone -- suit never decides a round", () => {
    for (const suit of ["S", "H", "D", "C"]) {
      expect(callHiLo(open("7S", `9${suit}`), "higher").outcome, suit).toBe("win");
    }
  });

  it("is inert on a call no card can win", () => {
    const round = open("2S", "5H");
    expect(callHiLo(round, "lower")).toBe(round);
    expect(legalHiLoCalls(round)).toEqual({ higher: true, lower: false });
  });

  it("is inert once settled", () => {
    const settled = callHiLo(open("7S", "KH"), "higher");
    expect(callHiLo(settled, "lower")).toBe(settled);
    expect(legalHiLoCalls(settled)).toEqual({ higher: false, lower: false });
  });

  it("does not mutate the round it was handed", () => {
    const round = open("7S", "KH");
    const before = round.deck.length;
    callHiLo(round, "higher");
    expect(round.deck).toHaveLength(before);
    expect(round.drawnCard).toBeNull();
    expect(round.phase).toBe("call");
  });

  it("rounds a fractional payout the house's way", () => {
    // An odd stake against a fractional multiplier must never round up.
    const round = callHiLo(open("7S", "KH", 33), "higher");
    expect(round.netGold).toBe(Math.floor(33 * hiLoOdds(card("7S")).higher.multiplier));
    expect(round.netGold).toBeLessThanOrEqual(33 * hiLoOdds(card("7S")).higher.multiplier);
  });
});

describe("startHiLoRound / dealHiLoRound", () => {
  it("turns one card face up and keeps 51 back", () => {
    let n = 0;
    const round = dealHiLoRound(1000, (max) => (n++ * 7) % max);
    expect(round.deck).toHaveLength(HI_LO_UNSEEN);
    expect(round.phase).toBe("call");
    expect(round.drawnCard).toBeNull();
    // 52 distinct cards across the face-up one and the deck.
    const keys = [round.baseCard, ...round.deck].map((c) => `${c.rank}${c.suit}`);
    expect(new Set(keys).size).toBe(52);
  });

  it("rejects a stake that is not positive", () => {
    expect(() => startHiLoRound({ stake: 0, deck: stacked("7S") })).toThrow();
    expect(() => startHiLoRound({ stake: -5, deck: stacked("7S") })).toThrow();
  });
});

describe("toHiLoSnapshot", () => {
  const meta = { id: "round-1", version: 2 };

  it("never carries the deck -- the next card is sitting on top of it", () => {
    const snapshot = toHiLoSnapshot(open("7S", "KH"), meta);
    expect("deck" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("deck");
  });

  it("withholds the drawn card until it is drawn", () => {
    expect(toHiLoSnapshot(open("7S", "KH"), meta).drawnCard).toBeNull();
    expect(toHiLoSnapshot(callHiLo(open("7S", "KH"), "higher"), meta).drawnCard).toEqual(card("KH"));
  });

  it("quotes the price before the player commits", () => {
    const snapshot = toHiLoSnapshot(open("7S", "KH"), meta);
    expect(snapshot.odds.higher.multiplier).toBeGreaterThan(0);
    expect(snapshot.legal).toEqual({ higher: true, lower: true });
    expect(snapshot.id).toBe("round-1");
    expect(snapshot.version).toBe(2);
  });
});

describe("hiLoOutcomeLabel", () => {
  it("names every outcome", () => {
    for (const outcome of ["win", "miss", "tie"] as const) {
      expect(hiLoOutcomeLabel(outcome), outcome).toBeTruthy();
    }
  });
});

describe("the house edge, over a long run", () => {
  /**
   * A seeded Monte Carlo, in the spirit of lib/game/bot-personality.test.ts.
   *
   * The exact per-call EV is already pinned above; this exists because a live
   * 300-round sweep against the dev server came back at -9% of turnover
   * against a designed 3% edge, which looks alarming until you notice the
   * variance. Calling "higher" on a king pays better than 11x and wins 4
   * times in 51, so a few hundred rounds says almost nothing. This run is
   * long enough to say something, and deterministic so it says the same thing
   * every time.
   *
   * The comparison is against the closed-form expectation of the exact rounds
   * played -- not a flat -3% -- because the edge is taken off the payout, so
   * per-round EV is -edge * stake * (51 - winners)/51 and depends on which
   * calls came up.
   */
  it("converges on the designed edge, not something worse", () => {
    // Deterministic LCG. Math.random would make this test's failures
    // unreproducible, which is the one thing a statistical test cannot afford.
    let seed = 0x5eed_1234;
    const randomInt = (maxExclusive: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % maxExclusive;
    };

    const stake = 1000;
    const rounds = 60_000;
    let realized = 0;
    let expected = 0;

    for (let n = 0; n < rounds; n += 1) {
      const round = dealHiLoRound(stake, randomInt);
      const odds = hiLoOdds(round.baseCard);
      // Alternate sides so the sample spans cheap and expensive calls alike,
      // falling back when one side is dead (a 2 or an ace).
      const preferred: HiLoCall = n % 2 === 0 ? "higher" : "lower";
      const call: HiLoCall = odds[preferred].available ? preferred : (preferred === "higher" ? "lower" : "higher");

      const side = odds[call];
      const payout = Math.floor(stake * side.multiplier);
      expected +=
        (side.winners / HI_LO_UNSEEN) * payout - ((HI_LO_UNSEEN - side.winners) / HI_LO_UNSEEN) * stake;
      realized += callHiLo(round, call).netGold;
    }

    const turnover = rounds * stake;
    // The house takes something, and the player never comes out ahead.
    expect(realized).toBeLessThan(0);
    // And it is the designed something: never worse than the stated edge on
    // turnover, which is the ceiling the per-call EV proof establishes.
    expect(realized / turnover).toBeGreaterThan(-HI_LO_HOUSE_EDGE);
    // Realized tracks the closed form. Wide but meaningful: the tail here is
    // heavy, so this catches a mispriced table without failing on noise.
    expect(Math.abs(realized - expected) / turnover).toBeLessThan(0.01);
  });
});

import { describe, expect, it } from "vitest";
import {
  POCKET_ANGLE,
  POCKET_COUNT,
  ROULETTE_ODDS,
  SPIN_DURATION_MS,
  WHEEL_ORDER,
  betLabel,
  isLegalBet,
  pocketColour,
  restingRotation,
  rouletteOutcomeLabel,
  roulettePayout,
  rouletteWins,
  spinRoulette,
  startRouletteRound,
  toRouletteSnapshot,
  wheelRotation,
  winningPockets,
  type RouletteBet,
} from "./roulette";

const ALL_POCKETS = Array.from({ length: POCKET_COUNT }, (_, index) => index);

/** Every bet the layout offers, once each. */
const EVERY_BET: RouletteBet[] = [
  ...ALL_POCKETS.map((pocket): RouletteBet => ({ kind: "straight", pocket })),
  { kind: "colour", colour: "red" },
  { kind: "colour", colour: "black" },
  { kind: "parity", parity: "odd" },
  { kind: "parity", parity: "even" },
  { kind: "half", half: "low" },
  { kind: "half", half: "high" },
  { kind: "dozen", dozen: 1 },
  { kind: "dozen", dozen: 2 },
  { kind: "dozen", dozen: 3 },
  { kind: "column", column: 1 },
  { kind: "column", column: 2 },
  { kind: "column", column: 3 },
];

describe("the wheel", () => {
  it("is European -- 37 pockets, exactly one zero", () => {
    // A second zero would double the house edge from 2.70% to 5.26%. It is
    // the single most player-hostile change available in this file.
    expect(POCKET_COUNT).toBe(37);
    expect(WHEEL_ORDER).toHaveLength(37);
    expect(WHEEL_ORDER.filter((pocket) => pocket === 0)).toHaveLength(1);
  });

  it("carries every number 0..36 exactly once", () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(ALL_POCKETS);
  });

  it("has 18 reds, 18 blacks and one green", () => {
    const counts = { red: 0, black: 0, green: 0 };
    for (const pocket of ALL_POCKETS) counts[pocketColour(pocket)] += 1;
    expect(counts).toEqual({ red: 18, black: 18, green: 1 });
  });

  it("alternates colour around the physical ring, which is what makes it a real wheel", () => {
    // Zero breaks the alternation by sitting between two reds; every other
    // adjacent pair must differ.
    for (let index = 0; index < WHEEL_ORDER.length; index += 1) {
      const here = WHEEL_ORDER[index];
      const next = WHEEL_ORDER[(index + 1) % WHEEL_ORDER.length];
      if (here === 0 || next === 0) continue;
      expect(pocketColour(here)).not.toBe(pocketColour(next));
    }
  });
});

describe("rouletteWins", () => {
  it("pays a straight-up bet on its own number and nothing else", () => {
    for (const pocket of ALL_POCKETS) {
      expect(rouletteWins({ kind: "straight", pocket: 17 }, pocket)).toBe(pocket === 17);
    }
  });

  it("lets a straight-up bet on zero win", () => {
    expect(rouletteWins({ kind: "straight", pocket: 0 }, 0)).toBe(true);
  });

  it("loses every outside bet to the zero -- this is the entire house edge", () => {
    for (const bet of EVERY_BET) {
      if (bet.kind === "straight") continue;
      expect(rouletteWins(bet, 0)).toBe(false);
    }
  });

  it("reads colour, parity and halves off the number", () => {
    expect(rouletteWins({ kind: "colour", colour: "red" }, 32)).toBe(true);
    expect(rouletteWins({ kind: "colour", colour: "black" }, 32)).toBe(false);
    expect(rouletteWins({ kind: "parity", parity: "odd" }, 17)).toBe(true);
    expect(rouletteWins({ kind: "parity", parity: "even" }, 17)).toBe(false);
    expect(rouletteWins({ kind: "half", half: "low" }, 18)).toBe(true);
    expect(rouletteWins({ kind: "half", half: "low" }, 19)).toBe(false);
    expect(rouletteWins({ kind: "half", half: "high" }, 19)).toBe(true);
  });

  it("splits the dozens and the columns at the right places", () => {
    expect(rouletteWins({ kind: "dozen", dozen: 1 }, 12)).toBe(true);
    expect(rouletteWins({ kind: "dozen", dozen: 2 }, 13)).toBe(true);
    expect(rouletteWins({ kind: "dozen", dozen: 2 }, 24)).toBe(true);
    expect(rouletteWins({ kind: "dozen", dozen: 3 }, 25)).toBe(true);
    expect(rouletteWins({ kind: "column", column: 1 }, 1)).toBe(true);
    expect(rouletteWins({ kind: "column", column: 1 }, 34)).toBe(true);
    expect(rouletteWins({ kind: "column", column: 2 }, 2)).toBe(true);
    expect(rouletteWins({ kind: "column", column: 3 }, 36)).toBe(true);
  });

  it("agrees with winningPockets on every bet", () => {
    // The felt quotes `winningPockets` as the true chance. If it disagreed
    // with what actually wins, the price shown would be a lie.
    for (const bet of EVERY_BET) {
      const actual = ALL_POCKETS.filter((pocket) => rouletteWins(bet, pocket)).length;
      expect(actual).toBe(winningPockets(bet));
    }
  });
});

describe("the price of every bet", () => {
  it("is a house edge of exactly 1/37 on the whole layout, and never more", () => {
    // The one property that matters: a single zero prices every bet as though
    // there were 36 pockets. Any bet that came out cheaper would be a hole in
    // the house's book; any that came out dearer would be a second, hidden
    // rake on top of the zero.
    for (const bet of EVERY_BET) {
      const wins = winningPockets(bet);
      const gross = ROULETTE_ODDS[bet.kind] + 1;
      const expectedReturn = (wins * gross) / POCKET_COUNT;
      expect(expectedReturn).toBeCloseTo(36 / 37, 12);
    }
  });

  it("never offers a positive-expectation bet", () => {
    for (const bet of EVERY_BET) {
      const wins = winningPockets(bet);
      const expectedReturn = (wins * (ROULETTE_ODDS[bet.kind] + 1)) / POCKET_COUNT;
      expect(expectedReturn).toBeLessThan(1);
    }
  });
});

describe("isLegalBet", () => {
  it("accepts everything the layout offers", () => {
    for (const bet of EVERY_BET) expect(isLegalBet(bet)).toBe(true);
  });

  it("refuses out-of-range selections", () => {
    expect(isLegalBet({ kind: "straight", pocket: 37 })).toBe(false);
    expect(isLegalBet({ kind: "straight", pocket: -1 })).toBe(false);
    expect(isLegalBet({ kind: "straight", pocket: 1.5 })).toBe(false);
    expect(isLegalBet({ kind: "dozen", dozen: 4 as 1 })).toBe(false);
    expect(isLegalBet({ kind: "column", column: 0 as 1 })).toBe(false);
  });
});

describe("spinRoulette", () => {
  /** A randomInt that always returns the index of the pocket wanted. */
  const always = (pocket: number) => () => pocket;

  it("draws a pocket and settles", () => {
    const round = spinRoulette(startRouletteRound({ stake: 1000, bet: { kind: "colour", colour: "red" } }), always(32));
    expect(round.pocket).toBe(32);
    expect(round.phase).toBe("settled");
    expect(round.won).toBe(true);
  });

  it("pays gross minus the stake, so the stake is never taken twice", () => {
    const round = spinRoulette(startRouletteRound({ stake: 1000, bet: { kind: "straight", pocket: 17 } }), always(17));
    expect(roulettePayout(round)).toBe(36_000);
    expect(round.netGold).toBe(35_000);
  });

  it("nets an even-money win at exactly the stake", () => {
    const round = spinRoulette(startRouletteRound({ stake: 1000, bet: { kind: "colour", colour: "red" } }), always(32));
    expect(roulettePayout(round)).toBe(2000);
    expect(round.netGold).toBe(1000);
  });

  it("loses the whole stake on a miss", () => {
    const round = spinRoulette(startRouletteRound({ stake: 1000, bet: { kind: "colour", colour: "red" } }), always(0));
    expect(round.won).toBe(false);
    expect(roulettePayout(round)).toBe(0);
    expect(round.netGold).toBe(-1000);
  });

  it("draws uniformly over all 37 pockets", () => {
    const seen = new Set<number>();
    for (let pocket = 0; pocket < POCKET_COUNT; pocket += 1) {
      const round = spinRoulette(startRouletteRound({ stake: 100, bet: { kind: "colour", colour: "red" } }), (max) => {
        expect(max).toBe(POCKET_COUNT);
        return pocket;
      });
      seen.add(round.pocket!);
    }
    expect(seen.size).toBe(POCKET_COUNT);
  });

  it("cannot be spun twice", () => {
    // A second spin on one bet is exactly what the version guard exists to
    // stop; the engine refusing it is the second line of defence.
    const settled = spinRoulette(startRouletteRound({ stake: 1000, bet: { kind: "colour", colour: "red" } }), always(32));
    expect(spinRoulette(settled, always(0))).toBe(settled);
  });

  it("does not mutate the round it was given", () => {
    const round = startRouletteRound({ stake: 1000, bet: { kind: "colour", colour: "red" } });
    spinRoulette(round, always(32));
    expect(round.phase).toBe("bet");
    expect(round.pocket).toBeNull();
  });
});

describe("startRouletteRound", () => {
  it("opens with the bet placed and nothing decided", () => {
    const round = startRouletteRound({ stake: 1000, bet: { kind: "dozen", dozen: 2 } });
    expect(round.pocket).toBeNull();
    expect(round.phase).toBe("bet");
    expect(round.netGold).toBe(0);
  });

  it("refuses a bad stake or a bet the layout does not offer", () => {
    expect(() => startRouletteRound({ stake: 0, bet: { kind: "colour", colour: "red" } })).toThrow(/positive stake/i);
    expect(() => startRouletteRound({ stake: 100, bet: { kind: "straight", pocket: 99 } })).toThrow(/not a bet/i);
  });
});

describe("roulettePayout", () => {
  it("pays nothing before the spin", () => {
    expect(roulettePayout(startRouletteRound({ stake: 1000, bet: { kind: "straight", pocket: 7 } }))).toBe(0);
  });
});

describe("wheelRotation", () => {
  it("starts at rest and lands exactly on the winning pocket", () => {
    for (const pocket of [0, 17, 26, 36]) {
      expect(wheelRotation(pocket, 0)).toBe(0);
      expect(wheelRotation(pocket, SPIN_DURATION_MS)).toBe(restingRotation(pocket));
      // Terminates rather than asymptoting: a frame arriving late must not
      // leave the ball a degree short of the number that was just paid.
      expect(wheelRotation(pocket, SPIN_DURATION_MS + 1)).toBe(restingRotation(pocket));
    }
  });

  it("brings the winning pocket under the top marker", () => {
    for (const pocket of WHEEL_ORDER) {
      const index = WHEEL_ORDER.indexOf(pocket);
      const finalAngle = index * POCKET_ANGLE + restingRotation(pocket);
      // Whole turns only -- the pocket sits at the marker.
      const turns = finalAngle / (Math.PI * 2);
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
    }
  });

  it("eases out -- most of the distance is covered in the first half", () => {
    const resting = restingRotation(17);
    const half = wheelRotation(17, SPIN_DURATION_MS / 2);
    expect(half).toBeGreaterThan(resting * 0.9);
    expect(half).toBeLessThan(resting);
  });

  it("moves only forwards", () => {
    let previous = -1;
    for (let elapsed = 0; elapsed <= SPIN_DURATION_MS; elapsed += 60) {
      const angle = wheelRotation(17, elapsed);
      expect(angle).toBeGreaterThanOrEqual(previous);
      previous = angle;
    }
  });

  it("refuses a pocket that is not on the wheel", () => {
    expect(() => restingRotation(37)).toThrow(/No such pocket/);
  });
});

describe("labels", () => {
  it("names every bet without saying `undefined`", () => {
    for (const bet of EVERY_BET) {
      const label = betLabel(bet);
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/undefined|NaN/);
    }
  });

  it("names the number and its colour once the wheel stops", () => {
    expect(rouletteOutcomeLabel({ phase: "bet", pocket: null, won: false })).toBe("Place your bet");
    expect(rouletteOutcomeLabel({ phase: "settled", pocket: 0, won: false })).toBe("Zero");
    expect(rouletteOutcomeLabel({ phase: "settled", pocket: 32, won: true })).toBe("32 red — paid");
    expect(rouletteOutcomeLabel({ phase: "settled", pocket: 15, won: false })).toBe("15 black");
  });
});

describe("toRouletteSnapshot", () => {
  it("carries no result before the spin, because none has been drawn", () => {
    const round = startRouletteRound({ stake: 1000, bet: { kind: "straight", pocket: 7 } });
    const snapshot = toRouletteSnapshot(round, { id: "r1", version: 1 });
    expect(snapshot.pocket).toBeNull();
    expect(snapshot.colour).toBeNull();
    // Stronger than redaction: the number does not exist yet, so there is
    // nothing on the server for a client to reach for.
    expect(round.pocket).toBeNull();
  });

  it("quotes the price it is charging", () => {
    const snapshot = toRouletteSnapshot(
      startRouletteRound({ stake: 1000, bet: { kind: "straight", pocket: 7 } }),
      { id: "r1", version: 1 },
    );
    expect(snapshot.odds).toBe(35);
    expect(snapshot.winningPockets).toBe(1);
  });

  it("copies the bet, so a caller cannot reach back into the round", () => {
    const round = startRouletteRound({ stake: 1000, bet: { kind: "straight", pocket: 7 } });
    const snapshot = toRouletteSnapshot(round, { id: "r1", version: 1 });
    if (snapshot.bet.kind === "straight") snapshot.bet.pocket = 8;
    expect(round.bet).toEqual({ kind: "straight", pocket: 7 });
  });
});

import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/game/types";
import {
  VIDEO_POKER_HAND_SIZE,
  VIDEO_POKER_PAYTABLE,
  dealVideoPokerRound,
  drawVideoPoker,
  isLegalHold,
  payLine,
  rankVideoPokerHand,
  startVideoPokerRound,
  toVideoPokerSnapshot,
  videoPokerOutcomeLabel,
  videoPokerPayout,
  type VideoPokerRound,
} from "./video-poker";

/** `sh` for spades, `h` hearts, `d` diamonds, `c` clubs -- terse enough to read a hand off one line. */
function card(rank: Card["rank"], suit: Card["suit"]): Card {
  return { rank, suit };
}

/**
 * Cards are dealt with pop(), so the *last* five entries of a deck are the
 * hand, in reverse. This builds a deck that deals exactly the hand asked for
 * and then the draws asked for, which is what lets every rule below be
 * asserted against an exact board rather than a lucky shuffle.
 */
function deckDealing(hand: Card[], draws: Card[] = []): Card[] {
  return [...draws].reverse().concat([...hand].reverse());
}

function roundWith(hand: Card[], draws: Card[] = [], stake = 1000): VideoPokerRound {
  return startVideoPokerRound({ stake, deck: deckDealing(hand, draws) });
}

describe("rankVideoPokerHand", () => {
  it("names every pay line", () => {
    expect(rankVideoPokerHand([card("10", "spades"), card("J", "spades"), card("Q", "spades"), card("K", "spades"), card("A", "spades")])).toBe("royal-flush");
    expect(rankVideoPokerHand([card("5", "hearts"), card("6", "hearts"), card("7", "hearts"), card("8", "hearts"), card("9", "hearts")])).toBe("straight-flush");
    expect(rankVideoPokerHand([card("7", "hearts"), card("7", "spades"), card("7", "clubs"), card("7", "diamonds"), card("2", "hearts")])).toBe("four-of-a-kind");
    expect(rankVideoPokerHand([card("7", "hearts"), card("7", "spades"), card("7", "clubs"), card("2", "diamonds"), card("2", "hearts")])).toBe("full-house");
    expect(rankVideoPokerHand([card("2", "clubs"), card("5", "clubs"), card("9", "clubs"), card("J", "clubs"), card("K", "clubs")])).toBe("flush");
    expect(rankVideoPokerHand([card("4", "clubs"), card("5", "hearts"), card("6", "clubs"), card("7", "clubs"), card("8", "clubs")])).toBe("straight");
    expect(rankVideoPokerHand([card("9", "hearts"), card("9", "spades"), card("9", "clubs"), card("3", "diamonds"), card("2", "hearts")])).toBe("three-of-a-kind");
    expect(rankVideoPokerHand([card("9", "hearts"), card("9", "spades"), card("3", "clubs"), card("3", "diamonds"), card("2", "hearts")])).toBe("two-pair");
  });

  it("pays a pair of jacks and refuses a pair of tens", () => {
    // The whole name of the game sits on this boundary.
    expect(rankVideoPokerHand([card("J", "hearts"), card("J", "spades"), card("3", "clubs"), card("5", "diamonds"), card("9", "hearts")])).toBe("jacks-or-better");
    expect(rankVideoPokerHand([card("10", "hearts"), card("10", "spades"), card("3", "clubs"), card("5", "diamonds"), card("9", "hearts")])).toBeNull();
    for (const rank of ["J", "Q", "K", "A"] as const) {
      expect(rankVideoPokerHand([card(rank, "hearts"), card(rank, "spades"), card("3", "clubs"), card("5", "diamonds"), card("8", "hearts")])).toBe("jacks-or-better");
    }
    for (const rank of ["2", "5", "9", "10"] as const) {
      expect(rankVideoPokerHand([card(rank, "hearts"), card(rank, "spades"), card("3", "clubs"), card("6", "diamonds"), card("8", "hearts")])).toBeNull();
    }
  });

  it("calls a wheel a straight and an ace-high straight flush a royal", () => {
    expect(rankVideoPokerHand([card("A", "clubs"), card("2", "hearts"), card("3", "clubs"), card("4", "clubs"), card("5", "clubs")])).toBe("straight");
    // A-2-3-4-5 all in suit is a straight flush, NOT the royal -- the royal is
    // the ace-HIGH one, and paying 800x for the wheel would be a 16x mispay.
    expect(rankVideoPokerHand([card("A", "clubs"), card("2", "clubs"), card("3", "clubs"), card("4", "clubs"), card("5", "clubs")])).toBe("straight-flush");
  });

  it("returns nothing for a busted hand", () => {
    expect(rankVideoPokerHand([card("2", "hearts"), card("5", "spades"), card("9", "clubs"), card("J", "diamonds"), card("K", "hearts")])).toBeNull();
  });

  it("insists on exactly five cards", () => {
    expect(() => rankVideoPokerHand([card("2", "hearts")])).toThrow(/exactly five/i);
  });
});

describe("the pay table", () => {
  it("is ordered best line first, which is also the order it renders in", () => {
    const multipliers = VIDEO_POKER_PAYTABLE.map((line) => line.multiplier);
    expect([...multipliers].sort((a, b) => b - a)).toEqual(multipliers);
  });

  it("has a line for every rank the engine can return", () => {
    // A rank with no line throws in payLine, which would be a 500 on a
    // winning hand -- the worst possible moment to find out.
    for (const line of VIDEO_POKER_PAYTABLE) {
      expect(payLine(line.rank)).toEqual(line);
    }
  });

  it("prices jacks or better as a push, not a win", () => {
    // A multiplier here is GROSS. Reading `1` as "wins one stake" would pay
    // every pushed hand twice.
    expect(payLine("jacks-or-better").multiplier).toBe(1);
    const round = drawVideoPoker(
      roundWith([card("J", "hearts"), card("J", "spades"), card("3", "clubs"), card("5", "diamonds"), card("9", "hearts")]),
      [true, true, true, true, true],
    );
    expect(round.rank).toBe("jacks-or-better");
    expect(round.netGold).toBe(0);
    expect(videoPokerPayout(round)).toBe(round.stake);
  });
});

describe("startVideoPokerRound", () => {
  it("deals five cards and leaves the rest of the deck", () => {
    const round = dealVideoPokerRound(1000, (max) => max - 1);
    expect(round.hand).toHaveLength(VIDEO_POKER_HAND_SIZE);
    expect(round.deck).toHaveLength(52 - VIDEO_POKER_HAND_SIZE);
    expect(round.phase).toBe("draw");
    expect(round.held).toEqual([false, false, false, false, false]);
    expect(round.replaced).toEqual([false, false, false, false, false]);
    expect(round.netGold).toBe(0);
  });

  it("refuses a non-positive stake", () => {
    expect(() => startVideoPokerRound({ stake: 0, deck: [] })).toThrow(/positive stake/i);
    expect(() => startVideoPokerRound({ stake: -5, deck: [] })).toThrow(/positive stake/i);
  });

  it("floors a fractional stake rather than carrying it into the payout", () => {
    const round = startVideoPokerRound({ stake: 1000.7, deck: deckDealing([
      card("2", "hearts"), card("5", "spades"), card("9", "clubs"), card("J", "diamonds"), card("K", "hearts"),
    ]) });
    expect(round.stake).toBe(1000);
  });
});

describe("drawVideoPoker", () => {
  const busted = [card("2", "hearts"), card("5", "spades"), card("9", "clubs"), card("J", "diamonds"), card("K", "hearts")];

  it("replaces exactly the cards not held", () => {
    const round = roundWith(busted, [card("2", "spades"), card("2", "clubs")]);
    const next = drawVideoPoker(round, [true, false, false, true, true]);

    expect(next.hand[0]).toEqual(card("2", "hearts"));
    expect(next.hand[3]).toEqual(card("J", "diamonds"));
    expect(next.hand[4]).toEqual(card("K", "hearts"));
    // The two open positions take the two queued draws, in order.
    expect(next.hand[1]).toEqual(card("2", "spades"));
    expect(next.hand[2]).toEqual(card("2", "clubs"));
    expect(next.replaced).toEqual([false, true, true, false, false]);
    expect(next.rank).toBe("three-of-a-kind");
  });

  it("treats holding all five as a legal draw of nothing", () => {
    const round = roundWith(busted);
    const next = drawVideoPoker(round, [true, true, true, true, true]);
    expect(next.hand).toEqual(round.hand);
    expect(next.deck).toHaveLength(round.deck.length);
    expect(next.phase).toBe("settled");
    expect(next.rank).toBeNull();
    expect(next.netGold).toBe(-round.stake);
  });

  it("draws all five when nothing is held", () => {
    const draws = [card("A", "spades"), card("K", "spades"), card("Q", "spades"), card("J", "spades"), card("10", "spades")];
    const next = drawVideoPoker(roundWith(busted, draws), [false, false, false, false, false]);
    expect(next.rank).toBe("royal-flush");
    expect(next.replaced).toEqual([true, true, true, true, true]);
  });

  it("nets gross minus the stake, so the stake is never taken twice", () => {
    const draws = [card("A", "spades"), card("K", "spades"), card("Q", "spades"), card("J", "spades"), card("10", "spades")];
    const next = drawVideoPoker(roundWith(busted, draws, 1000), [false, false, false, false, false]);
    expect(videoPokerPayout(next)).toBe(1000 * 800);
    expect(next.netGold).toBe(1000 * 800 - 1000);
  });

  it("loses the whole stake on a hand that pays nothing", () => {
    const next = drawVideoPoker(roundWith(busted), [true, true, true, true, true]);
    expect(videoPokerPayout(next)).toBe(0);
    expect(next.netGold).toBe(-1000);
  });

  it("is inert on an illegal hold rather than throwing", () => {
    // The service turns this into a 409; a throw here would be a 500 where a
    // conflict belongs.
    const round = roundWith(busted);
    expect(drawVideoPoker(round, [true, false])).toBe(round);
    expect(isLegalHold(round, [true, false])).toBe(false);
    expect(isLegalHold(round, [true, false, false, false, false])).toBe(true);
  });

  it("cannot be drawn twice", () => {
    const settled = drawVideoPoker(roundWith(busted), [true, true, true, true, true]);
    expect(isLegalHold(settled, [false, false, false, false, false])).toBe(false);
    expect(drawVideoPoker(settled, [false, false, false, false, false])).toBe(settled);
  });

  it("does not mutate the round it was given", () => {
    const round = roundWith(busted, [card("2", "spades")]);
    const deckBefore = round.deck.length;
    drawVideoPoker(round, [true, true, true, true, false]);
    expect(round.deck).toHaveLength(deckBefore);
    expect(round.phase).toBe("draw");
    expect(round.hand[4]).toEqual(card("K", "hearts"));
  });
});

describe("videoPokerPayout", () => {
  it("pays nothing on a hand that is still live", () => {
    expect(videoPokerPayout(roundWith([card("A", "spades"), card("K", "spades"), card("Q", "spades"), card("J", "spades"), card("10", "spades")]))).toBe(0);
  });

  it("floors a fractional payout the house's way", () => {
    // No 8/5 line is fractional today, so this pins the rounding direction
    // rather than a current line: a future half-unit must fall to the house,
    // the same way blackjack's 3:2 rounds on an odd stake.
    const round = drawVideoPoker(
      roundWith([card("9", "hearts"), card("9", "spades"), card("3", "clubs"), card("3", "diamonds"), card("2", "hearts")], [], 1001),
      [true, true, true, true, true],
    );
    expect(round.rank).toBe("two-pair");
    expect(videoPokerPayout(round)).toBe(2002);
  });
});

describe("toVideoPokerSnapshot", () => {
  it("has no deck field at all", () => {
    const round = roundWith([card("A", "spades"), card("K", "spades"), card("Q", "spades"), card("J", "spades"), card("10", "spades")]);
    const snapshot = toVideoPokerSnapshot(round, { id: "r1", version: 3 });
    // Not "is empty" -- absent. The five cards behind the draw are sitting in
    // that deck, and a client that could read them would know what to hold.
    expect("deck" in snapshot).toBe(false);
    expect(snapshot.id).toBe("r1");
    expect(snapshot.version).toBe(3);
    expect(snapshot.hand).toHaveLength(5);
  });

  it("copies the cards, so a caller cannot reach back into the round", () => {
    const round = roundWith([card("A", "spades"), card("K", "spades"), card("Q", "spades"), card("J", "spades"), card("10", "spades")]);
    const snapshot = toVideoPokerSnapshot(round, { id: "r1", version: 1 });
    snapshot.hand[0].rank = "2";
    snapshot.held[0] = true;
    expect(round.hand[0].rank).toBe("A");
    expect(round.held[0]).toBe(false);
  });
});

describe("videoPokerOutcomeLabel", () => {
  it("names the line, or says so when nothing paid", () => {
    const busted = [card("2", "hearts"), card("5", "spades"), card("9", "clubs"), card("J", "diamonds"), card("K", "hearts")];
    expect(videoPokerOutcomeLabel(roundWith(busted))).toBe("Hold and draw");
    expect(videoPokerOutcomeLabel(drawVideoPoker(roundWith(busted), [true, true, true, true, true]))).toBe("No pay");
    const paid = drawVideoPoker(
      roundWith([card("J", "hearts"), card("J", "spades"), card("3", "clubs"), card("5", "diamonds"), card("9", "hearts")]),
      [true, true, true, true, true],
    );
    expect(videoPokerOutcomeLabel(paid)).toBe("Jacks or Better");
  });
});

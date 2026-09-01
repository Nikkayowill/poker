import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "@/lib/game/types";
import {
  canCoverStake,
  dealRound,
  dealerUpCards,
  doubleDown,
  handTotal,
  hit,
  isNatural,
  legalBlackjackActions,
  resign,
  settlementPayout,
  stand,
  startRound,
  toBlackjackSnapshot,
} from "./blackjack";

/** "AS" -> ace of spades. Terse because these tests are mostly hand fixtures. */
const suitOf: Record<string, Suit> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
function card(code: string): Card {
  return { rank: code.slice(0, -1) as Rank, suit: suitOf[code.slice(-1)] };
}
function hand(...codes: string[]): Card[] {
  return codes.map(card);
}

/**
 * startRound deals from the END of the deck, player first, alternating. This
 * builds a deck that deals the hands given, with `rest` drawn afterwards in
 * the order written.
 */
function stacked(player: string[], dealer: string[], rest: string[] = []): Card[] {
  const order = [player[0], dealer[0], player[1], dealer[1], ...rest];
  return order.map(card).reverse();
}

describe("handTotal", () => {
  it("counts an ace as 11 until that would bust", () => {
    expect(handTotal(hand("AS", "9H"))).toEqual({ total: 20, soft: true, busted: false });
    expect(handTotal(hand("AS", "9H", "5D"))).toEqual({ total: 15, soft: false, busted: false });
  });

  it("demotes exactly one ace at a time", () => {
    // A-A-9 is 21, not 12 and not 31.
    expect(handTotal(hand("AS", "AH", "9D")).total).toBe(21);
    expect(handTotal(hand("AS", "AH")).total).toBe(12);
    expect(handTotal(hand("AS", "AH", "AD", "8C")).total).toBe(21);
  });

  it("values every face card at ten", () => {
    expect(handTotal(hand("KS", "QH")).total).toBe(20);
    expect(handTotal(hand("JS", "10H")).total).toBe(20);
  });

  it("reports a bust rather than clamping", () => {
    expect(handTotal(hand("KS", "QH", "5D"))).toEqual({ total: 25, soft: false, busted: true });
  });

  it("calls a soft 17 soft and a hard 17 hard", () => {
    expect(handTotal(hand("AS", "6H")).soft).toBe(true);
    expect(handTotal(hand("10S", "7H")).soft).toBe(false);
  });
});

describe("isNatural", () => {
  it("is two cards or nothing", () => {
    expect(isNatural(hand("AS", "KH"))).toBe(true);
    // 21 over three cards is not a natural and must not pay 3:2.
    expect(isNatural(hand("7S", "7H", "7D"))).toBe(false);
  });
});

describe("startRound", () => {
  it("deals two cards each, player first, and leaves 48 in the deck", () => {
    const round = startRound({ stake: 1000, deck: stacked(["9S", "7H"], ["6D", "5C"]) });
    expect(round.playerHand).toEqual(hand("9S", "7H"));
    expect(round.dealerHand).toEqual(hand("6D", "5C"));
    expect(round.deck).toHaveLength(0);
    expect(round.phase).toBe("player-turn");
  });

  it("pays a natural 3:2 immediately", () => {
    const round = startRound({ stake: 1000, deck: stacked(["AS", "KH"], ["9D", "8C"]) });
    expect(round.phase).toBe("settled");
    expect(round.outcome).toBe("player-blackjack");
    expect(round.netGold).toBe(1500);
  });

  it("pushes two naturals", () => {
    const round = startRound({ stake: 1000, deck: stacked(["AS", "KH"], ["AD", "QC"]) });
    expect(round.outcome).toBe("push");
    expect(round.netGold).toBe(0);
  });

  it("loses to a dealer natural before the player acts", () => {
    const round = startRound({ stake: 1000, deck: stacked(["10S", "9H"], ["AD", "QC"]) });
    expect(round.outcome).toBe("dealer-win");
    expect(round.netGold).toBe(-1000);
  });

  it("rounds a 3:2 payout the house's way on an odd stake", () => {
    const round = startRound({ stake: 25, deck: stacked(["AS", "KH"], ["9D", "8C"]) });
    expect(round.netGold).toBe(37);
  });

  it("rejects a negative or non-finite stake", () => {
    expect(() => startRound({ stake: -5, deck: stacked(["9S", "7H"], ["6D", "5C"]) })).toThrow();
    expect(() => startRound({ stake: NaN, deck: stacked(["9S", "7H"], ["6D", "5C"]) })).toThrow();
  });

  // A stake of exactly 0 is legal: Blackjack's own practice mode
  // (lib/server/blackjack-service.ts) deals a real hand for it.
  it("deals a practice round on a stake of 0", () => {
    const round = startRound({ stake: 0, deck: stacked(["9S", "7H"], ["6D", "5C"]) });
    expect(round.baseStake).toBe(0);
    expect(round.stake).toBe(0);
  });

  it("does not mutate the deck it was handed", () => {
    const deck = stacked(["9S", "7H"], ["6D", "5C"], ["2S"]);
    const before = deck.length;
    startRound({ stake: 100, deck });
    expect(deck).toHaveLength(before);
  });
});

describe("hit", () => {
  it("draws a card and leaves the turn open", () => {
    const round = hit(startRound({ stake: 100, deck: stacked(["5S", "4H"], ["6D", "5C"], ["3S"]) }));
    expect(round.playerHand).toEqual(hand("5S", "4H", "3S"));
    expect(round.phase).toBe("player-turn");
  });

  it("settles a bust at the current stake", () => {
    const round = hit(startRound({ stake: 100, deck: stacked(["10S", "9H"], ["6D", "5C"], ["5S"]) }));
    expect(round.outcome).toBe("player-bust");
    expect(round.netGold).toBe(-100);
  });

  it("stands automatically on a drawn 21 -- there is no card that improves it", () => {
    // Player 10+5, hits a 6 for 21; dealer 18 stands.
    const round = hit(startRound({ stake: 100, deck: stacked(["10S", "5H"], ["10D", "8C"], ["6S"]) }));
    expect(round.phase).toBe("settled");
    expect(round.outcome).toBe("player-win");
    // A three-card 21 pays even money, not 3:2.
    expect(round.netGold).toBe(100);
  });

  it("is inert once the round is settled", () => {
    const settled = stand(startRound({ stake: 100, deck: stacked(["10S", "9H"], ["10D", "8C"]) }));
    expect(hit(settled)).toBe(settled);
  });
});

describe("resign", () => {
  it("forfeits the whole stake and settles the round", () => {
    const round = resign(startRound({ stake: 100, deck: stacked(["5S", "4H"], ["6D", "5C"]) }));
    expect(round.phase).toBe("settled");
    expect(round.outcome).toBe("player-resign");
    expect(round.netGold).toBe(-100);
    expect(settlementPayout(round)).toBe(0);
  });

  it("forfeits nothing on a practice (stake 0) round -- there is nothing to forfeit", () => {
    const round = resign(startRound({ stake: 0, deck: stacked(["5S", "4H"], ["6D", "5C"]) }));
    expect(round.netGold).toBe(0);
  });

  it("is only legal on the opening turn, same as hit and stand", () => {
    const settled = stand(startRound({ stake: 100, deck: stacked(["10S", "9H"], ["10D", "8C"]) }));
    expect(resign(settled)).toBe(settled);
  });

  it("cannot be called after a double locked the wager in", () => {
    // doubleDown always leaves the round settled (exactly one more card, then
    // the dealer plays out), so resign has no live phase left to act on.
    // Dealer already stands on 18, so playDealer draws nothing further.
    const doubled = doubleDown(
      startRound({ stake: 100, deck: stacked(["5S", "4H"], ["10D", "8C"], ["2S"]) }),
    );
    expect(doubled.phase).toBe("settled");
    expect(resign(doubled)).toBe(doubled);
  });

  it("is offered exactly when hit and stand are", () => {
    const live = startRound({ stake: 100, deck: stacked(["5S", "4H"], ["10D", "8C"]) });
    expect(legalBlackjackActions(live).resign).toBe(true);
    const settled = stand(live);
    expect(legalBlackjackActions(settled).resign).toBe(false);
  });
});

describe("dealer rules", () => {
  it("stands on a soft 17", () => {
    // Dealer A-6. S17 means it must not draw the waiting 4.
    const round = stand(startRound({ stake: 100, deck: stacked(["10S", "8H"], ["AD", "6C"], ["4S"]) }));
    expect(round.dealerHand).toEqual(hand("AD", "6C"));
    expect(round.outcome).toBe("player-win");
  });

  it("stands on a hard 17", () => {
    const round = stand(startRound({ stake: 100, deck: stacked(["10S", "8H"], ["10D", "7C"], ["4S"]) }));
    expect(round.dealerHand).toHaveLength(2);
    expect(round.outcome).toBe("player-win");
  });

  it("hits under 17 and pays out when it busts", () => {
    const round = stand(startRound({ stake: 100, deck: stacked(["10S", "6H"], ["10D", "6C"], ["KS"]) }));
    expect(round.dealerHand).toEqual(hand("10D", "6C", "KS"));
    expect(round.outcome).toBe("dealer-bust");
    expect(round.netGold).toBe(100);
  });

  it("keeps drawing until it reaches 17", () => {
    const round = stand(startRound({ stake: 100, deck: stacked(["10S", "8H"], ["2D", "3C"], ["4S", "2H", "6D"]) }));
    expect(round.dealerHand).toEqual(hand("2D", "3C", "4S", "2H", "6D"));
    expect(handTotal(round.dealerHand).total).toBe(17);
    expect(round.outcome).toBe("player-win");
  });

  it("wins the tie for nobody -- equal totals push", () => {
    const round = stand(startRound({ stake: 100, deck: stacked(["10S", "8H"], ["10D", "8C"]) }));
    expect(round.outcome).toBe("push");
    expect(round.netGold).toBe(0);
  });

  it("takes the pot on a higher total", () => {
    const round = stand(startRound({ stake: 100, deck: stacked(["10S", "8H"], ["10D", "9C"]) }));
    expect(round.outcome).toBe("dealer-win");
    expect(round.netGold).toBe(-100);
  });
});

describe("doubleDown", () => {
  it("doubles the wager, draws exactly one card and ends the turn", () => {
    const round = doubleDown(
      startRound({ stake: 100, deck: stacked(["6S", "5H"], ["10D", "7C"], ["10S"]) }),
    );
    expect(round.doubled).toBe(true);
    expect(round.stake).toBe(200);
    expect(round.baseStake).toBe(100);
    expect(round.playerHand).toHaveLength(3);
    expect(round.phase).toBe("settled");
    expect(round.outcome).toBe("player-win");
    expect(round.netGold).toBe(200);
  });

  it("loses the doubled stake when the one card busts", () => {
    const round = doubleDown(
      startRound({ stake: 100, deck: stacked(["10S", "6H"], ["10D", "7C"], ["KS"]) }),
    );
    expect(round.outcome).toBe("player-bust");
    expect(round.netGold).toBe(-200);
  });

  it("is offered on the opening two cards only", () => {
    const opening = startRound({ stake: 100, deck: stacked(["6S", "5H"], ["10D", "7C"], ["2S", "3H"]) });
    expect(legalBlackjackActions(opening).double).toBe(true);
    const afterHit = hit(opening);
    expect(legalBlackjackActions(afterHit).double).toBe(false);
    // And the guard holds even if a caller ignores the legal-action list.
    expect(doubleDown(afterHit)).toBe(afterHit);
  });
});

describe("dealerUpCards", () => {
  it("hides the hole card until the dealer's turn", () => {
    const live = startRound({ stake: 100, deck: stacked(["10S", "8H"], ["10D", "7C"]) });
    expect(dealerUpCards(live)).toEqual(hand("10D"));
    expect(dealerUpCards(stand(live))).toEqual(hand("10D", "7C"));
  });
});

describe("dealRound", () => {
  it("deals from a full shuffled deck with no duplicates", () => {
    // A deterministic stand-in for crypto's randomInt.
    let seed = 7;
    const randomInt = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    const round = dealRound(500, randomInt);
    const dealt = [...round.playerHand, ...round.dealerHand];
    expect(round.deck.length + dealt.length).toBe(52);
    const keys = [...round.deck, ...dealt].map((c) => `${c.rank}${c.suit}`);
    expect(new Set(keys).size).toBe(52);
  });
});

describe("canCoverStake", () => {
  it("gates opening on the stake and doubling on twice the stake", () => {
    expect(canCoverStake(1000, { goldBalance: 1500, unlimitedGold: false }))
      .toEqual({ open: true, double: false });
    expect(canCoverStake(1000, { goldBalance: 2000, unlimitedGold: false }))
      .toEqual({ open: true, double: true });
    expect(canCoverStake(1000, { goldBalance: 999, unlimitedGold: false }))
      .toEqual({ open: false, double: false });
  });

  it("lets an unlimited profile cover anything", () => {
    expect(canCoverStake(500000, { goldBalance: 0, unlimitedGold: true }))
      .toEqual({ open: true, double: true });
  });
});

describe("settlementPayout", () => {
  // The stake is debited when the round opens, so settlement is one credit
  // back rather than a second debit on a loss. Every case below is
  // "start - stake + payout" landing on start + netGold.
  it("returns nothing on a loss", () => {
    const round = startRound({ stake: 1000, deck: stacked(["10S", "6H"], ["10D", "9C"]) });
    const settled = stand(round);
    expect(settled.outcome).toBe("dealer-win");
    expect(settled.netGold).toBe(-1000);
    expect(settlementPayout(settled)).toBe(0);
  });

  it("returns the stake on a push", () => {
    const round = startRound({ stake: 1000, deck: stacked(["10S", "9H"], ["10D", "9C"]) });
    const settled = stand(round);
    expect(settled.outcome).toBe("push");
    expect(settlementPayout(settled)).toBe(1000);
  });

  it("returns twice the stake on an ordinary win", () => {
    const round = startRound({ stake: 1000, deck: stacked(["10S", "9H"], ["10D", "8C"]) });
    const settled = stand(round);
    expect(settled.outcome).toBe("player-win");
    expect(settlementPayout(settled)).toBe(2000);
  });

  it("returns the stake plus 3:2 on a natural", () => {
    const round = startRound({ stake: 1000, deck: stacked(["AS", "KH"], ["10D", "8C"]) });
    expect(round.outcome).toBe("player-blackjack");
    expect(settlementPayout(round)).toBe(2500);
  });

  it("pays a double at the doubled stake", () => {
    const round = startRound({ stake: 1000, deck: stacked(["6S", "5H"], ["10D", "8C"], ["9C"]) });
    const settled = doubleDown(round);
    expect(settled.stake).toBe(2000);
    expect(settled.outcome).toBe("player-win");
    // 2000 staked (1000 at the deal, 1000 more to double) comes back doubled.
    expect(settlementPayout(settled)).toBe(4000);
  });

  it("pays nothing on a round that is still running", () => {
    const round = startRound({ stake: 1000, deck: stacked(["6S", "5H"], ["10D", "8C"]) });
    expect(round.phase).toBe("player-turn");
    expect(settlementPayout(round)).toBe(0);
  });

  // A practice hand (stake 0) has to settle to exactly 0 on every outcome --
  // this is what lets the server skip crediting a practice round without a
  // separate practice check of its own (see the note on settlementPayout).
  it("settles a practice hand to 0 on a win, a loss, and a push alike", () => {
    const won = stand(startRound({ stake: 0, deck: stacked(["10S", "9H"], ["10D", "8C"]) }));
    expect(won.outcome).toBe("player-win");
    expect(settlementPayout(won)).toBe(0);

    const lost = stand(startRound({ stake: 0, deck: stacked(["10S", "6H"], ["10D", "9C"]) }));
    expect(lost.outcome).toBe("dealer-win");
    expect(settlementPayout(lost)).toBe(0);

    const pushed = stand(startRound({ stake: 0, deck: stacked(["10S", "9H"], ["10D", "9C"]) }));
    expect(pushed.outcome).toBe("push");
    expect(settlementPayout(pushed)).toBe(0);

    const natural = startRound({ stake: 0, deck: stacked(["AS", "KH"], ["10D", "8C"]) });
    expect(natural.outcome).toBe("player-blackjack");
    expect(settlementPayout(natural)).toBe(0);
  });
});

describe("toBlackjackSnapshot", () => {
  const meta = { id: "round-1", version: 3 };

  it("never carries the undealt deck", () => {
    const round = startRound({ stake: 1000, deck: stacked(["6S", "5H"], ["10D", "8C"]) });
    const snapshot = toBlackjackSnapshot(round, meta);
    // Not "is empty" -- the field must not exist at all, so that no future
    // refactor can quietly start populating it.
    expect("deck" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("deck");
  });

  it("withholds the hole card until the dealer's turn", () => {
    const round = startRound({ stake: 1000, deck: stacked(["6S", "5H"], ["10D", "8C"]) });
    const during = toBlackjackSnapshot(round, meta);
    expect(during.dealerHand).toEqual(hand("10D"));
    expect(during.dealerHoleHidden).toBe(true);
    // The withheld card is genuinely absent from the payload, not merely
    // unrendered: a player reading the network tab still cannot see it.
    expect(JSON.stringify(during.dealerHand)).not.toContain("clubs");

    const after = toBlackjackSnapshot(stand(round), meta);
    expect(after.dealerHoleHidden).toBe(false);
    expect(after.dealerHand.length).toBeGreaterThanOrEqual(2);
    expect(after.dealerHand[1]).toEqual(card("8C"));
  });

  it("carries the id, version and legal moves the client acts on", () => {
    const round = startRound({ stake: 1000, deck: stacked(["6S", "5H"], ["10D", "8C"]) });
    const snapshot = toBlackjackSnapshot(round, meta);
    expect(snapshot.id).toBe("round-1");
    expect(snapshot.version).toBe(3);
    expect(snapshot.legal).toEqual({ hit: true, stand: true, double: true, resign: true });
    expect(snapshot.netGold).toBe(0);
    expect(snapshot.outcome).toBeNull();
  });

  it("reports a settled round's outcome and net", () => {
    const round = startRound({ stake: 1000, deck: stacked(["AS", "KH"], ["10D", "8C"]) });
    const snapshot = toBlackjackSnapshot(round, meta);
    expect(snapshot.phase).toBe("settled");
    expect(snapshot.outcome).toBe("player-blackjack");
    expect(snapshot.netGold).toBe(1500);
    expect(snapshot.legal).toEqual({ hit: false, stand: false, double: false, resign: false });
  });
});

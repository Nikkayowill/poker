import { describe, expect, it } from "vitest";
import { bestFiveCards, compareScores, evaluateHand } from "./evaluator";
import { applyPlayerAction, createGame } from "./engine";
import { cardKey, isWinningCard, winningCardKeys } from "./winning-cards";
import type { Card, GameState } from "./types";

const cards = (values: string): Card[] =>
  values.split(" ").map((value) => {
    const suits = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" } as const;
    return {
      rank: value.slice(0, -1) as Card["rank"],
      suit: suits[value.at(-1) as keyof typeof suits],
    };
  });

const keysOf = (list: Card[]) => list.map(cardKey).sort();

describe("bestFiveCards", () => {
  it("returns the five cards the score was actually made from", () => {
    const seven = cards("Ah Kh Qh Jh 10h 2c 3d");
    const best = bestFiveCards(seven);
    expect(best).toHaveLength(5);
    expect(keysOf(best)).toEqual(keysOf(cards("Ah Kh Qh Jh 10h")));
  });

  it("agrees with evaluateHand on every hand it is asked about", () => {
    // The real invariant. bestFiveCards and evaluateHand run the same search,
    // so a five that scores lower than the reported hand means the two have
    // drifted apart -- which is the only way this can be wrong.
    const hands = [
      "Ah Ad Ac Ks Kd 2h 3h",   // full house over two pair
      "2c 3d 4h 5s 6c Kd Qh",   // straight, not the two high cards
      "Ah Jh 8h 5h 2h Kd Qc",   // flush, not the king
      "As 2d 3h 4c 5s Kd Qc",   // wheel
      "7c 7d 7h 2s 9c 9d 4h",   // full house from two pairs of trips-and-pair
      "Ks Qd 9h 4c 2s 7d 3h",   // high card only
    ];
    hands.forEach((hand) => {
      const seven = cards(hand);
      const reported = evaluateHand(seven);
      const five = bestFiveCards(seven);
      expect(five).toHaveLength(5);
      expect(compareScores(evaluateHand(five), reported)).toBe(0);
      // And every card it names is one that was actually on the table.
      five.forEach((card) => {
        expect(seven.some((candidate) => cardKey(candidate) === cardKey(card))).toBe(true);
      });
    });
  });

  it("names five distinct cards", () => {
    const best = bestFiveCards(cards("Ah Ad Ac As Kd Kh Kc"));
    expect(new Set(keysOf(best)).size).toBe(5);
  });

  it("refuses fewer than five cards rather than guessing", () => {
    expect(() => bestFiveCards(cards("Ah Kh Qh Jh"))).toThrow(/five cards/);
  });
});

describe("winningCardKeys", () => {
  const winner = (bestFive: Card[] | null) => ({
    seatId: "seat-1",
    name: "Player",
    amount: 100,
    hand: "Flush",
    bestFive,
  });

  it("is null for a pot won without a showdown", () => {
    // An uncontested pot must highlight nothing: nobody saw those cards.
    expect(winningCardKeys([winner(null)])).toBeNull();
  });

  it("is null when there are no winners at all", () => {
    expect(winningCardKeys([])).toBeNull();
  });

  it("merges every winner's cards on a split pot", () => {
    const keys = winningCardKeys([
      winner(cards("Ah Kh Qh Jh 10h")),
      winner(cards("Ah Kh Qh Jh 10s")),
    ]);
    expect(keys?.split(" ")).toHaveLength(6);
  });

  it("matches by exact card, never by a rank that merely reads alike", () => {
    // A "10" and a "0" would collide under a substring test; there is no rank
    // "0", but the check is exact so the class of bug cannot arise at all.
    const keys = winningCardKeys([winner(cards("10h 9h 8h 7h 6h"))]);
    expect(isWinningCard(keys, cards("10h")[0])).toBe(true);
    expect(isWinningCard(keys, cards("10s")[0])).toBe(false);
    expect(isWinningCard(keys, cards("9c")[0])).toBe(false);
  });

  it("says no to everything when there is nothing to highlight", () => {
    expect(isWinningCard(null, cards("Ah")[0])).toBe(false);
    expect(isWinningCard("Aofhearts", null)).toBe(false);
  });
});

describe("what the engine publishes", () => {
  /**
   * All human again, and for a sharper reason than above. The first version of
   * this folded the two human seats and let the four bots play on -- which
   * reaches a showdown whenever the bots feel like it, so the test asserted
   * "uncontested" against a hand that was sometimes a real showdown and only
   * passed because the first few runs happened to fold out. Folding every seat
   * but one is the only way to *guarantee* the branch being tested.
   */
  function foldEveryoneButOne(): GameState {
    const game = createGame("seat-0-token", "Hero");
    game.seats.forEach((seat, index) => {
      seat.isHuman = true;
      seat.ownerToken = `seat-${index}-token`;
      seat.personality = null;
    });
    for (let guard = 0; guard < 20 && game.status === "playing"; guard += 1) {
      const index = game.currentPlayer;
      if (index === null) break;
      applyPlayerAction(game, { type: "fold" }, game.seats[index].ownerToken!);
    }
    return game;
  }

  /**
   * Every seat human, so nothing advances except by an explicit action and the
   * hand cannot end early on a bot's decision. Borrowed from
   * betting-round.test.ts for the same reason it exists there: a showdown
   * reached by luck is a test that sometimes asserts nothing.
   */
  function checkedDownToShowdown(): GameState {
    const game = createGame("seat-0-token", "Hero");
    game.seats.forEach((seat, index) => {
      seat.isHuman = true;
      seat.ownerToken = `seat-${index}-token`;
      seat.personality = null;
    });
    for (let guard = 0; guard < 60 && game.status === "playing"; guard += 1) {
      const index = game.currentPlayer;
      if (index === null) break;
      const seat = game.seats[index];
      applyPlayerAction(
        game,
        seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" },
        seat.ownerToken!,
      );
    }
    return game;
  }

  it("publishes the exact five cards that won a showdown", () => {
    const game = checkedDownToShowdown();
    expect(game.status).toBe("complete");
    expect(game.street).toBe("showdown");
    expect(game.community).toHaveLength(5);
    expect(game.winners.length).toBeGreaterThan(0);

    game.winners.forEach((winner) => {
      expect(winner.hand).not.toBe("Uncontested");
      expect(winner.bestFive).toHaveLength(5);

      const seat = game.seats.find((candidate) => candidate.id === winner.seatId)!;
      const available = [...seat.holeCards, ...game.community].map(cardKey);
      // Every named card is one that seat could actually use, and the five
      // together score the hand the winner was credited with.
      winner.bestFive!.forEach((card) => expect(available).toContain(cardKey(card)));
      expect(evaluateHand(winner.bestFive!).name).toBe(winner.hand);
    });
  });

  it("highlights at least one board card, so the board reads as involved", () => {
    const game = checkedDownToShowdown();
    const keys = winningCardKeys(game.winners);
    expect(keys).not.toBeNull();
    // Five community cards and two hole cards: no seven-card hand can be made
    // entirely from a player's own two, so a run that lit nothing on the board
    // would mean the keys were being built from the wrong cards.
    expect(game.community.some((card) => isWinningCard(keys, card))).toBe(true);
  });

  it("publishes no winning cards for an uncontested pot", () => {
    // The leak this guards: everyone folded, so the winner never showed a
    // card. Publishing their best five would hand every other player at the
    // table the hole cards they paid not to see -- the same rule the seat's
    // handLabel follows.
    const finished = foldEveryoneButOne();

    expect(finished.status).toBe("complete");
    expect(finished.winners.length).toBeGreaterThan(0);
    expect(finished.winners.map((w) => w.hand)).toEqual(
      finished.winners.map(() => "Uncontested"),
    );
    finished.winners.forEach((w) => expect(w.bestFive).toBeNull());
  });
});

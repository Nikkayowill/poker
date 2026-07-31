import { describe, expect, it } from "vitest";
import {
  advanceTimedTurn,
  applyPlayerAction,
  claimSeat,
  chooseBotAction,
  createGame,
  estimateBotEquity,
  expireIdleTurn,
  normalizeGameState,
  preflopHandTier,
  STARTING_TIME_CARDS,
  TIME_CARD_EXTENSION_MS,
  TURN_TIMEOUT_MS,
  toSnapshot,
  vacateSeat,
} from "./engine";
import { compareScores, describeHand, evaluateHand } from "./evaluator";
import { TIER_CONFIG } from "./tiers";
import type { Card, GameState, PlayerAction } from "./types";
import type { PlayerProfile } from "@/lib/profile/types";
import { avatarCosmetics, defaultEquipped } from "@/lib/cosmetics/catalog";

const testProfile = (
  name: string,
): Pick<PlayerProfile, "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"> => ({
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  accent: "#79c9ff",
  avatarUrl: null,
  avatarPreset: "ace",
  equipped: defaultEquipped,
});

const cards = (values: string): Card[] =>
  values.split(" ").map((value) => {
    const suitMap = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" } as const;
    return {
      rank: value.slice(0, -1) as Card["rank"],
      suit: suitMap[value.at(-1)! as keyof typeof suitMap],
    };
  });

const seededRandom = (initialSeed: number) => {
  let seed = initialSeed;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

function advanceBotsUntilHuman(state: GameState): GameState {
  let game = state;
  let safety = 0;

  while (
    game.status === "playing" &&
    game.currentPlayer !== null &&
    !game.seats[game.currentPlayer].isHuman
  ) {
    game = advanceTimedTurn(
      game,
      Date.parse(game.turnDeadlineAt ?? new Date().toISOString()),
    ).state;
    safety += 1;

    if (safety > 100) {
      throw new Error("Bot pacing did not reach a human turn");
    }
  }

  return game;
}

function createHumanTable() {
  const tokens = Array.from({ length: 6 }, () => crypto.randomUUID());
  let game = createGame(tokens[0], "Player 1");
  for (let index = 1; index < tokens.length; index += 1) {
    game = claimSeat(game, tokens[index], testProfile(`Player ${index + 1}`)).state;
  }
  return { game, tokens };
}

describe("hand evaluator", () => {
  it("recognizes a royal straight flush", () => {
    const score = evaluateHand(cards("As Ks Qs Js 10s 2d 3c"));
    expect(score.name).toBe("Royal flush");
    expect(score.values).toEqual([8, 14]);
  });

  it("uses a wheel ace as the low end of a straight", () => {
    const score = evaluateHand(cards("As 2d 3h 4c 5s Kd Qc"));
    expect(score.name).toBe("Straight");
    expect(score.values).toEqual([4, 5]);
  });

  it("prefers a full house over a flush", () => {
    const fullHouse = evaluateHand(cards("Ah Ad Ac Ks Kd 2h 3h"));
    const flush = evaluateHand(cards("Ah Jh 8h 5h 2h Kd Qc"));
    expect(fullHouse.values[0]).toBeGreaterThan(flush.values[0]);
  });

  it.each([
    ["High card", "As Kd 9h 7c 4s 3d 2c"],
    ["One pair", "As Ad 9h 7c 4s 3d 2c"],
    ["Two pair", "As Ad 9h 9c 4s 3d 2c"],
    ["Three of a kind", "As Ad Ah 9c 4s 3d 2c"],
    ["Straight", "9s 8d 7h 6c 5s 3d 2c"],
    ["Flush", "As 9s 7s 4s 2s Kd Qc"],
    ["Full house", "As Ad Ah 9c 9s 3d 2c"],
    ["Four of a kind", "As Ad Ah Ac 9s 3d 2c"],
    ["Straight flush", "9s 8s 7s 6s 5s Kd Qc"],
  ])("recognizes %s", (name, values) => {
    expect(evaluateHand(cards(values)).name).toBe(name);
  });

  it("uses every kicker in order and detects exact ties", () => {
    const strongerPair = evaluateHand(cards("As Ad Kh Qc 9s 3d 2c"));
    const weakerPair = evaluateHand(cards("Ac Ah Kd Qs 8c 3h 2d"));
    expect(compareScores(strongerPair, weakerPair)).toBeGreaterThan(0);

    const first = evaluateHand(cards("As Kd Qh Jc 9s 3d 2c"));
    const sameFromDifferentSuits = evaluateHand(cards("Ah Ks Qd Js 9c 4h 2d"));
    expect(compareScores(first, sameFromDifferentSuits)).toBe(0);
  });

  it("correctly reports when the board itself is the best hand", () => {
    const boardPlays = cards("As Kd Qh Jc 10s 2d 3c");
    expect(evaluateHand(boardPlays).name).toBe("Straight");
    expect(describeHand(boardPlays)).toBe("Straight");
  });
});

describe("server game engine", () => {
  it("never exposes the deck or opponents' hole cards", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Test");
    const snapshot = toSnapshot(game, token);
    expect("deck" in snapshot).toBe(false);
    expect(snapshot.seats[0].holeCards.every(Boolean)).toBe(true);
    expect(snapshot.seats.slice(1).flatMap((seat) => seat.holeCards).every((card) => card === null)).toBe(true);
  });

  it("hides folded and uncontested-win hole cards from other seats after the hand ends", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    const guestTokens = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    ["Guest1", "Guest2", "Guest3", "Guest4", "Guest5"].forEach((name, index) => {
      game = claimSeat(game, guestTokens[index], testProfile(name)).state;
    });
    expect(game.seats.every((seat) => seat.isHuman)).toBe(true);

    // Every seat is human-controlled, so folding is fully deterministic: fold
    // whoever is due to act until only one seat remains (an uncontested win),
    // rather than letting bot randomness decide the outcome.
    let safety = 0;
    while (game.status === "playing") {
      const actorIndex = game.currentPlayer!;
      const actorToken = game.seats[actorIndex].ownerToken!;
      const legal = toSnapshot(game, actorToken).legalActions!;
      const action: PlayerAction = legal.canFold ? { type: "fold" } : { type: "check" };
      game = applyPlayerAction(game, action, actorToken);
      safety += 1;
      expect(safety).toBeLessThan(50);
    }

    expect(game.status).toBe("complete");
    expect(game.winners).toHaveLength(1);
    expect(game.winners[0].hand).toBe("Uncontested");
    const winnerId = game.winners[0].seatId;

    // A caller who is neither the winner nor themselves must see every other
    // seat's hole cards as hidden — including the uncontested winner's, since
    // a real showdown never happened for anyone to have a right to see them.
    const onlookerToken = game.seats.find((seat) => seat.id !== winnerId)!.ownerToken!;
    const view = toSnapshot(game, onlookerToken);
    expect(view.seats.find((seat) => seat.id === winnerId)!.holeCards.every((card) => card === null)).toBe(true);
    view.seats
      .filter((seat) => !seat.isMine)
      .forEach((seat) => {
        expect(seat.holeCards.every((card) => card === null)).toBe(true);
      });
  });

  it("plays repeated complete hands while conserving chips", () => {
    const token = crypto.randomUUID();
    let game = createGame(token, "Test");
    let completed = 0;
    let safety = 0;
    // Rake is the only sanctioned way for chips to leave the table, so the
    // invariant is "everything still accounted for, minus what the house
    // took" -- which also proves nothing leaks anywhere else.
    let rakeTaken = 0;

    while (completed < 12) {
      game = advanceBotsUntilHuman(game);
      if (game.status === "complete") {
        rakeTaken += game.rake;
        expect(game.seats.reduce((sum, seat) => sum + seat.stack, 0) + rakeTaken).toBe(6000);
        completed += 1;
        if (completed >= 12 || game.seats[0].stack === 0) break;
        game = applyPlayerAction(game, { type: "next-hand" }, token);
      } else {
        const legal = toSnapshot(game, token).legalActions;
        expect(legal).not.toBeNull();
        let action: PlayerAction;
        if (legal!.canCheck) action = { type: "check" };
        else if (legal!.canCall) action = { type: "call" };
        else action = { type: "all-in" };
        game = applyPlayerAction(game, action, token);
        if (game.status === "playing") {
          expect(
            game.seats.reduce((sum, seat) => sum + seat.stack, 0) + game.pot + rakeTaken,
          ).toBe(6000);
        }
      }
      safety += 1;
      expect(safety).toBeLessThan(500);
    }
    expect(completed).toBeGreaterThan(0);
    expect(rakeTaken).toBeGreaterThan(0);
  });

  it("keeps fold available even when checking is free", () => {
    const token = crypto.randomUUID();
    let game = advanceBotsUntilHuman(createGame(token, "Host"));
    expect(game.currentPlayer).toBe(0);
    game.seats[0].streetBet = game.currentBet;

    const legal = toSnapshot(game, token).legalActions;
    expect(legal?.canCheck).toBe(true);
    expect(legal?.canFold).toBe(true);
    game = applyPlayerAction(game, { type: "fold" }, token);
    expect(game.seats[0].status).toBe("folded");
  });

  it("shows a made-hand hint only to the player who owns those cards", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    const game = claimSeat(
      createGame(hostToken, "Host"),
      guestToken,
      testProfile("Guest"),
    ).state;
    game.seats[0].holeCards = cards("3c 3d");
    game.community = cards("3h Ks 2c");

    const hostView = toSnapshot(game, hostToken);
    const guestView = toSnapshot(game, guestToken);
    expect(hostView.seats[0].handLabel).toBe("Three of a kind");
    expect(hostView.seats[1].handLabel).toBeNull();
    expect(guestView.seats[0].handLabel).toBeNull();
  });

  it("releases a busted human seat before the next deal", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    game.status = "complete";
    game.seats[0].stack = 0;

    game = applyPlayerAction(game, { type: "next-hand" }, hostToken);
    expect(game.seats[0].ownerToken).toBeNull();
    expect(game.seats[0].isHuman).toBe(false);
    expect(game.seats[0].status).toBe("out");
    expect(toSnapshot(game, hostToken).isSeated).toBe(false);
  });

  it("rejects a check facing a bet and enforces the minimum raise", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    game.currentPlayer = 0;
    game.seats[0].status = "active";
    game.seats[0].streetBet = 0;
    game.seats[0].stack = 980;
    game.currentBet = 20;
    game.minRaise = 20;

    expect(() => applyPlayerAction(structuredClone(game), { type: "check" }, token)).toThrow(/20 to call/i);
    expect(() => applyPlayerAction(structuredClone(game), { type: "raise", amount: 39 }, token)).toThrow(/minimum raise/i);

    const called = applyPlayerAction(structuredClone(game), { type: "call" }, token);
    expect(called.seats[0].streetBet).toBe(20);

    const raised = applyPlayerAction(structuredClone(game), { type: "raise", amount: 40 }, token);
    expect(raised.currentBet).toBe(40);
    expect(raised.seats[0].lastAction).toBe("Raise to · 40");
  });

  it("accepts a short all-in without reopening it as a full minimum raise", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    game.currentPlayer = 0;
    game.seats[0].status = "active";
    game.seats[0].streetBet = 0;
    game.seats[0].stack = 30;
    game.currentBet = 20;
    game.minRaise = 20;

    const legal = toSnapshot(game, token).legalActions!;
    expect(legal.canRaise).toBe(false);
    expect(legal.canAllIn).toBe(true);

    const allIn = applyPlayerAction(game, { type: "all-in" }, token);
    expect(allIn.seats[0].status).toBe("all-in");
    expect(allIn.currentBet).toBe(30);
    expect(allIn.minRaise).toBe(20);
  });

  it("does not reopen raising after one short all-in", () => {
    const { game, tokens } = createHumanTable();
    game.status = "playing";
    game.street = "flop";
    game.currentBet = 100;
    game.minRaise = 100;
    game.seats.forEach((seat) => {
      seat.status = "out";
      seat.stack = 0;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.acted = true;
      seat.actedAtBet = null;
    });
    Object.assign(game.seats[0], {
      status: "active",
      stack: 900,
      streetBet: 100,
      committed: 100,
      acted: true,
      actedAtBet: 100,
    });
    Object.assign(game.seats[1], {
      status: "active",
      stack: 50,
      streetBet: 100,
      committed: 100,
      acted: false,
      actedAtBet: null,
    });
    game.currentPlayer = 1;
    game.pot = 200;

    const afterShortRaise = applyPlayerAction(game, { type: "all-in" }, tokens[1]);
    expect(afterShortRaise.currentBet).toBe(150);
    expect(afterShortRaise.minRaise).toBe(100);
    expect(afterShortRaise.currentPlayer).toBe(0);

    const legal = toSnapshot(afterShortRaise, tokens[0]).legalActions!;
    expect(legal.toCall).toBe(50);
    expect(legal.canCall).toBe(true);
    expect(legal.canRaise).toBe(false);
    expect(legal.canAllIn).toBe(false);
    expect(() => applyPlayerAction(afterShortRaise, { type: "all-in" }, tokens[0]))
      .toThrow(/illegal raise/i);
  });

  it("reopens raising once cumulative short all-ins equal a full raise", () => {
    const { game, tokens } = createHumanTable();
    game.status = "playing";
    game.street = "flop";
    game.currentBet = 100;
    game.minRaise = 100;
    game.seats.forEach((seat) => {
      seat.status = "out";
      seat.stack = 0;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.acted = true;
      seat.actedAtBet = null;
    });
    Object.assign(game.seats[0], {
      status: "active",
      stack: 900,
      streetBet: 100,
      committed: 100,
      acted: true,
      actedAtBet: 100,
    });
    Object.assign(game.seats[1], {
      status: "active",
      stack: 50,
      streetBet: 100,
      committed: 100,
      acted: false,
    });
    Object.assign(game.seats[2], {
      status: "active",
      stack: 100,
      streetBet: 100,
      committed: 100,
      acted: false,
    });
    game.currentPlayer = 1;
    game.pot = 300;

    const firstShortRaise = applyPlayerAction(game, { type: "all-in" }, tokens[1]);
    expect(firstShortRaise.currentPlayer).toBe(2);
    const secondShortRaise = applyPlayerAction(firstShortRaise, { type: "all-in" }, tokens[2]);
    expect(secondShortRaise.currentBet).toBe(200);
    expect(secondShortRaise.minRaise).toBe(100);
    expect(secondShortRaise.currentPlayer).toBe(0);

    const legal = toSnapshot(secondShortRaise, tokens[0]).legalActions!;
    expect(legal.toCall).toBe(100);
    expect(legal.canRaise).toBe(true);
    expect(legal.canAllIn).toBe(true);
    expect(legal.minRaiseTo).toBe(300);
  });

  it("keeps the full big blind as the bring-in when the BB is short stacked", () => {
    const hostToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");
    game.status = "complete";
    game.buttonPosition = 5;
    game.seats.forEach((seat, index) => {
      seat.stack = index < 3 ? 1000 : 0;
    });
    game.seats[2].stack = 7;

    const nextHand = applyPlayerAction(game, { type: "next-hand" }, hostToken);
    const view = toSnapshot(nextHand, hostToken);
    expect(view.seats[1].isSmallBlind).toBe(true);
    expect(nextHand.seats[1].committed).toBe(5);
    expect(view.seats[2].isBigBlind).toBe(true);
    expect(nextHand.seats[2].committed).toBe(7);
    expect(nextHand.seats[2].status).toBe("all-in");
    expect(nextHand.currentBet).toBe(10);
    expect(view.legalActions?.toCall).toBe(10);
  });

  it("awards main and side pots by contribution and excludes a folded best hand", () => {
    const { game, tokens } = createHumanTable();
    game.status = "playing";
    game.street = "river";
    game.buttonPosition = 5;
    game.community = cards("2c 3d 7h 8s 9c");
    game.currentPlayer = 0;
    game.currentBet = 100;
    game.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.stack = 0;
      seat.status = "out";
    });

    Object.assign(game.seats[0], {
      status: "active",
      stack: 900,
      streetBet: 100,
      committed: 100,
      acted: false,
      holeCards: cards("As Ad"),
    });
    Object.assign(game.seats[1], {
      status: "all-in",
      committed: 300,
      holeCards: cards("Ks Kd"),
    });
    Object.assign(game.seats[2], {
      status: "all-in",
      committed: 500,
      holeCards: cards("Qs Jd"),
    });
    Object.assign(game.seats[3], {
      status: "folded",
      committed: 100,
      holeCards: cards("9d 9h"),
    });
    game.pot = 1000;

    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.status).toBe("complete");
    // Gross side pots are 400/400/200; 4% of the 1,000 total would be 40, but
    // the 3xBB cap (bigBlind 10) holds it to 30, split proportionally as
    // 12/12/6.
    expect(complete.rake).toBe(30);
    expect(complete.winners.find((winner) => winner.seatId === complete.seats[0].id)?.amount).toBe(388);
    expect(complete.winners.find((winner) => winner.seatId === complete.seats[1].id)?.amount).toBe(388);
    expect(complete.winners.find((winner) => winner.seatId === complete.seats[2].id)?.amount).toBe(194);
    expect(complete.winners.some((winner) => winner.seatId === complete.seats[3].id)).toBe(false);
  });

  it("gives an odd tied-pot chip to the first winner left of the button", () => {
    const { game, tokens } = createHumanTable();
    game.status = "playing";
    game.street = "river";
    game.buttonPosition = 0;
    game.community = cards("Ah Kd Qc 2s 3h");
    game.currentPlayer = 1;
    game.currentBet = 101;
    game.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.stack = 0;
      seat.status = "out";
    });
    Object.assign(game.seats[0], {
      status: "all-in",
      committed: 101,
      holeCards: cards("Js 10s"),
    });
    Object.assign(game.seats[1], {
      status: "active",
      stack: 899,
      streetBet: 101,
      committed: 101,
      acted: false,
      holeCards: cards("9s 9d"),
    });
    Object.assign(game.seats[2], {
      status: "all-in",
      committed: 101,
      holeCards: cards("Jh 10h"),
    });
    game.pot = 303;

    const complete = applyPlayerAction(game, { type: "check" }, tokens[1]);
    const buttonWinner = complete.winners.find((winner) => winner.seatId === complete.seats[0].id)!;
    const leftWinner = complete.winners.find((winner) => winner.seatId === complete.seats[2].id)!;
    // 303 chopped is 151/152 gross, less 12 rake (6 each) -- the odd chip
    // still lands left of the button, which is what this test is about.
    expect(complete.rake).toBe(12);
    expect(buttonWinner.amount).toBe(145);
    expect(leftWinner.amount).toBe(146);
  });
});

describe("bot identity", () => {
  it("seats a six-max table with a distinct AI personality per bot seat and none for the host", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(game.seats).toHaveLength(6);
    expect(game.seats[0].personality).toBeNull();
    expect(game.seats.slice(1).map((seat) => seat.personality)).toEqual([
      "MANIAC",
      "CALLING_STATION",
      "ROCK",
      "MANIAC",
      "CALLING_STATION",
    ]);
    expect(game.seats.slice(1).every((seat) => !seat.isHuman)).toBe(true);
    // Every bot seat gets a visually distinct identity (no repeats among bots).
    expect(new Set(game.seats.slice(1).map((seat) => seat.avatarPreset)).size).toBe(5);
  });

  it("bases decisions on estimated equity without reading opponents' cards", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat, index) => {
      seat.status = index === 0 || index === 3 ? "active" : "folded";
    });
    game.currentPlayer = 3;
    game.street = "river";
    game.community = cards("2c 7d 9h Js Qs");
    game.currentBet = 300;
    game.minRaise = 100;
    game.pot = 400;
    Object.assign(game.seats[3], {
      stack: 700,
      streetBet: 0,
      committed: 0,
      acted: false,
      actedAtBet: null,
      holeCards: cards("Ah Ad"),
    });

    const premiumEquity = estimateBotEquity(game, 3, 400, seededRandom(7));
    const premiumAction = chooseBotAction(game, 3, seededRandom(19));

    game.seats[3].holeCards = cards("3c 4d");
    const trashEquity = estimateBotEquity(game, 3, 400, seededRandom(7));
    const trashAction = chooseBotAction(game, 3, seededRandom(19));

    expect(premiumEquity).toBeGreaterThan(0.75);
    expect(trashEquity).toBeLessThan(0.2);
    expect(["call", "raise", "all-in"]).toContain(premiumAction.type);
    expect(trashAction.type).toBe("fold");
  });

  it("uses a disciplined six-max preflop starting-hand chart", () => {
    expect(preflopHandTier(cards("As Ah"))).toBe("premium");
    expect(preflopHandTier(cards("Ac Kc"))).toBe("premium");
    expect(preflopHandTier(cards("8s 8d"))).toBe("playable");
    expect(preflopHandTier(cards("7h 6h"))).toBe("playable");
    expect(preflopHandTier(cards("7c 2d"))).toBe("trash");
  });

  it("immediately folds low offsuit trash preflop outside the bluff gate", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat, index) => {
      seat.status = index === 0 || index === 3 ? "active" : "folded";
    });
    Object.assign(game.seats[3], {
      holeCards: cards("7c 2d"),
      stack: 1000,
      streetBet: 0,
      acted: false,
      actedAtBet: null,
    });
    game.currentPlayer = 3;
    game.street = "preflop";
    game.currentBet = 10;
    game.minRaise = 10;
    game.pot = 15;

    expect(chooseBotAction(game, 3, () => 0.5)).toEqual({ type: "fold" });
  });

  it("caps normal raises at one pot and never turns a deep-stack raise into an all-in", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat, index) => {
      seat.status = index === 0 || index === 1 ? "active" : "folded";
    });
    Object.assign(game.seats[1], {
      holeCards: cards("As Ah"),
      stack: 1000,
      streetBet: 0,
      committed: 0,
      acted: false,
      actedAtBet: null,
    });
    game.currentPlayer = 1;
    game.street = "preflop";
    game.currentBet = 10;
    game.minRaise = 10;
    game.pot = 15;

    const action = chooseBotAction(game, 1, () => 0.5);
    expect(action.type).toBe("raise");
    if (action.type === "raise") {
      // Facing 10 into a 15 pot: the bot calls 10, then may raise by at most
      // the resulting 25-chip pot, making 35 the largest allowed raise-to.
      expect(action.amount).toBeLessThanOrEqual(35);
      expect(action.amount).toBeLessThan(game.seats[1].stack);
    }
  });

  it("reserves preflop all-ins for strong hands with fewer than ten big blinds", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat, index) => {
      seat.status = index === 0 || index === 3 ? "active" : "folded";
    });
    Object.assign(game.seats[3], {
      holeCards: cards("As Ah"),
      stack: 80,
      streetBet: 0,
      committed: 0,
      acted: false,
      actedAtBet: null,
    });
    game.currentPlayer = 3;
    game.street = "preflop";
    game.currentBet = 20;
    game.minRaise = 10;
    game.pot = 30;

    expect(chooseBotAction(game, 3, () => 0.5)).toEqual({ type: "all-in" });
  });

  it("declines marginal hands after multiple opponents are already all-in", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat, index) => {
      seat.status = index < 4 ? "active" : "folded";
    });
    game.seats[1].status = "all-in";
    game.seats[2].status = "all-in";
    Object.assign(game.seats[3], {
      holeCards: cards("8s 8d"),
      stack: 900,
      streetBet: 100,
      committed: 100,
      acted: false,
      actedAtBet: null,
    });
    game.currentPlayer = 3;
    game.street = "preflop";
    game.currentBet = 1000;
    game.minRaise = 900;
    game.pot = 2200;

    expect(chooseBotAction(game, 3, () => 0.5)).toEqual({ type: "fold" });
  });
});

describe("heads-up blinds", () => {
  it("makes the button also the small blind once a table shrinks to two funded seats", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    const guestTokens = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    ["Guest1", "Guest2", "Guest3", "Guest4", "Guest5"].forEach((name, index) => {
      game = claimSeat(game, guestTokens[index], testProfile(name)).state;
    });

    // Simulate four seats busting out, leaving exactly two funded players.
    game.seats[2].stack = 0;
    game.seats[3].stack = 0;
    game.seats[4].stack = 0;
    game.seats[5].stack = 0;
    game.status = "complete";

    const nextHand = applyPlayerAction(game, { type: "next-hand" }, hostToken);
    expect(nextHand.status).toBe("playing");
    const view = toSnapshot(nextHand, hostToken);
    const activeSeats = view.seats.filter((seat) => seat.status !== "out");
    expect(activeSeats).toHaveLength(2);

    // The general n-player rule (small blind is the seat AFTER the button)
    // would be backwards here — standard heads-up poker has the button post
    // the small blind and act first preflop.
    const buttonSeat = activeSeats.find((seat) => seat.isDealer);
    expect(buttonSeat).toBeDefined();
    expect(buttonSeat!.isSmallBlind).toBe(true);
    const otherSeat = activeSeats.find((seat) => seat !== buttonSeat)!;
    expect(otherSeat.isBigBlind).toBe(true);
  });
});

describe("room codes", () => {
  it("issues a shareable code only for private tables", () => {
    const publicGame = createGame(crypto.randomUUID(), "Host");
    expect(publicGame.isPrivate).toBe(false);
    expect(publicGame.roomCode).toBeNull();

    const privateGame = createGame(crypto.randomUUID(), "Host", undefined, { isPrivate: true });
    expect(privateGame.isPrivate).toBe(true);
    expect(privateGame.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });
});

describe("multi-human seating", () => {
  it("converts the first open bot seat into a human seat", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");

    const { state, seatIndex } = claimSeat(game, guestToken, testProfile("Guest"));
    expect(seatIndex).toBe(1);
    expect(state.seats[1].isHuman).toBe(true);
    expect(state.seats[1].ownerToken).toBe(guestToken);
    expect(state.seats[1].personality).toBeNull();
    expect(state.seats[1].name).toBe("Guest");
  });

  it("does not mint a posted blind when a player claims that bot seat", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const chipsBefore = game.seats.reduce(
      (sum, seat) => sum + seat.stack + seat.committed,
      0,
    );

    const { state, seatIndex } = claimSeat(
      game,
      crypto.randomUUID(),
      testProfile("Guest"),
      1000,
    );
    const claimed = state.seats[seatIndex];

    expect(claimed.committed).toBeGreaterThan(0);
    expect(claimed.stack + claimed.committed).toBe(1000);
    expect(state.seats.reduce(
      (sum, seat) => sum + seat.stack + seat.committed,
      0,
    )).toBe(chipsBefore);
  });

  it("rejects a buy-in smaller than chips the open seat already committed", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    // Above even the table's fixed buy-in (1000), so clamping the requested
    // amount up to that fixed buy-in still isn't enough to cover it.
    game.seats[1].committed = 1500;

    expect(() => claimSeat(
      game,
      crypto.randomUUID(),
      testProfile("Guest"),
      500,
    )).toThrow(/covers this seat's committed chips/i);
  });

  it("returns the same seat on a repeat claim instead of taking another one", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");

    const first = claimSeat(game, guestToken, testProfile("Guest"));
    const versionAfterFirstClaim = first.state.version;
    const second = claimSeat(first.state, guestToken, testProfile("Guest"));

    expect(second.seatIndex).toBe(first.seatIndex);
    expect(second.state.version).toBe(versionAfterFirstClaim);
  });

  it("refuses to seat a seventh player at a full six-max table", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    for (const name of ["Guest1", "Guest2", "Guest3", "Guest4", "Guest5"]) {
      game = claimSeat(game, crypto.randomUUID(), testProfile(name)).state;
    }
    expect(game.seats).toHaveLength(6);
    expect(game.seats.every((seat) => seat.isHuman)).toBe(true);
    expect(() => claimSeat(game, crypto.randomUUID(), testProfile("Guest6"))).toThrow(/full/i);
  });

  it("rejects an action from a token that owns no seat", () => {
    const hostToken = crypto.randomUUID();
    const game = createGame(hostToken, "Host");
    expect(() => applyPlayerAction(game, { type: "check" }, crypto.randomUUID())).toThrow(/not seated/i);
  });

  it("lets a second human act on their own turn, while hiding cards from each other", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    expect(game.status).toBe("playing");

    const claimed = claimSeat(game, guestToken, testProfile("Guest"));
    game = claimed.state;
    const guestSeatIndex = claimed.seatIndex;
    const versionAfterClaim = game.version;

    game = advanceBotsUntilHuman(game);

    // The opening bot decision is paced. Once it resolves, action reaches the
    // host, so the guest still cannot act out of turn.
    expect(game.currentPlayer).not.toBe(guestSeatIndex);
    expect(() => applyPlayerAction(game, { type: "check" }, guestToken)).toThrow(/turn/i);

    // The host folding hands the turn straight to the guest, since she is the
    // next active seat and has not acted yet this betting round.
    game = applyPlayerAction(game, { type: "fold" }, hostToken);
    expect(game.currentPlayer).toBe(guestSeatIndex);

    const guestView = toSnapshot(game, guestToken);
    expect(guestView.legalActions).not.toBeNull();
    expect(guestView.seats[guestSeatIndex].holeCards.every(Boolean)).toBe(true);
    expect(guestView.seats[0].holeCards.every((card) => card === null)).toBe(true);

    const hostView = toSnapshot(game, hostToken);
    expect(hostView.legalActions).toBeNull();
    expect(hostView.seats[guestSeatIndex].holeCards.every((card) => card === null)).toBe(true);

    expect(() => applyPlayerAction(game, { type: "check" }, hostToken)).toThrow(/turn/i);
    game = applyPlayerAction(game, { type: "call" }, guestToken);
    expect(game.version).toBeGreaterThan(versionAfterClaim);
  });
});

describe("giving up a seat", () => {
  it("restores the seat's original bot identity, including for the host's own seat", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    const claimed = claimSeat(game, guestToken, testProfile("Guest"));
    game = claimed.state;
    expect(game.seats[claimed.seatIndex].name).toBe("Guest");

    game = vacateSeat(game, guestToken).state;
    const restored = game.seats[claimed.seatIndex];
    expect(restored.isHuman).toBe(false);
    expect(restored.ownerToken).toBeNull();
    expect(restored.name).toBe("Maya");
    expect(restored.personality).toBe("MANIAC");

    game = vacateSeat(game, hostToken).state;
    expect(game.seats[0].isHuman).toBe(false);
    expect(game.seats[0].ownerToken).toBeNull();
    expect(game.seats[0].name).toBe("Jax");
  });

  it("rejects vacating a seat you don't own", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(() => vacateSeat(game, crypto.randomUUID())).toThrow(/not seated/i);
  });

  it("lets go of a seat mid-turn without stalling the table", () => {
    const hostToken = crypto.randomUUID();
    let game = advanceBotsUntilHuman(createGame(hostToken, "Host"));
    expect(game.currentPlayer).toBe(0);

    game = applyPlayerAction(game, { type: "leave-seat" }, hostToken);
    expect(game.seats[0].isHuman).toBe(false);
    // The restored bot inherits the turn but receives its own deliberate
    // decision window, rather than resolving synchronously in the request.
    expect(game.currentPlayer).toBe(0);
    expect(game.turnDeadlineAt).not.toBeNull();

    game = advanceTimedTurn(game, Date.parse(game.turnDeadlineAt!)).state;
    expect(game.currentPlayer === null || game.currentPlayer !== 0).toBe(true);
  });
});

describe("idle turn timeout", () => {
  it("leaves a fresh turn untouched", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    const before = game.version;
    const { state, expiredSeatIds } = expireIdleTurn(game);
    expect(expiredSeatIds).toHaveLength(0);
    expect(state.version).toBe(before);
  });

  it("auto-resolves a human turn idle past the timeout, in exactly one version bump", () => {
    const token = crypto.randomUUID();
    const game = advanceBotsUntilHuman(createGame(token, "Host"));
    expect(game.currentPlayer).toBe(0);
    const hostSeatId = game.seats[0].id;
    game.turnStartedAt = new Date(Date.now() - TURN_TIMEOUT_MS - 1000).toISOString();
    game.turnDeadlineAt = new Date(Date.now() - 1000).toISOString();

    const before = game.version;
    const { state, expiredSeatIds } = expireIdleTurn(game);
    expect(expiredSeatIds).toEqual([hostSeatId]);
    expect(state.version).toBe(before + 1);
    // The host was seat 0 and is no longer the current player (either folded
    // out, or checked and action moved on).
    expect(state.currentPlayer === null || state.currentPlayer !== 0 || state.seats[0].status === "folded")
      .toBe(true);
  });

  it("resolves only one paced bot decision per deadline", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(game.currentPlayer).not.toBeNull();
    expect(game.seats[game.currentPlayer!].isHuman).toBe(false);

    const beforeVersion = game.version;
    const deadline = Date.parse(game.turnDeadlineAt!);
    const early = advanceTimedTurn(game, deadline - 1);
    expect(early.action).toBeNull();
    expect(early.state.version).toBe(beforeVersion);

    const due = advanceTimedTurn(game, deadline);
    expect(due.action).not.toBeNull();
    expect(due.state.version).toBe(beforeVersion + 1);
  });
});

describe("time cards", () => {
  it("gives each human three cards and extends only their active deadline", () => {
    const token = crypto.randomUUID();
    let game = advanceBotsUntilHuman(createGame(token, "Host"));
    expect(game.currentPlayer).toBe(0);
    expect(game.seats[0].timeCardsRemaining).toBe(STARTING_TIME_CARDS);

    const deadlineBefore = Date.parse(game.turnDeadlineAt!);
    game = applyPlayerAction(game, { type: "use-time-card" }, token);

    expect(game.currentPlayer).toBe(0);
    expect(game.seats[0].timeCardsRemaining).toBe(STARTING_TIME_CARDS - 1);
    expect(Date.parse(game.turnDeadlineAt!)).toBe(deadlineBefore + TIME_CARD_EXTENSION_MS);
  });

  it("cannot spend a fourth time card", () => {
    const token = crypto.randomUUID();
    let game = advanceBotsUntilHuman(createGame(token, "Host"));

    for (let index = 0; index < STARTING_TIME_CARDS; index += 1) {
      game = applyPlayerAction(game, { type: "use-time-card" }, token);
    }

    expect(game.seats[0].timeCardsRemaining).toBe(0);
    expect(() => applyPlayerAction(game, { type: "use-time-card" }, token)).toThrow(/time cards/i);
  });
});

describe("stakes tiers and buy-ins", () => {
  it("defaults to the cheapest tier's blinds and a 1000 stack when no tier/buyIn is given", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(game.tier).toBe("1k");
    expect(game.smallBlind).toBe(5);
    expect(game.bigBlind).toBe(10);
    expect(game.seats[0].stack).toBe(1000);
  });

  it("applies a tier's blinds and clamps any buy-in to that tier's fixed amount", () => {
    const tooLow = createGame(crypto.randomUUID(), "Host", undefined, { tier: "10k", buyIn: 100 });
    expect(tooLow.tier).toBe("10k");
    expect(tooLow.smallBlind).toBe(50);
    expect(tooLow.bigBlind).toBe(100);
    expect(tooLow.seats[0].stack).toBe(10_000); // clamped up to 10k's fixed buy-in

    const tooHigh = createGame(crypto.randomUUID(), "Host", undefined, { tier: "10k", buyIn: 999_999 });
    expect(tooHigh.seats[0].stack).toBe(10_000); // clamped down to 10k's fixed buy-in
  });

  it("clamps a claimed seat's buy-in to the table's own fixed tier amount", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host", undefined, { tier: "500k", buyIn: 500_000 });
    game.seats[1].stack = 0;
    const guestToken = crypto.randomUUID();
    const claimed = claimSeat(game, guestToken, testProfile("Guest"), 999_999);
    game = claimed.state;
    expect(claimed.seatIndex).toBe(1);
    const seat = game.seats[claimed.seatIndex];
    expect(seat.stack + seat.committed).toBe(500_000); // clamped down to 500k's fixed buy-in
  });

  it("lets a busted seat rebuy between hands, clamped to the table's tier", () => {
    const token = crypto.randomUUID();
    let game = createGame(token, "Host", undefined, { tier: "1k", buyIn: 1000 });
    game.status = "complete";
    game.seats[0].stack = 0;

    game = applyPlayerAction(game, { type: "rebuy", amount: 5_000_000 }, token);
    expect(game.seats[0].stack).toBe(1000); // clamped down to 1k's fixed buy-in
    expect(game.status).toBe("playing"); // rebuy immediately deals the next hand
  });

  it("refuses to rebuy a seat that still has chips, or outside a completed hand", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    expect(() => applyPlayerAction(game, { type: "rebuy", amount: 1000 }, token))
      .toThrow(/rebuy between hands/i);

    game.status = "complete";
    expect(() => applyPlayerAction(game, { type: "rebuy", amount: 1000 }, token))
      .toThrow(/still has chips/i);
  });

  it("charges a full buy-in even when the outgoing bot left chips on the seat", () => {
    let game = createGame(crypto.randomUUID(), "Host", undefined, { tier: "1k", buyIn: 1000 });
    // An active bot mid-session, sitting on chips it won.
    game.seats[1].stack = 1750;

    const claimed = claimSeat(game, crypto.randomUUID(), testProfile("Guest"), 50);
    game = claimed.state;
    // Whatever was requested clamps to the table's fixed 1,000 buy-in --
    // inheriting the bot's 1,750 would be redeemable free chips.
    const seat = game.seats[claimed.seatIndex];
    expect(seat.stack + seat.committed).toBe(1000);
  });
});

describe("legacy state normalization", () => {
  it("backfills seat avatars on tables dealt before avatars existed", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    // Exactly what a table persisted before avatars looks like coming back
    // out of storage: every other field intact, no avatar on any seat.
    game.seats.forEach((seat) => {
      delete (seat as Partial<typeof seat>).avatarCosmetic;
    });

    const normalized = normalizeGameState(game);
    normalized.seats.forEach((seat) => {
      expect(seat.avatarCosmetic).toBeTruthy();
    });
    // Bots keep distinct faces rather than all collapsing to one default,
    // which is most of what makes a table look occupied. Derived from the
    // catalog size so adding or removing artwork never breaks this.
    const botFaces = new Set(normalized.seats.slice(1).map((seat) => seat.avatarCosmetic));
    expect(botFaces.size).toBe(Math.min(5, avatarCosmetics.length));
  });

  it("leaves an avatar that is already present untouched", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats[0].avatarCosmetic = "avatar-nightowl";
    expect(normalizeGameState(game).seats[0].avatarCosmetic).toBe("avatar-nightowl");
  });
});

describe("rake", () => {
  /**
   * A table on the river with two live seats holding equal committed chips,
   * everyone else folded but still funded, poised so a single check from
   * seat 0 runs the showdown. Seat 0 always wins with aces.
   */
  function riverShowdown(committed: number) {
    const { game, tokens } = createHumanTable();
    game.status = "playing";
    game.street = "river";
    game.buttonPosition = 5;
    game.community = cards("2c 3d 7h 8s 9c");
    game.currentPlayer = 0;
    game.currentBet = 0;
    game.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.stack = 1000;
      seat.status = "folded";
    });
    Object.assign(game.seats[0], {
      status: "active",
      stack: 500,
      committed,
      acted: false,
      holeCards: cards("As Ad"),
    });
    Object.assign(game.seats[1], {
      status: "all-in",
      stack: 0,
      committed,
      holeCards: cards("Ks Kd"),
    });
    return { game, tokens };
  }

  it("takes nothing from a pot below the ten-big-blind floor", () => {
    const { game, tokens } = riverShowdown(45);
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    // 90 total is under 10 x 10, so the winner is handed the pot whole --
    // this is what keeps a preflop blind steal unraked.
    expect(complete.rake).toBe(0);
    expect(complete.winners[0].amount).toBe(90);
  });

  it("takes four percent of a pot above the floor", () => {
    const { game, tokens } = riverShowdown(150);
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    // 300 total, 4% is 12, which is under the 3 x 20 cap.
    expect(complete.rake).toBe(12);
    expect(complete.winners[0].amount).toBe(288);
  });

  it("caps rake at three big blinds however large the pot gets", () => {
    const { game, tokens } = riverShowdown(5000);
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    // 4% of 10,000 would be 400; the cap holds it to 3 x 10.
    expect(complete.rake).toBe(30);
    expect(complete.winners[0].amount).toBe(9970);
  });

  it("resets to zero when the next hand is dealt", () => {
    const { game, tokens } = riverShowdown(5000);
    let complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.rake).toBeGreaterThan(0);
    complete = applyPlayerAction(complete, { type: "next-hand" }, tokens[0]);
    expect(complete.rake).toBe(0);
  });

  /**
   * Everyone folded to seat 0 with chips already in the middle and no board
   * dealt. `street` stays preflop and `community` stays empty, which is the
   * whole condition "no flop, no drop" turns on.
   */
  function preflopUncontested(committed: number) {
    const { game, tokens } = createHumanTable();
    game.status = "playing";
    game.street = "preflop";
    game.community = [];
    game.buttonPosition = 5;
    game.currentPlayer = 0;
    game.currentBet = committed;
    game.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
      seat.committed = 0;
      seat.stack = 1000;
      seat.status = "folded";
    });
    Object.assign(game.seats[0], {
      status: "active",
      stack: 500,
      streetBet: committed,
      committed,
      acted: false,
      holeCards: cards("As Ad"),
    });
    Object.assign(game.seats[1], {
      status: "folded",
      committed,
      holeCards: cards("Ks Kd"),
    });
    return { game, tokens };
  }

  it("takes nothing from a pot that never saw a flop, however big it got", () => {
    // 300 total clears the ten-big-blind floor comfortably and would have
    // been raked 12 under the old rule. Raising, taking it down uncontested,
    // and still losing chips to the house is exactly what this prevents.
    const { game, tokens } = preflopUncontested(150);
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.community).toHaveLength(0);
    expect(complete.rake).toBe(0);
    expect(complete.winners[0].amount).toBe(300);
  });

  it("still rakes an uncontested pot once a flop is out", () => {
    // Same shape, but a board exists -- the house dealt a flop, so it takes
    // its cut even though nobody reached showdown.
    const { game, tokens } = preflopUncontested(150);
    game.street = "flop";
    game.community = cards("2c 3d 7h");
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.rake).toBe(12);
    expect(complete.winners[0].amount).toBe(288);
  });

  it("rakes an all-in pot that was run out from preflop", () => {
    // The board is dealt by showdown() itself here, so `community` is empty
    // when the hand begins resolving and five cards long by the time rake is
    // computed. A flop was dealt, so this is raked -- the guard must key off
    // the board at deduction time, not off the street the action ended on.
    const { game, tokens } = riverShowdown(150);
    game.street = "preflop";
    game.community = [];
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.community).toHaveLength(5);
    expect(complete.rake).toBe(12);
  });
});

describe("cashing out", () => {
  it("returns the departing player's remaining chips and leaves none behind", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host", undefined, { tier: "1k", buyIn: 1000 });

    const { state, cashedOut } = vacateSeat(game, token);
    expect(cashedOut).toBe(1000);
    // The chips left with the player, so the seat must not still hold them --
    // otherwise standing up would mint the stack a second time.
    expect(state.seats[0].stack).toBe(TIER_CONFIG["1k"].minBuyIn);
    expect(state.seats[0].isHuman).toBe(false);
  });

  it("does not refund chips already committed to the current pot", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host", undefined, { tier: "1k", buyIn: 1000 });
    game.seats[0].stack = 700;
    game.seats[0].committed = 300;

    // Only what is still in front of them comes back; the 300 in the middle
    // is contested, exactly as at a real table.
    expect(vacateSeat(game, token).cashedOut).toBe(700);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceTimedTurn,
  applyPlayerAction,
  claimSeat,
  chooseBotAction,
  createGame,
  createTournamentGame,
  dealNextHandIfDue,
  estimateBotEquity,
  MAX_MISSED_TURNS,
  normalizeGameState,
  preflopHandTier,
  SEAT_COUNT,
  TURN_TIMEOUT_MS,
  toSnapshot,
  vacateSeat,
} from "./engine";
import { BOT_TAGS } from "./bot-identities";
import { compareScores, describeHand, evaluateHand } from "./evaluator";
import { TIER_CONFIG } from "./tiers";
import type { Card, GameState, PlayerAction } from "./types";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  avatarCosmetics,
  cosmeticById,
  DEFAULT_CARD_BACK,
  defaultEquipped,
} from "@/lib/cosmetics/catalog";

/**
 * Registered by default, because that is the case with something to check:
 * a registered profile is the only one that puts an id on the seat.
 * Pass `{ isRegistered: false }` for the guest path.
 */
/**
 * RIVER_TABLE_FUNDED_FLOOR is stubbed by two tests below, and vitest.config.ts
 * sets no automatic env restoration -- so without this the second stub, and
 * then every later test in this file, ran against a floor the test never asked
 * for. continuous-table.test.ts already cleans up after itself this way.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

const testProfile = (
  name: string,
  overrides: Partial<Pick<PlayerProfile, "id" | "isRegistered">> = {},
): Pick<
  PlayerProfile,
  "id" | "isRegistered" | "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"
> => ({
  id: crypto.randomUUID(),
  isRegistered: true,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  accent: "#79c9ff",
  avatarUrl: null,
  avatarPreset: "ace",
  equipped: defaultEquipped,
  ...overrides,
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
    // And no hand label either. A label is a lossy description of exactly the
    // cards next to it, so leaking one past an uncontested win would give away
    // what the muck is entitled to keep.
    view.seats
      .filter((seat) => !seat.isMine)
      .forEach((seat) => {
        expect(seat.handLabel).toBeNull();
      });
  });

  describe("hand strength visibility", () => {
    it("shows you your own made hand and nobody else's mid-hand", () => {
      const { game, tokens } = createHumanTable();
      const view = toSnapshot(game, tokens[0]);
      const mine = view.seats.find((seat) => seat.isMine)!;

      expect(mine.handLabel).not.toBeNull();
      view.seats
        .filter((seat) => !seat.isMine)
        .forEach((seat) => expect(seat.handLabel).toBeNull());
    });

    it("shows every contender's made hand once a real showdown happens", () => {
      const { game, tokens } = createHumanTable();
      game.status = "playing";
      game.street = "river";
      game.community = cards("2c 3d 7h 8s 9c");
      game.currentPlayer = 0;
      game.currentBet = 0;
      game.seats.forEach((seat) => {
        seat.acted = true;
        seat.streetBet = 0;
        seat.committed = 100;
        seat.stack = 900;
        seat.status = "folded";
      });
      // Distinct labels on purpose: pocket aces make only a pair against this
      // board, so two pocket pairs would both read "One pair" and the
      // assertion would pass without proving each seat is described
      // separately. Sevens hit the board and make trips.
      Object.assign(game.seats[0], { status: "active", acted: false, holeCards: cards("As Ad") });
      Object.assign(game.seats[1], { status: "all-in", stack: 0, holeCards: cards("7s 7c") });

      const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
      expect(complete.status).toBe("complete");

      // Read as seat 2, who folded: they still see both contenders, because a
      // genuine showdown is public information at any real table.
      const view = toSnapshot(complete, tokens[2]);
      expect(view.seats[0].handLabel).toBe("One pair");
      expect(view.seats[1].handLabel).toBe("Three of a kind");
      // Their own folded hand stays their business, and the label follows the
      // cards rather than having a rule of its own.
      expect(view.seats[3].handLabel).toBeNull();
      expect(view.seats[3].holeCards.every((card) => card === null)).toBe(true);
    });

    it("never labels a hand it would not also reveal", () => {
      const { game, tokens } = createHumanTable();
      // The invariant that matters, asserted directly: a label is a lossy
      // description of the cards beside it, so a seat showing face-down cards
      // must never carry one.
      [0, 1, 2].forEach((viewer) => {
        toSnapshot(game, tokens[viewer]).seats.forEach((seat) => {
          const hidden = seat.holeCards.some((card) => card === null);
          if (hidden) expect(seat.handLabel).toBeNull();
        });
      });
    });
  });

  it("plays repeated complete hands while conserving chips", () => {
    const token = crypto.randomUUID();
    let game = createGame(token, "Test");
    // Bot seats start at a randomized multiple of the buy-in (see
    // randomBotStack in engine.ts), so the table's total is no longer a fixed
    // 6000 -- it is whatever this particular table drew, captured once here.
    // stack + committed, not stack alone: createGame deals hand 1 and posts
    // blinds before returning, so two seats' stacks are already down by their
    // blind at this point, with that amount sitting in committed instead.
    const startingTotal = game.seats.reduce((sum, seat) => sum + seat.stack + seat.committed, 0);
    let completed = 0;
    let safety = 0;
    // Rake is the only sanctioned way for chips to leave the table, so the
    // invariant is "everything still accounted for, minus what the house
    // took" -- which also proves nothing leaks anywhere else.
    let rakeTaken = 0;
    // A busted *bot* seat refilling is a sanctioned way for chips to
    // *arrive* -- `reseat`'s minted stack is not backed by Gold, and with
    // TABLE_FUNDED_FLOOR now the whole table (6, not 4) a single bot bust is
    // enough to trigger one, not just several at once. Twelve hands is
    // plenty for that to happen, so it has to be tracked rather than
    // assumed away.
    let mintedTotal = 0;

    while (completed < 12) {
      game = advanceBotsUntilHuman(game);
      if (game.status === "complete") {
        rakeTaken += game.rake;
        expect(game.seats.reduce((sum, seat) => sum + seat.stack, 0) + rakeTaken)
          .toBe(startingTotal + mintedTotal);
        completed += 1;
        if (completed >= 12 || game.seats[0].stack === 0) break;
        const wasBustedBot = game.seats.map((seat) => !seat.isHuman && seat.stack <= 0);
        game = applyPlayerAction(game, { type: "next-hand" }, token);
        game.seats.forEach((seat, index) => {
          if (wasBustedBot[index] && seat.stack > 0) mintedTotal += TIER_CONFIG[game.tier].minBuyIn;
        });
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
          ).toBe(startingTotal + mintedTotal);
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

  it("keeps a busted human's own seat sitting out through the next deal", () => {
    const hostToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    game.status = "complete";
    game.seats[0].stack = 0;

    game = applyPlayerAction(game, { type: "next-hand" }, hostToken);
    // No bot standing in for them -- see lib/game/busted-seat.test.ts for the
    // full behaviour. This asserted the opposite while a bust still handed
    // the seat to a bot after a grace period.
    expect(game.seats[0].ownerToken).toBe(hostToken);
    expect(game.seats[0].isHuman).toBe(true);
    expect(toSnapshot(game, hostToken).isSeated).toBe(true);
    expect(game.seats[0].status).toBe("out");
    expect(game.seats[0].stack).toBe(0);
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
    // Floor dropped to 3 so the three empty seats stay empty; this is a
    // three-handed bring-in rule, and the shipped floor of 4 would refill one
    // of them and make it a four-handed table instead.
    vi.stubEnv("RIVER_TABLE_FUNDED_FLOOR", "3");
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
  it("seats a six-max table with an AI personality per bot seat and none for the host", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(game.seats).toHaveLength(6);
    expect(game.seats[0].personality).toBeNull();
    // Personality is rolled independently of identity (see pickBotPersonality),
    // so it's no longer a fixed sequence -- just a valid archetype per seat.
    game.seats.slice(1).forEach((seat) => {
      expect(["MANIAC", "ROCK", "CALLING_STATION"]).toContain(seat.personality);
    });
    expect(game.seats.slice(1).every((seat) => !seat.isHuman)).toBe(true);
    // Every bot seat gets a visually distinct identity (no repeats among bots).
    expect(new Set(game.seats.slice(1).map((seat) => seat.avatarPreset)).size).toBe(5);
  });

  it("never seats two bots wearing the same character, over many tables", () => {
    // Not one table: `pickBotIdentity` is seeded off the table id, so a single
    // sample passes ~85% of the time even when faces do collide. The pool of
    // tags is deliberately larger than the character roster and `botAvatarFor`
    // wraps modulo the roster, so some tags share a face -- picking around
    // that is the seat-art half of the same uniqueness rule the preset check
    // above covers. Grew the roster to 26 in 2026-08-25 and this started
    // firing on the assertion above's own single sample.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const table = createGame(crypto.randomUUID(), "Host");
      const bots = table.seats.slice(1);
      expect(new Set(bots.map((seat) => seat.avatarCosmetic)).size).toBe(bots.length);
    }
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

  it("immediately folds low offsuit trash preflop outside the bluff gate, for the disciplined personality", () => {
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
      // Personality is rolled independently of seat index now (see
      // pickBotPersonality), so it's pinned explicitly here: this test is
      // about the disciplined "Table Captain" baseline, whose trash-continue
      // chance (0.06) stays below the mock's fixed 0.5 roll. The looser
      // personalities are exactly what the new VPIP tests in
      // bot-personality.test.ts cover instead.
      personality: "ROCK",
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
      // Pinned: personality is rolled independently of seat index now (see
      // pickBotPersonality), and this test is about raise-sizing math, not
      // about which archetype is aggressive enough to raise AA at all.
      personality: "MANIAC",
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
      // Pinned for the same reason as above: this test is about the
      // short-stack shove rule itself, not about which personality is
      // aggressive enough to take it at a 0.5 roll.
      personality: "MANIAC",
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
      // Pinned defensively, same as the two tests above: the guaranteed-fold
      // clause this exercises doesn't read `style` at all, but a fixed roll
      // meeting a random personality's thresholds elsewhere in the function
      // is exactly the kind of thing worth not leaving to chance.
      personality: "ROCK",
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
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    game = claimSeat(game, guestToken, testProfile("Guest")).state;

    // Four *bot* seats bust out, leaving exactly two funded players.
    //
    // Bots on purpose: a busted human's seat is handed back to a funded bot, so
    // busting humans -- which is how this test used to shrink the table -- no
    // longer shrinks anything.
    //
    // The floor is dropped to 2 so those four stay busted. At the shipped
    // floor of 4 a table cannot reach heads-up by busting at all, which is the
    // deliberate cost of keeping tables populated -- but the heads-up blind
    // rule is still a real rule, it still governs any table that gets there,
    // and it is worth holding to it.
    vi.stubEnv("RIVER_TABLE_FUNDED_FLOOR", "2");
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
    // Per seat, not a table total: bot seats now start at a randomized stack
    // (see randomBotStack in engine.ts), so claiming one at a fixed 1000
    // buy-in legitimately changes the table's total by however much more or
    // less than 1000 that bot happened to be carrying -- that difference is
    // bot chips, never Gold-backed, so it neither mints nor steals anything.
    // What must hold regardless is narrower: the claimed seat nets to exactly
    // what was paid, and every *other* seat is untouched.
    const othersBefore = game.seats.map((seat) => seat.stack + seat.committed);

    const { state, seatIndex } = claimSeat(
      game,
      crypto.randomUUID(),
      testProfile("Guest"),
      1000,
    );
    const claimed = state.seats[seatIndex];

    expect(claimed.committed).toBeGreaterThan(0);
    expect(claimed.stack + claimed.committed).toBe(1000);
    state.seats.forEach((seat, index) => {
      if (index === seatIndex) return;
      expect(seat.stack + seat.committed).toBe(othersBefore[index]);
    });
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

  it("sits a mid-hand claim out of the hand already in progress, then plays for real next hand", () => {
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    expect(game.status).toBe("playing");

    const claimed = claimSeat(game, guestToken, testProfile("Guest"));
    game = claimed.state;
    const guestSeatIndex = claimed.seatIndex;

    // No hand to inherit: no cards, no turn, no legal actions, whatever the
    // bot she replaced was holding.
    expect(game.seats[guestSeatIndex].status).toBe("out");
    expect(game.seats[guestSeatIndex].holeCards).toHaveLength(0);
    const guestView = toSnapshot(game, guestToken);
    expect(guestView.legalActions).toBeNull();
    expect(guestView.seats[guestSeatIndex].holeCards.every((card) => card === null)).toBe(true);
    expect(() => applyPlayerAction(game, { type: "check" }, guestToken)).toThrow(/turn/i);

    // Play the rest of the hand out -- the host's one action, then bots --
    // and the guest never once comes up on the clock.
    let guard = 0;
    while (game.status === "playing" && guard < 60) {
      expect(game.currentPlayer).not.toBe(guestSeatIndex);
      game = game.currentPlayer === 0
        ? applyPlayerAction(game, { type: "fold" }, hostToken)
        : advanceTimedTurn(game, Date.parse(game.turnDeadlineAt ?? new Date().toISOString())).state;
      guard += 1;
    }
    expect(game.status).toBe("complete");
    expect(game.nextHandAt).not.toBeNull();

    // The next deal is the guest's first real hand: a normal, active seat
    // with her own two cards.
    const { state: dealt, dealt: didDeal } = dealNextHandIfDue(game, Date.parse(game.nextHandAt!) + 1);
    expect(didDeal).toBe(true);
    expect(dealt.status).toBe("playing");
    expect(dealt.seats[guestSeatIndex].status).toBe("active");
    expect(dealt.seats[guestSeatIndex].holeCards).toHaveLength(2);
  });
});

describe("giving up a seat", () => {
  /**
   * A vacated seat used to be handed back to the identity that chair started
   * with -- seat 1 was always the same tag. It now draws a fresh one, so a
   * player who sits for an hour is not watching six handles cycle. What has to
   * hold is weaker but is the part that matters: a bot takes the seat, it is
   * somebody from the pool, and nobody at the table is wearing that identity
   * twice.
   */
  it("hands the seat to a fresh bot identity, including for the host's own seat", () => {
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
    expect(restored.botIdentity).not.toBeNull();
    expect(restored.name).toBeTruthy();
    expect(["MANIAC", "ROCK", "CALLING_STATION"]).toContain(restored.personality);

    game = vacateSeat(game, hostToken).state;
    expect(game.seats[0].isHuman).toBe(false);
    expect(game.seats[0].ownerToken).toBeNull();
    expect(game.seats[0].botIdentity).not.toBeNull();

    // No duplicates: drawing an identity per seat without checking the table
    // is exactly what puts two seats wearing the same tag in one hand.
    const identities = game.seats.map((seat) => seat.botIdentity);
    expect(new Set(identities).size).toBe(identities.length);
    expect(new Set(game.seats.map((seat) => seat.name)).size).toBe(game.seats.length);
  });

  it("keeps a rotated identity across a persist/reload cycle", () => {
    // The regression that makes rotation worth having a persisted field for:
    // bot faces used to be recomputed from `position` on every load, so a
    // rotated seat reverted on the next snapshot and the change was real in
    // memory and invisible in production.
    const hostToken = crypto.randomUUID();
    const guestToken = crypto.randomUUID();
    let game = createGame(hostToken, "Host");
    const claimed = claimSeat(game, guestToken, testProfile("Guest"));
    game = vacateSeat(claimed.state, guestToken).state;

    const rotated = game.seats[claimed.seatIndex];
    const { name, botIdentity, avatarCosmetic } = rotated;

    const reloaded = normalizeGameState(JSON.parse(JSON.stringify(game)) as GameState);
    expect(reloaded.seats[claimed.seatIndex].botIdentity).toBe(botIdentity);
    expect(reloaded.seats[claimed.seatIndex].name).toBe(name);
    expect(reloaded.seats[claimed.seatIndex].avatarCosmetic).toBe(avatarCosmetic);
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
    const { state, action } = advanceTimedTurn(game);
    expect(action).toBeNull();
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
    const { state, actorSeatId, timedOut } = advanceTimedTurn(game);
    expect(timedOut).toBe(true);
    expect(actorSeatId).toBe(hostSeatId);
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

describe("stakes tiers and buy-ins", () => {
  it("defaults to the cheapest tier's blinds and a 1000 stack when no tier/buyIn is given", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    expect(game.tier).toBe("1k");
    expect(game.smallBlind).toBe(5);
    expect(game.bigBlind).toBe(10);
    expect(game.seats[0].stack).toBe(1000);
  });

  it("gives the human seat exactly the chosen buy-in but spreads bot stacks from 1x up to a deep stack", () => {
    const buyIn = TIER_CONFIG["10k"].minBuyIn;
    const game = createGame(crypto.randomUUID(), "Host", undefined, { tier: "10k", buyIn });
    // stack + committed, not stack alone: createGame deals hand 1 and posts
    // blinds before returning, so a seat in a blind position already has part
    // of its starting stack sitting in committed by the time this reads it.

    // The human always gets exactly what they paid for -- randomization is a
    // bot-only table-feel detail, never something that shorts a real buy-in.
    expect(game.seats[0].stack + game.seats[0].committed).toBe(buyIn);

    const botStacks = game.seats.slice(1).map((seat) => seat.stack + seat.committed);
    for (const stack of botStacks) {
      expect(stack).toBeGreaterThanOrEqual(buyIn);
      expect(stack).toBeLessThanOrEqual(buyIn * 3);
      // Snapped to a real chip denomination, not an arbitrary integer.
      expect(stack % game.bigBlind).toBe(0);
    }
    // Not every bot dealt the exact same stack -- otherwise this is just
    // createGame's old uniform behaviour wearing a new comment. Flaky only in
    // the astronomically unlikely case all five draw the same value.
    expect(new Set(botStacks).size).toBeGreaterThan(1);
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

  it("refuses to rebuy a seat that still has chips, or one still live in the current hand", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    // Still funded -- checked first, regardless of table status.
    expect(() => applyPlayerAction(game, { type: "rebuy", amount: 1000 }, token))
      .toThrow(/still has chips/i);

    game.status = "complete";
    game.seats[0].stack = 0;
    expect(() => applyPlayerAction(game, { type: "rebuy", amount: 1000 }, token))
      .not.toThrow();
  });

  it("refuses a rebuy for a busted seat still live in a hand in progress", () => {
    const token = crypto.randomUUID();
    const game = createGame(token, "Host");
    // Not sitting out -- still contesting this exact hand's pot (e.g. an
    // all-in whose showdown hasn't been reached yet). No timer to wait out,
    // just the one hand this seat is still part of.
    game.seats[0].stack = 0;
    game.seats[0].status = "all-in";
    expect(() => applyPlayerAction(game, { type: "rebuy", amount: 1000 }, token))
      .toThrow(/finish/i);
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
    game.seats[0].avatarCosmetic = "character5";
    expect(normalizeGameState(game).seats[0].avatarCosmetic).toBe("character5");
  });

  it("backfills card backs on tables dealt before they reached the felt", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat) => {
      delete (seat as Partial<typeof seat>).cardBackCosmetic;
    });

    const normalized = normalizeGameState(game);
    // undefined here reaches an SVG fill attribute and draws a blank
    // rectangle where every hidden card should be -- on a table that was
    // mid-hand when it was persisted.
    normalized.seats.forEach((seat) => {
      expect({ id: seat.id, back: cosmeticById(seat.cardBackCosmetic)?.slot })
        .toEqual({ id: seat.id, back: "cardBack" });
    });
    expect(normalized.seats[0].cardBackCosmetic).toBe(DEFAULT_CARD_BACK);
  });

  it("leaves a card back that is already present untouched", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats[0].cardBackCosmetic = "back-ivory";
    expect(normalizeGameState(game).seats[0].cardBackCosmetic).toBe("back-ivory");
  });
});

describe("card backs follow the player, not the seat", () => {
  it("gives a claimed seat the back the player equipped", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const token = crypto.randomUUID();
    const profile = {
      ...testProfile("Buyer"),
      equipped: { ...defaultEquipped, cardBack: "back-ivory" },
    };

    const seated = claimSeat(game, token, profile).state;
    const mine = seated.seats.find((seat) => seat.ownerToken === token)!;
    expect(mine.cardBackCosmetic).toBe("back-ivory");
  });

  it("takes the back back when the seat returns to a bot", () => {
    // A player who leaves, or who is released for missing three turns
    // (MAX_MISSED_TURNS), must not leave a 400,000 Gold card back behind for
    // a bot to keep dealing with.
    const game = createGame(crypto.randomUUID(), "Host");
    const token = crypto.randomUUID();
    const seated = claimSeat(game, token, {
      ...testProfile("Buyer"),
      equipped: { ...defaultEquipped, cardBack: "back-riverwood" },
    }).state;
    const seatId = seated.seats.find((seat) => seat.ownerToken === token)!.id;
    expect(seated.seats.find((seat) => seat.id === seatId)!.cardBackCosmetic).toBe("back-riverwood");

    const left = vacateSeat(seated, token).state;
    const released = left.seats.find((seat) => seat.id === seatId)!;
    expect(released.isHuman).toBe(false);
    expect(released.cardBackCosmetic).not.toBe("back-riverwood");
    expect(cosmeticById(released.cardBackCosmetic)?.rarity).toBe("standard");
  });

  it("deals every seat at a fresh table a real card back", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    for (const seat of game.seats) {
      const item = cosmeticById(seat.cardBackCosmetic);
      expect({ position: seat.position, slot: item?.slot }).toEqual({ position: seat.position, slot: "cardBack" });
    }
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

  it("clears every seat's standing streetBet once an uncontested win pays out", () => {
    // Seat 0 still shows streetBet: 150 the instant awardUncontested runs --
    // that's the bet the rest of the table just folded to. Leaving it in
    // place would float a stale bet pill over a seat whose chips already
    // moved into the stack.
    const { game, tokens } = preflopUncontested(150);
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.status).toBe("complete");
    complete.seats.forEach((seat) => expect(seat.streetBet).toBe(0));
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

  it("clears every seat's standing streetBet once the river reaches showdown", () => {
    // The last river action closes the round straight into showdown() --
    // advanceStreet's own per-street reset never runs for that transition,
    // so a lingering streetBet from the river's own betting has to be
    // showdown's job to clear, not something it can rely on upstream.
    const { game, tokens } = riverShowdown(150);
    game.currentBet = 60;
    game.seats[0].streetBet = 60;
    game.seats[1].streetBet = 60;
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.street).toBe("showdown");
    complete.seats.forEach((seat) => expect(seat.streetBet).toBe(0));
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

describe("seat profile ids in the public snapshot", () => {
  it("shows a registered player's profile id to everyone at the table", () => {
    // The whole point of the field: another player has to be able to name you
    // as a friend target without ever holding your session token.
    const game = createGame(crypto.randomUUID(), "Host");
    const token = crypto.randomUUID();
    const profile = testProfile("Registered");
    const seated = claimSeat(game, token, profile).state;

    const onlooker = toSnapshot(seated, crypto.randomUUID());
    const seat = onlooker.seats.find((row) => row.name === "Registered")!;
    expect(seat.profileId).toBe(profile.id);
  });

  it("never puts the session token in the snapshot", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const token = crypto.randomUUID();
    const seated = claimSeat(game, token, testProfile("Registered")).state;

    const view = toSnapshot(seated, crypto.randomUUID());
    // The reason profileId exists at all is that this must stay true.
    expect(JSON.stringify(view)).not.toContain(token);
    view.seats.forEach((seat) => expect(seat).not.toHaveProperty("ownerToken"));
  });

  it("gives a guest no profile id", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const token = crypto.randomUUID();
    const guest = testProfile("Guest", { isRegistered: false });
    const seated = claimSeat(game, token, guest).state;

    // A guest profile dies with its cookie, so a friend request addressed to
    // one could never be accepted.
    const seat = toSnapshot(seated, token).seats.find((row) => row.name === "Guest")!;
    expect(seat.profileId).toBeNull();
  });

  it("leaves bots and open seats with no profile id", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    toSnapshot(game, crypto.randomUUID()).seats
      .filter((seat) => !seat.isHuman)
      .forEach((seat) => expect(seat.profileId).toBeNull());
  });

  it("drops the profile id when the seat returns to a bot", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const token = crypto.randomUUID();
    const seated = claimSeat(game, token, testProfile("Leaver")).state;
    const seatId = seated.seats.find((seat) => seat.ownerToken === token)!.id;

    const left = vacateSeat(seated, token).state;
    const released = left.seats.find((seat) => seat.id === seatId)!;
    // Same rule as the card back above: nothing of the departed player stays
    // in the chair for the bot -- or the next occupant -- to wear.
    expect(released.isHuman).toBe(false);
    expect(released.profileId).toBeNull();
  });

  it("does not let a new occupant inherit the previous player's profile id", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const firstToken = crypto.randomUUID();
    const first = testProfile("First");
    const seated = claimSeat(game, firstToken, first).state;
    const seatId = seated.seats.find((seat) => seat.ownerToken === firstToken)!.id;

    const left = vacateSeat(seated, firstToken).state;
    const second = testProfile("Second");
    const reseated = claimSeat(left, crypto.randomUUID(), second).state;

    const seat = reseated.seats.find((row) => row.id === seatId)!;
    // If this ever reads `first.id`, the table is telling everyone the new
    // player is somebody else.
    expect(seat.profileId).not.toBe(first.id);
  });

  it("turns a legacy seat's missing profile id into a deliberate null", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const seated = claimSeat(game, crypto.randomUUID(), testProfile("Human")).state;

    // A table persisted before this field existed carries undefined, which
    // would reach the client as an absent key and read as "no id" by accident.
    const legacy = structuredClone(seated) as GameState;
    legacy.seats.forEach((seat) => {
      delete (seat as Partial<GameState["seats"][number]>).profileId;
    });

    normalizeGameState(legacy).seats.forEach((seat) => {
      expect(seat.profileId).toBeNull();
    });
  });

  it("keeps a seated human's profile id across a normalize", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const profile = testProfile("Human");
    const seated = claimSeat(game, crypto.randomUUID(), profile).state;

    // The other half of the backfill: it must not flatten live ids on the way
    // through, which is the failure botIdentity actually shipped with once.
    const normalized = normalizeGameState(structuredClone(seated) as GameState);
    const seat = normalized.seats.find((row) => row.name === "Human")!;
    expect(seat.profileId).toBe(profile.id);
  });

  it("strips a profile id from a seat that is not human", () => {
    const game = createGame(crypto.randomUUID(), "Host");
    const tampered = structuredClone(game) as GameState;
    const bot = tampered.seats.find((seat) => !seat.isHuman)!;
    bot.profileId = crypto.randomUUID();

    // Belt and braces for the release paths: a stale id cannot survive one
    // round trip through the store, whatever put it there.
    const normalized = normalizeGameState(tampered);
    expect(normalized.seats.find((seat) => seat.id === bot.id)!.profileId).toBeNull();
  });
});

describe("the bot pool's tags", () => {
  /* Kayo's call, 2026-08-21: the table should read like a room of real people,
     which means handles somebody typed for themselves rather than a cast of
     single first names (this pool used to be Jax/Maya/Theo). Pinned here
     because "these look like NPCs" is a thing only a person notices, and only
     after the pool has quietly drifted back one well-meaning entry at a time. */
  it("is written as gamer tags, not first names", () => {
    for (const tag of BOT_TAGS) {
      expect(tag, `${tag} is not in tag shape`).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
    }
  });

  it("stays inside a nameplate", () => {
    // A human's own name is capped at 18 by joinTable and shares the plate; a
    // bot has no such gate, so the pool is the gate.
    for (const tag of BOT_TAGS) expect(tag.length, tag).toBeLessThanOrEqual(14);
  });

  it("never seats the same handle twice, and holds more handles than seats", () => {
    expect(new Set(BOT_TAGS).size).toBe(BOT_TAGS.length);
    expect(BOT_TAGS.length).toBeGreaterThan(SEAT_COUNT);
  });

  /* One visible formula across every entry gives the generated feel straight
     back, however good the individual tags are. This is the cheapest way to
     say "keep it varied" to whoever adds the next batch. */
  it("mixes the shapes real tags come in", () => {
    expect(BOT_TAGS.filter((tag) => tag.includes("_")).length).toBeGreaterThan(3);
    expect(BOT_TAGS.filter((tag) => !tag.includes("_")).length).toBeGreaterThan(3);
    expect(BOT_TAGS.filter((tag) => /\d/.test(tag)).length).toBeGreaterThan(1);
  });
});

describe("tournament mode", () => {
  function createTournamentTable() {
    const entrants = Array.from({ length: SEAT_COUNT }, (_, index) => ({
      token: crypto.randomUUID(),
      profile: testProfile(`Player ${index + 1}`),
    }));
    const game = createTournamentGame(entrants, "1k");
    return { game, entrants };
  }

  it("seats exactly SEAT_COUNT humans, all at the tier's own starting stack, no bots", () => {
    const { game } = createTournamentTable();
    expect(game.seats).toHaveLength(SEAT_COUNT);
    for (const seat of game.seats) {
      expect(seat.isHuman).toBe(true);
      // Hand 1 is already dealt (setupHand(state, true) runs inside
      // createTournamentGame), so the two blind seats have already posted --
      // what matters is every seat STARTED at the same fixed stack.
      expect(seat.stack + seat.committed).toBe(TIER_CONFIG["1k"].minBuyIn);
      expect(seat.profileId).not.toBeNull();
    }
    expect(game.tournament?.startingStack).toBe(TIER_CONFIG["1k"].minBuyIn);
  });

  it("refuses to build a table with the wrong number of entrants", () => {
    expect(() => createTournamentGame([], "1k")).toThrow();
  });

  it("recomputes blinds from the schedule, not the tier's static blinds, as hands roll forward", () => {
    let state = createTournamentTable().game;
    for (let i = 0; i < 5; i += 1) {
      state.status = "complete";
      state.nextHandAt = new Date(0).toISOString();
      state = dealNextHandIfDue(state, 1).state;
    }
    expect(state.handNumber).toBe(6);
    expect(state.smallBlind).toBe(TIER_CONFIG["1k"].smallBlind * 2);
    expect(state.bigBlind).toBe(TIER_CONFIG["1k"].bigBlind * 2);
    expect(state.tournament?.blindLevel).toBe(1);
  });

  it("leaves a cash table's blinds untouched -- the branch only fires when tournament is set", () => {
    const token = crypto.randomUUID();
    let state = createGame(token, "Host", undefined, { tier: "1k", buyIn: 1000 });
    state.status = "complete";
    state.nextHandAt = new Date(0).toISOString();
    state = dealNextHandIfDue(state, 1).state;
    expect(state.smallBlind).toBe(TIER_CONFIG["1k"].smallBlind);
    expect(state.bigBlind).toBe(TIER_CONFIG["1k"].bigBlind);
  });

  it("never bot-refills a busted seat, and logs elimination rather than a rebuy prompt", () => {
    const { game } = createTournamentTable();
    // "all-in", not "out": a seat that just lost its last chip this hand
    // reads this way until the *next* setupHand relabels it -- the same
    // status releaseBustedSeats' log check itself keys off, so this
    // reproduces "just busted" rather than "already logged long ago".
    game.seats[0].stack = 0;
    game.seats[0].status = "all-in";
    game.status = "complete";
    game.nextHandAt = new Date(0).toISOString();
    const { state } = dealNextHandIfDue(game, 1);
    expect(state.seats[0].isHuman).toBe(true);
    expect(state.seats[0].stack).toBe(0);
    expect(state.log.some((entry) => entry.text.includes("is eliminated"))).toBe(true);
    expect(state.log.some((entry) => entry.text.includes("sits out until they rebuy"))).toBe(false);
  });

  it("rejects a rebuy outright, even with a fully funded seat", () => {
    const { game, entrants } = createTournamentTable();
    expect(() =>
      applyPlayerAction(game, { type: "rebuy", amount: 1000 }, entrants[0].token),
    ).toThrow(/no rebuy/);
  });

  it("leaving mid-hand forfeits immediately on your own turn, with no bot handoff", () => {
    const { game } = createTournamentTable();
    const leavingIndex = game.currentPlayer!;
    const leavingToken = game.seats[leavingIndex].ownerToken!;

    const after = applyPlayerAction(game, { type: "leave-seat" }, leavingToken);
    expect(after.seats[leavingIndex].stack).toBe(0);
    expect(after.seats[leavingIndex].status).toBe("out");
    // No bot handoff, unlike a cash table's vacateSeat.
    expect(after.seats[leavingIndex].ownerToken).toBe(leavingToken);
    expect(after.seats[leavingIndex].isHuman).toBe(true);
    // Five other seats are still funded, so this alone doesn't decide the
    // Sit & Go -- only forfeits the one seat that left.
    expect(after.tournament?.winnerProfileId).toBeNull();
  });

  it("leaving mid-hand off turn fast-tracks the forfeit instead of disturbing the live hand", () => {
    const { game } = createTournamentTable();
    const stayingIndex = game.currentPlayer!;
    const leavingIndex = game.seats.findIndex((seat, index) => index !== stayingIndex && seat.stack > 0);
    const leavingToken = game.seats[leavingIndex].ownerToken!;

    const after = applyPlayerAction(game, { type: "leave-seat" }, leavingToken);
    expect(after.status).toBe("playing");
    expect(after.currentPlayer).toBe(stayingIndex);
    expect(after.seats[leavingIndex].status).not.toBe("out");
    expect(after.seats[leavingIndex].missedTurns).toBe(MAX_MISSED_TURNS - 1);
  });

  it("forfeits with zero Gold movement once a hand has already ended", () => {
    const { game, entrants } = createTournamentTable();
    game.status = "complete";
    const left = applyPlayerAction(game, { type: "leave-seat" }, entrants[0].token);
    expect(left.seats[0].stack).toBe(0);
    expect(left.seats[0].status).toBe("out");
    // No bot handoff, unlike a cash table's vacateSeat.
    expect(left.seats[0].ownerToken).toBe(entrants[0].token);
    expect(left.seats[0].isHuman).toBe(true);
  });

  it("declares a winner and stops scheduling hands the moment one seat is left standing", () => {
    const { game } = createTournamentTable();
    game.seats.forEach((seat, index) => {
      seat.stack = index === 0 ? 6000 : 0;
      seat.status = index === 0 ? "active" : "out";
    });
    game.status = "complete";
    game.nextHandAt = new Date(0).toISOString();
    const { state, dealt } = dealNextHandIfDue(game, 1);
    expect(dealt).toBe(true);
    expect(state.tournament?.winnerProfileId).toBe(game.seats[0].profileId);
    expect(state.tournament?.finishedAtHand).toBe(state.handNumber);
    expect(state.nextHandAt).toBeNull();
    expect(state.status).toBe("complete");
  });

  it("never takes rake from a tournament pot, even one well above the cash-table floor", () => {
    // A Sit & Go's prize pool is a fixed entryFee * seats with no house edge
    // to skim -- rake would just shrink the chips deciding the payout. Same
    // fixture shape as the "rake" describe block's own riverShowdown(5000),
    // which rakes 30 off this exact pot on a cash table.
    const { game, tokens } = createHumanTable();
    game.tournament = {
      format: "sit_and_go",
      entryFee: 1000,
      startingStack: 1000,
      blindLevel: 0,
      finishedAtHand: null,
      winnerProfileId: null,
    };
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
      committed: 5000,
      acted: false,
      holeCards: cards("As Ad"),
    });
    Object.assign(game.seats[1], {
      status: "all-in",
      stack: 0,
      committed: 5000,
      holeCards: cards("Ks Kd"),
    });
    const complete = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(complete.rake).toBe(0);
    expect(complete.winners[0].amount).toBe(10000);
  });

  it("forfeits an AFK tournament seat outright once missed turns cross the threshold -- no bot fill to hand it to", () => {
    const { game } = createTournamentTable();
    const seatIndex = game.currentPlayer!;
    // One more missed turn crosses MAX_MISSED_TURNS. A cash table hands the
    // seat to a bot at this same threshold (releaseInactiveSeats); a
    // tournament seat is never handed to one, so it forfeits outright
    // instead -- ending its own tournament life rather than being left to
    // auto-fold forever with nobody left to notice it should be over.
    game.seats[seatIndex].missedTurns = MAX_MISSED_TURNS - 1;
    game.turnStartedAt = new Date(Date.now() - 60_000).toISOString();
    game.turnDeadlineAt = new Date(Date.now() - 1000).toISOString();

    const { state } = advanceTimedTurn(game, Date.now());
    expect(state.seats[seatIndex].missedTurns).toBe(MAX_MISSED_TURNS);
    expect(state.seats[seatIndex].status).toBe("out");
    expect(state.seats[seatIndex].stack).toBe(0);
    expect(state.seats[seatIndex].isHuman).toBe(true);
    // Newest entry first (addLog unshifts).
    const lastLog = state.log[0]?.text ?? "";
    expect(lastLog).toMatch(/forfeits their seat/);
  });
});

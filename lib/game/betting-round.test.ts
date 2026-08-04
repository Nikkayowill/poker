import { describe, expect, it } from "vitest";
import { applyPlayerAction, createGame, normalizeGameState } from "./engine";
import type { GameState, PlayerAction, Seat } from "./types";

/**
 * Betting-round rules, exercised through the engine's real entry point.
 *
 * Every seat here is human, so nothing advances except by an explicit action.
 * That is the point: these tests are about who is asked to act and when, and a
 * bot deciding on a timer would hide exactly the bug they are looking for.
 */

function allHumanTable(): GameState {
  const game = createGame("seat-0-token", "Hero");
  game.seats.forEach((seat, index) => {
    seat.isHuman = true;
    seat.ownerToken = `seat-${index}-token`;
    seat.personality = null;
    // Pinned back to the uniform default buy-in: createGame now spreads bot
    // seats across a randomized stack range (see randomBotStack in
    // engine.ts) for table feel, which these tests never asked for and would
    // otherwise pull an incidental side-pot/short-all-in scenario into a
    // suite that is specifically about turn order, not stack depth.
    //
    // 1000 - committed, not a flat 1000: createGame has already dealt hand 1
    // and posted blinds by the time this runs, so the small/big blind seats
    // already hold part of their 1000 in committed. Overwriting stack alone
    // would hand a blind seat 1000 *more* than it bought in for.
    seat.stack = 1000 - seat.committed;
  });
  normalizeGameState(game);
  return game;
}

const tokenOf = (state: GameState, index: number) => state.seats[index].ownerToken!;
const current = (state: GameState) => state.currentPlayer;
const act = (state: GameState, action: PlayerAction) =>
  applyPlayerAction(state, action, tokenOf(state, state.currentPlayer!));

/** Seats still owed a decision this street, by the engine's own definition. */
const pending = (state: GameState) =>
  state.seats.filter(
    (seat: Seat) =>
      seat.status === "active"
      && seat.stack > 0
      && !(seat.acted && seat.streetBet === state.currentBet),
  ).length;

describe("preflop betting round", () => {
  it("gives the big blind an option and ends the street when it checks", () => {
    const game = allHumanTable();
    expect(game.street).toBe("preflop");

    // Blinds are posted once, and posting is not acting: the big blind still
    // owes a decision, which is what an option *is*.
    const big = game.seats.find((seat) => seat.lastAction?.startsWith("Big blind"))!;
    expect(big.acted).toBe(false);
    expect(game.currentBet).toBe(game.bigBlind);

    const order: number[] = [];
    let guard = 0;
    while (game.street === "preflop" && guard < 20) {
      order.push(current(game)!);
      const seat = game.seats[current(game)!];
      act(game, seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" });
      guard += 1;
    }

    // Everyone limps, the big blind checks, and the street ends -- once.
    expect(game.street).toBe("flop");
    expect(order).toHaveLength(game.seats.length);
    expect(new Set(order).size).toBe(order.length);
    expect(game.community).toHaveLength(3);
  });

  it("does not ask a caller to act again when nobody raised", () => {
    const game = allHumanTable();
    const first = current(game)!;
    act(game, { type: "call" });
    expect(current(game)).not.toBe(first);

    let guard = 0;
    while (game.street === "preflop" && guard < 20) {
      expect(current(game)).not.toBe(first);
      const seat = game.seats[current(game)!];
      act(game, seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" });
      guard += 1;
    }
    expect(game.street).toBe("flop");
  });

  it("closes the street after one raise and calls all round", () => {
    const game = allHumanTable();
    const raiser = current(game)!;
    act(game, { type: "raise", amount: game.bigBlind * 3 });
    expect(game.currentBet).toBe(game.bigBlind * 3);

    let guard = 0;
    while (game.street === "preflop" && guard < 20) {
      expect(current(game)).not.toBe(raiser);
      act(game, { type: "call" });
      guard += 1;
    }
    expect(game.street).toBe("flop");
    expect(game.community).toHaveLength(3);
  });

  it("reopens action for players who already called when someone re-raises", () => {
    const game = allHumanTable();
    act(game, { type: "raise", amount: game.bigBlind * 3 });
    const caller = current(game)!;
    act(game, { type: "call" });
    expect(game.seats[caller].acted).toBe(true);

    // A legitimate re-raise puts the earlier caller back in the round.
    act(game, { type: "raise", amount: game.bigBlind * 9 });
    expect(game.seats[caller].acted).toBe(false);
    expect(game.street).toBe("preflop");
  });
});

describe("postflop betting rounds", () => {
  function toFlop(): GameState {
    const game = allHumanTable();
    let guard = 0;
    while (game.street === "preflop" && guard < 20) {
      const seat = game.seats[current(game)!];
      act(game, seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" });
      guard += 1;
    }
    return game;
  }

  it("checks around exactly once and deals the turn once", () => {
    const game = toFlop();
    const live = game.seats.filter((seat) => seat.status === "active").length;

    const order: number[] = [];
    let guard = 0;
    while (game.street === "flop" && guard < 20) {
      order.push(current(game)!);
      act(game, { type: "check" });
      guard += 1;
    }

    expect(order).toHaveLength(live);
    expect(new Set(order).size).toBe(order.length);
    expect(game.street).toBe("turn");
    expect(game.community).toHaveLength(4);
  });

  it("ends the street once a bet is called all the way round", () => {
    const game = toFlop();
    act(game, { type: "raise", amount: game.bigBlind * 2 });
    expect(game.currentBet).toBe(game.bigBlind * 2);

    let guard = 0;
    while (game.street === "flop" && guard < 20) {
      act(game, { type: "call" });
      guard += 1;
    }
    expect(game.street).toBe("turn");
    expect(game.community).toHaveLength(4);
  });

  it("never deals a street twice on the way to showdown", () => {
    const game = toFlop();
    const dealt: string[] = [];
    let guard = 0;
    while (game.status === "playing" && guard < 60) {
      const street = game.street;
      act(game, { type: "check" });
      if (game.street !== street) dealt.push(game.street);
      guard += 1;
    }
    expect(dealt).toEqual(["turn", "river", "showdown"]);
    expect(game.community).toHaveLength(5);
  });
});

describe("who is skipped", () => {
  it("never returns to a folded seat", () => {
    const game = allHumanTable();
    const folder = current(game)!;
    act(game, { type: "fold" });
    expect(game.seats[folder].status).toBe("folded");

    let guard = 0;
    while (game.status === "playing" && guard < 60) {
      expect(current(game)).not.toBe(folder);
      const seat = game.seats[current(game)!];
      act(game, seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" });
      guard += 1;
    }
    expect(game.seats[folder].status).toBe("folded");
  });

  it("never returns to an all-in seat and does not wait on it to close a street", () => {
    const game = allHumanTable();
    const shover = current(game)!;
    act(game, { type: "all-in" });
    expect(game.seats[shover].status).toBe("all-in");

    let guard = 0;
    while (game.street === "preflop" && guard < 20) {
      expect(current(game)).not.toBe(shover);
      act(game, { type: "call" });
      guard += 1;
    }
    // An all-in seat is not owed an action, so it cannot hold the street open.
    expect(pending(game)).toBe(0);
    expect(game.seats[shover].status).toBe("all-in");
  });
});

describe("turn ownership", () => {
  it("refuses an action from a player who is not on turn", () => {
    const game = allHumanTable();
    const notOnTurn = (game.currentPlayer! + 1) % game.seats.length;
    expect(() => applyPlayerAction(game, { type: "call" }, tokenOf(game, notOnTurn)))
      .toThrow(/Wait for your turn/);
  });

  it("refuses a second action from the player who just acted", () => {
    const game = allHumanTable();
    const actor = current(game)!;
    const token = tokenOf(game, actor);
    act(game, { type: "call" });
    // This is the duplicate-submit case: the same player, the same intent,
    // arriving twice. The second must not commit chips again.
    const committed = game.seats[actor].committed;
    expect(() => applyPlayerAction(game, { type: "call" }, token)).toThrow(/Wait for your turn/);
    expect(game.seats[actor].committed).toBe(committed);
  });
});

describe("VPIP", () => {
  it("is not set by posting a blind", () => {
    const game = allHumanTable();
    const small = game.seats.find((seat) => seat.lastAction?.startsWith("Small blind"))!;
    const big = game.seats.find((seat) => seat.lastAction?.startsWith("Big blind"))!;
    expect(small.vpip).toBe(false);
    expect(big.vpip).toBe(false);
  });

  it("is not set by folding or by the big blind's free check", () => {
    const game = allHumanTable();
    // Identified before anyone acts: the round-closing check that follows
    // clears lastAction table-wide as part of dealing the next street (see
    // advanceStreet), so "Big blind" would no longer be findable afterward.
    const bigIndex = game.seats.findIndex((seat) => seat.lastAction?.startsWith("Big blind"));
    expect(bigIndex).toBeGreaterThanOrEqual(0);

    const folder = current(game)!;
    act(game, { type: "fold" });
    expect(game.seats[folder].vpip).toBe(false);

    let guard = 0;
    let bigChecked = false;
    while (game.street === "preflop" && guard < 20) {
      const idx = current(game)!;
      const seat = game.seats[idx];
      const willCheck = seat.streetBet === game.currentBet;
      act(game, willCheck ? { type: "check" } : { type: "call" });
      if (idx === bigIndex) bigChecked = willCheck;
      guard += 1;
    }
    // The BB really did get its free option here, rather than the street
    // closing before it acted at all.
    expect(bigChecked).toBe(true);
    expect(game.seats[bigIndex].vpip).toBe(false);
  });

  it("is set by calling, raising or shoving preflop, and stays set for the rest of the hand", () => {
    const game = allHumanTable();
    const caller = current(game)!;
    act(game, { type: "call" });
    expect(game.seats[caller].vpip).toBe(true);

    const raiser = current(game)!;
    act(game, { type: "raise", amount: game.bigBlind * 4 });
    expect(game.seats[raiser].vpip).toBe(true);

    let guard = 0;
    while (game.street === "preflop" && guard < 20) {
      const seat = game.seats[current(game)!];
      act(game, seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" });
      guard += 1;
    }
    // Checking the flop is not a preflop action and must not clear it.
    expect(game.street).toBe("flop");
    act(game, { type: "check" });
    expect(game.seats[caller].vpip).toBe(true);
    expect(game.seats[raiser].vpip).toBe(true);
  });

  it("resets every seat at the start of the next hand", () => {
    const game = allHumanTable();
    act(game, { type: "raise", amount: game.bigBlind * 4 });
    let guard = 0;
    while (game.status === "playing" && guard < 60) {
      const seat = game.seats[current(game)!];
      act(game, seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" });
      guard += 1;
    }
    expect(game.seats.some((seat) => seat.vpip)).toBe(true);

    // Not through the act() helper: by now the hand is complete and nobody
    // is "on turn", but next-hand doesn't require turn ownership -- any
    // seated player can deal the next one in.
    applyPlayerAction(game, { type: "next-hand" }, tokenOf(game, 0));
    expect(game.seats.every((seat) => seat.vpip === false)).toBe(true);
  });
});

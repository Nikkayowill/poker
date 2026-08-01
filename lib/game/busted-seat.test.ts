import { describe, expect, it } from "vitest";
import {
  createGame,
  dealNextHandIfDue,
  MAX_MISSED_TURNS,
  normalizeGameState,
  releaseInactiveSeats,
  vacateSeat,
} from "./engine";
import { TIER_CONFIG } from "./tiers";
import type { GameState } from "./types";

/**
 * What happens to a seat when the human in it stops holding it.
 *
 * There are exactly three ways a seat goes back to the house -- the player
 * leaves (`vacateSeat`), the player stops acting (`releaseInactiveSeats`), or
 * the player runs out of chips and does not rebuy (`releaseBustedHumanSeats`,
 * reachable only through `setupHand`). All three call `restoreBotControl`,
 * which deliberately does not touch the stack, so each one has to fund the
 * replacement itself.
 *
 * Two of them always did. The third did not, and because nothing ever refunds
 * a bot the seat it left behind was dead for the rest of the table's life.
 * That is the regression these tests exist for, and the reason the last
 * describe block drives all three together rather than the one that broke:
 * the defect was an inconsistency between siblings, not a bad line in
 * isolation.
 */

/** A table where every seat is a human, so nothing moves except by a clock. */
function allHumanTable(): GameState {
  const game = createGame("seat-0-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
  game.seats.forEach((seat, index) => {
    seat.isHuman = true;
    seat.ownerToken = `seat-${index}-token`;
    seat.personality = null;
  });
  normalizeGameState(game);
  return game;
}

/** Puts a finished hand one millisecond past its next-hand deadline. */
function dueForTheNextHand(game: GameState, now: number): GameState {
  game.status = "complete";
  game.nextHandAt = new Date(now - 1).toISOString();
  return game;
}

const fundedSeats = (game: GameState) => game.seats.filter((seat) => seat.stack > 0).length;

describe("a busted seat going back to the house", () => {
  it("funds the replacement bot instead of leaving it holding nothing", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);

    dealNextHandIfDue(game, now);

    const seat = game.seats[0];
    expect(seat.isHuman).toBe(false);
    expect(seat.ownerToken).toBeNull();
    // The line that was missing. Zero here is the whole defect.
    expect(seat.stack).toBe(TIER_CONFIG["1k"].minBuyIn);
    expect(seat.status).toBe("active");
  });

  it("leaves the table with every seat still funded", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    expect(fundedSeats(game)).toBe(6);

    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);
    dealNextHandIfDue(game, now);

    expect(fundedSeats(game)).toBe(6);
  });

  it("still reports the departure to the table", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    const playerName = game.seats[0].name;
    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);

    dealNextHandIfDue(game, now);

    expect(game.log.some((entry) => entry.text.includes(playerName) && /out of chips/i.test(entry.text)))
      .toBe(true);
  });
});

describe("a table that keeps being busted out of", () => {
  /**
   * The failure this guards is cumulative, not immediate: one dead seat is
   * survivable and six is a table that cannot deal. Before the fix this walked
   * 6 -> 5 -> 4 -> 3 and then `setupHand` gave up with "Not enough players with
   * chips to continue" -- on a continuous table, with nobody having done
   * anything wrong.
   */
  it("does not lose a seat per bust", () => {
    let now = Date.now();
    const game = allHumanTable();

    for (const position of [0, 1, 2, 3]) {
      game.seats[position].stack = 0;
      dueForTheNextHand(game, now);
      dealNextHandIfDue(game, now);

      expect(fundedSeats(game)).toBe(6);
      expect(game.seats[position].isHuman).toBe(false);
      expect(game.seats[position].stack).toBe(TIER_CONFIG["1k"].minBuyIn);
      now += 1000;
    }

    // Four of six seats have changed hands and the table is still dealing.
    expect(game.status).toBe("playing");
    expect(game.message).not.toMatch(/not enough players/i);
  });
});

describe("all three release paths, together", () => {
  /**
   * Driven as one table each rather than one assertion each, because the
   * property is the same property: after any release, the seat is a funded bot.
   * A future fourth path should be added here.
   */
  it("leaves a funded bot behind, whichever way the seat is given up", () => {
    const now = Date.now();
    const minBuyIn = TIER_CONFIG["1k"].minBuyIn;

    // 1. The player leaves deliberately.
    const left = allHumanTable();
    left.seats[0].stack = 4_200;
    const { state: afterLeave, cashedOut } = vacateSeat(left, "seat-0-token");
    expect(cashedOut).toBe(4_200); // the stack goes with the player...
    expect(afterLeave.seats[0].stack).toBe(minBuyIn); // ...and the seat is refilled
    expect(afterLeave.seats[0].isHuman).toBe(false);

    // 2. The player stops acting.
    const away = allHumanTable();
    away.seats[0].stack = 3_100;
    away.seats[0].missedTurns = MAX_MISSED_TURNS;
    const released = releaseInactiveSeats(away);
    expect(released).toHaveLength(1);
    expect(released[0].cashedOut).toBe(3_100);
    expect(away.seats[0].stack).toBe(minBuyIn);
    expect(away.seats[0].isHuman).toBe(false);

    // 3. The player runs out of chips and does not rebuy. No cash-out contract
    //    here, and none needed -- the stack being zero is why we are in this
    //    branch at all.
    const busted = allHumanTable();
    busted.seats[0].stack = 0;
    dueForTheNextHand(busted, now);
    dealNextHandIfDue(busted, now);
    expect(busted.seats[0].stack).toBe(minBuyIn);
    expect(busted.seats[0].isHuman).toBe(false);
  });

  it("never leaves a released seat owned, holding a time card, or counting misses", () => {
    const now = Date.now();
    const busted = allHumanTable();
    busted.seats[0].stack = 0;
    busted.seats[0].missedTurns = 2;
    dueForTheNextHand(busted, now);

    dealNextHandIfDue(busted, now);

    const seat = busted.seats[0];
    expect(seat.ownerToken).toBeNull();
    expect(seat.timeCardsRemaining).toBe(0);
    expect(seat.missedTurns).toBe(0);
  });
});

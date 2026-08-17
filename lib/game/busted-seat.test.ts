import { describe, expect, it } from "vitest";
import {
  applyPlayerAction,
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
 * What happens to a seat when the human in it stops holding it -- and, since
 * this file was rewritten, what happens when they very much do not.
 *
 * There are two ways a seat actually goes back to the house -- the player
 * leaves (`vacateSeat`) or stops acting (`releaseInactiveSeats`). Both call
 * `restoreBotControl`, which deliberately does not touch the stack, so each
 * has to fund the replacement itself.
 *
 * Running out of chips is deliberately NOT a third way. A busted human keeps
 * their seat -- no grace period, no bot standing in for them, exactly like
 * walking away from a real table broke -- and the table deals on around them
 * at the same pace it always does, forever, until they rebuy or leave. This
 * file used to test the opposite of that; see git history if the old
 * behaviour's reasoning is ever needed again.
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

describe("a busted human", () => {
  it("keeps their own seat instead of handing it to a bot", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);

    dealNextHandIfDue(game, now);

    const seat = game.seats[0];
    expect(seat.isHuman).toBe(true);
    expect(seat.ownerToken).toBe("hero-token");
    expect(seat.stack).toBe(0);
    expect(seat.status).toBe("out");
  });

  it("does not slow the table down for anyone else", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);

    // dealNextHandIfDue only fires once its deadline is due -- the same
    // deadline as any other finished hand, bust or not. See
    // continuous-table.test.ts for the beat itself not changing length.
    dealNextHandIfDue(game, now);

    expect(game.status).toBe("playing");
  });

  it("logs the bust once, not every hand it stays busted", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    const playerName = game.seats[0].name;
    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);
    dealNextHandIfDue(game, now);
    const bustLogs = () => game.log.filter(
      (entry) => entry.text.includes(playerName) && /out of chips/i.test(entry.text),
    );
    expect(bustLogs()).toHaveLength(1);

    // A second hand comes and goes with them still sitting out...
    dueForTheNextHand(game, now + 1_000);
    dealNextHandIfDue(game, now + 1_000);

    // ...and the log has not grown a second entry for it.
    expect(bustLogs()).toHaveLength(1);
  });

  it("rebuys back into their own seat whenever they choose, no window to miss", () => {
    const now = Date.now();
    const game = createGame("hero-token", "Hero", undefined, { tier: "1k", buyIn: 1000 });
    game.seats[0].stack = 0;
    dueForTheNextHand(game, now);
    dealNextHandIfDue(game, now); // a full hand passes while they're still deciding
    dueForTheNextHand(game, now + 5_000);
    dealNextHandIfDue(game, now + 5_000); // and another
    // That hand is now in progress; they finally decide once it's over.
    game.status = "complete";

    applyPlayerAction(game, { type: "rebuy", amount: TIER_CONFIG["1k"].minBuyIn }, "hero-token");

    expect(game.seats[0].stack).toBe(TIER_CONFIG["1k"].minBuyIn);
    expect(game.seats[0].status).toBe("active");
    expect(game.status).toBe("playing"); // dealt straight back in, between hands
  });

  it("can rebuy while a hand is running for everyone else, without touching it", () => {
    const game = allHumanTable();
    // Simulates a seat that busted an earlier hand and has been sitting out
    // ever since, exactly like setupHand's own per-seat pass leaves it.
    game.seats[1].stack = 0;
    game.seats[1].status = "out";
    const currentPlayer = game.currentPlayer;
    const pot = game.pot;

    applyPlayerAction(game, { type: "rebuy", amount: TIER_CONFIG["1k"].minBuyIn }, "seat-1-token");

    expect(game.seats[1].stack).toBe(TIER_CONFIG["1k"].minBuyIn);
    // Dealt in at the next hand, not this one.
    expect(game.seats[1].status).toBe("out");
    expect(game.status).toBe("playing");
    expect(game.currentPlayer).toBe(currentPlayer);
    expect(game.pot).toBe(pot);
  });

  it("refuses a rebuy for a seat still live in the hand in progress", () => {
    const game = allHumanTable();
    // Not sitting out -- still contesting this exact hand's pot, e.g. an
    // all-in whose showdown the table hasn't reached yet. Only reachable via
    // the API directly; the client never offers Rebuy in this state.
    game.seats[1].stack = 0;
    game.seats[1].status = "all-in";

    expect(() => applyPlayerAction(
      game,
      { type: "rebuy", amount: TIER_CONFIG["1k"].minBuyIn },
      "seat-1-token",
    )).toThrow(/finish/i);
  });
});

describe("a table where a human keeps busting", () => {
  /**
   * The failure the old version of this test guarded against doesn't apply
   * any more -- a busted human was never what threatened to strand a
   * continuous table; busted *bots* were (see continuous-table.test.ts).
   * What still matters here: busting several different humans in a row
   * keeps the table dealing, at the normal pace, with each of them sitting
   * out their own seat rather than any of it stalling.
   */
  it("keeps dealing at the normal pace no matter how many seats are sat out busted", () => {
    let now = Date.now();
    const game = allHumanTable();

    for (const position of [0, 1, 2, 3]) {
      game.seats[position].stack = 0;
      dueForTheNextHand(game, now);
      dealNextHandIfDue(game, now);

      expect(game.seats[position].isHuman).toBe(true);
      expect(game.seats[position].status).toBe("out");
      now += 1_000;
    }

    // Four of six seats are sitting out busted and the table is still
    // dealing to the other two.
    expect(game.status).toBe("playing");
    expect(game.message).not.toMatch(/not enough players/i);
    expect(fundedSeats(game)).toBe(2);
  });
});

describe("the two release paths that do hand a seat to a bot", () => {
  it("leaves a funded bot behind, whichever way the seat is given up", () => {
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
  });
});

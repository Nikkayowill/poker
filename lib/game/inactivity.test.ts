import { describe, expect, it } from "vitest";
import {
  advanceTimedTurn,
  applyPlayerAction,
  createGame,
  dealNextHandIfDue,
  MAX_MISSED_TURNS,
  normalizeGameState,
  releaseInactiveSeats,
  scheduleNextHand,
  TURN_TIMEOUT_MS,
} from "./engine";
import { TIER_CONFIG } from "./tiers";
import type { GameState } from "./types";

/**
 * Inactivity: counting it, and giving the seat back.
 *
 * The behaviour that needs guarding hardest is not the counter, it is the
 * settlement. restoreBotControl leaves the stack where it is, so a release
 * that failed to report the balance would quietly hand a player's chips to
 * the bot that replaced them -- and nothing would throw, log, or look wrong.
 */

/** Every seat human, so nothing moves except by an explicit action or a clock. */
function allHumanTable(): GameState {
  const game = createGame("seat-0-token", "Hero");
  game.seats.forEach((seat, index) => {
    seat.isHuman = true;
    seat.ownerToken = `seat-${index}-token`;
    seat.personality = null;
  });
  normalizeGameState(game);
  return game;
}

/** Lets the seat on turn run its clock out, once. */
function letTheClockExpire(game: GameState): GameState {
  const deadline = Date.parse(game.turnDeadlineAt ?? "");
  return advanceTimedTurn(game, deadline + 1).state;
}

describe("counting missed turns", () => {
  it("starts every seat at zero", () => {
    const game = allHumanTable();
    game.seats.forEach((seat) => expect(seat.missedTurns).toBe(0));
  });

  it("counts a human's expired clock", () => {
    const game = allHumanTable();
    const seatId = game.seats[game.currentPlayer!].id;
    letTheClockExpire(game);
    expect(game.seats.find((seat) => seat.id === seatId)!.missedTurns).toBe(1);
  });

  it("does not count a bot, which has no attention to lose", () => {
    // Put a known bot on the clock rather than playing until one turns up:
    // a loop that only asserts when it happens to find a bot is a test that
    // can quietly assert nothing at all.
    const game = createGame("seat-0-token", "Hero");
    const botIndex = game.seats.findIndex((seat) => !seat.isHuman);
    expect(botIndex).toBeGreaterThan(-1);
    game.currentPlayer = botIndex;
    game.turnStartedAt = new Date(Date.now() - 5_000).toISOString();
    game.turnDeadlineAt = new Date(Date.now() - 1).toISOString();

    const advanced = advanceTimedTurn(game, Date.now());
    expect(advanced.action).not.toBeNull();
    expect(advanced.timedOut).toBe(false);
    expect(game.seats[botIndex].missedTurns).toBe(0);
  });

  it("resets the moment the player acts again", () => {
    // The seat already on the clock, carrying a count, acting deliberately.
    // Walking the table back round to them meant the hand could end first,
    // and the version that did that had to bail out without asserting.
    const game = allHumanTable();
    const seatIndex = game.currentPlayer!;
    const seat = game.seats[seatIndex];
    seat.missedTurns = MAX_MISSED_TURNS - 1;

    applyPlayerAction(
      game,
      seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" },
      seat.ownerToken!,
    );
    expect(seat.missedTurns).toBe(0);
  });

  it("resets when a time card is spent, which is also being present", () => {
    const game = allHumanTable();
    const seat = game.seats[game.currentPlayer!];
    seat.missedTurns = MAX_MISSED_TURNS - 1;
    // allHumanTable promotes bot seats without a time bank; only the original
    // human seat is dealt one, and the first to act preflop is not that seat.
    seat.timeCardsRemaining = 1;
    applyPlayerAction(game, { type: "use-time-card" }, seat.ownerToken!);
    expect(seat.missedTurns).toBe(0);
  });

  it("counts consecutively across hands, not within one", () => {
    // A player who has walked away misses one turn per hand, so a counter
    // that reset each deal would never reach any threshold at all.
    const game = allHumanTable();
    const seat = game.seats[0];
    seat.missedTurns = 2;
    scheduleNextHand(game, Date.now());
    game.status = "complete";
    game.nextHandAt = new Date(Date.now() - 1).toISOString();
    dealNextHandIfDue(game, Date.now());
    // The seat was released at 2 < 3, so the count survives the new deal.
    expect(game.seats[0].missedTurns).toBe(2);
  });
});

describe("giving the seat back", () => {
  it("releases nobody below the threshold", () => {
    const game = allHumanTable();
    game.seats[0].missedTurns = MAX_MISSED_TURNS - 1;
    expect(releaseInactiveSeats(game)).toEqual([]);
    expect(game.seats[0].isHuman).toBe(true);
  });

  it("hands the seat to a bot at the threshold", () => {
    const game = allHumanTable();
    game.seats[0].missedTurns = MAX_MISSED_TURNS;
    const released = releaseInactiveSeats(game);

    expect(released).toHaveLength(1);
    expect(released[0].ownerToken).toBe("seat-0-token");
    expect(game.seats[0].isHuman).toBe(false);
    expect(game.seats[0].ownerToken).toBeNull();
    expect(game.seats[0].missedTurns).toBe(0);
  });

  it("reports the whole stack so it can be paid back", () => {
    // The defect this exists to prevent: restoreBotControl leaves the stack
    // alone, so a release that did not report the balance would hand those
    // chips to the replacement bot and nothing anywhere would complain.
    const game = allHumanTable();
    game.seats[0].missedTurns = MAX_MISSED_TURNS;
    game.seats[0].stack = 4_820;

    const released = releaseInactiveSeats(game);
    expect(released[0].cashedOut).toBe(4_820);
    // And the seat does not keep them as well, or every departure mints chips.
    expect(game.seats[0].stack).toBe(TIER_CONFIG[game.tier].minBuyIn);
  });

  it("releases several absent seats in one pass", () => {
    const game = allHumanTable();
    game.seats[0].missedTurns = MAX_MISSED_TURNS;
    game.seats[3].missedTurns = MAX_MISSED_TURNS + 2;
    game.seats[4].missedTurns = 1;

    const released = releaseInactiveSeats(game);
    expect(released.map((seat) => seat.ownerToken).sort()).toEqual(
      ["seat-0-token", "seat-3-token"],
    );
    expect(game.seats[4].isHuman).toBe(true);
  });

  it("never releases a bot seat, whatever its counter says", () => {
    const game = createGame("seat-0-token", "Hero");
    game.seats[2].missedTurns = 99;
    expect(releaseInactiveSeats(game)).toEqual([]);
  });

  it("releases on the deal, and reports it through dealNextHandIfDue", () => {
    const game = allHumanTable();
    game.seats[0].missedTurns = MAX_MISSED_TURNS;
    game.seats[0].stack = 1_500;
    game.status = "complete";
    game.nextHandAt = new Date(Date.now() - 1).toISOString();

    const result = dealNextHandIfDue(game, Date.now());
    expect(result.dealt).toBe(true);
    expect(result.released).toHaveLength(1);
    expect(result.released[0].cashedOut).toBe(1_500);
  });

  it("reports nothing when no hand is dealt", () => {
    const game = allHumanTable();
    game.seats[0].missedTurns = MAX_MISSED_TURNS;
    // Still playing: not a moment to release anyone, because a bot would
    // inherit chips already committed to this pot.
    const result = dealNextHandIfDue(game, Date.now());
    expect(result.dealt).toBe(false);
    expect(result.released).toEqual([]);
    expect(game.seats[0].isHuman).toBe(true);
  });
});

describe("reaching the threshold by actually running out of time", () => {
  it("takes exactly MAX_MISSED_TURNS expired clocks and no fewer", () => {
    const game = allHumanTable();
    const seatIndex = game.currentPlayer!;
    const token = game.seats[seatIndex].ownerToken!;

    let expiries = 0;
    for (let guard = 0; guard < 60 && expiries < MAX_MISSED_TURNS; guard += 1) {
      if (game.status !== "playing") {
        game.nextHandAt = new Date(Date.now() - 1).toISOString();
        const dealt = dealNextHandIfDue(game, Date.now());
        if (!dealt.dealt) break;
        continue;
      }
      if (game.currentPlayer === seatIndex) {
        letTheClockExpire(game);
        expiries += 1;
      } else {
        const seat = game.seats[game.currentPlayer!];
        applyPlayerAction(
          game,
          seat.streetBet === game.currentBet ? { type: "check" } : { type: "call" },
          seat.ownerToken!,
        );
      }
    }

    expect(expiries).toBe(MAX_MISSED_TURNS);
    const seat = game.seats.find((candidate) => candidate.ownerToken === token);
    // Still seated: the release happens on the next deal, not mid-hand.
    expect(seat?.missedTurns).toBe(MAX_MISSED_TURNS);
    expect(TURN_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("tables persisted before inactivity was tracked", () => {
  it("reads a missing counter as zero rather than as undefined", () => {
    const game = allHumanTable();
    const legacy: Record<string, unknown> = { ...game };
    (legacy.seats as Array<Record<string, unknown>>).forEach((seat) => delete seat.missedTurns);

    const normalized = normalizeGameState(legacy as unknown as GameState);
    normalized.seats.forEach((seat) => expect(seat.missedTurns).toBe(0));
    // undefined >= 3 is false, so nobody would ever be released -- silently.
    expect(releaseInactiveSeats(normalized)).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceTimedTurn,
  applyPlayerAction,
  dealNextHandIfDue,
  claimSeat,
  createGame,
  NEXT_HAND_DELAY_MS,
  normalizeGameState,
  scheduleNextHand,
  vacateSeat,
} from "./engine";
import { planTurnClock, type TurnClockInput } from "./turn-clock";
import type { GameState } from "./types";
import { defaultEquipped } from "@/lib/cosmetics/catalog";

/**
 * Continuous play, which is one deadline and one branch.
 *
 * The behaviour these lock down is not "a hand ends and another starts" --
 * that already worked when a player pressed Deal. It is that a finished hand
 * carries a deadline, that the deadline is honoured exactly once and only
 * when it is due, and that the one state where a table must NOT deal itself
 * at all is still respected: nobody left with chips to play. A human busting
 * is not one of these states any more -- see busted-seat.test.ts -- their
 * seat just sits out and the table keeps to the same beat regardless.
 */

const profile = (name: string) => ({
  id: crypto.randomUUID(),
  isRegistered: true,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  accent: "#79c9ff",
  avatarUrl: null,
  avatarPreset: "ace" as const,
  equipped: defaultEquipped,
});

function tableWithTwoHumans() {
  const tokens = [crypto.randomUUID(), crypto.randomUUID()];
  let game = createGame(tokens[0], "Player 1");
  game = claimSeat(game, tokens[1], profile("Player 2")).state;
  return { game, tokens };
}

/** Folds every seat but one, which is the shortest route to a finished hand. */
function foldToOneWinner(start: GameState): GameState {
  let game = start;
  for (let guard = 0; guard < 40 && game.status === "playing"; guard += 1) {
    const index = game.currentPlayer;
    if (index === null) break;
    const seat = game.seats[index];
    if (!seat.isHuman || !seat.ownerToken) {
      game = advanceTimedTurn(game, Date.parse(game.turnDeadlineAt ?? "") + 1).state;
      continue;
    }
    game = applyPlayerAction(game, { type: "fold" }, seat.ownerToken);
  }
  return game;
}

describe("a finished hand schedules the next one", () => {
  it("writes a deadline the moment the hand completes", () => {
    const before = Date.now();
    const game = foldToOneWinner(tableWithTwoHumans().game);
    expect(game.status).toBe("complete");

    const due = Date.parse(game.nextHandAt ?? "");
    expect(Number.isFinite(due)).toBe(true);
    expect(due).toBeGreaterThanOrEqual(before + NEXT_HAND_DELAY_MS);
    expect(due).toBeLessThanOrEqual(Date.now() + NEXT_HAND_DELAY_MS + 50);
  });

  it("does nothing at all before the deadline", () => {
    const game = foldToOneWinner(tableWithTwoHumans().game);
    const due = Date.parse(game.nextHandAt ?? "");
    const handNumber = game.handNumber;
    const version = game.version;

    const early = dealNextHandIfDue(game, due - 1).state;
    expect(early.status).toBe("complete");
    expect(early.handNumber).toBe(handNumber);
    // Version untouched, because a no-op that bumps the version wakes every
    // other browser over the broadcast for nothing.
    expect(early.version).toBe(version);
  });

  it("deals the next hand once the deadline passes", () => {
    const game = foldToOneWinner(tableWithTwoHumans().game);
    const due = Date.parse(game.nextHandAt ?? "");
    const handNumber = game.handNumber;
    // Captured, not read back off `game` afterwards: the engine mutates the
    // state in place and returns the same object, so `game` IS `dealt`.
    const version = game.version;

    const dealt = dealNextHandIfDue(game, due).state;
    expect(dealt.status).toBe("playing");
    expect(dealt.handNumber).toBe(handNumber + 1);
    expect(dealt.version).toBeGreaterThan(version);
    // Cleared, or the next call would deal again on the stale deadline.
    expect(dealt.nextHandAt).toBeNull();
    expect(dealt.turnDeadlineAt).not.toBeNull();
  });

  it("keeps dealing, hand after hand, with no player input", () => {
    let game = tableWithTwoHumans().game;
    const first = game.handNumber;
    for (let hand = 0; hand < 3; hand += 1) {
      game = foldToOneWinner(game);
      expect(game.status).toBe("complete");
      game = dealNextHandIfDue(game, Date.parse(game.nextHandAt ?? "")).state;
    }
    expect(game.handNumber).toBe(first + 3);
    expect(game.status).toBe("playing");
  });
});

describe("the table that must not deal itself", () => {
  it("refills busted bots and keeps dealing rather than stalling the table", () => {
    const { game: started, tokens } = tableWithTwoHumans();
    const game = foldToOneWinner(started);
    // One human, and every other seat ground down to nothing. This used to be
    // the state setupHand refused -- one funded seat -- because nothing ever
    // refunded a bot, so a table walked 6 -> 5 -> 4 and stopped for good.
    // Busted bots are now released and reseated at the head of setupHand, so
    // the table plays on.
    const afterLeave = vacateSeat({ ...game, status: "complete" }, tokens[1]).state;
    const finished: GameState = {
      ...afterLeave,
      seats: afterLeave.seats.map((seat, index) => (index === 0 ? seat : { ...seat, stack: 0 })),
    };

    // Guards the ordering, which is the part that is easy to get wrong:
    // scheduleNextHand runs at hand end, *before* the refill, so counting only
    // seats funded at that instant would null the deadline and leave the table
    // stalled forever on a refill it never reached.
    scheduleNextHand(finished);
    expect(finished.nextHandAt).not.toBeNull();

    const settled = dealNextHandIfDue(
      { ...finished, nextHandAt: new Date(Date.now() - 1).toISOString() },
      Date.now(),
    ).state;
    expect(settled.status).toBe("playing");
    expect(settled.seats.filter((seat) => seat.stack > 0).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Driven directly rather than by playing a hand out. Reaching "a human is
   * all in, loses, and ends on nothing" through real play depends on the
   * cards, so the test that did it that way had to bail out when the setup
   * did not happen -- and a test that can decline to assert is not a test.
   */
  describe("the delay itself", () => {
    const NOW = Date.parse("2026-07-31T12:00:00.000Z");
    const withStacks = (stacks: Array<{ stack: number; isHuman: boolean }>): GameState => {
      const base = tableWithTwoHumans().game;
      return {
        ...base,
        seats: stacks.map((entry, index) => ({
          ...base.seats[index % base.seats.length],
          id: `seat-${index}`,
          stack: entry.stack,
          isHuman: entry.isHuman,
          ownerToken: entry.isHuman ? `token-${index}` : null,
        })),
      };
    };

    it("waits the normal beat when everyone still has chips", () => {
      const state = withStacks([
        { stack: 900, isHuman: true },
        { stack: 1_100, isHuman: false },
      ]);
      scheduleNextHand(state, NOW);
      expect(state.nextHandAt).toBe(new Date(NOW + NEXT_HAND_DELAY_MS).toISOString());
    });

    it("does not extend the wait when a human has just lost their last chip", () => {
      // No grace period any more: their seat sits out, same as any other
      // unfunded seat, and everyone else keeps to the normal beat regardless.
      const state = withStacks([
        { stack: 0, isHuman: true },
        { stack: 1_000, isHuman: false },
        { stack: 1_000, isHuman: false },
      ]);
      scheduleNextHand(state, NOW);
      expect(state.nextHandAt).toBe(new Date(NOW + NEXT_HAND_DELAY_MS).toISOString());
    });

    it("does not extend the wait for a busted bot", () => {
      // Nor a bot's -- nobody is waiting on anything, ever.
      const state = withStacks([
        { stack: 900, isHuman: true },
        { stack: 1_100, isHuman: false },
        { stack: 0, isHuman: false },
      ]);
      scheduleNextHand(state, NOW);
      expect(state.nextHandAt).toBe(new Date(NOW + NEXT_HAND_DELAY_MS).toISOString());
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("schedules nothing when only one seat still has chips and none can refill", () => {
      // The floor is dropped to 1 so the busted bot is not topped back up.
      // At the shipped floor of 4 this table refills and deals, which is the
      // point of the floor -- but the branch being locked down here is the
      // other one: when nothing *can* be refilled, a table that cannot deal
      // must not leave a deadline behind, or every seated browser wakes at it,
      // asks the server to advance, and is told the same thing forever.
      vi.stubEnv("RIVER_TABLE_FUNDED_FLOOR", "1");
      const state = withStacks([
        { stack: 2_000, isHuman: true },
        { stack: 0, isHuman: false },
      ]);
      state.nextHandAt = new Date(NOW).toISOString();
      scheduleNextHand(state, NOW);
      expect(state.nextHandAt).toBeNull();
    });
  });
});

describe("the browser clock between hands", () => {
  const NOW = Date.parse("2026-07-31T12:00:00.000Z");
  const at = (offset: number) => new Date(NOW + offset).toISOString();
  const input = (over: Partial<TurnClockInput> = {}): TurnClockInput => ({
    isSeated: true,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentIsHuman: false,
    currentIsMine: false,
    myHumanRank: 0,
    ...over,
  });

  it("waits for the next hand when no turn is running", () => {
    // Previously "no turn deadline" meant idle, which is exactly why a
    // finished table sat there until somebody pressed Deal.
    const plan = planTurnClock(input({ nextHandAt: at(4_000) }), NOW);
    expect(plan).toEqual({ kind: "advance-at", delayMs: 4_000, rank: 0 });
  });

  it("still rests when there is nothing to wait for", () => {
    expect(planTurnClock(input(), NOW).kind).toBe("idle");
  });

  it("keeps the backup queue between hands, so a closed tab is covered", () => {
    const plan = planTurnClock(input({ nextHandAt: at(4_000), myHumanRank: 2 }), NOW);
    expect(plan.kind).toBe("advance-at");
    if (plan.kind === "advance-at") expect(plan.delayMs).toBeGreaterThan(4_000);
  });

  it("prefers a live turn deadline over a stale next-hand one", () => {
    const plan = planTurnClock(
      input({ turnDeadlineAt: at(1_000), nextHandAt: at(9_000) }),
      NOW,
    );
    expect(plan).toEqual({ kind: "advance-at", delayMs: 1_000, rank: 0 });
  });
});

describe("tables persisted before continuous play", () => {
  it("reads a missing deadline as null rather than dealing immediately", () => {
    const game = foldToOneWinner(tableWithTwoHumans().game);
    const legacy: Record<string, unknown> = { ...game };
    delete legacy.nextHandAt;

    const normalized = normalizeGameState(legacy as unknown as GameState);
    expect(normalized.nextHandAt).toBeNull();
    // And with no deadline, the timed advance leaves it exactly as it was.
    expect(dealNextHandIfDue(normalized, Date.now() + 60_000).dealt).toBe(false);
    expect(normalized.status).toBe("complete");
  });
});

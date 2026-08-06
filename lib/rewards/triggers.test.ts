import { describe, expect, it } from "vitest";
import type { GameSnapshot, PublicSeat, Winner } from "@/lib/game/types";
import {
  BIG_POT_BIG_BLINDS,
  WIN_STREAK_MILESTONE,
  advanceRewardWatch,
  initialRewardWatchState,
  type RewardWatchInput,
  type RewardWatchState,
} from "./triggers";

const CHEAPEST_BUY_IN = 1000;

function seat(overrides: Partial<PublicSeat> = {}): PublicSeat {
  return {
    id: "seat-mine",
    name: "You",
    initials: "YO",
    accent: "#e7c66a",
    avatarUrl: null,
    avatarPreset: "ace",
    avatarCosmetic: "default",
    cardBackCosmetic: "default",
    position: 0,
    isHuman: true,
    profileId: "profile-1",
    botIdentity: null,
    personality: null,
    stack: 900,
    status: "active",
    holeCards: [],
    streetBet: 0,
    committed: 0,
    acted: false,
    actedAtBet: null,
    lastAction: null,
    timeCardsRemaining: 3,
    missedTurns: 0,
    vpip: false,
    reseatEligibleAt: null,
    handLabel: null,
    isDealer: false,
    isCurrent: false,
    isSmallBlind: false,
    isBigBlind: false,
    isMine: true,
    isOpen: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "table-1",
    isPrivate: false,
    roomCode: null,
    tier: "1k",
    rake: 0,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 0,
    smallBlind: 5,
    bigBlind: 10,
    currentPlayer: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 0,
    minRaise: 10,
    pot: 0,
    community: [],
    seats: [seat()],
    winners: [],
    log: [],
    message: "",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    legalActions: null,
    isSeated: true,
    ...overrides,
  } as GameSnapshot;
}

function win(amount: number): Winner {
  return { seatId: "seat-mine", name: "You", amount, hand: "Two pair", bestFive: null };
}

function input(overrides: Partial<RewardWatchInput> = {}): RewardWatchInput {
  return {
    previous: null,
    next: null,
    goldBalance: 5000,
    unlimitedGold: false,
    cheapestBuyIn: CHEAPEST_BUY_IN,
    ...overrides,
  };
}

/** Runs a sequence of observations and collects every trigger kind that fired. */
function run(steps: Array<Partial<RewardWatchInput>>, from: RewardWatchState = initialRewardWatchState) {
  let state = from;
  const fired: string[] = [];
  for (const step of steps) {
    const result = advanceRewardWatch(state, input(step));
    state = result.state;
    if (result.trigger) fired.push(result.trigger.kind);
  }
  return { state, fired };
}

describe("advanceRewardWatch", () => {
  it("says nothing on an ordinary observation", () => {
    const { trigger } = advanceRewardWatch(initialRewardWatchState, input({ next: snapshot() }));
    expect(trigger).toBeNull();
  });

  describe("running out of Gold", () => {
    it("fires on the crossing", () => {
      const { fired } = run([
        { goldBalance: 5000, next: snapshot() },
        { goldBalance: 400, previous: snapshot(), next: snapshot() },
      ]);
      expect(fired).toEqual(["low-gold"]);
    });

    it("fires once, not on every render below the line", () => {
      // The whole reason these rules are edge-triggered: a level-triggered
      // version reopens the modal the instant the player dismisses it.
      const { fired } = run([
        { goldBalance: 5000, next: snapshot() },
        { goldBalance: 400, previous: snapshot(), next: snapshot() },
        { goldBalance: 400, previous: snapshot(), next: snapshot() },
        { goldBalance: 300, previous: snapshot(), next: snapshot() },
        { goldBalance: 0, previous: snapshot(), next: snapshot() },
      ]);
      expect(fired).toEqual(["low-gold"]);
    });

    it("fires for a player who arrives already broke", () => {
      // previous === null is the first observation of the session. Waiting for
      // a crossing that happened before the page loaded would mean the one
      // player who most needs the offer never sees it.
      const { fired } = run([{ goldBalance: 0, previous: null, next: null }]);
      expect(fired).toEqual(["low-gold"]);
    });

    it("does not fire while the balance covers the cheapest seat", () => {
      const { fired } = run([
        { goldBalance: CHEAPEST_BUY_IN, previous: null, next: null },
        { goldBalance: CHEAPEST_BUY_IN, previous: snapshot(), next: snapshot() },
      ]);
      expect(fired).toEqual([]);
    });

    it("stays silent before the profile has loaded", () => {
      // A null balance is "not known yet", not "zero". Treating it as broke
      // would greet every cold load with a modal.
      const { fired } = run([{ goldBalance: null, previous: null, next: null }]);
      expect(fired).toEqual([]);
    });
  });

  describe("unlimited Gold", () => {
    it("is never offered anything", () => {
      // spendGold never deducts from such a profile, so a credit means nothing
      // and the offer would be 30 seconds for a number that cannot move.
      const { fired } = run([
        { unlimitedGold: true, goldBalance: 0, previous: null, next: null },
        {
          unlimitedGold: true,
          goldBalance: 0,
          previous: snapshot(),
          next: snapshot({ handNumber: 2, winners: [win(5000)] }),
        },
      ]);
      expect(fired).toEqual([]);
    });
  });

  describe("achievements", () => {
    /**
     * A finished hand. `amount` of 0 means somebody else took it -- a settled
     * hand always has a winner, so an empty `winners` is a hand still in play,
     * not a hand the player lost.
     */
    const settled = (handNumber: number, amount: number) =>
      snapshot({
        handNumber,
        winners: amount > 0
          ? [win(amount)]
          : [{ seatId: "seat-other", name: "Bot", amount: 120, hand: "Flush", bestFive: null }],
      });

    it("marks the first pot of the session", () => {
      const { fired } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: settled(1, 50) },
      ]);
      expect(fired).toEqual(["first-win"]);
    });

    it("prefers the bigger milestone when a first win is also a big pot", () => {
      const big = BIG_POT_BIG_BLINDS * 10; // bigBlind is 10 in the fixture
      const { fired } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: settled(1, big) },
      ]);
      expect(fired).toEqual(["big-pot"]);
    });

    it("still offers the first-win milestone later, having only spent big-pot", () => {
      // Each branch marks its own kind, so announcing one does not silently
      // consume the other.
      const big = BIG_POT_BIG_BLINDS * 10;
      const { fired } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: settled(1, big) },
        { previous: settled(1, big), next: settled(2, 30) },
      ]);
      expect(fired).toEqual(["big-pot", "first-win"]);
    });

    it("counts a streak and fires at the milestone", () => {
      const steps: Array<Partial<RewardWatchInput>> = [{ previous: null, next: snapshot() }];
      for (let hand = 1; hand <= WIN_STREAK_MILESTONE; hand += 1) {
        steps.push({ previous: settled(hand - 1, 0), next: settled(hand, 30) });
      }
      const { fired, state } = run(steps);
      expect(state.winStreak).toBe(WIN_STREAK_MILESTONE);
      expect(fired).toContain("win-streak");
    });

    it("does not count the same hand twice when a snapshot arrives again", () => {
      // A Realtime invalidation and a poll can both land for one hand; ingest
      // keeps the newer version without deduplicating identical ones.
      const { state } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: settled(1, 30) },
        { previous: settled(1, 30), next: settled(1, 30) },
        { previous: settled(1, 30), next: settled(1, 30) },
      ]);
      expect(state.winStreak).toBe(1);
    });

    it("breaks a streak on a hand the player contested and lost", () => {
      const { state } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: settled(1, 30) },
        { previous: settled(1, 30), next: settled(2, 0) },
      ]);
      expect(state.winStreak).toBe(0);
    });

    it("leaves a streak alone across a hand the player sat out", () => {
      // An "out" seat was not in the hand. Resetting on it would wipe a streak
      // over the two hands a rebuy takes.
      const sittingOut = snapshot({
        handNumber: 2,
        winners: [{ seatId: "seat-other", name: "Bot", amount: 90, hand: "Flush", bestFive: null }],
        seats: [seat({ status: "out" })],
      });
      const { state } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: settled(1, 30) },
        { previous: settled(1, 30), next: sittingOut },
      ]);
      expect(state.winStreak).toBe(1);
    });

    it("ignores a pot won by somebody else", () => {
      const theirs = snapshot({
        handNumber: 2,
        winners: [{ seatId: "seat-other", name: "Bot", amount: 500, hand: "Flush", bestFive: null }],
      });
      const { fired } = run([
        { previous: null, next: snapshot() },
        { previous: snapshot(), next: theirs },
      ]);
      expect(fired).toEqual([]);
    });
  });

  describe("copy", () => {
    it("keeps every headline short enough for the modal's one line", () => {
      // Same reasoning as dealerLine's 28-character cap and the removed
      // per-seat status pills: variable-length prose is what clipped before.
      const cases: Array<Partial<RewardWatchInput>> = [
        { goldBalance: 0, previous: null, next: null },
        { previous: snapshot(), next: snapshot({ handNumber: 1, winners: [win(30)] }) },
        { previous: snapshot(), next: snapshot({ handNumber: 1, winners: [win(9000)] }) },
      ];
      for (const step of cases) {
        const { trigger } = advanceRewardWatch(initialRewardWatchState, input(step));
        expect(trigger).not.toBeNull();
        expect(trigger!.headline.length).toBeLessThanOrEqual(28);
        expect(trigger!.detail.length).toBeLessThanOrEqual(90);
      }
    });
  });
});

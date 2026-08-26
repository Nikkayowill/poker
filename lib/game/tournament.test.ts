import { describe, expect, it } from "vitest";
import { blindLevelForHand, forfeitTournamentSeat } from "./tournament";
import type { GameState, Seat } from "./types";

const BASE = { smallBlind: 25, bigBlind: 50 };

describe("blindLevelForHand", () => {
  it("starts at level 0, the tier's own blinds, on hand 1", () => {
    expect(blindLevelForHand(1, BASE)).toEqual({ level: 0, smallBlind: 25, bigBlind: 50 });
  });

  it("holds the previous level for every hand before the next threshold", () => {
    expect(blindLevelForHand(5, BASE)).toEqual({ level: 0, smallBlind: 25, bigBlind: 50 });
  });

  it("steps up exactly on the threshold hand, not one early or late", () => {
    expect(blindLevelForHand(6, BASE)).toEqual({ level: 1, smallBlind: 50, bigBlind: 100 });
  });

  it("reaches its final level by hand 46", () => {
    expect(blindLevelForHand(46, BASE)).toEqual({ level: 9, smallBlind: 800, bigBlind: 1600 });
  });

  it("holds the final level indefinitely past its own threshold", () => {
    expect(blindLevelForHand(200, BASE)).toEqual({ level: 9, smallBlind: 800, bigBlind: 1600 });
  });

  it("handles a hand number of 0 the same as hand 1", () => {
    // dealNextHandIfDue/normalizeGameState never actually produce 0, but the
    // function shouldn't throw or return a negative level for it either.
    expect(blindLevelForHand(0, BASE)).toEqual({ level: 0, smallBlind: 25, bigBlind: 50 });
  });
});

function makeSeat(overrides: Partial<Seat> = {}): Seat {
  return {
    id: "seat-0",
    name: "Hero",
    initials: "HE",
    accent: "#000",
    avatarUrl: null,
    avatarPreset: "ace",
    avatarCosmetic: "default",
    cardBackCosmetic: "default",
    position: 0,
    isHuman: true,
    ownerToken: "token-0",
    profileId: "profile-0",
    botIdentity: null,
    personality: null,
    stack: 1000,
    status: "active",
    holeCards: [],
    streetBet: 0,
    committed: 0,
    acted: false,
    actedAtBet: null,
    lastAction: null,
    missedTurns: 0,
    vpip: false,
    reseatEligibleAt: null,
    ...overrides,
  };
}

function makeState(seats: Seat[]): GameState {
  return {
    id: "game-0",
    hostToken: "token-0",
    isPrivate: true,
    roomCode: null,
    tier: "1k",
    rake: 0,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 3,
    buttonPosition: 0,
    smallBlind: 25,
    bigBlind: 50,
    currentPlayer: 0,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 0,
    minRaise: 50,
    pot: 0,
    deck: [],
    community: [],
    seats,
    winners: [],
    log: [],
    message: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tournament: {
      entryFee: 1000,
      startingStack: 1000,
      blindLevel: 0,
      finishedAtHand: null,
      winnerProfileId: null,
    },
  };
}

describe("forfeitTournamentSeat", () => {
  it("zeroes the stack and marks the seat out", () => {
    const state = makeState([makeSeat({ stack: 4000, status: "active" })]);
    forfeitTournamentSeat(state, 0);
    expect(state.seats[0].stack).toBe(0);
    expect(state.seats[0].status).toBe("out");
  });

  it("never hands the seat to a bot -- ownerToken and isHuman are untouched", () => {
    const state = makeState([makeSeat({ ownerToken: "token-0", isHuman: true })]);
    forfeitTournamentSeat(state, 0);
    expect(state.seats[0].ownerToken).toBe("token-0");
    expect(state.seats[0].isHuman).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { applyOptimisticAction } from "./optimistic-action";
import type { GameSnapshot, LegalActions, PublicSeat } from "./types";

function seat(overrides: Partial<PublicSeat> = {}): PublicSeat {
  return {
    id: "seat-0",
    name: "Hero",
    initials: "H",
    accent: "purple",
    avatarUrl: null,
    avatarPreset: "default",
    avatarCosmetic: "default",
    cardBackCosmetic: "default",
    position: 0,
    isHuman: true,
    profileId: null,
    botIdentity: null,
    personality: null,
    stack: 1000,
    status: "active",
    holeCards: [null, null],
    streetBet: 0,
    committed: 0,
    acted: false,
    actedAtBet: null,
    lastAction: null,
    missedTurns: 0,
    vpip: false,
    reseatEligibleAt: null,
    handLabel: null,
    isDealer: false,
    isCurrent: true,
    isSmallBlind: false,
    isBigBlind: false,
    isMine: true,
    isOpen: false,
    ...overrides,
  };
}

function legalActions(overrides: Partial<LegalActions> = {}): LegalActions {
  return {
    canFold: true,
    canCheck: false,
    canCall: true,
    canRaise: true,
    canAllIn: true,
    toCall: 100,
    callAmount: 100,
    minRaiseTo: 200,
    maxRaiseTo: 1000,
    ...overrides,
  };
}

function game(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "game-1",
    isPrivate: false,
    roomCode: null,
    tier: "1k",
    rake: 0,
    version: 5,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 0,
    smallBlind: 25,
    bigBlind: 50,
    currentPlayer: 0,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 100,
    minRaise: 50,
    pot: 150,
    community: [],
    seats: [seat()],
    winners: [],
    log: [],
    message: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    legalActions: legalActions(),
    isSeated: true,
    tournament: null,
    ...overrides,
  };
}

describe("applyOptimisticAction", () => {
  it("returns the same snapshot unchanged when it's not my turn", () => {
    const g = game({ legalActions: null });
    expect(applyOptimisticAction(g, { type: "call" })).toBe(g);
  });

  it("returns null when there is no game to predict against", () => {
    expect(applyOptimisticAction(null, { type: "call" })).toBeNull();
  });

  it("folds the caller's own seat immediately, moving no chips", () => {
    const g = game();
    const next = applyOptimisticAction(g, { type: "fold" });
    expect(next?.seats[0].status).toBe("folded");
    expect(next?.pot).toBe(g.pot);
    expect(next?.seats[0].stack).toBe(g.seats[0].stack);
  });

  it("commits the call amount to the caller's streetBet and stack, and bumps pot by the same delta -- preserving pot - Σ streetBet", () => {
    const g = game();
    const next = applyOptimisticAction(g, { type: "call" })!;
    expect(next.seats[0].streetBet).toBe(100);
    expect(next.seats[0].committed).toBe(100);
    expect(next.seats[0].stack).toBe(900);
    expect(next.pot).toBe(250); // 150 + 100
    expect(next.legalActions).toBeNull();

    const potInvariant = (snap: GameSnapshot) =>
      snap.pot - snap.seats.reduce((sum, s) => sum + s.streetBet, 0);
    expect(potInvariant(next)).toBe(potInvariant(g));
  });

  it("commits exactly the requested raise, capped at maxRaiseTo", () => {
    const g = game();
    const next = applyOptimisticAction(g, { type: "raise", amount: 400 })!;
    expect(next.seats[0].streetBet).toBe(400);
    expect(next.seats[0].stack).toBe(600);
    expect(next.pot).toBe(550); // 150 + 400

    const over = applyOptimisticAction(g, { type: "raise", amount: 5000 })!;
    expect(over.seats[0].streetBet).toBe(1000); // clamped to maxRaiseTo
  });

  it("shoves the caller's entire remaining stack and marks the seat all-in", () => {
    const g = game();
    const next = applyOptimisticAction(g, { type: "all-in" })!;
    expect(next.seats[0].streetBet).toBe(1000);
    expect(next.seats[0].stack).toBe(0);
    expect(next.seats[0].status).toBe("all-in");
  });

  it("leaves check, and non-turn actions like rebuy, untouched", () => {
    const g = game();
    expect(applyOptimisticAction(g, { type: "check" })).toBe(g);
    expect(applyOptimisticAction(g, { type: "rebuy", amount: 1000 })).toBe(g);
    expect(applyOptimisticAction(g, { type: "leave-seat" })).toBe(g);
  });

  it("never predicts against another seat's turn", () => {
    const g = game({ seats: [seat({ isMine: false })] });
    expect(applyOptimisticAction(g, { type: "call" })).toBe(g);
  });
});

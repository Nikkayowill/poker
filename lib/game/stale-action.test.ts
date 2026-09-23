import { describe, expect, it } from "vitest";
import { canResubmitStaleAction } from "./stale-action";
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
    street: "flop",
    handNumber: 3,
    buttonPosition: 0,
    smallBlind: 25,
    bigBlind: 50,
    currentPlayer: 0,
    turnStartedAt: "2026-09-23T12:00:00.000Z",
    turnDeadlineAt: "2026-09-23T12:00:20.000Z",
    nextHandAt: null,
    currentBet: 100,
    minRaise: 50,
    pot: 150,
    community: [],
    seats: [seat()],
    winners: [],
    log: [],
    message: "",
    createdAt: "2026-09-23T11:00:00.000Z",
    updatedAt: "2026-09-23T12:00:00.000Z",
    tournament: null,
    legalActions: legalActions(),
    isSeated: true,
    ...overrides,
  };
}

describe("canResubmitStaleAction", () => {
  const base = game();
  // Someone else sat down mid-turn: new version, same turn.
  const bumped = game({ version: 6 });

  it("resends a fold or call when only the version moved", () => {
    expect(canResubmitStaleAction(base, bumped, { type: "fold" })).toBe(true);
    expect(canResubmitStaleAction(base, bumped, { type: "call" })).toBe(true);
    expect(canResubmitStaleAction(base, bumped, { type: "raise", amount: 400 })).toBe(true);
    expect(canResubmitStaleAction(base, bumped, { type: "all-in" })).toBe(true);
  });

  it("never resends once the turn has changed, since the action may already be in", () => {
    // A new turnStartedAt means the player acted or timed out. Resending a
    // call there is the double bet the version check exists to stop.
    const newTurn = game({ version: 9, turnStartedAt: "2026-09-23T12:00:08.000Z" });
    expect(canResubmitStaleAction(base, newTurn, { type: "call" })).toBe(false);
    expect(canResubmitStaleAction(base, game({ version: 9, street: "turn" }), { type: "call" })).toBe(false);
    expect(canResubmitStaleAction(base, game({ version: 9, handNumber: 4 }), { type: "fold" })).toBe(false);
  });

  it("does not resend when it is no longer this player's turn", () => {
    expect(canResubmitStaleAction(base, game({ version: 6, legalActions: null }), { type: "fold" })).toBe(false);
  });

  it("does not resend a move that stopped being legal or changed size", () => {
    const pricier = game({ version: 6, legalActions: legalActions({ callAmount: 300 }) });
    expect(canResubmitStaleAction(base, pricier, { type: "call" })).toBe(false);
    const checkGone = game({ version: 6, legalActions: legalActions({ canCheck: false }) });
    expect(canResubmitStaleAction(game({ legalActions: legalActions({ canCheck: true }) }), checkGone, { type: "check" })).toBe(false);
    expect(canResubmitStaleAction(base, bumped, { type: "raise", amount: 5_000 })).toBe(false);
  });

  it("does not resend without a turn start to compare", () => {
    const noClock = game({ turnStartedAt: null });
    expect(canResubmitStaleAction(noClock, game({ version: 6, turnStartedAt: null }), { type: "fold" })).toBe(false);
  });

  it("resends a rebuy only while the seat is still empty and eligible", () => {
    const busted = game({ status: "complete", legalActions: null, seats: [seat({ stack: 0, status: "out" })] });
    const stillBusted = game({ version: 7, status: "complete", legalActions: null, seats: [seat({ stack: 0, status: "out" })] });
    const refilled = game({ version: 7, status: "playing", legalActions: null, seats: [seat({ stack: 1000 })] });
    expect(canResubmitStaleAction(busted, stillBusted, { type: "rebuy", amount: 1000 })).toBe(true);
    expect(canResubmitStaleAction(busted, refilled, { type: "rebuy", amount: 1000 })).toBe(false);
  });

  it("never resends a rebuy at a tournament table", () => {
    const tournament = { format: "sit_and_go" } as GameSnapshot["tournament"];
    const busted = game({ status: "complete", tournament, seats: [seat({ stack: 0, status: "out" })] });
    expect(canResubmitStaleAction(busted, { ...busted, version: 7 }, { type: "rebuy", amount: 1000 })).toBe(false);
  });

  it("never resends across tables", () => {
    expect(canResubmitStaleAction(base, game({ id: "game-2" }), { type: "fold" })).toBe(false);
  });
});

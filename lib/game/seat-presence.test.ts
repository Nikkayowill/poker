import { describe, expect, test } from "vitest";
import type { PublicSeat } from "./types";
import { isBotAway } from "./seat-presence";

/**
 * isBotAway is the one line deciding whether a seat renders as "a bot
 * stood up and will be replaced shortly" (dimmed further, grayscale, a
 * fixed "Sitting out" label in player-seat.tsx) versus every other reason a
 * seat can be `"out"` -- a busted human's rebuy grace, a seat claimed
 * mid-hand and waiting for the next deal -- which must keep reading as an
 * ordinary .seat-muted fold, not "away". Getting this wrong in either
 * direction is a real regression: too broad and a busted human's rebuy
 * prompt looks like their bot replacement already left; too narrow and a
 * departed bot never gets the treatment this feature exists to add.
 */
function makeSeat(overrides: Partial<PublicSeat> = {}): PublicSeat {
  return {
    id: "seat-1",
    name: "Table Captain",
    initials: "TC",
    accent: "#000",
    avatarUrl: null,
    avatarPreset: "default",
    avatarCosmetic: "default",
    cardBackCosmetic: "default",
    position: 0,
    isHuman: false,
    profileId: null,
    botIdentity: 0,
    personality: "ROCK",
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
    handLabel: null,
    isDealer: false,
    isCurrent: false,
    isSmallBlind: false,
    isBigBlind: false,
    isMine: false,
    isOpen: true,
    ...overrides,
  };
}

describe("isBotAway", () => {
  test("a bot that voluntarily left (out + reseatEligibleAt set) is away", () => {
    const seat = makeSeat({ status: "out", stack: 0, reseatEligibleAt: "2026-08-05T00:00:00.000Z" });
    expect(isBotAway(seat)).toBe(true);
  });

  const notAwayCases: Array<[string, Partial<PublicSeat>]> = [
    ["an active seat", { status: "active", reseatEligibleAt: null }],
    ["a seat merely folded this hand", { status: "folded", reseatEligibleAt: null }],
    ["an all-in seat", { status: "all-in", reseatEligibleAt: null }],
    // A busted human in the rebuy grace window, or a seat claimed mid-hand
    // and waiting for next deal -- both real "out" cases with no
    // reseatEligibleAt, and neither should look like a departed bot.
    ["an 'out' seat with no reseatEligibleAt", { status: "out", stack: 0, reseatEligibleAt: null }],
  ];
  for (const [label, overrides] of notAwayCases) {
    test(`${label} is not away`, () => {
      expect(isBotAway(makeSeat(overrides))).toBe(false);
    });
  }

  test("reseatEligibleAt alone, without status out, is not away", () => {
    // Should never happen from the engine (reseatEligibleAt is only ever set
    // alongside status = "out"), but the check itself should still require
    // both, not just the timestamp -- a status recompute elsewhere in the
    // client's data path must not accidentally show "Sitting out" on a
    // seat that is actually active.
    const seat = makeSeat({ status: "active", reseatEligibleAt: "2026-08-05T00:00:00.000Z" });
    expect(isBotAway(seat)).toBe(false);
  });
});

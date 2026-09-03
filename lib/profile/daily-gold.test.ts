import { describe, expect, it } from "vitest";
import { dailyGoldState, isSameUtcDay } from "./daily-gold";
import type { PlayerProfile } from "./types";

function profileWith(overrides: Partial<PlayerProfile>): PlayerProfile {
  return {
    id: "p1",
    displayName: "Player",
    initials: "PL",
    avatarUrl: null,
    avatarPreset: "ace",
    equipped: { avatar2d: "character4", cardBack: "back-house", chipDesigns: {} },
    accent: "#e7c66a",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    goldBalance: 2000,
    unlimitedGold: false,
    lastDailyClaimAt: null,
    lastBackstopAt: null,
    isRegistered: true,
    stackacresAccess: false,
    adminBadge: false,
    ...overrides,
  };
}

describe("isSameUtcDay", () => {
  it("is a UTC boundary, not a local one", () => {
    // 23:30 UTC and 00:30 UTC the next day are 60 minutes apart and still
    // belong to different claim days -- which is the whole point of pinning
    // this to UTC: the server credits on the same boundary.
    const late = new Date("2026-08-05T23:30:00.000Z");
    const early = new Date("2026-08-06T00:30:00.000Z");
    expect(isSameUtcDay(late, early)).toBe(false);
    expect(isSameUtcDay(late, new Date("2026-08-05T00:00:00.000Z"))).toBe(true);
  });
});

describe("dailyGoldState", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("offers nothing before a profile exists", () => {
    expect(dailyGoldState(null, now)).toBeNull();
  });

  it("is ready when a registered player has never claimed", () => {
    expect(dailyGoldState(profileWith({ lastDailyClaimAt: null }), now)).toBe("ready");
  });

  it("is ready again the day after a claim", () => {
    const profile = profileWith({ lastDailyClaimAt: "2026-08-05T23:59:00.000Z" });
    expect(dailyGoldState(profile, now)).toBe("ready");
  });

  it("is claimed when today's has already been taken", () => {
    const profile = profileWith({ lastDailyClaimAt: "2026-08-06T00:01:00.000Z" });
    expect(dailyGoldState(profile, now)).toBe("claimed");
  });

  it("tells a guest the reward needs an account", () => {
    expect(dailyGoldState(profileWith({ isRegistered: false }), now)).toBe("guest");
  });

  it("says nothing to a profile that is never charged", () => {
    // Checked before the guest and claimed branches: an unlimited profile that
    // happens to be unregistered must not be offered a signup for Gold it can
    // never spend.
    const profile = profileWith({ unlimitedGold: true, isRegistered: false });
    expect(dailyGoldState(profile, now)).toBe("unlimited");
  });
});

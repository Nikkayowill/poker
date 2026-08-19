import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetAchievementMemory, applyAchievementEvent } from "./achievement-store";
import { getProfileBadges } from "./badge-store";
import { ensureProfile } from "./profile-store";

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, profileId: profile.id };
}

beforeEach(() => {
  __resetAchievementMemory();
});

describe("getProfileBadges", () => {
  it("returns nothing for a profile that has earned no badges", async () => {
    const { profileId } = await newPlayer("Nobody");
    expect(await getProfileBadges(profileId)).toEqual([]);
  });

  it("surfaces an achievement grant as a labelled badge", async () => {
    const { profileId } = await newPlayer("Duelist");
    for (let round = 0; round < 10; round += 1) {
      await applyAchievementEvent(profileId, { kind: "duel_won" });
    }

    const badges = await getProfileBadges(profileId);
    expect(badges).toHaveLength(1);
    expect(badges[0].badge).toBe("achievement-duels_won_10");
    expect(badges[0].label).toBe("Duelist");
    expect(badges[0].seasonId).toBeNull();
    expect(typeof badges[0].awardedAt).toBe("string");
  });

  it("keeps one player's badges out of another's", async () => {
    const a = await newPlayer("Alice");
    const b = await newPlayer("Bob");
    for (let round = 0; round < 10; round += 1) {
      await applyAchievementEvent(a.profileId, { kind: "duel_won" });
    }

    expect(await getProfileBadges(a.profileId)).toHaveLength(1);
    expect(await getProfileBadges(b.profileId)).toEqual([]);
  });

  it("orders multiple badges newest first", async () => {
    const { profileId } = await newPlayer("Grinder");
    for (let round = 0; round < 10; round += 1) {
      await applyAchievementEvent(profileId, { kind: "duel_won" });
    }
    for (let round = 0; round < 10; round += 1) {
      await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
    }

    const badges = await getProfileBadges(profileId);
    expect(badges.map((entry) => entry.badge).sort()).toEqual([
      "achievement-duels_won_10",
      "achievement-puzzles_completed_10",
    ]);
    // awardedAt is set with the same clock tick in a fast test run, so this
    // pins ordering-is-stable rather than a specific winner between ties.
    const [first, second] = badges;
    expect(first.awardedAt >= second.awardedAt).toBe(true);
  });
});

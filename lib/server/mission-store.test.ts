import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureProfile } from "./profile-store";
import { __resetMissionMemory, applyMissionEvent, getMissionsView } from "./mission-store";

/** A registered-shaped profile, which is all these paths need. */
async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, profileId: profile.id, startingGold: profile.goldBalance };
}

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  __resetMissionMemory();
});

describe("applying a mission event", () => {
  it("increments only the missions that share the event's metrics", async () => {
    const { profileId } = await newPlayer("Grinder");
    const now = at("2026-08-13T12:00:00.000Z"); // a Thursday

    await applyMissionEvent(profileId, { kind: "poker_hand_played", multiplayer: false }, now);
    const view = await getMissionsView(profileId, now);
    const daily = (code: string) => view.daily.find((m) => m.code === code)!;
    const weekly = (code: string) => view.weekly.find((m) => m.code === code)!;

    expect(daily("daily_play_hands").progress).toBe(1);
    // Not fed by a poker hand at all: untouched.
    expect(daily("daily_win_duels").progress).toBe(0);
    expect(daily("daily_brain_game").progress).toBe(0);
    // No second real player, so the multiplayer mission does not move either.
    expect(daily("daily_multiplayer").progress).toBe(0);
    // A single hand still feeds both cross-category weekly missions.
    expect(weekly("weekly_cross_category").progress).toBe(1);
    expect(weekly("weekly_active_days").progress).toBe(1);
    expect(weekly("weekly_win_duels").progress).toBe(0);
  });

  it("adds the multiplayer mission only when the hand had another real player in it", async () => {
    const { profileId } = await newPlayer("Social");
    const now = at("2026-08-13T12:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "poker_hand_played", multiplayer: true }, now);
    const view = await getMissionsView(profileId, now);
    expect(view.daily.find((m) => m.code === "daily_multiplayer")!.progress).toBe(1);
  });

  it("clamps progress at the target and never overshoots", async () => {
    const { profileId } = await newPlayer("Overachiever");
    const now = at("2026-08-13T12:00:00.000Z");

    for (let round = 0; round < 10; round += 1) {
      await applyMissionEvent(profileId, { kind: "puzzle_completed" }, now);
    }

    const mission = (await getMissionsView(profileId, now)).daily.find((m) => m.code === "daily_brain_game")!;
    expect(mission.progress).toBe(mission.target); // target is 1
    expect(mission.completed).toBe(true);
  });

  it("accumulates games_played_any across different kinds of event", async () => {
    const { profileId } = await newPlayer("Renaissance");
    const now = at("2026-08-10T09:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "poker_hand_played", multiplayer: false }, now);
    await applyMissionEvent(profileId, { kind: "duel_won" }, now);
    await applyMissionEvent(profileId, { kind: "puzzle_completed" }, now);

    const mission = (await getMissionsView(profileId, now)).weekly.find((m) => m.code === "weekly_cross_category")!;
    expect(mission.progress).toBe(3);
  });

  it("does nothing for a wager that crossed no level", async () => {
    const { profileId } = await newPlayer("Steady");
    const now = at("2026-08-10T09:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "level_gained", levels: 0 }, now);
    const mission = (await getMissionsView(profileId, now)).weekly.find((m) => m.code === "weekly_level_up")!;
    expect(mission.progress).toBe(0);
  });

  it("completes the rank-up mission the moment any level is crossed", async () => {
    const { profileId } = await newPlayer("Climber");
    const now = at("2026-08-10T09:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "level_gained", levels: 4 }, now);
    const mission = (await getMissionsView(profileId, now)).weekly.find((m) => m.code === "weekly_level_up")!;
    expect(mission.completed).toBe(true);
  });
});

describe("the active_day dedupe", () => {
  it("counts at most one active day per UTC day, but a new day counts again", async () => {
    const { profileId } = await newPlayer("Regular");
    const day1Morning = at("2026-08-10T09:00:00.000Z"); // Monday
    const day1Evening = at("2026-08-10T18:00:00.000Z");
    const day2 = at("2026-08-11T09:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "poker_hand_played", multiplayer: false }, day1Morning);
    await applyMissionEvent(profileId, { kind: "puzzle_completed" }, day1Evening);
    await applyMissionEvent(profileId, { kind: "duel_won" }, day2);

    const mission = (await getMissionsView(profileId, day2)).weekly.find((m) => m.code === "weekly_active_days")!;
    expect(mission.progress).toBe(2);
  });
});

describe("period boundaries", () => {
  it("starts a fresh row for a new week rather than carrying prior progress", async () => {
    const { profileId } = await newPlayer("WeekCrosser");
    const lastWeek = at("2026-08-10T09:00:00.000Z"); // Monday
    const nextWeek = at("2026-08-17T09:00:00.000Z"); // the following Monday

    await applyMissionEvent(profileId, { kind: "duel_won" }, lastWeek);
    await applyMissionEvent(profileId, { kind: "duel_won" }, lastWeek);

    const before = (await getMissionsView(profileId, lastWeek)).weekly.find((m) => m.code === "weekly_win_duels")!;
    expect(before.progress).toBe(2);

    const after = (await getMissionsView(profileId, nextWeek)).weekly.find((m) => m.code === "weekly_win_duels")!;
    expect(after.progress).toBe(0);
  });

  it("keeps a daily mission's progress isolated to its own UTC day", async () => {
    const { profileId } = await newPlayer("DayCrosser");
    const day1 = at("2026-08-10T09:00:00.000Z");
    const day2 = at("2026-08-11T09:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "puzzle_completed" }, day1);
    const mission = (await getMissionsView(profileId, day2)).daily.find((m) => m.code === "daily_brain_game")!;
    expect(mission.progress).toBe(0);
  });
});

describe("reward idempotency", () => {
  it("credits the reward exactly once, even as the metric keeps rising past the target", async () => {
    const { token, profileId, startingGold } = await newPlayer("Duelist");
    const now = at("2026-08-13T12:00:00.000Z");

    for (let round = 0; round < 4; round += 1) {
      // daily_win_duels' target is 3; the fourth win must not pay a second time.
      await applyMissionEvent(profileId, { kind: "duel_won" }, now);
    }

    const profile = await ensureProfile(token);
    expect(profile.goldBalance).toBe(startingGold + 150);
  });

  it("does not re-credit a mission that already completed on an earlier call", async () => {
    const { token, profileId, startingGold } = await newPlayer("Retryer");
    const now = at("2026-08-13T12:00:00.000Z");

    await applyMissionEvent(profileId, { kind: "puzzle_completed" }, now); // completes daily_brain_game
    const afterFirst = await ensureProfile(token);
    expect(afterFirst.goldBalance).toBe(startingGold + 100);

    await applyMissionEvent(profileId, { kind: "puzzle_completed" }, now); // already complete
    const afterSecond = await ensureProfile(token);
    expect(afterSecond.goldBalance).toBe(afterFirst.goldBalance);
  });
});

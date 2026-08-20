import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import {
  __resetAchievementMemory,
  applyAchievementEvent,
  checkAchievements,
  getAchievementsView,
} from "./achievement-store";
import { awardCosmetic, listOwnedCosmetics } from "./cosmetics-store";
import { ensureProfile } from "./profile-store";
import { awardWager } from "./progression-store";
import { recordHandStats } from "./stats-store";

/** Same shortcut as avatar-unlocks.test.ts: a real createGame() table with
 * only the fields recordHandStats actually reads set directly. */
function wonHand(token: string, amountWon: number, gameId: string, handNumber: number) {
  const state = createGame(token);
  const seat = state.seats[0];
  seat.holeCards = [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }];
  seat.committed = 500;
  seat.vpip = true;
  state.winners = [{ seatId: seat.id, name: seat.name, amount: amountWon, hand: "Flush", bestFive: null }];
  state.id = gameId;
  state.handNumber = handNumber;
  return state;
}

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, profileId: profile.id, startingGold: profile.goldBalance };
}

function findAchievement(payload: Awaited<ReturnType<typeof getAchievementsView>>, code: string) {
  const achievement = payload.achievements.find((candidate) => candidate.code === code);
  if (!achievement) throw new Error(`No achievement seeded with code ${code}`);
  return achievement;
}

beforeEach(() => {
  __resetAchievementMemory();
});

describe("applyAchievementEvent", () => {
  it("increments only the counter its own metric feeds", async () => {
    const { profileId } = await newPlayer("Counter");
    await applyAchievementEvent(profileId, { kind: "duel_won" });

    const view = await getAchievementsView(profileId);
    expect(findAchievement(view, "duels_won_10").progress).toBe(1);
    // A duel win must not move the unrelated puzzles counter.
    expect(findAchievement(view, "puzzles_completed_10").progress).toBe(0);
  });

  it("credits the tier-1 reward exactly once, even as the counter keeps rising past it", async () => {
    const { token, profileId, startingGold } = await newPlayer("Duelist");

    for (let round = 0; round < 15; round += 1) {
      // duels_won_10's threshold is 10; the eleventh-through-fifteenth win
      // must not pay a second time (duels_won_50's threshold is 50, well
      // out of reach here).
      await applyAchievementEvent(profileId, { kind: "duel_won" });
    }

    const profile = await ensureProfile(token);
    expect(profile.goldBalance).toBe(startingGold + 500);
    expect(findAchievement(await getAchievementsView(profileId), "duels_won_10").unlocked).toBe(true);
  });

  it("is a no-op for an event with no counter signal", async () => {
    const { profileId } = await newPlayer("Bystander");
    // poker_hand_played produces no achievement counter signal -- this must
    // return without touching anything (and without throwing).
    await applyAchievementEvent(profileId, { kind: "poker_hand_played", multiplayer: false });
    const view = await getAchievementsView(profileId);
    expect(view.unlockedCount).toBe(0);
  });
});

describe("checkAchievements against stat-sourced metrics", () => {
  it("unlocks every tier a single hand crosses at once", async () => {
    const { token, profileId } = await newPlayer("HighRoller");
    const gameId = randomUUID();

    const touched = await recordHandStats(wonHand(token, 50_000, gameId, 1));
    await checkAchievements(touched);

    const view = await getAchievementsView(profileId);
    // 50,000 clears both biggest_pot_10k (10,000) and biggest_pot_50k
    // (50,000) in the same pass.
    expect(findAchievement(view, "biggest_pot_10k").unlocked).toBe(true);
    expect(findAchievement(view, "biggest_pot_50k").unlocked).toBe(true);
    // Not the top tier, well out of reach at 50,000.
    expect(findAchievement(view, "biggest_pot_250k").unlocked).toBe(false);
  });

  // Cosmetic-granting achievements are only reachable at real thresholds
  // (hands_played_1000 -> back-riverwood is the one live pairing left, since
  // biggest_pot_50k's avatar-housename reward was retired along with the
  // illustrated 2D avatar catalog), too high a bar for a fast unit test --
  // awardCosmetic's own call site is covered directly instead.
  it("awards a cosmetic when a tier's definition names one", async () => {
    const { profileId } = await newPlayer("Bookkeeper");
    await awardCosmetic(profileId, "back-riverwood");
    expect(await listOwnedCosmetics(profileId)).toContain("back-riverwood");
  });

  it("does not re-grant an already-unlocked tier on a later call", async () => {
    const { token, startingGold } = await newPlayer("Retryer");
    const gameId = randomUUID();

    const touched = await recordHandStats(wonHand(token, 50_000, gameId, 1));
    await checkAchievements(touched);
    const afterFirst = (await ensureProfile(token)).goldBalance;

    // A second hand, still well under every remaining tier -- must not
    // re-pay the ones already granted.
    const secondTouched = await recordHandStats(wonHand(token, 20_000, gameId, 2));
    await checkAchievements(secondTouched);
    const afterSecond = (await ensureProfile(token)).goldBalance;

    // biggest_pot_10k (500) + biggest_pot_50k (6000, the pot tier); a
    // 500-chip commit against a 50,000 win also clears net_profit_10k's
    // 10,000 threshold (500) in the same pass.
    expect(afterFirst).toBe(startingGold + 500 + 6000 + 500);
    expect(afterSecond).toBe(afterFirst);
  });

  it("grants each profile independently when several are checked in one call", async () => {
    // checkAchievements fans its per-profile work out with Promise.all --
    // this pins that running two profiles concurrently still grades each
    // one only against its own standing, with no cross-talk between them.
    const playerA = await newPlayer("ParallelA");
    const playerB = await newPlayer("ParallelB");

    const touchedA = await recordHandStats(wonHand(playerA.token, 50_000, randomUUID(), 1));
    const touchedB = await recordHandStats(wonHand(playerB.token, 5_000, randomUUID(), 1));

    await checkAchievements([...touchedA, ...touchedB]);

    const viewA = await getAchievementsView(playerA.profileId);
    const viewB = await getAchievementsView(playerB.profileId);
    expect(findAchievement(viewA, "biggest_pot_10k").unlocked).toBe(true);
    expect(findAchievement(viewA, "biggest_pot_50k").unlocked).toBe(true);
    expect(findAchievement(viewB, "biggest_pot_10k").unlocked).toBe(false);
    expect(findAchievement(viewB, "biggest_pot_50k").unlocked).toBe(false);

    const profileA = await ensureProfile(playerA.token);
    const profileB = await ensureProfile(playerB.token);
    // biggest_pot_10k (500) + biggest_pot_50k (6000) + net_profit_10k (500).
    expect(profileA.goldBalance).toBe(playerA.startingGold + 500 + 6000 + 500);
    expect(profileB.goldBalance).toBe(playerB.startingGold);
  });

  it("reports real progress toward a locked tier", async () => {
    const { token, profileId } = await newPlayer("Climbing");
    const gameId = randomUUID();

    const touched = await recordHandStats(wonHand(token, 5_000, gameId, 1));
    await checkAchievements(touched);

    const achievement = findAchievement(await getAchievementsView(profileId), "biggest_pot_10k");
    expect(achievement.unlocked).toBe(false);
    expect(achievement.progress).toBe(5_000);
    expect(achievement.threshold).toBe(10_000);
  });
});

describe("checkAchievements against the live-sourced rank metric", () => {
  it("unlocks a level achievement the moment awardWager crosses it", async () => {
    const { profileId } = await newPlayer("Climber");

    // xpToReachLevel(10) = 250 * 9 * 10 / 2 = 11,250 XP; GOLD_PER_XP is 10,
    // so 112,500 Gold staked in one wager crosses level 10 outright.
    // progression-store.ts's awardWager already wires checkAchievements on
    // any level-up, so this exercises the real call site, not a mock of it.
    await awardWager(profileId, null, 112_500);

    const achievement = findAchievement(await getAchievementsView(profileId), "level_10");
    expect(achievement.unlocked).toBe(true);
    expect(achievement.unlockedAt).not.toBeNull();
  });

  it("leaves a level achievement locked below its threshold", async () => {
    const { profileId } = await newPlayer("Newcomer");
    await awardWager(profileId, null, 1_000);

    expect(findAchievement(await getAchievementsView(profileId), "level_10").unlocked).toBe(false);
  });
});

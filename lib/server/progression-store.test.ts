import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GOLD_PER_XP,
  goldForLevelUps,
  levelForXp,
  xpToReachLevel,
} from "@/lib/progression/rank";
import { dailyGrantFor, utcDayKey } from "@/lib/progression/streak";
import { ensureProfile } from "./profile-store";
import {
  __resetProgressionMemory,
  awardWager,
  getProgression,
  recordDailyClaim,
} from "./progression-store";

/** A registered-shaped profile, which is all these paths need. */
async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, profileId: profile.id, startingGold: profile.goldBalance };
}

/** The Gold it takes to wager a given amount of XP into existence. */
const goldFor = (xp: number) => xp * GOLD_PER_XP;

beforeEach(() => {
  __resetProgressionMemory();
});

describe("reading progression", () => {
  it("reports level 1 for a player with no row at all", async () => {
    const { profileId } = await newPlayer("Fresh");
    const progress = await getProgression(profileId);

    expect(progress.level).toBe(1);
    expect(progress.xp).toBe(0);
    expect(progress.lifetimeWagered).toBe(0);
    expect(progress.streak).toBe(0);
  });
});

describe("awarding XP for a wager", () => {
  it("records XP and lifetime volume, and never nets a loss out of either", async () => {
    const { token, profileId } = await newPlayer("Grinder");

    await awardWager(profileId, token, 1_000);
    await awardWager(profileId, token, 500);

    const progress = await getProgression(profileId);
    expect(progress.xp).toBe(150);
    // Volume, not profit: two losing rounds still moved the bar.
    expect(progress.lifetimeWagered).toBe(1_500);
  });

  it("does nothing for a stake too small to be worth a point", async () => {
    const { token, profileId } = await newPlayer("Penny");

    expect(await awardWager(profileId, token, GOLD_PER_XP - 1)).toBeNull();
    expect(await awardWager(profileId, token, 0)).toBeNull();
    expect((await getProgression(profileId)).xp).toBe(0);
  });

  it("reports the levels a single wager crossed, not just the one it landed on", async () => {
    const { token, profileId } = await newPlayer("Whale");

    // One wager big enough to jump several levels at once -- the case where
    // awarding only the level landed on would swallow the milestones below it.
    const target = xpToReachLevel(7);
    const award = await awardWager(profileId, token, goldFor(target));

    expect(award).not.toBeNull();
    expect(award!.levelUps.map((reward) => reward.level)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(award!.progression.level).toBe(7);
  });

  it("credits milestone Gold once, into the balance it hands back", async () => {
    const { token, profileId, startingGold } = await newPlayer("Climber");

    const target = xpToReachLevel(5);
    const owed = goldForLevelUps(1, 5);
    expect(owed).toBeGreaterThan(0);

    const award = await awardWager(profileId, token, goldFor(target));
    expect(award!.goldAwarded).toBe(owed);
    // The wallet comes back with the payout already in it, so a caller
    // serialising this response cannot show a level-up beside a stale balance.
    expect(award!.profile?.goldBalance).toBe(startingGold + owed);

    // Crossing nothing pays nothing: the second wager is inside level 5.
    const again = await awardWager(profileId, token, goldFor(1));
    expect(again!.goldAwarded).toBe(0);
    expect(again!.levelUps).toEqual([]);
  });

  it("keeps XP monotonic across many small wagers", async () => {
    const { token, profileId } = await newPlayer("Steady");

    let expected = 0;
    for (let round = 0; round < 40; round += 1) {
      await awardWager(profileId, token, 250);
      expected += 25;
    }
    const progress = await getProgression(profileId);
    expect(progress.xp).toBe(expected);
    expect(progress.level).toBe(levelForXp(expected));
  });
});

describe("the daily streak", () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

  it("starts at one and extends on consecutive days", async () => {
    const { profileId } = await newPlayer("Regular");

    expect(await recordDailyClaim(profileId, day("2026-08-01"))).toBe(1);
    expect(await recordDailyClaim(profileId, day("2026-08-02"))).toBe(2);
    expect(await recordDailyClaim(profileId, day("2026-08-03"))).toBe(3);
  });

  it("is idempotent within a day, which is what makes it safe to record first", async () => {
    const { profileId } = await newPlayer("Retry");

    expect(await recordDailyClaim(profileId, day("2026-08-01"))).toBe(1);
    // The claim route records the streak before attempting the credit, so a
    // rejected or retried claim must not inflate it.
    expect(await recordDailyClaim(profileId, day("2026-08-01"))).toBe(1);
    expect(await recordDailyClaim(profileId, day("2026-08-01"))).toBe(1);
  });

  it("resets after a missed day", async () => {
    const { profileId } = await newPlayer("Lapsed");

    await recordDailyClaim(profileId, day("2026-08-01"));
    await recordDailyClaim(profileId, day("2026-08-02"));
    expect(await recordDailyClaim(profileId, day("2026-08-04"))).toBe(1);
  });

  it("reads a lapsed streak back as zero rather than promising a multiplier", async () => {
    const { profileId } = await newPlayer("Ghost");
    await recordDailyClaim(profileId, day("2026-08-01"));

    // Still alive the next day -- the streak is not broken until today is
    // missed too, which is what lets the menu say "claim to reach 2".
    expect((await getProgression(profileId, day("2026-08-02"))).streak).toBe(1);
    // Two days on, it is over, whatever the stored number still says.
    expect((await getProgression(profileId, day("2026-08-05"))).streak).toBe(0);
  });

  it("survives beside XP rather than overwriting it", async () => {
    const { token, profileId } = await newPlayer("Both");

    await awardWager(profileId, token, 10_000);
    await recordDailyClaim(profileId, day("2026-08-01"));
    await awardWager(profileId, token, 10_000);

    const progress = await getProgression(profileId, day("2026-08-01"));
    expect(progress.xp).toBe(2_000);
    expect(progress.streak).toBe(1);
    expect(progress.lastClaimDay).toBe(utcDayKey(day("2026-08-01")));
  });

  it("pays a bigger grant the longer the streak runs", async () => {
    const { profileId } = await newPlayer("Loyal");

    const first = await recordDailyClaim(profileId, day("2026-08-01"));
    let streak = first;
    for (let offset = 2; offset <= 7; offset += 1) {
      streak = await recordDailyClaim(profileId, day(`2026-08-0${offset}`));
    }
    expect(streak).toBe(7);
    expect(dailyGrantFor(1_000, streak)).toBeGreaterThan(dailyGrantFor(1_000, first));
  });
});

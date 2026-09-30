import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { RANK_TIERS, tierForPoints } from "@/lib/progression/rank";
import { GOLD_PER_RANK_POINT } from "@/lib/progression/solo-earnings";
import { ensureProfile, findProfileBySessionToken } from "./profile-store";
import { getProgression } from "./progression-store";
import { __resetSoloEarningsMemory, readSoloState, recordSoloResult } from "./solo-earnings-store";

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, profileId: profile.id, startingGold: profile.goldBalance };
}

let counter = 0;
const key = () => `test:${(counter += 1)}`;
const result = (wager: number, payout: number) => ({ game: "sudoku", correlationId: key(), wager, payout });

beforeEach(() => {
  __resetSoloEarningsMemory();
});

describe("recording solo results", () => {
  it("counts a win into the tally and the rank", async () => {
    const { token, profileId } = await newPlayer("Winner");
    await recordSoloResult(profileId, token, result(1_000, 4_000));

    const progress = await getProgression(profileId);
    expect(progress.soloEarnings).toMatchObject({ wins: 1, losses: 0, totalStaked: 1_000, totalPaidOut: 4_000, net: 3_000 });
    // 3,000 net at band 0's weight of 1.
    expect(progress.points).toBe(3_000 / GOLD_PER_RANK_POINT);
  });

  it("takes rank down on a loss", async () => {
    const { token, profileId } = await newPlayer("Loser");
    await recordSoloResult(profileId, token, result(1_000, 9_000));
    const afterWin = (await getProgression(profileId)).points;

    await recordSoloResult(profileId, token, result(1_000, 0));
    const afterLoss = await getProgression(profileId);

    expect(afterLoss.points).toBe(afterWin - 1_000 / GOLD_PER_RANK_POINT);
    expect(afterLoss.soloEarnings).toMatchObject({ wins: 1, losses: 1, totalStaked: 2_000, totalPaidOut: 9_000, net: 7_000 });
  });

  it("never takes rank below zero", async () => {
    const { token, profileId } = await newPlayer("Broke");
    await recordSoloResult(profileId, token, result(5_000, 0));

    const progress = await getProgression(profileId);
    expect(progress.tier.id).toBe("bronze");
    expect(progress.points).toBe(0);
    expect(progress.soloEarnings.net).toBe(-5_000);
  });

  it("counts a settle once however many times it is replayed", async () => {
    const { token, profileId } = await newPlayer("Replay");
    const same = result(1_000, 2_000);
    expect(await recordSoloResult(profileId, token, same)).not.toBeNull();
    expect(await recordSoloResult(profileId, token, same)).toBeNull();
    expect(await recordSoloResult(profileId, token, same)).toBeNull();

    expect((await getProgression(profileId)).soloEarnings).toMatchObject({ wins: 1, totalPaidOut: 2_000 });
  });

  it("ignores free play", async () => {
    const { token, profileId } = await newPlayer("Practice");
    expect(await recordSoloResult(profileId, token, result(0, 0))).toBeNull();
    expect((await getProgression(profileId)).soloEarnings.wins).toBe(0);
  });

  it("weights a hard band's win above an easy one", async () => {
    const easy = await newPlayer("Easy");
    const hard = await newPlayer("Hard");
    await recordSoloResult(easy.profileId, easy.token, result(1_000, 2_000));
    await recordSoloResult(hard.profileId, hard.token, result(2_000_000, 4_000_000));

    const easyState = await readSoloState(easy.profileId);
    const hardState = await readSoloState(hard.profileId);
    expect(Object.keys(easyState.byBand)).not.toEqual(Object.keys(hardState.byBand));
    // A win with the same 2x multiplier is worth more per Gold on the harder band.
    expect((await getProgression(hard.profileId)).points / 1_000_000).toBeGreaterThan(
      (await getProgression(easy.profileId)).points / 1_000,
    );
  });
});

describe("tier Gold", () => {
  const silver = RANK_TIERS[1];
  // A win that adds `points` rank points at band 0 (a 9,000 stake keeps it on the lowest band).
  const winFor = (points: number) => result(9_000, 9_000 + points * GOLD_PER_RANK_POINT);

  it("pays a tier on reaching it, into the balance it hands back", async () => {
    const { token, profileId, startingGold } = await newPlayer("Climber");
    const outcome = await recordSoloResult(profileId, token, winFor(silver.from));

    expect(outcome?.tierUps.map((reward) => reward.tier.id)).toEqual(["silver"]);
    expect(outcome?.goldAwarded).toBe(silver.rewardGold);
    const fresh = await findProfileBySessionToken(token);
    expect(outcome?.profile?.goldBalance).toBe(fresh?.goldBalance);
    expect(fresh!.goldBalance).toBeGreaterThanOrEqual(startingGold + silver.rewardGold);
  });

  it("pays every tier a single win jumps", async () => {
    const { token, profileId } = await newPlayer("Leaper");
    const outcome = await recordSoloResult(profileId, token, winFor(RANK_TIERS[3].from));

    expect(outcome?.tierUps.map((reward) => reward.tier.id)).toEqual(["silver", "platinum", "emerald"]);
    expect(outcome?.goldAwarded).toBe(silver.rewardGold + RANK_TIERS[2].rewardGold + RANK_TIERS[3].rewardGold);
  });

  it("does not pay the same tier twice when rank falls and climbs back", async () => {
    const { token, profileId } = await newPlayer("Yo-yo");
    const first = await recordSoloResult(profileId, token, winFor(silver.from));
    expect(first?.goldAwarded).toBe(silver.rewardGold);

    // A 3,000 loss is 150 points, enough to drop from the start of Silver back to Bronze; then win back above it.
    await recordSoloResult(profileId, token, result(3_000, 0));
    expect(tierForPoints((await getProgression(profileId)).points).id).toBe("bronze");
    const again = await recordSoloResult(profileId, token, result(9_000, 9_000 + 200 * GOLD_PER_RANK_POINT));

    expect((await getProgression(profileId)).tier.id).toBe("silver");
    expect(again?.goldAwarded).toBe(0);
  });

  it("pays nothing for a loss", async () => {
    const { token, profileId } = await newPlayer("Loss");
    const outcome = await recordSoloResult(profileId, token, result(1_000, 0));
    expect(outcome).toEqual({ tierUps: [], goldAwarded: 0, profile: null });
  });
});

import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { RANK_TIERS, tierForPoints } from "@/lib/progression/rank";
import { RANK_POINTS_PER_WIN, bandRankWeight } from "@/lib/progression/solo-earnings";
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
    // One win at band 0's weight of 1.
    expect(progress.points).toBe(RANK_POINTS_PER_WIN);
  });

  it("leaves rank alone on a loss", async () => {
    const { token, profileId } = await newPlayer("Loser");
    await recordSoloResult(profileId, token, result(1_000, 9_000));
    const afterWin = (await getProgression(profileId)).points;

    await recordSoloResult(profileId, token, result(1_000, 0));
    const afterLoss = await getProgression(profileId);

    expect(afterLoss.points).toBe(afterWin);
    expect(afterLoss.soloEarnings).toMatchObject({ wins: 1, losses: 1, totalStaked: 2_000, totalPaidOut: 9_000, net: 7_000 });
  });

  it("keeps a player who has only lost at zero", async () => {
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
    expect((await getProgression(hard.profileId)).points).toBe(Math.floor(RANK_POINTS_PER_WIN * bandRankWeight(3)));
    expect((await getProgression(hard.profileId)).points).toBeGreaterThan((await getProgression(easy.profileId)).points);
  });
});

describe("tier Gold", () => {
  const silver = RANK_TIERS[1];
  const platinum = RANK_TIERS[2];
  // A top-band win; the stake and payout do not change the points it is worth.
  const topWin = () => result(1_000_000, 1_600_000);
  const topWinPoints = RANK_POINTS_PER_WIN * bandRankWeight(3);
  const winsFor = (points: number) => Math.ceil(points / topWinPoints);

  async function winTimes(profileId: string, token: string, times: number) {
    let goldAwarded = 0;
    const tierIds: string[] = [];
    for (let index = 0; index < times; index += 1) {
      const outcome = await recordSoloResult(profileId, token, topWin());
      goldAwarded += outcome?.goldAwarded ?? 0;
      tierIds.push(...(outcome?.tierUps.map((reward) => reward.tier.id) ?? []));
    }
    return { goldAwarded, tierIds };
  }

  it("pays a tier on reaching it, into the balance it hands back", async () => {
    const { token, profileId, startingGold } = await newPlayer("Climber");
    await winTimes(profileId, token, winsFor(silver.from) - 1);
    const outcome = await recordSoloResult(profileId, token, topWin());

    expect(outcome?.tierUps.map((reward) => reward.tier.id)).toEqual(["silver"]);
    expect(outcome?.goldAwarded).toBe(silver.rewardGold);
    const fresh = await findProfileBySessionToken(token);
    expect(outcome?.profile?.goldBalance).toBe(fresh?.goldBalance);
    expect(fresh!.goldBalance).toBeGreaterThanOrEqual(startingGold + silver.rewardGold);
  });

  it("pays each tier crossed once, in order", async () => {
    const { token, profileId } = await newPlayer("Leaper");
    const climb = await winTimes(profileId, token, winsFor(platinum.from));

    expect(climb.tierIds).toEqual(["silver", "platinum"]);
    expect(climb.goldAwarded).toBe(silver.rewardGold + platinum.rewardGold);
  });

  it("keeps the tier and pays nothing more through a big loss", async () => {
    const { token, profileId } = await newPlayer("Steady");
    await winTimes(profileId, token, winsFor(silver.from));
    const loss = await recordSoloResult(profileId, token, result(15_000_000, 0));
    const next = await recordSoloResult(profileId, token, topWin());

    expect(tierForPoints((await getProgression(profileId)).points).id).toBe("silver");
    expect(loss?.goldAwarded).toBe(0);
    expect(next?.goldAwarded).toBe(0);
  });

  it("pays nothing for a loss", async () => {
    const { token, profileId } = await newPlayer("Loss");
    const outcome = await recordSoloResult(profileId, token, result(1_000, 0));
    expect(outcome).toEqual({ tierUps: [], goldAwarded: 0, profile: null });
  });
});

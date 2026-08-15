import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetArcadeRoundsForTest } from "./arcade-round-store";
import { placeRouletteBet } from "./roulette-service";
import { placeBaccaratBet } from "./baccarat-service";
import { dealVideoPokerHand } from "./video-poker-service";
import { startCoinFlipRun } from "./coin-flip-service";
import { adjustGold, ensureProfile } from "./profile-store";

/**
 * hi-lo-service.test.ts already proves dealHiLo refuses at its real
 * openCasinoRound choke point. This file closes the same gap for the other
 * four retired games, which previously had no route-level regression test at
 * all -- only lib/arcade/retired.test.ts's string-comparison against
 * RETIRED_ARCADE_GAMES itself, which would stay green even if a service's
 * exported GAME constant drifted from the string the guard checks. Calling
 * each service's real entry point with its real, exported game table is what
 * would actually catch that: a future game wired to openCasinoRound with a
 * mismatched id would 200 here instead of 410.
 */

async function funded(gold: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return token;
}

beforeEach(() => {
  __resetArcadeRoundsForTest();
});

describe("retired casino games refuse to deal, charging nothing", () => {
  it("roulette", async () => {
    const token = await funded(2000);
    await expect(
      placeRouletteBet(token, "1k", { kind: "colour", colour: "red" }),
    ).rejects.toMatchObject({ status: 410 });
    expect((await ensureProfile(token)).goldBalance).toBe(2000);
  });

  it("baccarat", async () => {
    const token = await funded(2000);
    await expect(placeBaccaratBet(token, "1k", "player")).rejects.toMatchObject({ status: 410 });
    expect((await ensureProfile(token)).goldBalance).toBe(2000);
  });

  it("video poker", async () => {
    const token = await funded(2000);
    await expect(dealVideoPokerHand(token, "1k")).rejects.toMatchObject({ status: 410 });
    expect((await ensureProfile(token)).goldBalance).toBe(2000);
  });

  it("coin flip", async () => {
    const token = await funded(2000);
    await expect(startCoinFlipRun(token, "1k")).rejects.toMatchObject({ status: 410 });
    expect((await ensureProfile(token)).goldBalance).toBe(2000);
  });
});

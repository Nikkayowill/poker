import { randomInt, randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { dealHiLoRound, hiLoOdds, toHiLoSnapshot, type HiLoRound } from "@/lib/arcade/hi-lo";
import {
  __resetArcadeRoundsForTest,
  createArcadeRound,
} from "./arcade-round-store";
import { HI_LO_GAME, dealHiLo, playHiLoCall, readHiLoRound } from "./hi-lo-service";
import { adjustGold, ensureProfile, setUnlimitedGold, spendGold } from "./profile-store";

/**
 * The money contract, in memory mode.
 *
 * Hi-Lo was RETIRED on 2026-08-12 with the rest of the pure-chance games (see
 * lib/arcade/retired.ts), and this file changed shape rather than being
 * deleted, for the same reason the service and its routes were kept: a player
 * who had a live round when the retirement shipped has already paid for it and
 * must still be able to settle it. That settlement path is unchanged, still
 * moves real Gold, and is still worth pinning.
 *
 * So `dealHiLo` is now only exercised to prove it REFUSES, and the rounds
 * these tests settle are opened directly through the store by `liveRound`
 * below -- which is what dealHiLo did before the guard, minus the guard. That
 * is fixture setup, not a production seam: nothing under app/ or lib/server
 * can reach it, so it cannot become a way to deal a retired game.
 *
 * As before, no deck is stacked: the randomness comes from node:crypto by
 * design and a seam to override it is a seam an attacker would want. The
 * assertions are invariants that hold for whatever card comes out --
 *
 *   final balance === starting balance + netGold
 *
 * -- which is stronger than any single stacked outcome. The payout arithmetic
 * and the house edge are pinned exactly, on the pure functions, in
 * lib/arcade/hi-lo.test.ts.
 */

const STAKE = 1000;

async function funded(gold?: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold === undefined ? 0 : gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return token;
}

/**
 * Opens a live round the way dealHiLo did before it was retired: debit, deal,
 * persist. Fixture setup only -- see the file header.
 */
async function liveRound(token: string, stake = STAKE) {
  const profile = await spendGold(token, stake);
  const stored = await createArcadeRound<HiLoRound>({
    profileId: profile.id,
    game: HI_LO_GAME,
    tier: "1k",
    baseStake: stake,
    round: dealHiLoRound(stake, randomInt),
    settled: false,
  });
  return toHiLoSnapshot(stored.round, { id: stored.id, version: stored.version });
}

beforeEach(() => {
  __resetArcadeRoundsForTest();
});

describe("retirement", () => {
  it("refuses to deal a new round, and charges nothing for the refusal", async () => {
    const token = await funded(2000);
    await expect(dealHiLo(token, "1k")).rejects.toMatchObject({ status: 410 });
    // The guard sits before spendGold, so a retired game cannot take a stake
    // on its way to saying it is retired.
    expect((await ensureProfile(token)).goldBalance).toBe(2000);
  });

  it("still hands back a round the player already paid for", async () => {
    // The whole reason the routes were kept rather than deleted: refusing this
    // would take the stake and give nothing back.
    const token = await funded(2000);
    const dealt = await liveRound(token);
    const restored = await readHiLoRound(token);
    expect(restored.round?.id).toBe(dealt.id);
    expect(restored.round?.baseCard).toEqual(dealt.baseCard);
  });

  it("still settles a round the player already paid for", async () => {
    const token = await funded(2000);
    const dealt = await liveRound(token);
    const settled = await playHiLoCall(token, {
      roundId: dealt.id,
      version: dealt.version,
      call: dealt.legal.higher ? "higher" : "lower",
    });
    expect(settled.round?.phase).toBe("settled");
    expect(settled.profile.goldBalance).toBe(2000 + settled.round!.netGold);
  });

  it("reports no round for a player who has never dealt", async () => {
    expect((await readHiLoRound(await funded())).round).toBeNull();
  });
});

describe("redaction", () => {
  it("never leaks the deck, which is where the deciding card is", async () => {
    const round = await liveRound(await funded(2000));
    expect("deck" in round).toBe(false);
    expect(JSON.stringify(round)).not.toContain("deck");
  });

  it("quotes the price of both calls before the player commits", async () => {
    const round = await liveRound(await funded(2000));
    expect(round.odds.higher.winners + round.odds.lower.winners + round.odds.ties).toBe(51);
    // At least one side is always playable; both are unless the card is a 2 or an ace.
    expect(round.odds.higher.available || round.odds.lower.available).toBe(true);
  });
});

describe("settlement", () => {
  it("leaves the player exactly netGold up or down over a whole round", async () => {
    // Repeated because the card is genuinely random: across this many rounds
    // the run covers wins, misses and the occasional tie, and the invariant
    // has to hold for every one.
    for (let n = 0; n < 30; n += 1) {
      const token = await funded(2000);
      const dealt = await liveRound(token);
      const settled = await playHiLoCall(token, {
        roundId: dealt.id,
        version: dealt.version,
        call: dealt.legal.higher ? "higher" : "lower",
      });
      expect(settled.round?.phase).toBe("settled");
      expect(settled.round?.drawnCard).toBeTruthy();
      expect(settled.profile.goldBalance).toBe(2000 + settled.round!.netGold);
    }
  });

  it("pays a win at exactly the price it quoted", async () => {
    for (let n = 0; n < 30; n += 1) {
      const token = await funded(2000);
      const dealt = await liveRound(token);
      const call = dealt.legal.higher ? "higher" : "lower";
      const quoted = dealt.odds[call].multiplier;
      const settled = await playHiLoCall(token, {
        roundId: dealt.id,
        version: dealt.version,
        call,
      });
      if (settled.round?.outcome === "win") {
        expect(settled.round.netGold).toBe(Math.floor(STAKE * quoted));
      } else {
        // A miss and a tie both take the stake, and nothing else.
        expect(settled.round?.netGold).toBe(-STAKE);
      }
    }
  });

  it("stakes an unlimited-Gold player nothing and pays them nothing", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await setUnlimitedGold(profile.id, true);
    const dealt = await liveRound(token, 500_000);
    const settled = await playHiLoCall(token, {
      roundId: dealt.id,
      version: dealt.version,
      call: dealt.legal.higher ? "higher" : "lower",
    });
    // spendGold and creditGold are both no-ops for an unlimited profile, and
    // the arcade must not become the one place that mints from them.
    expect(settled.profile.goldBalance).toBe(profile.goldBalance);
  });
});

describe("the version guard", () => {
  it("rejects a replayed call and does not draw a second card", async () => {
    const token = await funded(2000);
    const dealt = await liveRound(token);
    const call = dealt.legal.higher ? "higher" : "lower";
    const settled = await playHiLoCall(token, {
      roundId: dealt.id,
      version: dealt.version,
      call,
    });
    const after = (await ensureProfile(token)).goldBalance;

    // The same request again -- a double-click, a retry, a replayed payload.
    // In Hi-Lo this would be a free re-roll of the only card that matters.
    await expect(
      playHiLoCall(token, { roundId: dealt.id, version: dealt.version, call }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await ensureProfile(token)).goldBalance).toBe(after);
    expect(settled.profile.goldBalance).toBe(after);
  });

  it("rejects a call pinned to a stale version", async () => {
    const token = await funded(2000);
    const dealt = await liveRound(token);
    await expect(
      playHiLoCall(token, {
        roundId: dealt.id,
        version: dealt.version + 5,
        call: dealt.legal.higher ? "higher" : "lower",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await ensureProfile(token)).goldBalance).toBe(1000);
  });

  it("refuses a call addressed to a round the caller does not hold", async () => {
    const token = await funded(2000);
    const dealt = await liveRound(token);
    await expect(
      playHiLoCall(token, { roundId: randomUUID(), version: dealt.version, call: "higher" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to call when no round is live", async () => {
    await expect(
      playHiLoCall(await funded(), { roundId: randomUUID(), version: 1, call: "higher" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("unwinnable calls", () => {
  it("refuses the call no card can win, and takes nothing for it", async () => {
    // Deal until the base card is a 2 or an ace -- the two cards with a dead
    // side. Roughly 2 in 13, so this finds one quickly.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const token = await funded(2000);
      const dealt = await liveRound(token);
      const dead = !dealt.legal.higher ? "higher" : !dealt.legal.lower ? "lower" : null;
      if (!dead) continue;

      expect(hiLoOdds(dealt.baseCard)[dead].winners).toBe(0);
      await expect(
        playHiLoCall(token, { roundId: dealt.id, version: dealt.version, call: dead }),
      ).rejects.toMatchObject({ status: 409 });
      // The stake is still just the opening debit, and the round is untouched.
      expect((await ensureProfile(token)).goldBalance).toBe(1000);
      const live = await readHiLoRound(token);
      expect(live.round?.version).toBe(dealt.version);
      expect(live.round?.drawnCard).toBeNull();
      return;
    }
    throw new Error("Never dealt a 2 or an ace in 200 rounds.");
  });
});

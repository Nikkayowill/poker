import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { hiLoOdds } from "@/lib/arcade/hi-lo";
import { __resetArcadeRoundsForTest } from "./arcade-round-store";
import {
  HiLoRequestError,
  dealHiLo,
  playHiLoCall,
  readHiLoRound,
} from "./hi-lo-service";
import { adjustGold, ensureProfile, setUnlimitedGold } from "./profile-store";

/**
 * The money contract, in memory mode.
 *
 * As with blackjack, these deliberately do not stack a deck: dealHiLo takes
 * its randomness from node:crypto by design, and a seam to override it is a
 * seam an attacker would want. The assertions are invariants that must hold
 * for whatever card comes out --
 *
 *   final balance === starting balance + netGold
 *
 * -- which is stronger than any single stacked outcome because it has to hold
 * across wins, misses and ties alike. The payout arithmetic and the house edge
 * are pinned separately, exactly, on the pure functions in
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

beforeEach(() => {
  __resetArcadeRoundsForTest();
});

describe("dealing", () => {
  it("debits the stake and turns one card face up", async () => {
    const token = await funded(2000);
    const result = await dealHiLo(token, "1k");
    expect(result.resumed).toBe(false);
    expect(result.profile.goldBalance).toBe(1000);
    expect(result.round?.baseCard).toBeTruthy();
    // Hi-Lo never settles on the deal -- there is always a call to make.
    expect(result.round?.phase).toBe("call");
    expect(result.round?.drawnCard).toBeNull();
  });

  it("quotes the price of both calls before the player commits", async () => {
    const { round } = await dealHiLo(await funded(2000), "1k");
    const odds = round!.odds;
    expect(odds.higher.winners + odds.lower.winners + odds.ties).toBe(51);
    // At least one side is always playable; both are unless the card is a 2 or an ace.
    expect(odds.higher.available || odds.lower.available).toBe(true);
  });

  it("never leaks the deck, which is where the deciding card is", async () => {
    const { round } = await dealHiLo(await funded(2000), "1k");
    expect("deck" in round!).toBe(false);
    expect(JSON.stringify(round)).not.toContain("deck");
  });

  it("refuses a stake the wallet cannot cover, and charges nothing", async () => {
    const token = await funded(999);
    await expect(dealHiLo(token, "1k")).rejects.toBeInstanceOf(HiLoRequestError);
    expect((await ensureProfile(token)).goldBalance).toBe(999);
  });

  it("resumes a live round instead of dealing a second one", async () => {
    const token = await funded(2000);
    const first = await dealHiLo(token, "1k");
    const again = await dealHiLo(token, "1k");
    expect(again.resumed).toBe(true);
    expect(again.round?.id).toBe(first.round?.id);
    // Critically the SAME base card -- re-dealing would both double-charge and
    // swap the card the player was about to call.
    expect(again.round?.baseCard).toEqual(first.round?.baseCard);
    expect(again.profile.goldBalance).toBe(1000);
  });

  it("restores the round to a page that reloads", async () => {
    const token = await funded(2000);
    const dealt = await dealHiLo(token, "1k");
    const restored = await readHiLoRound(token);
    expect(restored.round?.id).toBe(dealt.round?.id);
    expect(restored.round?.baseCard).toEqual(dealt.round?.baseCard);
  });

  it("reports no round for a player who has never dealt", async () => {
    expect((await readHiLoRound(await funded())).round).toBeNull();
  });
});

describe("settlement", () => {
  it("leaves the player exactly netGold up or down over a whole round", async () => {
    // Repeated because the card is genuinely random: across this many rounds
    // the run covers wins, misses and the occasional tie, and the invariant
    // has to hold for every one.
    for (let n = 0; n < 30; n += 1) {
      const token = await funded(2000);
      const dealt = await dealHiLo(token, "1k");
      const call = dealt.round!.legal.higher ? "higher" : "lower";
      const settled = await playHiLoCall(token, {
        roundId: dealt.round!.id,
        version: dealt.round!.version,
        call,
      });
      expect(settled.round?.phase).toBe("settled");
      expect(settled.round?.drawnCard).toBeTruthy();
      expect(settled.profile.goldBalance).toBe(2000 + settled.round!.netGold);
    }
  });

  it("pays a win at exactly the price it quoted", async () => {
    for (let n = 0; n < 30; n += 1) {
      const token = await funded(2000);
      const dealt = await dealHiLo(token, "1k");
      const call = dealt.round!.legal.higher ? "higher" : "lower";
      const quoted = dealt.round!.odds[call].multiplier;
      const settled = await playHiLoCall(token, {
        roundId: dealt.round!.id,
        version: dealt.round!.version,
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

  it("frees the player to deal again once the round settles", async () => {
    const token = await funded(20000);
    const dealt = await dealHiLo(token, "1k");
    await playHiLoCall(token, {
      roundId: dealt.round!.id,
      version: dealt.round!.version,
      call: dealt.round!.legal.higher ? "higher" : "lower",
    });
    const next = await dealHiLo(token, "1k");
    expect(next.resumed).toBe(false);
    expect(next.round?.id).not.toBe(dealt.round?.id);
  });

  it("stakes an unlimited-Gold player nothing and pays them nothing", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await setUnlimitedGold(profile.id, true);
    const dealt = await dealHiLo(token, "500k");
    expect(dealt.round).not.toBeNull();
    // spendGold and creditGold are both no-ops for an unlimited profile, and
    // the arcade must not become the one place that mints from them.
    expect(dealt.profile.goldBalance).toBe(profile.goldBalance);
  });
});

describe("the version guard", () => {
  it("rejects a replayed call and does not draw a second card", async () => {
    const token = await funded(2000);
    const dealt = await dealHiLo(token, "1k");
    const call = dealt.round!.legal.higher ? "higher" : "lower";
    const settled = await playHiLoCall(token, {
      roundId: dealt.round!.id,
      version: dealt.round!.version,
      call,
    });
    const after = (await ensureProfile(token)).goldBalance;

    // The same request again -- a double-click, a retry, a replayed payload.
    // In Hi-Lo this would be a free re-roll of the only card that matters.
    await expect(
      playHiLoCall(token, { roundId: dealt.round!.id, version: dealt.round!.version, call }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await ensureProfile(token)).goldBalance).toBe(after);
    expect(settled.profile.goldBalance).toBe(after);
  });

  it("rejects a call pinned to a stale version", async () => {
    const token = await funded(2000);
    const dealt = await dealHiLo(token, "1k");
    await expect(
      playHiLoCall(token, {
        roundId: dealt.round!.id,
        version: dealt.round!.version + 5,
        call: dealt.round!.legal.higher ? "higher" : "lower",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await ensureProfile(token)).goldBalance).toBe(1000);
  });

  it("refuses a call addressed to a round the caller does not hold", async () => {
    const token = await funded(2000);
    const dealt = await dealHiLo(token, "1k");
    await expect(
      playHiLoCall(token, { roundId: randomUUID(), version: dealt.round!.version, call: "higher" }),
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
      const dealt = await dealHiLo(token, "1k");
      const dead = !dealt.round!.legal.higher ? "higher" : !dealt.round!.legal.lower ? "lower" : null;
      if (!dead) continue;

      expect(hiLoOdds(dealt.round!.baseCard)[dead].winners).toBe(0);
      await expect(
        playHiLoCall(token, { roundId: dealt.round!.id, version: dealt.round!.version, call: dead }),
      ).rejects.toMatchObject({ status: 409 });
      // The stake is still just the opening debit, and the round is untouched.
      expect((await ensureProfile(token)).goldBalance).toBe(1000);
      const live = await readHiLoRound(token);
      expect(live.round?.version).toBe(dealt.round!.version);
      expect(live.round?.drawnCard).toBeNull();
      return;
    }
    throw new Error("Never dealt a 2 or an ace in 200 rounds.");
  });
});

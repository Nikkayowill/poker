import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BlackjackRequestError,
  actOnBlackjackRound,
  dealBlackjackRound,
  readBlackjackRound,
} from "./blackjack-service";
import { __resetBlackjackRoundsForTest } from "./blackjack-store";
import { adjustGold, ensureProfile, setUnlimitedGold } from "./profile-store";

/**
 * The money contract, in memory mode.
 *
 * These deliberately do not stack a deck: dealBlackjackRound takes its
 * randomness from node:crypto by design, and a seam to override that would be
 * a seam an attacker would want too. Every assertion below is instead written
 * as an invariant that holds for whatever hand comes out --
 *
 *   final balance === starting balance + netGold
 *
 * -- which is a stronger statement than any single stacked outcome, because
 * it has to hold across wins, losses, pushes, naturals and busts alike. The
 * per-outcome payout arithmetic is pinned separately, on the pure function,
 * in lib/arcade/blackjack.test.ts.
 */

const STAKE = 1000;

async function funded(gold?: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  // adjustGold rejects a zero delta, and the starting balance already happens
  // to be what most of these want.
  const delta = gold === undefined ? 0 : gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return token;
}

/**
 * A round the player can still act on. Roughly one deal in ten settles on the
 * spot (a natural either way), so this retries with a fresh player rather
 * than being flaky one time in ten.
 */
async function playableRound(gold = 2000) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const token = await funded(gold);
    const result = await dealBlackjackRound(token, "1k");
    if (result.round?.phase === "player-turn") return { token, round: result.round, profile: result.profile };
  }
  throw new Error("Could not deal a round that needed a decision.");
}

beforeEach(() => {
  __resetBlackjackRoundsForTest();
});

describe("dealing", () => {
  it("debits the stake as the hand is dealt", async () => {
    const token = await funded(2000);
    const result = await dealBlackjackRound(token, "1k");
    expect(result.resumed).toBe(false);
    expect(result.round).not.toBeNull();
    // A hand that settled on the deal has already been paid; one still
    // running is simply down the stake.
    const expected = result.round!.phase === "settled" ? 2000 + result.round!.netGold : 1000;
    expect(result.profile.goldBalance).toBe(expected);
  });

  it("refuses a stake the wallet cannot cover, and charges nothing", async () => {
    const token = await funded(999);
    await expect(dealBlackjackRound(token, "1k")).rejects.toBeInstanceOf(BlackjackRequestError);
    const profile = await ensureProfile(token);
    expect(profile.goldBalance).toBe(999);
  });

  it("resumes a live round instead of dealing a second one", async () => {
    const { token, round } = await playableRound();
    const again = await dealBlackjackRound(token, "1k");
    expect(again.resumed).toBe(true);
    expect(again.round?.id).toBe(round.id);
    expect(again.round?.version).toBe(round.version);
    // The whole point: the second call must not take another stake.
    expect(again.profile.goldBalance).toBe(1000);
  });

  it("hands the same live round back to a page that reloads", async () => {
    const { token, round } = await playableRound();
    const restored = await readBlackjackRound(token);
    expect(restored.round?.id).toBe(round.id);
    expect(restored.round?.playerHand).toEqual(round.playerHand);
  });

  it("reports no round for a player who has never dealt", async () => {
    const restored = await readBlackjackRound(await funded());
    expect(restored.round).toBeNull();
  });

  it("never sends the undealt deck or the hole card to the caller", async () => {
    const { round } = await playableRound();
    expect("deck" in round).toBe(false);
    expect(round.dealerHand).toHaveLength(1);
    expect(round.dealerHoleHidden).toBe(true);
  });
});

describe("settlement", () => {
  it("leaves the player exactly netGold up or down over a whole hand", async () => {
    // Repeated because the outcome is genuinely random: over this many hands
    // the run covers wins, losses, pushes and busts, and the invariant has to
    // hold for every one of them.
    for (let hand = 0; hand < 25; hand += 1) {
      const token = await funded(2000);
      const dealt = await dealBlackjackRound(token, "1k");
      const finished = dealt.round!.phase === "settled"
        ? dealt
        : await actOnBlackjackRound(token, {
          roundId: dealt.round!.id,
          version: dealt.round!.version,
          action: "stand",
        });
      expect(finished.round?.phase).toBe("settled");
      expect(finished.profile.goldBalance).toBe(2000 + finished.round!.netGold);
    }
  });

  it("frees the player to deal again once a hand is settled", async () => {
    const { token, round } = await playableRound();
    const settled = await actOnBlackjackRound(token, {
      roundId: round.id,
      version: round.version,
      action: "stand",
    });
    const next = await dealBlackjackRound(token, "1k");
    expect(next.resumed).toBe(false);
    expect(next.round?.id).not.toBe(settled.round?.id);
  });

  it("stakes an unlimited-Gold player nothing and pays them nothing", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await setUnlimitedGold(profile.id, true);
    const dealt = await dealBlackjackRound(token, "500k");
    expect(dealt.round).not.toBeNull();
    // spendGold and creditGold are both no-ops for an unlimited profile, and
    // this table must not become the one place that mints from them.
    expect(dealt.profile.goldBalance).toBe(profile.goldBalance);
  });
});

describe("the version guard", () => {
  it("rejects an action pinned to a version that has moved on", async () => {
    const { token, round } = await playableRound();
    await actOnBlackjackRound(token, { roundId: round.id, version: round.version, action: "hit" });
    const before = (await ensureProfile(token)).goldBalance;

    // The same request again -- a double-click, a retry, a replayed payload.
    // Two rejections are possible and both are honest: 409 if the first hit
    // left the hand live at a new version, 404 if it busted and there is no
    // live round left to act on. What must never happen is a second card off
    // the same deck, so the assertion is on the invariant rather than on
    // whichever status this particular deal produced.
    await expect(
      actOnBlackjackRound(token, { roundId: round.id, version: round.version, action: "hit" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BlackjackRequestError && (error.status === 409 || error.status === 404),
    );
    expect((await ensureProfile(token)).goldBalance).toBe(before);

    const live = await readBlackjackRound(token);
    // Either settled (nothing live) or still on exactly the one card the
    // accepted hit drew -- never two.
    if (live.round) expect(live.round.playerHand).toHaveLength(round.playerHand.length + 1);
  });

  it("returns the true round with the conflict so a stale client can resync", async () => {
    const { token, round } = await playableRound();
    const advanced = await actOnBlackjackRound(token, {
      roundId: round.id,
      version: round.version,
      action: "hit",
    });
    try {
      await actOnBlackjackRound(token, { roundId: round.id, version: round.version, action: "stand" });
      expect.unreachable("a stale version must not be accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(BlackjackRequestError);
      const conflict = error as BlackjackRequestError;
      // Either the hand is still live at its new version, or the hit settled
      // it and there is nothing live to point at -- both are honest answers.
      if (conflict.round) expect(conflict.round.version).toBe(advanced.round!.version);
    }
  });

  it("refuses an action addressed to a round the caller does not hold", async () => {
    const { token, round } = await playableRound();
    await expect(
      actOnBlackjackRound(token, { roundId: randomUUID(), version: round.version, action: "hit" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to act when no round is live", async () => {
    const token = await funded();
    await expect(
      actOnBlackjackRound(token, { roundId: randomUUID(), version: 1, action: "hit" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("doubling", () => {
  it("takes a second stake and settles at the doubled wager", async () => {
    const { token, round } = await playableRound();
    const settled = await actOnBlackjackRound(token, {
      roundId: round.id,
      version: round.version,
      action: "double",
    });
    expect(settled.round?.doubled).toBe(true);
    expect(settled.round?.stake).toBe(STAKE * 2);
    expect(settled.round?.phase).toBe("settled");
    // 2000 in, 2000 staked across two debits, settled to netGold either way.
    expect(settled.profile.goldBalance).toBe(2000 + settled.round!.netGold);
  });

  it("refuses a double the wallet cannot cover, and takes nothing for it", async () => {
    // Exactly the opening stake and not a Gold more: enough to sit down,
    // never enough to double.
    const { token, round } = await playableRound(STAKE);
    expect((await ensureProfile(token)).goldBalance).toBe(0);
    await expect(
      actOnBlackjackRound(token, { roundId: round.id, version: round.version, action: "double" }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await ensureProfile(token)).goldBalance).toBe(0);

    // And the hand is untouched, so the player can still play it out.
    const live = await readBlackjackRound(token);
    expect(live.round?.version).toBe(round.version);
    expect(live.round?.playerHand).toEqual(round.playerHand);
  });

  it("refuses a double once the player has already hit", async () => {
    const { token, round } = await playableRound();
    const afterHit = await actOnBlackjackRound(token, {
      roundId: round.id,
      version: round.version,
      action: "hit",
    });
    if (afterHit.round?.phase !== "player-turn") return; // the hit ended it; nothing to assert
    expect(afterHit.round.legal.double).toBe(false);
    const before = (await ensureProfile(token)).goldBalance;
    await expect(
      actOnBlackjackRound(token, {
        roundId: afterHit.round.id,
        version: afterHit.round.version,
        action: "double",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await ensureProfile(token)).goldBalance).toBe(before);
  });
});

import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { stand, startRound } from "@/lib/arcade/blackjack";
import type { Card, Rank, Suit } from "@/lib/game/types";
import {
  ActiveBlackjackRoundExists,
  __resetBlackjackRoundsForTest,
  advanceBlackjackRound,
  createBlackjackRound,
  getActiveBlackjackRound,
} from "./blackjack-store";

/**
 * The two invariants the table's constraints enforce in Supabase, checked
 * against the memory branch that `npm test` and a no-env dev server actually
 * run on: one active round per profile, and a version that only advances from
 * the value the caller last saw.
 *
 * These matter more than they look. The version guard is what the service
 * uses as its settlement idempotency key -- if advanceBlackjackRound ever
 * returned a round for a stale version, a replayed Stand would pay twice.
 */

const suitOf: Record<string, Suit> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
function stacked(player: string[], dealer: string[], rest: string[] = []): Card[] {
  return [player[0], dealer[0], player[1], dealer[1], ...rest]
    .map((code) => ({ rank: code.slice(0, -1) as Rank, suit: suitOf[code.slice(-1)] }))
    .reverse();
}

/** A hand that is still the player's to act on. */
function liveRound() {
  return startRound({ stake: 1000, deck: stacked(["6S", "5H"], ["10D", "8C"], ["9C"]) });
}

beforeEach(() => {
  __resetBlackjackRoundsForTest();
});

async function open(profileId: string) {
  return createBlackjackRound({ profileId, tier: "1k", baseStake: 1000, round: liveRound() });
}

describe("one active round per profile", () => {
  it("stores a round and reads it back as the profile's live one", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    expect(stored.version).toBe(1);
    expect(stored.status).toBe("active");

    const found = await getActiveBlackjackRound(profileId);
    expect(found?.id).toBe(stored.id);
    expect(found?.round.playerHand).toEqual(stored.round.playerHand);
  });

  it("refuses a second live round for the same profile", async () => {
    const profileId = randomUUID();
    await open(profileId);
    await expect(open(profileId)).rejects.toBeInstanceOf(ActiveBlackjackRoundExists);
  });

  it("does not let one profile's round block another's", async () => {
    await open(randomUUID());
    await expect(open(randomUUID())).resolves.toBeTruthy();
  });

  it("frees the profile once the round settles", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    await advanceBlackjackRound(stored, stand(stored.round));
    expect(await getActiveBlackjackRound(profileId)).toBeNull();
    await expect(open(profileId)).resolves.toBeTruthy();
  });

  it("stores a round that settled on the deal as settled, not active", async () => {
    const profileId = randomUUID();
    const natural = startRound({ stake: 1000, deck: stacked(["AS", "KH"], ["10D", "8C"]) });
    const stored = await createBlackjackRound({ profileId, tier: "1k", baseStake: 1000, round: natural });
    expect(stored.status).toBe("settled");
    expect(await getActiveBlackjackRound(profileId)).toBeNull();
  });
});

describe("the version guard", () => {
  it("advances from the expected version and bumps it by one", async () => {
    const stored = await open(randomUUID());
    const next = await advanceBlackjackRound(stored, stand(stored.round));
    expect(next?.version).toBe(2);
    expect(next?.status).toBe("settled");
  });

  it("returns null for a stale version and leaves the round untouched", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    await advanceBlackjackRound(stored, { ...stored.round, playerHand: [...stored.round.playerHand] });

    // The same call again, still pinned to version 1.
    const replayed = await advanceBlackjackRound(stored, stand(stored.round));
    expect(replayed).toBeNull();

    const live = await getActiveBlackjackRound(profileId);
    expect(live?.version).toBe(2);
    expect(live?.round.phase).toBe("player-turn");
  });

  it("cannot settle a round twice", async () => {
    const stored = await open(randomUUID());
    const settled = await advanceBlackjackRound(stored, stand(stored.round));
    expect(settled).not.toBeNull();
    // A second settlement attempt against the now-settled row -- the shape a
    // retried request takes. Null here is what stops a second payout.
    expect(await advanceBlackjackRound(settled!, stand(stored.round))).toBeNull();
  });

  it("returns null for a round that does not exist", async () => {
    const stored = await open(randomUUID());
    __resetBlackjackRoundsForTest();
    expect(await advanceBlackjackRound(stored, stand(stored.round))).toBeNull();
  });
});

describe("isolation", () => {
  it("hands back copies, so a caller cannot reach into the store", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    stored.round.playerHand.push({ rank: "A", suit: "spades" });
    stored.round.deck.length = 0;

    const live = await getActiveBlackjackRound(profileId);
    expect(live?.round.playerHand).toHaveLength(2);
    expect(live?.round.deck.length).toBeGreaterThan(0);
  });
});

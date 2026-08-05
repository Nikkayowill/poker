import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ActiveArcadeRoundExists,
  __resetArcadeRoundsForTest,
  advanceArcadeRound,
  createArcadeRound,
  getActiveArcadeRound,
} from "./arcade-round-store";

/**
 * The invariants the table's constraints enforce in Supabase, checked against
 * the memory branch that `npm test` and a no-env dev server run on: one active
 * round per (profile, GAME), and a version that only advances from the value
 * the caller last saw.
 *
 * The version guard is what every service uses as its settlement idempotency
 * key -- if advanceArcadeRound ever returned a round for a stale version, a
 * replayed call would pay twice.
 */

interface Fake {
  step: number;
  card: string;
}

const fake = (step = 1): Fake => ({ step, card: "7S" });

beforeEach(() => {
  __resetArcadeRoundsForTest();
});

async function open(profileId: string, game = "hi-lo", settled = false) {
  return createArcadeRound<Fake>({
    profileId,
    game,
    tier: "1k",
    baseStake: 1000,
    round: fake(),
    settled,
  });
}

describe("one active round per profile per game", () => {
  it("stores a round and reads it back", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    expect(stored.version).toBe(1);
    expect(stored.status).toBe("active");
    expect(stored.game).toBe("hi-lo");

    const found = await getActiveArcadeRound<Fake>(profileId, "hi-lo");
    expect(found?.id).toBe(stored.id);
    expect(found?.round).toEqual(fake());
  });

  it("refuses a second live round of the same game", async () => {
    const profileId = randomUUID();
    await open(profileId, "hi-lo");
    await expect(open(profileId, "hi-lo")).rejects.toBeInstanceOf(ActiveArcadeRoundExists);
  });

  it("lets one player sit at two different games at once", async () => {
    // The whole reason the index is on (profile_id, game) and not profile_id:
    // Hi-Lo and the next game are different tables in the lounge.
    const profileId = randomUUID();
    const hiLo = await open(profileId, "hi-lo");
    const other = await open(profileId, "coin-flip");
    expect(other.id).not.toBe(hiLo.id);
    expect((await getActiveArcadeRound<Fake>(profileId, "hi-lo"))?.id).toBe(hiLo.id);
    expect((await getActiveArcadeRound<Fake>(profileId, "coin-flip"))?.id).toBe(other.id);
  });

  it("does not let one profile's round block another's", async () => {
    await open(randomUUID());
    await expect(open(randomUUID())).resolves.toBeTruthy();
  });

  it("does not hand one player another player's round", async () => {
    const mine = randomUUID();
    await open(mine);
    expect(await getActiveArcadeRound<Fake>(randomUUID(), "hi-lo")).toBeNull();
  });

  it("frees the game once the round settles", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    await advanceArcadeRound<Fake>(stored, fake(2), true);
    expect(await getActiveArcadeRound<Fake>(profileId, "hi-lo")).toBeNull();
    await expect(open(profileId)).resolves.toBeTruthy();
  });

  it("stores a round that settled on the deal as settled, not active", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId, "hi-lo", true);
    expect(stored.status).toBe("settled");
    expect(await getActiveArcadeRound<Fake>(profileId, "hi-lo")).toBeNull();
  });
});

describe("the version guard", () => {
  it("advances from the expected version and bumps it by one", async () => {
    const stored = await open(randomUUID());
    const next = await advanceArcadeRound<Fake>(stored, fake(2), true);
    expect(next?.version).toBe(2);
    expect(next?.status).toBe("settled");
    expect(next?.round).toEqual(fake(2));
  });

  it("returns null for a stale version and leaves the round untouched", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    await advanceArcadeRound<Fake>(stored, fake(2), false);

    // The same call again, still pinned to version 1.
    expect(await advanceArcadeRound<Fake>(stored, fake(99), false)).toBeNull();

    const live = await getActiveArcadeRound<Fake>(profileId, "hi-lo");
    expect(live?.version).toBe(2);
    expect(live?.round).toEqual(fake(2));
  });

  it("cannot settle a round twice", async () => {
    const stored = await open(randomUUID());
    const settled = await advanceArcadeRound<Fake>(stored, fake(2), true);
    expect(settled).not.toBeNull();
    // The shape a retried request takes. Null here is what stops a second payout.
    expect(await advanceArcadeRound<Fake>(settled!, fake(3), true)).toBeNull();
  });

  it("returns null for a round that does not exist", async () => {
    const stored = await open(randomUUID());
    __resetArcadeRoundsForTest();
    expect(await advanceArcadeRound<Fake>(stored, fake(2), true)).toBeNull();
  });
});

describe("isolation", () => {
  it("hands back copies, so a caller cannot reach into the store", async () => {
    const profileId = randomUUID();
    const stored = await open(profileId);
    stored.round.step = 999;

    expect((await getActiveArcadeRound<Fake>(profileId, "hi-lo"))?.round.step).toBe(1);
  });
});

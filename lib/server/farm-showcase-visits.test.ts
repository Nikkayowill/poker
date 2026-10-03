import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  __resetFriendsMemory,
  blockProfile,
  respondToFriendRequest,
  sendFriendRequest,
} from "./friends-store";
import { __resetStackAcresForTest } from "./stackacres-store";
import { __resetStackAcresRevisionsForTest } from "./stackacres-revision-store";
import { __resetStackAcresSeedStockForTest } from "./stackacres-seed-store";
import { __resetStackAcresSoilTilesForTest } from "./stackacres-soil-store";
import { resetStoneNodeStoreForTests } from "./stone-node-store";
import { __resetStackAcresShowcaseForTest, writeFarmVisibility } from "./stackacres-showcase-store";
import { readFarmShowcase, reactToFarmShowcase } from "./farm-showcase-visits";
import { readShowcaseSettings, setShowcaseVisibility } from "./stackacres-showcase-service";
import { readStackAcres, stockStackAcres } from "./stackacres-service";

/**
 * Visitor Mode's authorization, and the promise that a visitor cannot change
 * anything.
 *
 * WHAT THIS FILE IS REALLY FOR. Two claims carry the whole feature: that only
 * the people the owner chose can open their farm, and that whoever does open
 * it cannot touch it or read their purse. Both are asserted here against the
 * real stores in memory mode rather than against mocks, because a mocked
 * friendship would pass this suite while the live one refused -- or worse,
 * the other way around.
 *
 * Every refusal is checked for its STATUS as well as its text: the whole
 * design is that a private farm, a stranger's friends-only farm, a block and
 * an id that never existed are indistinguishable from outside.
 */

const NOW = new Date("2026-09-30T12:00:00.000Z");

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, id: profile.id };
}

async function befriend(a: string, b: string) {
  const sent = await sendFriendRequest(a, b);
  if (sent.status !== "sent") throw new Error(`expected sent, got ${sent.status}`);
  const accepted = await respondToFriendRequest(b, sent.requestId, "accept");
  if (accepted.status !== "accepted") throw new Error(`expected accepted, got ${accepted.status}`);
}

/** The one refusal every closed door gives. */
async function expectClosed(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    status: 404,
    message: "That farm isn't open to visitors.",
  });
}

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresSeedStockForTest();
  __resetStackAcresSoilTilesForTest();
  __resetStackAcresRevisionsForTest();
  __resetStackAcresShowcaseForTest();
  __resetFriendsMemory();
  resetStoneNodeStoreForTests();
});

describe("who gets in", () => {
  it("starts every farm private, with no row written", async () => {
    const owner = await newPlayer("Owner");
    expect((await readShowcaseSettings(owner.token)).visibility).toBe("private");
  });

  it("refuses a friend while the farm is private", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);

    await expectClosed(readFarmShowcase(friend.token, owner.id, NOW));
  });

  it("lets a friend in once the farm is friends-only", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");

    const showcase = await readFarmShowcase(friend.token, owner.id, NOW);
    expect(showcase.owner.profileId).toBe(owner.id);
    expect(showcase.own).toBe(false);
  });

  it("refuses a stranger on a friends-only farm", async () => {
    const [owner, stranger] = [await newPlayer("Owner"), await newPlayer("Stranger")];
    await setShowcaseVisibility(owner.token, "friends");

    await expectClosed(readFarmShowcase(stranger.token, owner.id, NOW));
  });

  it("refuses someone the owner blocked, even though they are on the friends list", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");
    await blockProfile(owner.id, friend.id);

    await expectClosed(readFarmShowcase(friend.token, owner.id, NOW));
  });

  it("refuses someone who blocked the OWNER, not just the other way round", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");
    await blockProfile(friend.id, owner.id);

    await expectClosed(readFarmShowcase(friend.token, owner.id, NOW));
  });

  it("answers a profile id that never existed exactly like a closed farm", async () => {
    const visitor = await newPlayer("Visitor");
    await expectClosed(readFarmShowcase(visitor.token, randomUUID(), NOW));
  });

  it("never refuses the owner their own farm, whatever the setting", async () => {
    const owner = await newPlayer("Owner");
    const showcase = await readFarmShowcase(owner.token, owner.id, NOW);
    expect(showcase.own).toBe(true);
  });

  it("closes the door again when the owner goes back to private", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");
    await readFarmShowcase(friend.token, owner.id, NOW);

    await setShowcaseVisibility(owner.token, "private");
    await expectClosed(readFarmShowcase(friend.token, owner.id, NOW));
  });

  it("refuses a caller with no profile behind their token", async () => {
    const owner = await newPlayer("Owner");
    await writeFarmVisibility(owner.id, "friends");

    await expect(readFarmShowcase(randomUUID(), owner.id, NOW)).rejects.toMatchObject({ status: 401 });
  });
});

describe("what a visitor is shown", () => {
  /** A friend's farm with something on it and Gold in the owner's purse. */
  async function openFarm() {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");
    await adjustGold(owner.id, 40_000);
    await stockStackAcres(owner.token, { stock: "hen" }, NOW);
    return { owner, friend };
  }

  it("carries the layout, so the visitor sees a real farm rather than a card", async () => {
    const { owner, friend } = await openFarm();

    const showcase = await readFarmShowcase(friend.token, owner.id, NOW);
    expect(showcase.world.units.map((unit) => unit.stock)).toContain("hen");
    expect(showcase.stats.favoriteProduction?.stock).toBe("hen");
    expect(showcase.stats.farmLevel).toBeGreaterThanOrEqual(1);
    expect(showcase.stats.chapter?.number).toBe(1);
  });

  it("carries none of the owner's money or private progress", async () => {
    const { owner, friend } = await openFarm();
    const mine = await readStackAcres(owner.token, NOW);

    const showcase = await readFarmShowcase(friend.token, owner.id, NOW);

    // The shape, first: these are the fields a leak would have to travel in.
    expect(Object.keys(showcase).sort()).toEqual(
      ["owner", "own", "reactions", "sent", "stats", "world"].sort(),
    );
    for (const key of ["profile", "inventory", "seedStock", "secrets", "story", "contract", "upkeep", "energy", "friendship", "empire", "influence", "feed", "water"]) {
      expect(showcase).not.toHaveProperty(key);
      expect(showcase.world).not.toHaveProperty(key);
      expect(showcase.stats).not.toHaveProperty(key);
    }
    // And then the values, in case a future field carries one under another
    // name: the owner's balance is a distinctive number and it must not be
    // anywhere in what crosses the wire.
    expect(mine.profile.goldBalance).toBeGreaterThan(0);
    expect(JSON.stringify(showcase)).not.toContain(String(mine.profile.goldBalance));
    expect(JSON.stringify(showcase)).not.toContain("goldBalance");
  });

  it("leaves the grocery till behind when it sends the grocery floor", async () => {
    const { owner, friend } = await openFarm();

    const showcase = await readFarmShowcase(friend.token, owner.id, NOW);
    if (showcase.world.grocery) {
      expect(Object.keys(showcase.world.grocery).sort()).toEqual(["layout", "staff"]);
    } else {
      // An owner who has not bought the store sends no grocery at all, which
      // is the other half of the same rule.
      expect(showcase.world.grocery).toBeNull();
    }
  });

  it("sends no revision, because a visitor has no pending actions to compare", async () => {
    const { owner, friend } = await openFarm();
    const showcase = await readFarmShowcase(friend.token, owner.id, NOW);
    expect(showcase).not.toHaveProperty("revision");
  });
});

describe("a visitor cannot change the farm", () => {
  /**
   * THE STRUCTURAL PROOF, not a disabled button.
   *
   * Every farm mutation resolves the farm from the CALLER'S OWN session token
   * and takes no parameter for whose farm to act on. So the strongest thing a
   * visitor can do with a farm action is farm their own land: the action they
   * send lands on their farm, and the farm they were looking at is untouched.
   */
  it("acts on the visitor's own farm, never the one they were looking at", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");
    await adjustGold(friend.id, 40_000);

    const before = await readFarmShowcase(friend.token, owner.id, NOW);
    await stockStackAcres(friend.token, { stock: "hen" }, NOW);
    const after = await readFarmShowcase(friend.token, owner.id, NOW);

    expect(before.world.units).toHaveLength(0);
    expect(after.world.units).toHaveLength(0);
    // The hen went onto the visitor's own farm, which is where it belongs.
    expect((await readStackAcres(friend.token, NOW)).units.map((unit) => unit.stock)).toEqual(["hen"]);
  });

  it("does not let a visitor change the owner's own visitor setting", async () => {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");

    // The setting is keyed on the caller's token and nothing else, so this is
    // the friend opening their OWN farm up, not the owner's closing down.
    await setShowcaseVisibility(friend.token, "private");

    expect((await readShowcaseSettings(owner.token)).visibility).toBe("friends");
    expect((await readShowcaseSettings(friend.token)).visibility).toBe("private");
  });
});

describe("reactions", () => {
  async function openFarm() {
    const [owner, friend] = [await newPlayer("Owner"), await newPlayer("Friend")];
    await befriend(owner.id, friend.id);
    await setShowcaseVisibility(owner.token, "friends");
    return { owner, friend };
  }

  it("counts a friend's compliment once, however many times they send it", async () => {
    const { owner, friend } = await openFarm();

    const first = await reactToFarmShowcase(friend.token, owner.id, "nice_layout");
    expect(first.counted).toBe(true);
    expect(first.reactions.nice_layout).toBe(1);
    expect(first.sent).toEqual(["nice_layout"]);

    const second = await reactToFarmShowcase(friend.token, owner.id, "nice_layout");
    expect(second.counted).toBe(false);
    expect(second.reactions.nice_layout).toBe(1);
  });

  it("keeps the three kinds apart", async () => {
    const { owner, friend } = await openFarm();
    await reactToFarmShowcase(friend.token, owner.id, "nice_layout");
    const result = await reactToFarmShowcase(friend.token, owner.id, "great_farm");

    expect(result.reactions).toMatchObject({
      nice_layout: 1,
      great_farm: 1,
      impressive_production: 0,
    });
  });

  it("shows the owner the tally on their own setting", async () => {
    const { owner, friend } = await openFarm();
    await reactToFarmShowcase(friend.token, owner.id, "great_farm");

    expect((await readShowcaseSettings(owner.token)).reactions.great_farm).toBe(1);
  });

  it("refuses a reaction from someone who could not open the farm", async () => {
    const [owner, stranger] = [await newPlayer("Owner"), await newPlayer("Stranger")];
    await setShowcaseVisibility(owner.token, "friends");

    await expectClosed(reactToFarmShowcase(stranger.token, owner.id, "nice_layout"));
    expect((await readShowcaseSettings(owner.token)).reactions.nice_layout).toBe(0);
  });

  it("refuses a reaction on a farm that has gone private again", async () => {
    const { owner, friend } = await openFarm();
    await setShowcaseVisibility(owner.token, "private");

    await expectClosed(reactToFarmShowcase(friend.token, owner.id, "nice_layout"));
  });

  it("refuses a reaction on the sender's own farm", async () => {
    const owner = await newPlayer("Owner");

    await expect(reactToFarmShowcase(owner.token, owner.id, "great_farm")).rejects.toMatchObject({
      status: 400,
    });
    expect((await readShowcaseSettings(owner.token)).reactions.great_farm).toBe(0);
  });

  it("reports what the viewer has already left, so the buttons can show as spent", async () => {
    const { owner, friend } = await openFarm();
    await reactToFarmShowcase(friend.token, owner.id, "impressive_production");

    const showcase = await readFarmShowcase(friend.token, owner.id, NOW);
    expect(showcase.sent).toEqual(["impressive_production"]);
    expect(showcase.reactions.impressive_production).toBe(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  getStackAcresFenceSegment,
  upgradeStackAcresFenceSegment,
  StackAcresDefenseRequestError,
} from "./stackacres-defense-service";
import { __resetStackAcresDefenseForTest, getFenceSegment } from "./stackacres-defense-store";
import { FENCE_TIER_MAX_DURABILITY } from "@/lib/stackacres/wildlife";

const TOKEN = "token-1";

beforeEach(() => {
  __resetStackAcresDefenseForTest();
});

describe("getStackAcresFenceSegment", () => {
  it("reads Basic Wood, version 0 for an untouched bay", async () => {
    const segment = await getStackAcresFenceSegment(TOKEN, "farmstead", 2);
    expect(segment.tier).toBe("wood");
    expect(segment.version).toBe(0);
  });

  it("reflects an upgrade made by the same token", async () => {
    const written = await upgradeStackAcresFenceSegment(TOKEN, "farmstead", 2, 0);
    const read = await getStackAcresFenceSegment(TOKEN, "farmstead", 2);
    expect(read.tier).toBe("wire");
    expect(read.version).toBe(written.version);
  });
});

describe("upgradeStackAcresFenceSegment", () => {
  it("upgrades an untouched (Basic Wood) bay to Reinforced Wire", async () => {
    const written = await upgradeStackAcresFenceSegment(TOKEN, "wallow", 0, 0);
    expect(written.tier).toBe("wire");
    expect(written.durability).toBe(FENCE_TIER_MAX_DURABILITY.wire);
    expect(written.version).toBe(1);

    const read = await getFenceSegment(written.profileId, "wallow", 0);
    expect(read.tier).toBe("wire");
  });

  it("walks the ladder a second time to Steel Mesh", async () => {
    const first = await upgradeStackAcresFenceSegment(TOKEN, "wallow", 0, 0);
    const second = await upgradeStackAcresFenceSegment(TOKEN, "wallow", 0, first.version);
    expect(second.tier).toBe("steel");
    expect(second.durability).toBe(FENCE_TIER_MAX_DURABILITY.steel);
  });

  it("refuses to upgrade past Steel Mesh", async () => {
    const first = await upgradeStackAcresFenceSegment(TOKEN, "wallow", 0, 0);
    const second = await upgradeStackAcresFenceSegment(TOKEN, "wallow", 0, first.version);
    await expect(upgradeStackAcresFenceSegment(TOKEN, "wallow", 0, second.version)).rejects.toMatchObject({
      reason: "already-max-tier",
    });
  });

  it("throws for an unknown zone", async () => {
    await expect(upgradeStackAcresFenceSegment(TOKEN, "not-a-zone", 0, 0)).rejects.toThrow(StackAcresDefenseRequestError);
  });

  it("refuses a stale-version upgrade attempt and hands back the current segment", async () => {
    await upgradeStackAcresFenceSegment(TOKEN, "farmstead", 3, 0);
    await expect(upgradeStackAcresFenceSegment(TOKEN, "farmstead", 3, 0)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("scopes segments per player: two profiles upgrading the same (zone, index) do not collide", async () => {
    const mine = await upgradeStackAcresFenceSegment("token-a", "oxfields", 1, 0);
    const theirs = await upgradeStackAcresFenceSegment("token-b", "oxfields", 1, 0);
    expect(mine.profileId).not.toBe(theirs.profileId);
    expect(mine.tier).toBe("wire");
    expect(theirs.tier).toBe("wire");
  });
});

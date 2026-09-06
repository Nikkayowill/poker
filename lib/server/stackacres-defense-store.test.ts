import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetStackAcresDefenseForTest,
  getFenceSegment,
  getLivestockHealth,
  getPredatorWave,
  listFenceSegments,
  savePredatorWave,
  writeFenceSegment,
  writeLivestockHealth,
} from "./stackacres-defense-store";
import { FENCE_TIER_MAX_DURABILITY, LIVESTOCK_MAX_HEALTH } from "@/lib/stackacres/wildlife";

const PROFILE = "profile-1";

beforeEach(() => {
  __resetStackAcresDefenseForTest();
});

describe("fence segments (memory mode)", () => {
  it("defaults an untouched segment to Basic Wood at full durability, version 0", async () => {
    const segment = await getFenceSegment(PROFILE, "wallow", 0);
    expect(segment.tier).toBe("wood");
    expect(segment.durability).toBe(FENCE_TIER_MAX_DURABILITY.wood);
    expect(segment.version).toBe(0);
  });

  it("round-trips an upgrade: write, then read back the same state", async () => {
    const written = await writeFenceSegment(PROFILE, "wallow", 0, 0, "steel", FENCE_TIER_MAX_DURABILITY.steel);
    expect(written).not.toBeNull();
    expect(written?.tier).toBe("steel");
    expect(written?.version).toBe(1);

    const read = await getFenceSegment(PROFILE, "wallow", 0);
    expect(read.tier).toBe("steel");
    expect(read.durability).toBe(FENCE_TIER_MAX_DURABILITY.steel);
    expect(read.version).toBe(1);
  });

  it("refuses a write against a stale version", async () => {
    await writeFenceSegment(PROFILE, "wallow", 0, 0, "wire", FENCE_TIER_MAX_DURABILITY.wire);
    const lost = await writeFenceSegment(PROFILE, "wallow", 0, 0, "steel", FENCE_TIER_MAX_DURABILITY.steel);
    expect(lost).toBeNull();
    // The first write's state must be untouched by the lost race.
    const read = await getFenceSegment(PROFILE, "wallow", 0);
    expect(read.tier).toBe("wire");
    expect(read.version).toBe(1);
  });

  it("refuses a duplicate first-write race (expectedVersion 0 twice)", async () => {
    const first = await writeFenceSegment(PROFILE, "meadow", 2, 0, "wire", FENCE_TIER_MAX_DURABILITY.wire);
    const second = await writeFenceSegment(PROFILE, "meadow", 2, 0, "wire", FENCE_TIER_MAX_DURABILITY.wire);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("clamps durability into [0, tier max]", async () => {
    const written = await writeFenceSegment(PROFILE, "oxfields", 5, 0, "wood", -50);
    expect(written?.durability).toBe(0);
    const written2 = await writeFenceSegment(PROFILE, "oxfields", 5, written!.version, "wood", 9999);
    expect(written2?.durability).toBe(FENCE_TIER_MAX_DURABILITY.wood);
  });

  it("keeps segments scoped per zone and per profile", async () => {
    await writeFenceSegment(PROFILE, "wallow", 0, 0, "steel", FENCE_TIER_MAX_DURABILITY.steel);
    await writeFenceSegment("profile-2", "wallow", 0, 0, "wire", FENCE_TIER_MAX_DURABILITY.wire);
    const mine = await listFenceSegments(PROFILE, "wallow");
    expect(mine).toHaveLength(1);
    expect(mine[0].tier).toBe("steel");
  });
});

describe("livestock health (memory mode)", () => {
  it("defaults to full health, version 0", async () => {
    const health = await getLivestockHealth(PROFILE, "wallow");
    expect(health.health).toBe(LIVESTOCK_MAX_HEALTH);
    expect(health.version).toBe(0);
  });

  it("round-trips damage and clamps at zero", async () => {
    const first = await writeLivestockHealth(PROFILE, "wallow", 0, 40);
    expect(first?.health).toBe(40);
    const second = await writeLivestockHealth(PROFILE, "wallow", first!.version, -20);
    expect(second?.health).toBe(0);
    const read = await getLivestockHealth(PROFILE, "wallow");
    expect(read.health).toBe(0);
    expect(read.version).toBe(2);
  });

  it("a lost race never applies its damage", async () => {
    await writeLivestockHealth(PROFILE, "wallow", 0, 60);
    const lost = await writeLivestockHealth(PROFILE, "wallow", 0, 10);
    expect(lost).toBeNull();
    const read = await getLivestockHealth(PROFILE, "wallow");
    expect(read.health).toBe(60);
  });
});

describe("predator wave (memory mode)", () => {
  it("defaults to inactive with no predators", async () => {
    const wave = await getPredatorWave(PROFILE);
    expect(wave.active).toBe(false);
    expect(wave.predators).toEqual([]);
    expect(wave.version).toBe(0);
  });

  it("round-trips an active wave with predators", async () => {
    const predator = {
      id: "wolf-1",
      kind: "wolf" as const,
      x: 12,
      y: -8,
      state: "seeking" as const,
      health: 100,
      attackCooldownMs: 0,
    };
    const saved = await savePredatorWave(PROFILE, 0, true, [predator]);
    expect(saved?.active).toBe(true);
    expect(saved?.predators).toEqual([predator]);

    const read = await getPredatorWave(PROFILE);
    expect(read.active).toBe(true);
    expect(read.predators).toEqual([predator]);
    expect(read.version).toBe(1);
  });

  it("refuses a stale wave write", async () => {
    await savePredatorWave(PROFILE, 0, true, []);
    const lost = await savePredatorWave(PROFILE, 0, false, []);
    expect(lost).toBeNull();
  });
});

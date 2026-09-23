import { describe, expect, it } from "vitest";
import { BURST_MS, FLY_MS, THROW_MS, makeShards, shardAt, shardGrid } from "./shards";

const seeded = (): (() => number) => {
  let s = 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

const pixels = [
  { x: 10, y: 0, colour: 0x335522 },
  { x: 0, y: 0, colour: 0x664422 },
  { x: -10, y: 0, colour: 0x224411 },
];
const farmer = { x: 40, y: 20 };

describe("a burst of shards", () => {
  const shards = makeShards(pixels, { x: 0, y: 0 }, farmer, 1, seeded());

  it("starts every shard on its own pixel, in its own colour", () => {
    for (const shard of shards) {
      const frame = shardAt(shard, 0, farmer);
      expect(frame).toMatchObject({ x: shard.from.x, y: shard.from.y, arrived: false });
      expect(pixels.some((p) => p.x === shard.from.x && p.colour === shard.colour)).toBe(true);
    }
  });

  it("throws them outward from the middle", () => {
    const right = shards.find((s) => s.from.x === 10)!;
    const left = shards.find((s) => s.from.x === -10)!;
    expect(right.out.x).toBeGreaterThan(right.from.x);
    expect(left.out.x).toBeLessThan(left.from.x);
    expect(shardAt(right, THROW_MS, farmer).x).toBeCloseTo(right.out.x);
  });

  it("sends the nearest piece first, so they reach him as a stream", () => {
    expect(shards[0].from.x).toBe(10);
    expect(shards[0].leaveMs).toBeLessThan(shards[2].leaveMs);
  });

  it("lands every shard on him by the end of the burst, shrunk and glowing", () => {
    for (const shard of shards) {
      const end = shardAt(shard, shard.leaveMs + FLY_MS, farmer);
      expect(end.arrived).toBe(true);
      expect(end.x).toBeCloseTo(farmer.x);
      expect(end.y).toBeCloseTo(farmer.y);
      expect(end.glow).toBe(1);
      expect(end.size).toBeLessThan(1);
      expect(shard.leaveMs + FLY_MS).toBeLessThanOrEqual(BURST_MS);
    }
  });

  it("follows him if he moves while they fly", () => {
    const moved = { x: 60, y: 30 };
    const end = shardAt(shards[1], shards[1].leaveMs + FLY_MS, moved);
    expect(end.x).toBeCloseTo(moved.x);
  });

  it("throws the chips of one swing less far than a tree coming down", () => {
    const chips = makeShards(pixels, { x: 0, y: 0 }, farmer, 0.2, seeded());
    const far = (list: typeof shards) => Math.max(...list.map((s) => Math.hypot(s.out.x - s.from.x, s.out.y - s.from.y)));
    expect(far(chips)).toBeLessThan(far(shards));
  });
});

describe("shardGrid", () => {
  it("keeps a big picture near the cap and a small one at every pixel", () => {
    expect(shardGrid(8, 8, 200)).toBe(1);
    const step = shardGrid(64, 96, 180);
    expect(Math.ceil(64 / step) * Math.ceil(96 / step) * 0.55).toBeLessThanOrEqual(180);
  });
});

import { describe, expect, it } from "vitest";
import { HORDE } from "./content";
import { spawnInterval, waveMix, waveQueue } from "./waves";

describe("wave mix", () => {
  it("grows every wave", () => {
    for (let n = 1; n < 20; n += 1) {
      const now = waveMix(n, 1);
      const next = waveMix(n + 1, 1);
      expect(next.walker).toBeGreaterThan(now.walker);
      expect(next.runner).toBeGreaterThanOrEqual(now.runner);
    }
  });

  it("brings bloaters from wave 4, a few more every second wave", () => {
    expect(waveMix(3, 1).bloater).toBe(0);
    expect(waveMix(4, 1).bloater).toBe(1);
    expect(waveMix(6, 1).bloater).toBe(2);
    expect(waveMix(10, 1).bloater).toBe(4);
  });

  it("brings riot zombies from wave 6, a few more every second wave", () => {
    expect(waveMix(5, 1).armored).toBe(0);
    expect(waveMix(6, 1).armored).toBe(1);
    expect(waveMix(8, 1).armored).toBe(2);
    expect(waveMix(12, 1).armored).toBe(4);
    expect(waveMix(8, 1.25).armored).toBeGreaterThan(waveMix(8, 0.8).armored - 1);
  });

  it("brings runners from wave 3 and a brute every fifth wave", () => {
    expect(waveMix(1, 1).runner).toBe(0);
    expect(waveMix(2, 1).runner).toBe(0);
    expect(waveMix(3, 1).runner).toBeGreaterThan(0);
    expect(waveMix(4, 1).brute).toBe(0);
    expect(waveMix(5, 1).brute).toBe(1);
    expect(waveMix(10, 1).brute).toBe(2);
    expect(waveMix(15, 1).brute).toBe(3);
  });

  it("scales the crowd with the difficulty", () => {
    expect(waveMix(6, 0.8).walker).toBeLessThan(waveMix(6, 1).walker);
    expect(waveMix(6, 1).walker).toBeLessThan(waveMix(6, 1.25).walker);
  });

  it("never asks for an empty wave", () => {
    expect(waveMix(0, 0.1).walker).toBeGreaterThanOrEqual(1);
  });
});

describe("spawn pace", () => {
  it("starts relaxed, speeds up and then holds", () => {
    expect(spawnInterval(1)).toBeCloseTo(HORDE.spawnInterval.start, 6);
    expect(spawnInterval(6)).toBeLessThan(spawnInterval(1));
    expect(spawnInterval(HORDE.rampWaves + 1)).toBeCloseTo(HORDE.spawnInterval.end, 6);
    expect(spawnInterval(HORDE.rampWaves + 40)).toBeCloseTo(HORDE.spawnInterval.end, 6);
  });
});

describe("wave queue", () => {
  const seeded = () => {
    let x = 0.31;
    return () => (x = (x * 9301 + 0.49297) % 1);
  };

  it("holds exactly the mix", () => {
    const queue = waveQueue(10, 1, seeded());
    const mix = waveMix(10, 1);
    expect(queue.filter((kind) => kind === "walker")).toHaveLength(mix.walker);
    expect(queue.filter((kind) => kind === "runner")).toHaveLength(mix.runner);
    expect(queue.filter((kind) => kind === "bloater")).toHaveLength(mix.bloater);
    expect(queue.filter((kind) => kind === "armored")).toHaveLength(mix.armored);
    expect(queue.filter((kind) => kind === "brute")).toHaveLength(mix.brute);
  });

  it("sends the crowd first and holds the brutes back to the middle", () => {
    const queue = waveQueue(10, 1, seeded());
    const first = queue.indexOf("brute");
    expect(first).toBeGreaterThan(queue.length / 4);
    expect(queue.slice(0, first).every((kind) => kind !== "brute")).toBe(true);
  });

  it("shuffles, so two waves are not the same order", () => {
    expect(waveQueue(8, 1, seeded())).not.toEqual(waveQueue(8, 1, () => 0.99));
  });
});

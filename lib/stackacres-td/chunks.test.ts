import { describe, expect, it } from "vitest";
import {
  CHUNKS_PER_BREAK,
  HOPS,
  MAGNET_REACH,
  MAGNET_TOP_SPEED,
  SETTLE_MS,
  chunkAt,
  chunkRests,
  fallAngle,
  fallSide,
  flyToward,
  inMagnetReach,
} from "./chunks";

describe("a felled tree", () => {
  it("falls away from the farmer", () => {
    expect(fallSide(120, 100)).toBe(-1);
    expect(fallSide(80, 100)).toBe(1);
    expect(fallSide(100, 100)).toBe(1);
  });

  it("tips from standing to flat, slowly and then fast", () => {
    expect(fallAngle(0, 1)).toBe(0);
    expect(fallAngle(1, -1)).toBeCloseTo(-Math.PI / 2);
    expect(fallAngle(0.5, 1)).toBeLessThan(Math.PI / 4);
  });

  it("breaks into three chunks lying on the side it fell", () => {
    const rests = chunkRests(CHUNKS_PER_BREAK.tree, -1);
    expect(rests).toHaveLength(3);
    for (const rest of rests) expect(rest.x).toBeLessThan(0);
  });
});

describe("chunkRests", () => {
  it("keeps every chunk within two tiles of where it broke", () => {
    for (const fell of [-1, 1, null] as const) {
      for (const rest of chunkRests(3, fell)) {
        expect(Math.abs(rest.x)).toBeLessThanOrEqual(MAGNET_REACH);
        expect(Math.abs(rest.y)).toBeLessThanOrEqual(MAGNET_REACH);
      }
    }
  });

  it("scatters a broken rock rather than stacking it", () => {
    const rests = chunkRests(3, null);
    expect(new Set(rests.map((rest) => `${rest.x},${rest.y}`)).size).toBe(3);
  });
});

describe("chunkAt", () => {
  const from = { x: 0, y: 0 };
  const rest = { x: 10, y: 4 };

  it("lands on its rest spot at the end of the first hop and stays there", () => {
    expect(chunkAt(from, rest, HOPS[0].ms).ground).toEqual(rest);
    expect(chunkAt(from, rest, SETTLE_MS + 100)).toEqual({ ground: rest, lift: 0 });
  });

  it("bounces lower each time", () => {
    const peak = (index: number) => {
      const start = HOPS.slice(0, index).reduce((sum, hop) => sum + hop.ms, 0);
      return chunkAt(from, rest, start + HOPS[index].ms / 2).lift;
    };
    expect(peak(0)).toBeGreaterThan(peak(1));
    expect(peak(1)).toBeGreaterThan(peak(2));
  });
});

describe("drawing a chunk in", () => {
  it("reaches two tiles on either axis", () => {
    expect(inMagnetReach({ x: 0, y: 0 }, { x: 32, y: -32 })).toBe(true);
    expect(inMagnetReach({ x: 0, y: 0 }, { x: 33, y: 0 })).toBe(false);
  });

  it("gathers speed, never passes its top speed, and arrives", () => {
    let flight = { at: { x: 0, y: 0 }, speed: 0 };
    const target = { x: 30, y: 0 };
    let arrived = false;
    let frames = 0;
    let last = 0;
    while (!arrived && frames < 200) {
      const next = flyToward(flight, target, 16);
      expect(next.speed).toBeGreaterThanOrEqual(last);
      expect(next.speed).toBeLessThanOrEqual(MAGNET_TOP_SPEED);
      last = next.speed;
      flight = next;
      arrived = next.arrived;
      frames += 1;
    }
    expect(arrived).toBe(true);
    // Two tiles in well under half a second.
    expect(frames * 16).toBeLessThan(450);
  });
});

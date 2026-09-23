import { describe, expect, it } from "vitest";
import {
  COINS,
  COIN_FLY_MS,
  COIN_STAGGER_MS,
  HOLD_MS,
  HOVER_MS,
  ORB_BURST_MS,
  SPLIT_MS,
  SWARM_MS,
  makeOrbBurst,
  motesLanded,
  orbPointAt,
} from "./orb-burst";

const seeded = (): (() => number) => {
  let s = 11;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

// A small "tree": a block of green pixels.
const pixels = Array.from({ length: 120 }, (_, i) => ({ x: 100 + (i % 12) * 2, y: 60 + Math.floor(i / 12) * 3, colour: 0x3a7d2c }));
const centre = { x: 111, y: 70 };
const farmer = { x: 160, y: 110 };
const burst = makeOrbBurst(pixels, centre, farmer, seeded());

describe("the orb burst", () => {
  it("starts every point on its own pixel, in its own colour", () => {
    for (const point of burst.points) {
      const at = orbPointAt(burst, point, 0, farmer);
      expect(at.x).toBeCloseTo(point.from.x);
      expect(at.y).toBeCloseTo(point.from.y);
      expect(at.colour).toBe(point.from.colour);
    }
  });

  it("gathers into a round orb over where it stood", () => {
    const ms = SWARM_MS + HOLD_MS / 2;
    for (const point of burst.points) {
      const at = orbPointAt(burst, point, ms, farmer);
      expect(Math.hypot(at.x - centre.x, at.y - centre.y)).toBeLessThanOrEqual(burst.radius * 1.12);
    }
    // And it is colourful, not the tree's one green.
    const colours = new Set(burst.points.map((point) => orbPointAt(burst, point, ms, farmer).colour));
    expect(colours.size).toBeGreaterThan(20);
  });

  it("sizes the orb to the thing that broke", () => {
    const rock = makeOrbBurst(pixels.slice(0, 20).map((p) => ({ ...p, x: centre.x + (p.x - 100) / 4, y: centre.y + (p.y - 60) / 4 })), centre, farmer, seeded());
    expect(rock.radius).toBeLessThan(burst.radius);
    expect(rock.radius).toBeGreaterThanOrEqual(6);
  });

  it("splits into coins, each point on its own coin's face", () => {
    const ms = SWARM_MS + HOLD_MS + SPLIT_MS + HOVER_MS / 2;
    for (const point of burst.points) {
      const at = orbPointAt(burst, point, ms, farmer);
      const hover = burst.hover[point.mote];
      expect(Math.hypot(at.x - (centre.x + hover.x), at.y - (centre.y + hover.y))).toBeLessThan(5);
      expect(at.colour).toBe(burst.moteColour[point.mote]);
    }
    expect(new Set(burst.points.map((point) => point.mote)).size).toBe(COINS);
  });

  it("lands the coins on him one after another, nearest first", () => {
    const flyAt = SWARM_MS + HOLD_MS + SPLIT_MS + HOVER_MS;
    expect(motesLanded(burst, flyAt + COIN_FLY_MS - 1)).toBe(0);
    expect(motesLanded(burst, flyAt + COIN_FLY_MS)).toBe(1);
    expect(motesLanded(burst, flyAt + COIN_FLY_MS + COIN_STAGGER_MS * 3)).toBe(4);
    expect(motesLanded(burst, ORB_BURST_MS)).toBe(COINS);
    const first = burst.order.indexOf(0);
    const last = burst.order.indexOf(COINS - 1);
    const d = (k: number) => Math.hypot(centre.x + burst.hover[k].x - farmer.x, centre.y + burst.hover[k].y - farmer.y);
    expect(d(first)).toBeLessThanOrEqual(d(last));
  });

  it("ends with every point landed on him, wherever he walked to", () => {
    const moved = { x: 180, y: 120 };
    for (const point of burst.points) {
      const at = orbPointAt(burst, point, ORB_BURST_MS, moved);
      expect(at.landed).toBe(true);
      expect(at.alpha).toBe(0);
    }
  });

  it("keeps the whole thing short enough for a farm chore", () => {
    expect(ORB_BURST_MS).toBeLessThan(2500);
  });
});

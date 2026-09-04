import { describe, expect, it } from "vitest";
import {
  GOD_RAY_BEAMS,
  GOD_RAY_MAX_ALPHA,
  GOD_RAY_MIN_ALPHA,
  GOD_RAY_PERIOD_MS,
  SPARKLE_MAX,
  SPARKLE_MAX_LIFE_MS,
  godRayAlpha,
  sparkleAlpha,
  sparkleField,
  sparkleScale,
  spawnSparkle,
  stepSparkle,
  type Sparkle,
} from "./sunlight";
import type { WorldRect } from "./world";

const AREA: WorldRect = { x: -100, y: -50, width: 400, height: 300 };

/** A deterministic stand-in for the scene's own seeded generator. */
function cycle(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("godRayAlpha", () => {
  it("never exceeds the 8% ceiling, at any moment of the cycle", () => {
    // The point of the whole module. Walked at a resolution finer than the
    // period rather than spot-checked, because the ceiling is a promise about
    // every frame, not about the frames a test happened to pick.
    for (let t = 0; t <= GOD_RAY_PERIOD_MS * 3; t += 37) {
      expect(godRayAlpha(t), `t=${t}`).toBeLessThanOrEqual(GOD_RAY_MAX_ALPHA);
    }
  });

  it("never goes fully out", () => {
    // A layer that vanishes and comes back reads as a bug; one that only ever
    // thickens and thins reads as cloud.
    for (let t = 0; t <= GOD_RAY_PERIOD_MS * 3; t += 37) {
      expect(godRayAlpha(t), `t=${t}`).toBeGreaterThanOrEqual(GOD_RAY_MIN_ALPHA - 1e-9);
    }
  });

  it("actually reaches both ends of its range", () => {
    // Guards the opposite failure from the two above: an alpha pinned safely
    // at one value would pass every clamp assertion and render nothing.
    const walked: number[] = [];
    for (let t = 0; t <= GOD_RAY_PERIOD_MS; t += 50) walked.push(godRayAlpha(t));
    expect(Math.max(...walked)).toBeCloseTo(GOD_RAY_MAX_ALPHA, 3);
    expect(Math.min(...walked)).toBeCloseTo(GOD_RAY_MIN_ALPHA, 3);
  });

  it("survives a garbage clock without going bright", () => {
    // Phaser hands update() its own time; a NaN there must not become a
    // NaN alpha, which Phaser would render as fully opaque white.
    expect(godRayAlpha(Number.NaN)).toBe(GOD_RAY_MIN_ALPHA);
    expect(godRayAlpha(Number.POSITIVE_INFINITY)).toBe(GOD_RAY_MIN_ALPHA);
  });
});

describe("GOD_RAY_BEAMS", () => {
  it("keeps every beam on screen and below full weight", () => {
    for (const beam of GOD_RAY_BEAMS) {
      expect(beam.centre - beam.width / 2).toBeGreaterThan(-0.1);
      expect(beam.centre + beam.width / 2).toBeLessThan(1.1);
      expect(beam.weight).toBeGreaterThan(0);
      expect(beam.weight).toBeLessThanOrEqual(1);
    }
  });

  it("is uneven", () => {
    // Evenly spaced beams of equal width read as a printed pattern rather
    // than as light.
    const widths = new Set(GOD_RAY_BEAMS.map((b) => b.width));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe("sparkleField", () => {
  it("holds exactly the pool size, every frame", () => {
    // The hard budget. Checked across many frames rather than one, because
    // the failure this guards against is drift: a refill rule that adds one
    // more than it retires costs nothing on frame 1 and everything on 10,000.
    let live: Sparkle[] = [];
    const random = cycle([0.1, 0.4, 0.7, 0.2, 0.9, 0.55]);
    for (let frame = 0; frame < 5_000; frame += 1) {
      live = sparkleField(live, AREA, 16, random);
      expect(live.length, `frame ${frame}`).toBe(SPARKLE_MAX);
    }
  });

  it("refuses to carry more than the pool size in, either", () => {
    // A caller handing in an over-long array (a hot reload, a resize that
    // rebuilt the pool) must be trimmed, not trusted.
    const random = cycle([0.5]);
    const tooMany = Array.from({ length: SPARKLE_MAX * 3 }, () => spawnSparkle(AREA, random));
    expect(sparkleField(tooMany, AREA, 16, random).length).toBe(SPARKLE_MAX);
  });

  it("spawns every fleck inside the ground rectangle it was given", () => {
    let live: Sparkle[] = [];
    const random = cycle([0, 0.25, 0.5, 0.75, 0.999]);
    for (let frame = 0; frame < 200; frame += 1) {
      live = sparkleField(live, AREA, 16, random);
      for (const s of live) {
        expect(s.x).toBeGreaterThanOrEqual(AREA.x);
        expect(s.x).toBeLessThanOrEqual(AREA.x + AREA.width);
        // Only the birth position is bounded -- a fleck drifts upward as it
        // fades, so y may leave the top of the rect by design.
        expect(s.y).toBeLessThanOrEqual(AREA.y + AREA.height);
      }
    }
  });

  it("turns the field over rather than freezing it", () => {
    // The opposite failure from the budget test: a pool that never retires
    // anything also holds exactly 15 forever.
    const random = cycle([0.3, 0.6, 0.15, 0.85]);
    let live = sparkleField([], AREA, 16, random);
    const first = live.map((s) => s);
    for (let frame = 0; frame < 400; frame += 1) live = sparkleField(live, AREA, 16, random);
    expect(live.some((s) => first.includes(s))).toBe(false);
  });
});

describe("stepSparkle", () => {
  it("retires a fleck at the end of its life", () => {
    // Stepped at a real frame length rather than in one jump: the clamp in
    // stepSparkle means no single call can age a fleck past its life, which
    // is the point of the clamp and is asserted directly below.
    let live: Sparkle | null = spawnSparkle(AREA, cycle([0.5]));
    const life = live.lifeMs;
    let elapsed = 0;
    while (live && elapsed <= life + 64) {
      live = stepSparkle(live, 16);
      elapsed += 16;
    }
    expect(live).toBeNull();
  });

  it("clamps a huge frame delta so a backgrounded tab does not skip the field", () => {
    // Phaser hands a delta of whatever the tab was away for. Ageing a fleck
    // by 30 seconds in one step would empty and refill the pool in a single
    // frame, which reads as a flash.
    const s = spawnSparkle(AREA, cycle([0.5]));
    const stepped = stepSparkle(s, 30_000);
    expect(stepped).not.toBeNull();
    expect(stepped?.ageMs).toBeLessThanOrEqual(64);
  });

  it("never runs a fleck's age backwards on a negative delta", () => {
    const s = spawnSparkle(AREA, cycle([0.5]));
    expect(stepSparkle(s, -500)?.ageMs).toBe(0);
  });
});

describe("sparkleAlpha and sparkleScale", () => {
  it("keeps opacity inside 0..1 across a whole life", () => {
    const s = spawnSparkle(AREA, cycle([0.5]));
    for (let age = 0; age <= s.lifeMs; age += 10) {
      const alpha = sparkleAlpha({ ...s, ageMs: age });
      expect(alpha, `age=${age}`).toBeGreaterThanOrEqual(0);
      expect(alpha, `age=${age}`).toBeLessThanOrEqual(1);
    }
  });

  it("rises faster than it falls", () => {
    // The asymmetry is the effect: a symmetric fade reads as a blinking
    // light, a long tail reads as something losing the sun.
    const s: Sparkle = { ...spawnSparkle(AREA, cycle([0.5])), lifeMs: 2_000 };
    const peak = 0.22 * s.lifeMs;
    expect(sparkleAlpha({ ...s, ageMs: peak })).toBeCloseTo(1, 5);
    // Same distance either side of the peak: the tail is still brighter,
    // because it has further to fall.
    expect(sparkleAlpha({ ...s, ageMs: peak + 300 })).toBeGreaterThan(
      sparkleAlpha({ ...s, ageMs: peak - 300 }),
    );
  });

  it("starts and ends at nothing", () => {
    const s: Sparkle = { ...spawnSparkle(AREA, cycle([0.5])), lifeMs: 2_000 };
    expect(sparkleAlpha({ ...s, ageMs: 0 })).toBe(0);
    expect(sparkleAlpha({ ...s, ageMs: 2_000 })).toBeCloseTo(0, 5);
  });

  it("keeps every fleck a sensible size", () => {
    const s: Sparkle = { ...spawnSparkle(AREA, cycle([0.5])), lifeMs: SPARKLE_MAX_LIFE_MS };
    for (let age = 0; age <= s.lifeMs; age += 10) {
      const scale = sparkleScale({ ...s, ageMs: age });
      expect(scale, `age=${age}`).toBeGreaterThan(0);
      expect(scale, `age=${age}`).toBeLessThan(8);
    }
  });
});

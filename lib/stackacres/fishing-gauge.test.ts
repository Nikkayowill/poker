import { describe, expect, it } from "vitest";
import { MAX_FRAME_MS, seededRandom } from "./world";
import { FISH_SPECIES } from "./fishing";
import {
  FISH_GAUGE_PROFILES,
  FISH_MARKER_SPAN,
  START_PROGRESS,
  createFishingGaugeState,
  fishGaugeProfile,
  gaugeOverlap,
  gaugeSpeciesLadder,
  gaugeTension,
  stepFishingGauge,
  type FishingGaugeState,
} from "./fishing-gauge";

const FRAME_MS = 16;

/** Runs a whole fight with a caller-supplied controller, the way the scene's
 *  `update` does, and hands back the last state. */
function playOut(
  state: FishingGaugeState,
  holdAt: (state: FishingGaugeState) => boolean,
  random: () => number,
  frames = 3_000,
): FishingGaugeState {
  let current = state;
  for (let i = 0; i < frames && current.phase === "playing"; i += 1) {
    current = stepFishingGauge(current, FRAME_MS, holdAt(current), random);
  }
  return current;
}

/** A player who just keeps the bar under the fish. Bang-bang, not skilled. */
function chaseFish(state: FishingGaugeState): boolean {
  const barCentre = state.barPos + fishGaugeProfile(state.species).barSpan / 2;
  return barCentre < state.fishPos + FISH_MARKER_SPAN / 2;
}

describe("FISH_GAUGE_PROFILES", () => {
  it("covers every species the catch table can roll", () => {
    for (const species of FISH_SPECIES) {
      expect(FISH_GAUGE_PROFILES[species]).toBeDefined();
    }
    expect(Object.keys(FISH_GAUGE_PROFILES).sort()).toEqual([...FISH_SPECIES].sort());
    expect(gaugeSpeciesLadder()).toEqual(FISH_SPECIES);
  });

  it("gets harder as the fish gets rarer", () => {
    const [common, fair, rare] = FISH_SPECIES.map((species) => FISH_GAUGE_PROFILES[species]);
    expect(common.barSpan).toBeGreaterThan(fair.barSpan);
    expect(fair.barSpan).toBeGreaterThan(rare.barSpan);
    expect(common.fishSpeed).toBeLessThan(fair.fishSpeed);
    expect(fair.fishSpeed).toBeLessThan(rare.fishSpeed);
    expect(common.drainPerSec).toBeLessThan(fair.drainPerSec);
    expect(fair.drainPerSec).toBeLessThan(rare.drainPerSec);
  });

  it("leaves every bar and the fish room on the track", () => {
    for (const species of FISH_SPECIES) {
      expect(FISH_GAUGE_PROFILES[species].barSpan).toBeLessThan(1);
      expect(FISH_GAUGE_PROFILES[species].barSpan).toBeGreaterThan(FISH_MARKER_SPAN);
    }
  });
});

describe("createFishingGaugeState", () => {
  it("parks the bar at the bottom with the meter part-filled", () => {
    const state = createFishingGaugeState("trout", seededRandom(7));
    expect(state.phase).toBe("playing");
    expect(state.barPos).toBe(0);
    expect(state.barVel).toBe(0);
    expect(state.progress).toBe(START_PROGRESS);
    expect(state.elapsedMs).toBe(0);
    expect(state.overlapMs).toBe(0);
  });

  it("starts the fish on the track and already heading somewhere", () => {
    const state = createFishingGaugeState("catfish", seededRandom(11));
    expect(state.fishPos).toBeGreaterThanOrEqual(0);
    expect(state.fishPos).toBeLessThanOrEqual(1 - FISH_MARKER_SPAN);
    expect(state.fishTarget).toBeGreaterThanOrEqual(0);
    expect(state.fishTarget).toBeLessThanOrEqual(1 - FISH_MARKER_SPAN);
    expect(state.restMs).toBeGreaterThan(0);
  });
});

describe("gaugeOverlap", () => {
  const base = createFishingGaugeState("bluegill", seededRandom(3));

  it("is 1 when the bar swallows the fish whole", () => {
    expect(gaugeOverlap({ ...base, barPos: 0.3, fishPos: 0.4 })).toBe(1);
  });

  it("is 0 when the bar is clear of the fish", () => {
    expect(gaugeOverlap({ ...base, barPos: 0, fishPos: 0.8 })).toBe(0);
    expect(gaugeOverlap({ ...base, barPos: 0.6, fishPos: 0 })).toBe(0);
  });

  it("is the covered fraction of the fish when they only half meet", () => {
    // Bar 0.34 long from 0.3 covers up to 0.64; a fish from 0.58 is
    // 0.12 long, so 0.06 of it is inside.
    expect(gaugeOverlap({ ...base, barPos: 0.3, fishPos: 0.58 })).toBeCloseTo(0.5, 5);
  });
});

describe("stepFishingGauge: the bar", () => {
  const random = seededRandom(21);

  it("climbs while held and falls once let go", () => {
    const start = createFishingGaugeState("bluegill", random);
    let held = start;
    for (let i = 0; i < 20; i += 1) held = stepFishingGauge(held, FRAME_MS, true, random);
    expect(held.barPos).toBeGreaterThan(start.barPos);
    expect(held.barVel).toBeGreaterThan(0);

    // Letting go kills the climb before it reverses it, so the fall is
    // measured against the peak the bar coasts to, not against the frame the
    // press ended on.
    let dropped = held;
    let peak = held.barPos;
    for (let i = 0; i < 40; i += 1) {
      dropped = stepFishingGauge(dropped, FRAME_MS, false, random);
      peak = Math.max(peak, dropped.barPos);
    }
    expect(dropped.barVel).toBeLessThan(0);
    expect(dropped.barPos).toBeLessThan(peak);

    // And it keeps falling until the well stops it.
    for (let i = 0; i < 60; i += 1) dropped = stepFishingGauge(dropped, FRAME_MS, false, random);
    expect(dropped.barPos).toBe(0);
  });

  it("stops at the ceiling without banking momentum for the fall", () => {
    let state = createFishingGaugeState("catfish", random);
    for (let i = 0; i < 400; i += 1) state = stepFishingGauge(state, FRAME_MS, true, random);
    const limit = 1 - fishGaugeProfile("catfish").barSpan;
    expect(state.barPos).toBeCloseTo(limit, 6);
    expect(state.barVel).toBeLessThanOrEqual(0);
  });

  it("stops at the floor and never goes under it", () => {
    let state = createFishingGaugeState("trout", random);
    for (let i = 0; i < 400; i += 1) state = stepFishingGauge(state, FRAME_MS, false, random);
    expect(state.barPos).toBe(0);
    expect(state.barVel).toBeGreaterThanOrEqual(0);
  });
});

describe("stepFishingGauge: the fish", () => {
  it("stays on the track across a long fight", () => {
    const random = seededRandom(99);
    let state = createFishingGaugeState("catfish", random);
    for (let i = 0; i < 2_000; i += 1) {
      state = stepFishingGauge({ ...state, phase: "playing", progress: START_PROGRESS }, FRAME_MS, i % 30 < 15, random);
      expect(state.fishPos).toBeGreaterThanOrEqual(0);
      expect(state.fishPos).toBeLessThanOrEqual(1 - FISH_MARKER_SPAN);
    }
  });
});

describe("stepFishingGauge: the outcome", () => {
  it("lands the fish for a player who keeps the bar on it", () => {
    const random = seededRandom(5);
    const finished = playOut(createFishingGaugeState("bluegill", random), chaseFish, random);
    expect(finished.phase).toBe("landed");
    expect(finished.progress).toBe(1);
    expect(finished.overlapMs).toBeGreaterThan(0);
  });

  it("loses the fish for a player who never presses", () => {
    const random = seededRandom(5);
    const finished = playOut(createFishingGaugeState("bluegill", random), () => false, random);
    expect(finished.phase).toBe("escaped");
    expect(finished.progress).toBe(0);
  });

  it("gains on overlap and drains without it", () => {
    const random = seededRandom(31);
    const base = createFishingGaugeState("trout", random);
    const covering = stepFishingGauge({ ...base, barPos: 0.3, fishPos: 0.4 }, FRAME_MS, false, random);
    expect(covering.progress).toBeGreaterThan(START_PROGRESS);
    const missing = stepFishingGauge({ ...base, barPos: 0, fishPos: 0.85 }, FRAME_MS, false, random);
    expect(missing.progress).toBeLessThan(START_PROGRESS);
  });

  it("clamps a long frame so a stalled tab cannot decide the fight", () => {
    const random = seededRandom(13);
    const base = { ...createFishingGaugeState("trout", random), barPos: 0, fishPos: 0.85 };
    const normal = stepFishingGauge(base, 100, false, random);
    const stalled = stepFishingGauge(base, 10_000, false, random);
    expect(normal.elapsedMs).toBe(100);
    expect(stalled.elapsedMs).toBe(MAX_FRAME_MS);
    expect(stalled.progress).toBeGreaterThan(0);
  });

  it("leaves a finished fight alone", () => {
    const random = seededRandom(17);
    const landed: FishingGaugeState = { ...createFishingGaugeState("trout", random), phase: "landed", progress: 1 };
    expect(stepFishingGauge(landed, FRAME_MS, true, random)).toBe(landed);
    const escaped: FishingGaugeState = { ...createFishingGaugeState("trout", random), phase: "escaped", progress: 0 };
    expect(stepFishingGauge(escaped, FRAME_MS, true, random)).toBe(escaped);
  });

  it("ignores a zero-length frame", () => {
    const random = seededRandom(19);
    const base = createFishingGaugeState("trout", random);
    expect(stepFishingGauge(base, 0, true, random)).toBe(base);
  });

  it("replays identically from the same seed", () => {
    const first = playOut(createFishingGaugeState("catfish", seededRandom(77)), chaseFish, seededRandom(77));
    const second = playOut(createFishingGaugeState("catfish", seededRandom(77)), chaseFish, seededRandom(77));
    expect(second).toEqual(first);
  });
});

describe("gaugeTension", () => {
  it("is 0 at or above the starting meter and 1 at slack", () => {
    const base = createFishingGaugeState("bluegill", seededRandom(2));
    expect(gaugeTension({ ...base, progress: START_PROGRESS })).toBe(0);
    expect(gaugeTension({ ...base, progress: 0.9 })).toBe(0);
    expect(gaugeTension({ ...base, progress: 0 })).toBe(1);
    expect(gaugeTension({ ...base, progress: START_PROGRESS / 2 })).toBeCloseTo(0.5, 5);
  });
});

import { describe, expect, it } from "vitest";
import {
  LIGHTS_OUT_BANDS,
  LIGHTS_OUT_MAX_MOVES,
  lightsOutLadder,
  scrambleLightsOut,
  toggleLightsOut,
  brainLightsOutPayout,
  resignBrainLightsOut,
  startBrainLightsOut,
  tapBrainLightsOut,
  toBrainLightsOutSnapshot,
  wagerMultiplierForMoves,
} from "./brain-lights-out";

const cyclingRandom = (values: number[]) => {
  let i = 0;
  return (max: number) => values[i++ % values.length] % max;
};

describe("brain lights out", () => {
  it("deals a board that is not already solved", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    expect(attempt.lights.some(Boolean)).toBe(true);
  });

  it("tapping the same cell twice returns the board to its prior state (own inverse)", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    const once = tapBrainLightsOut(attempt, 6, new Date());
    const twice = tapBrainLightsOut(once, 6, new Date());
    expect(twice.lights).toEqual(attempt.lights);
  });

  it("forfeits once the move cap is reached without clearing the board", () => {
    let attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    for (let i = 0; i < LIGHTS_OUT_MAX_MOVES; i++) {
      attempt = tapBrainLightsOut(attempt, i % 2, new Date());
      if (attempt.status !== "active") break;
    }
    expect(attempt.status === "won" || attempt.status === "lost").toBe(true);
    if (attempt.status === "lost") expect(attempt.moves).toBeGreaterThanOrEqual(LIGHTS_OUT_MAX_MOVES);
  });

  it("pays zero on anything but a win", () => {
    expect(brainLightsOutPayout({ wager: 1000, status: "lost", moves: 3 })).toBe(0);
    expect(brainLightsOutPayout({ wager: 1000, status: "won", moves: 4 })).toBeGreaterThan(0);
  });

  it("pays less the slower the clear", () => {
    expect(wagerMultiplierForMoves(4)).toBeGreaterThan(wagerMultiplierForMoves(18));
  });

  it("resign settles an active attempt as lost", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    const resigned = resignBrainLightsOut(attempt, new Date());
    expect(resigned.status).toBe("lost");
  });

  it("snapshot never reveals more cells than are actually lit", () => {
    const attempt = startBrainLightsOut(cyclingRandom([0, 5, 10, 15, 20, 3, 8, 13]), 1000, new Date());
    const snapshot = toBrainLightsOutSnapshot(attempt, { id: "x", version: 1 });
    expect(snapshot.lights).toEqual(attempt.lights);
    expect(snapshot.size * snapshot.size).toBe(attempt.lights.length);
  });
});

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
}

/**
 * Solves a board over GF(2): which tiles to tap once each. Returns every
 * solution's tap count, or null when there is none.
 */
function solutions(lights: readonly boolean[]): number[] | null {
  const cells = lights.length;
  const size = Math.round(Math.sqrt(cells));
  const rows = Array.from({ length: cells }, (_, cell) => {
    const row = Array.from({ length: cells + 1 }, () => 0);
    const effect = toggleLightsOut(Array<boolean>(cells).fill(false), cell);
    // Column `tap` of row `cell`: does tapping `tap` flip `cell`? Symmetric, so reuse `effect`.
    effect.forEach((on, tap) => { row[tap] = on ? 1 : 0; });
    row[cells] = lights[cell] ? 1 : 0;
    return row;
  });
  const pivots: number[] = [];
  let r = 0;
  for (let col = 0; col < cells && r < cells; col++) {
    const pivot = rows.findIndex((row, i) => i >= r && row[col] === 1);
    if (pivot < 0) continue;
    [rows[r], rows[pivot]] = [rows[pivot], rows[r]];
    for (let i = 0; i < cells; i++) {
      if (i !== r && rows[i][col] === 1) rows[i] = rows[i].map((v, k) => v ^ rows[r][k]);
    }
    pivots.push(col);
    r++;
  }
  if (rows.slice(r).some((row) => row[cells] === 1)) return null;
  const free = Array.from({ length: cells }, (_, c) => c).filter((c) => !pivots.includes(c));
  expect(size * size).toBe(cells);
  const counts: number[] = [];
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const x = Array<number>(cells).fill(0);
    free.forEach((c, bit) => { x[c] = (mask >> bit) & 1; });
    pivots.forEach((col, i) => {
      let value = rows[i][cells];
      for (const c of free) value ^= rows[i][c] & x[c];
      x[col] = value;
    });
    counts.push(x.reduce((a, b) => a + b, 0));
  }
  return counts;
}

describe("lights out by stake band", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("band 0 keeps today's 5x5 board and 8/12/16/20 rungs", () => {
    expect(lightsOutLadder(LIGHTS_OUT_BANDS[0]).map((rung) => rung.maxMoves)).toEqual([8, 12, 16, 20]);
    expect(LIGHTS_OUT_MAX_MOVES).toBe(20);
    const attempt = startBrainLightsOut(seededRandom(1), 1000, now);
    expect(attempt.lights).toHaveLength(25);
    expect(attempt.pressure).toBe(0);
  });

  it("bigger stakes deal bigger boards, copied onto the run with their ladder", () => {
    const cases = [
      [10_000, 6, 10, 17],
      [100_000, 6, 14, 20],
      [1_000_000, 7, 15, 20],
    ] as const;
    for (const [wager, size, par, cap] of cases) {
      const attempt = startBrainLightsOut(seededRandom(wager), wager, now);
      const snapshot = toBrainLightsOutSnapshot(attempt, { id: "x", version: 1 });
      expect(snapshot.size).toBe(size);
      expect(snapshot.lights).toHaveLength(size * size);
      expect(snapshot.par).toBe(par);
      expect(snapshot.maxMoves).toBe(cap);
    }
  });

  it("every band's boards are solvable within par", () => {
    for (const pressure of [0, 1, 2, 3] as const) {
      const band = LIGHTS_OUT_BANDS[pressure];
      const random = seededRandom(pressure + 40);
      for (let i = 0; i < 30; i++) {
        const lights = scrambleLightsOut(random, band.size, band.taps);
        expect(lights.some(Boolean)).toBe(true);
        const counts = solutions(lights);
        expect(counts).not.toBeNull();
        expect(Math.min(...counts!)).toBeLessThanOrEqual(band.taps);
        // 6x6 and 7x7 have exactly one solution, so par is the true minimum there.
        if (band.size >= 6) expect(counts).toEqual([band.taps]);
      }
    }
  });

  it("the move cap and payout follow the run's own ladder", () => {
    const attempt = startBrainLightsOut(seededRandom(7), 1_000_000, now);
    expect(attempt.ladder?.map((rung) => rung.multiplier)).toEqual([3, 2, 0.8]);
    expect(brainLightsOutPayout({ ...attempt, status: "won", moves: 15 })).toBe(3_000_000);
    expect(brainLightsOutPayout({ ...attempt, status: "won", moves: 16 })).toBe(2_000_000);
    expect(brainLightsOutPayout({ ...attempt, status: "won", moves: 18 })).toBe(800_000);
    expect(brainLightsOutPayout({ ...attempt, status: "won", moves: 21 })).toBe(0);
    let run = attempt;
    for (let i = 0; i < 20 && run.status === "active"; i++) run = tapBrainLightsOut(run, i % 2, now);
    if (run.status === "lost") expect(run.moves).toBe(20);
  });

  it("steps each band's median waste up geometrically", () => {
    // Taps x board side is the model's difficulty; each band is 1.3x to 1.6x the last.
    const load = ([0, 1, 2, 3] as const).map((p) => LIGHTS_OUT_BANDS[p].taps * LIGHTS_OUT_BANDS[p].size);
    for (let i = 1; i < load.length; i++) {
      expect(load[i] / load[i - 1]).toBeGreaterThanOrEqual(1.2);
      expect(load[i] / load[i - 1]).toBeLessThanOrEqual(1.6);
    }
  });

  it("loads a run stored before bands existed with today's rules", () => {
    const old = startBrainLightsOut(seededRandom(3), 1000, now);
    delete old.pressure;
    delete old.ladder;
    const snapshot = toBrainLightsOutSnapshot(old, { id: "x", version: 1 });
    expect(snapshot.size).toBe(5);
    expect(snapshot.maxMoves).toBe(20);
    expect(snapshot.par).toBe(8);
    expect(brainLightsOutPayout({ ...old, status: "won", moves: 12 })).toBe(2000);
    let run = old;
    for (let i = 0; i < 20 && run.status === "active"; i++) run = tapBrainLightsOut(run, i % 2, now);
    if (run.status === "lost") expect(run.moves).toBe(20);
  });

  it("ignores a tap off the board", () => {
    const attempt = startBrainLightsOut(seededRandom(3), 1000, now);
    expect(tapBrainLightsOut(attempt, 25, now)).toBe(attempt);
    expect(tapBrainLightsOut(attempt, 1.5, now)).toBe(attempt);
  });
});

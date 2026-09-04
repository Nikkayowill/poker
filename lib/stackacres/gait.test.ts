import { describe, expect, it } from "vitest";

import { GAIT_MAX_ROLL, GAIT_MAX_ROLL_DEGREES, spawnGait, stepGait, type Gait } from "./gait";

const FRAME = 16;
const HEN = 14;
const COW = 7;

/** Walks a gait for `ms` and hands back every roll it passed through. */
function walk(gait: Gait, ms: number, speed: number, walking = true): { gait: Gait; rolls: number[] } {
  const rolls: number[] = [];
  let at = gait;
  for (let t = 0; t < ms; t += FRAME) {
    at = stepGait(at, walking, speed, FRAME);
    rolls.push(at.roll);
  }
  return { gait: at, rolls };
}

describe("the walking gait", () => {
  it("starts level and stays level while an animal stands about", () => {
    let gait = spawnGait(1.2);
    expect(gait.roll).toBe(0);
    for (let i = 0; i < 500; i += 1) {
      gait = stepGait(gait, false, HEN, FRAME);
      expect(gait.roll).toBe(0);
    }
  });

  it("never lifts the animal off the ground -- there is no vertical term at all", () => {
    // The whole pose is one angle. If a hop ever comes back it will have to
    // come back as a new field, and this is what will notice.
    const gait = walk(spawnGait(0), 4_000, HEN).gait;
    expect(Object.keys(gait).sort()).toEqual(["phase", "roll", "weight"]);
  });

  it("sways no further than three degrees either way", () => {
    for (const speed of [HEN, COW, 40]) {
      for (const { rolls } of [walk(spawnGait(0.4), 20_000, speed)]) {
        for (const roll of rolls) {
          expect(Math.abs(roll)).toBeLessThanOrEqual(GAIT_MAX_ROLL + 1e-12);
        }
        const degrees = rolls.map((r) => (r * 180) / Math.PI);
        expect(Math.max(...degrees)).toBeGreaterThan(GAIT_MAX_ROLL_DEGREES * 0.95);
        expect(Math.min(...degrees)).toBeLessThan(-GAIT_MAX_ROLL_DEGREES * 0.95);
      }
    }
  });

  it("leans both ways rather than only one, so it reads as a weight shift", () => {
    const { rolls } = walk(spawnGait(0), 6_000, COW);
    expect(rolls.some((r) => r > GAIT_MAX_ROLL * 0.5)).toBe(true);
    expect(rolls.some((r) => r < -GAIT_MAX_ROLL * 0.5)).toBe(true);
  });

  it("sways faster the faster the animal moves", () => {
    const hen = walk(spawnGait(0), 1_000, HEN).gait;
    const cow = walk(spawnGait(0), 1_000, COW).gait;
    // Same clock, same start: the hen has simply been through more of the
    // cycle, and by the ratio of the two speeds.
    expect(hen.phase / cow.phase).toBeCloseTo(HEN / COW, 6);
    expect(cow.phase).toBeGreaterThan(0);
  });

  it("fades in rather than snapping to a full lean on the first frame", () => {
    const first = stepGait(spawnGait(Math.PI / 2), true, HEN, FRAME);
    expect(Math.abs(first.roll)).toBeLessThan(GAIT_MAX_ROLL * 0.2);
    const settled = walk(spawnGait(Math.PI / 2), 2_000, HEN).gait;
    expect(settled.weight).toBeGreaterThan(0.99);
  });

  it("eases the lean back to exactly zero when the animal goes idle", () => {
    // Stop it at the top of a sway, which is the worst case: a hard reset
    // here would be a visible three-degree jolt.
    let gait = spawnGait(0);
    gait = walk(gait, 2_000, HEN).gait;
    while (gait.roll < GAIT_MAX_ROLL * 0.9) gait = stepGait(gait, true, HEN, FRAME);
    const leaning = gait.roll;
    expect(leaning).toBeGreaterThan(GAIT_MAX_ROLL * 0.9);

    const { gait: standing, rolls } = walk(gait, 3_000, HEN, false);
    expect(standing.roll).toBe(0);
    expect(standing.weight).toBe(0);
    // Strictly downhill the whole way, never past level and never back up:
    // the animal settles onto its feet instead of rocking to a stop.
    let previous = leaning;
    for (const roll of rolls) {
      expect(roll).toBeLessThanOrEqual(previous);
      expect(roll).toBeGreaterThanOrEqual(0);
      previous = roll;
    }
    // And it got there smoothly: no single frame ate most of the lean.
    expect(rolls[0]).toBeGreaterThan(leaning * 0.8);
  });

  it("picks the cycle back up where it stopped instead of restarting it", () => {
    const walked = walk(spawnGait(0.3), 1_500, COW).gait;
    const stood = walk(walked, 400, COW, false).gait;
    expect(stood.phase).toBe(walked.phase);
    const off = stepGait(stood, true, COW, FRAME);
    expect(off.phase).toBeGreaterThan(walked.phase);
  });

  it("caps a long frame so a backgrounded tab does not spin the sway", () => {
    const jump = stepGait(spawnGait(0), true, HEN, 60_000);
    const capped = stepGait(spawnGait(0), true, HEN, 250);
    expect(jump).toEqual(capped);
  });

  it("treats a negative or zero frame as no time passing", () => {
    const gait = walk(spawnGait(0.8), 800, HEN).gait;
    expect(stepGait(gait, true, HEN, 0)).toEqual(gait);
    expect(stepGait(gait, true, HEN, -40)).toEqual(gait);
  });
});

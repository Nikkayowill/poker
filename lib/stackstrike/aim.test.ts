import { describe, expect, it } from "vitest";
import { aimBeforeLift, CANCEL_REACH, recordAim, releaseShot, type AimEnd, type AimSample } from "./aim";

const at = (angle: number, reach = 0.8): AimEnd => ({ angle, reach });

function steady(angle: number, from: number, to: number, reach = 0.8): AimSample[] {
  const out: AimSample[] = [];
  for (let at = from; at <= to; at += 16) out.push({ at, angle, reach });
  return out;
}

describe("lift-off aim", () => {
  it("fires along the aim from before the thumb rolled off", () => {
    const history = steady(1, 0, 300);
    // The last two frames before the lift roll the aim away, by less than a sweep.
    history.push({ at: 316, angle: 1.2, reach: 0.8 }, { at: 332, angle: 1.4, reach: 0.7 });
    const shot = releaseShot(history, 340, at(1.4, 0.7));
    expect(shot?.angle).toBe(1);
  });

  it("uses the oldest sample when the touch is shorter than the lookback", () => {
    const history = [{ at: 0, angle: 0.5, reach: 0.6 }, { at: 16, angle: 0.6, reach: 0.6 }];
    expect(aimBeforeLift(history, 40)?.angle).toBe(0.5);
  });

  it("does not shoot when the thumb was slid back to the middle", () => {
    const history = steady(2, 0, 200, CANCEL_REACH - 0.05);
    expect(releaseShot(history, 210, at(2, CANCEL_REACH - 0.05))).toBeNull();
  });

  it("judges the cancel on the lookback sample, not the last slide", () => {
    const history = steady(2, 0, 200, 0.9);
    history.push({ at: 216, angle: 2, reach: 0.05 });
    expect(releaseShot(history, 220, at(2, 0.05))?.angle).toBe(2);
  });

  it("returns nothing with no history", () => {
    expect(releaseShot([], 100, at(1, 0.05))).toBeNull();
    expect(releaseShot([], 100, at(1, 0.8))?.angle).toBe(1);
  });

  it("trusts the lift's own angle after a long sweep", () => {
    const history = steady(0, 0, 300);
    history.push({ at: 316, angle: 1.2, reach: 0.8 }, { at: 332, angle: 2, reach: 0.8 });
    expect(releaseShot(history, 340, at(2.3))?.angle).toBe(2.3);
  });

  it("measures the sweep across the wrap at pi", () => {
    const history = steady(3.1, 0, 300);
    expect(releaseShot(history, 310, at(-3.1))?.angle).toBe(3.1);
  });

  it("drops samples older than the keep window", () => {
    const history: AimSample[] = [];
    for (let at = 0; at <= 2000; at += 16) recordAim(history, { at, angle: 0, reach: 1 });
    expect(history[0].at).toBeGreaterThanOrEqual(2000 - 420);
    expect(history.length).toBeLessThan(40);
  });

  it("keeps where a thumb held still was, so a late roll does not erase it", () => {
    const history: AimSample[] = [];
    recordAim(history, { at: 0, angle: 1, reach: 0.8 });
    recordAim(history, { at: 900, angle: 1.3, reach: 0.8 });
    expect(releaseShot(history, 910, at(1.3))?.angle).toBe(1);
  });
});

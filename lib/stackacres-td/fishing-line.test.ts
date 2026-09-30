import { describe, expect, it } from "vitest";
import { SLACK_TAUT, SLACK_WAITING, createRope, distance, sag, stepRope, twitchRope } from "./fishing-line";

const tip = { x: 100, y: 20 };
const float = { x: 40, y: 42 };

function settle(slack: number, steps = 240) {
  const rope = createRope(tip, float, distance(tip, float) * slack);
  for (let i = 0; i < steps; i++) stepRope(rope, tip, float, 16);
  return rope;
}

describe("the fishing line", () => {
  it("is pinned to the rod tip and the float", () => {
    const rope = settle(SLACK_WAITING);
    expect(rope.points[0]).toEqual(tip);
    expect(rope.points[rope.points.length - 1]).toEqual(float);
  });

  it("droops toward the camera when there is slack out", () => {
    expect(sag(settle(SLACK_WAITING))).toBeGreaterThan(3);
  });

  it("pulls straight when a fish has it taut", () => {
    expect(Math.abs(sag(settle(SLACK_TAUT)))).toBeLessThan(0.5);
  });

  it("never stretches past the line that is out", () => {
    const rope = settle(SLACK_WAITING);
    let total = 0;
    for (let i = 1; i < rope.points.length; i++) total += distance(rope.points[i - 1], rope.points[i]);
    expect(total).toBeLessThanOrEqual(rope.length * 1.02);
  });

  it("follows the float when it moves", () => {
    const rope = settle(SLACK_WAITING);
    const moved = { x: 20, y: 44 };
    rope.length = distance(tip, moved) * SLACK_WAITING;
    for (let i = 0; i < 240; i++) stepRope(rope, tip, moved, 16);
    expect(rope.points[rope.points.length - 1]).toEqual(moved);
    expect(sag(rope)).toBeGreaterThan(3);
  });

  it("settles back after a twitch", () => {
    const rope = settle(SLACK_TAUT);
    twitchRope(rope, 6, () => 0.9);
    for (let i = 0; i < 240; i++) stepRope(rope, tip, float, 16);
    expect(Math.abs(sag(rope))).toBeLessThan(0.5);
  });

  it("falls into its droop within a third of a second of a throw leaving it up in the air", () => {
    const rope = createRope(tip, float, distance(tip, float) * SLACK_WAITING);
    // Thrown: the middle of the line is left well above the straight line.
    for (let i = 1; i < rope.points.length - 1; i++) {
      rope.points[i].y -= 20;
      rope.prev[i].y -= 20;
    }
    for (let i = 0; i < 20; i++) stepRope(rope, tip, float, 16);
    expect(sag(rope)).toBeGreaterThan(2);
  });

  it("survives a stalled frame without flinging the line", () => {
    const rope = settle(SLACK_WAITING);
    stepRope(rope, tip, float, 5000);
    for (const p of rope.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(Math.abs(p.y - 30)).toBeLessThan(40);
    }
  });
});

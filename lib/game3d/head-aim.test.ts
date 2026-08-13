import { describe, expect, it } from "vitest";
import { HEAD_PITCH_LIMIT, HEAD_YAW_LIMIT } from "./avatar-state";
import { headGazeTarget } from "./head-aim";
import { dot, len, norm, sub, vec } from "./vec3-math";

const FORWARD = vec(0, 0, -1);
const RIGHT = vec(1, 0, 0);
const HEAD = vec(0, 1.5, 0);

// Angle between the seat's own forward direction and the resolved gaze
// direction, ignoring the small deterministic idle wander by sampling at a
// time where both wander terms are (close to) zero.
const gazeAngle = (target: ReturnType<typeof vec>, slot = 0, timeS = 0) => {
  const point = headGazeTarget(HEAD, target, FORWARD, RIGHT, slot, timeS);
  const dir = norm(sub(point, HEAD));
  return Math.acos(Math.min(1, Math.max(-1, dot(dir, FORWARD))));
};

describe("headGazeTarget", () => {
  it("looks straight ahead at a target directly in front", () => {
    const angle = gazeAngle(vec(0, 1.5, -5));
    expect(angle).toBeLessThan(0.1);
  });

  it("turns toward a target off to the side, within the yaw limit", () => {
    const point = headGazeTarget(HEAD, vec(5, 1.5, 0), FORWARD, RIGHT, 0, 0);
    const dir = norm(sub(point, HEAD));
    // Signed yaw off forward, same convention the module uses internally.
    const yaw = Math.atan2(dot(dir, RIGHT), dot(dir, FORWARD));
    expect(yaw).toBeGreaterThan(0);
    expect(Math.abs(yaw)).toBeLessThanOrEqual(HEAD_YAW_LIMIT + 0.1); // + idle wander slack
  });

  it("never exceeds the yaw limit by more than the idle wander", () => {
    // A target hard off to the side and behind — the extreme case.
    const point = headGazeTarget(HEAD, vec(-10, 1.5, 8), FORWARD, RIGHT, 2, 4);
    const dir = norm(sub(point, HEAD));
    const yaw = Math.atan2(dot(dir, RIGHT), dot(dir, FORWARD));
    expect(Math.abs(yaw)).toBeLessThanOrEqual(HEAD_YAW_LIMIT + 0.15);
  });

  it("never exceeds the pitch limit by more than the idle wander", () => {
    const point = headGazeTarget(HEAD, vec(0, -5, -1), FORWARD, RIGHT, 3, 7);
    const dir = norm(sub(point, HEAD));
    const horizontal = vec(dir.x, 0, dir.z);
    const pitch = Math.atan2(dir.y, len(horizontal));
    expect(Math.abs(pitch)).toBeLessThanOrEqual(HEAD_PITCH_LIMIT + 0.1);
  });

  it("is deterministic — the same inputs give the same point", () => {
    const a = headGazeTarget(HEAD, vec(1, 1, -2), FORWARD, RIGHT, 1, 5.5);
    const b = headGazeTarget(HEAD, vec(1, 1, -2), FORWARD, RIGHT, 1, 5.5);
    expect(a).toEqual(b);
  });

  it("wanders a held gaze slightly rather than locking it perfectly still", () => {
    const p1 = headGazeTarget(HEAD, vec(0, 1.5, -5), FORWARD, RIGHT, 0, 0);
    const p2 = headGazeTarget(HEAD, vec(0, 1.5, -5), FORWARD, RIGHT, 0, 3);
    expect(p1).not.toEqual(p2);
  });

  it("returns a point one unit from the head", () => {
    const point = headGazeTarget(HEAD, vec(0, 1.5, -5), FORWARD, RIGHT, 0, 0);
    expect(len(sub(point, HEAD))).toBeCloseTo(1, 6);
  });

  it("degrades to straight ahead rather than NaN for a target directly above the head", () => {
    const point = headGazeTarget(HEAD, vec(0, 10, 0), FORWARD, RIGHT, 0, 0);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(Number.isFinite(point.z)).toBe(true);
  });
});

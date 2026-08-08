import { describe, expect, it } from "vitest";
import type { Vec3 } from "./seat-layout";
import {
  ARC_HEIGHT,
  BOUNCE_MS,
  FLIGHT_MS,
  STAGGER_MS,
  flightDurationMs,
  landingOffset,
  sampleChipFlight,
} from "./chip-trajectory";

const FROM: Vec3 = { x: -2, y: 0.4, z: 1.5 };
const TO: Vec3 = { x: 0, y: 0.86, z: -0.5 };

describe("sampleChipFlight", () => {
  it("starts exactly at the origin and ends exactly at the target", () => {
    expect(sampleChipFlight(FROM, TO, 0, 0).position).toEqual(FROM);
    const end = sampleChipFlight(FROM, TO, FLIGHT_MS + BOUNCE_MS, 0);
    expect(end.position).toEqual(TO);
    expect(end.done).toBe(true);
  });

  it("terminates exactly — one ms past the total it is done, never before landing", () => {
    const justBefore = sampleChipFlight(FROM, TO, FLIGHT_MS - 1, 0);
    expect(justBefore.done).toBe(false);
    expect(justBefore.landed).toBe(false);
    const after = sampleChipFlight(FROM, TO, FLIGHT_MS + BOUNCE_MS + 1, 0);
    expect(after.done).toBe(true);
  });

  it("arcs above the straight line between the endpoints", () => {
    const mid = sampleChipFlight(FROM, TO, FLIGHT_MS / 2, 0);
    const linearY = FROM.y + (TO.y - FROM.y) * 0.5;
    expect(mid.position.y).toBeGreaterThan(linearY);
    expect(mid.position.y).toBeLessThanOrEqual(
      Math.max(FROM.y, TO.y) + ARC_HEIGHT + 1e-9
    );
  });

  it("bounces at the landing spot: airborne again after touchdown, then settles", () => {
    const early = sampleChipFlight(FROM, TO, FLIGHT_MS + BOUNCE_MS * 0.2, 0);
    expect(early.landed).toBe(true);
    expect(early.done).toBe(false);
    expect(early.position.x).toBe(TO.x);
    expect(early.position.z).toBe(TO.z);
    expect(early.position.y).toBeGreaterThan(TO.y);
  });

  it("holds a staggered chip at its origin until its own start", () => {
    const held = sampleChipFlight(FROM, TO, STAGGER_MS * 3 - 1, 3);
    expect(held.position).toEqual(FROM);
    expect(held.done).toBe(false);
  });

  it("is a pure function of elapsed time — identical samples for identical inputs", () => {
    const a = sampleChipFlight(FROM, TO, 137, 2);
    const b = sampleChipFlight(FROM, TO, 137, 2);
    expect(a).toEqual(b);
  });

  it("budgets total duration by chip count", () => {
    expect(flightDurationMs(1)).toBe(FLIGHT_MS + BOUNCE_MS);
    expect(flightDurationMs(5)).toBe(FLIGHT_MS + BOUNCE_MS + 4 * STAGGER_MS);
  });
});

describe("landingOffset", () => {
  it("is deterministic and distinct per index", () => {
    expect(landingOffset(4)).toEqual(landingOffset(4));
    const a = landingOffset(1);
    const b = landingOffset(2);
    expect(a.dx === b.dx && a.dz === b.dz).toBe(false);
  });

  it("squashes z against x, so scatter lies on the depth-compressed felt", () => {
    for (let i = 1; i < 12; i++) {
      const { dx, dz } = landingOffset(i);
      const angle = i * 2.39996;
      // The ellipse ratio, independent of index radius growth.
      expect(Math.abs(dz / Math.cos(angle))).toBeCloseTo(
        Math.abs((dx / Math.sin(angle)) * 0.6),
        10
      );
    }
  });
});

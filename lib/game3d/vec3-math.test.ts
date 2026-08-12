import { describe, expect, it } from "vitest";
import {
  add,
  cross,
  dist,
  dot,
  len,
  norm,
  rotateAbout,
  scale,
  sub,
  vec,
} from "./vec3-math";

const close = (a: number, b: number, tolerance = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tolerance);

describe("vec3-math", () => {
  it("does the obvious arithmetic", () => {
    expect(add(vec(1, 2, 3), vec(4, 5, 6))).toEqual(vec(5, 7, 9));
    expect(sub(vec(4, 5, 6), vec(1, 2, 3))).toEqual(vec(3, 3, 3));
    expect(scale(vec(1, -2, 3), 2)).toEqual(vec(2, -4, 6));
    expect(dot(vec(1, 2, 3), vec(4, 5, 6))).toBe(32);
    expect(len(vec(3, 4, 0))).toBe(5);
    expect(dist(vec(1, 0, 0), vec(4, 4, 0))).toBe(5);
  });

  it("cross products follow the right-hand rule", () => {
    expect(cross(vec(1, 0, 0), vec(0, 1, 0))).toEqual(vec(0, 0, 1));
    expect(cross(vec(0, 1, 0), vec(0, 0, 1))).toEqual(vec(1, 0, 0));
    expect(cross(vec(0, 0, 1), vec(1, 0, 0))).toEqual(vec(0, 1, 0));
  });

  // The reason `norm` takes a fallback at all: a cross product of two
  // parallel bind-pose axes is a legitimate input here, and a NaN quaternion
  // deletes the whole character from the frame rather than posing one finger
  // oddly.
  it("returns the fallback rather than NaN for a zero-length vector", () => {
    expect(norm(vec(0, 0, 0))).toEqual(vec(0, 1, 0));
    expect(norm(vec(0, 0, 0), vec(1, 0, 0))).toEqual(vec(1, 0, 0));
    const unit = norm(vec(0, 3, 4));
    close(len(unit), 1);
  });

  describe("rotateAbout", () => {
    it("turns +X onto +Y about +Z", () => {
      const r = rotateAbout(vec(1, 0, 0), vec(0, 0, 1), Math.PI / 2);
      close(r.x, 0, 1e-12);
      close(r.y, 1, 1e-12);
      close(r.z, 0, 1e-12);
    });

    it("leaves a vector on its own axis alone", () => {
      const r = rotateAbout(vec(0, 2, 0), vec(0, 1, 0), 1.1);
      close(r.x, 0, 1e-12);
      close(r.y, 2, 1e-12);
      close(r.z, 0, 1e-12);
    });

    it("preserves length", () => {
      const r = rotateAbout(vec(0.3, -1.2, 0.7), norm(vec(1, 1, 1)), 0.83);
      close(len(r), len(vec(0.3, -1.2, 0.7)), 1e-12);
    });

    /**
     * The property `hand-rig.ts` actually depends on: to first order a small
     * positive rotation moves a vector along `axis x vector`. Everything
     * about which way a finger curls is downstream of this sign.
     */
    it("moves a vector along axis x vector for a small angle", () => {
      const v = vec(1, 0, 0);
      const axis = vec(0, 0, 1);
      const moved = sub(rotateAbout(v, axis, 1e-4), v);
      const predicted = scale(cross(axis, v), 1e-4);
      close(moved.x, predicted.x, 1e-8);
      close(moved.y, predicted.y, 1e-8);
      close(moved.z, predicted.z, 1e-8);
    });
  });
});

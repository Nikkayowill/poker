import { describe, expect, it } from "vitest";
import { resolveLandscapeCutout } from "./landscape-cutout-placeholder";

describe("resolveLandscapeCutout", () => {
  it("alternates the two placeholder renders across the five opponent slots", () => {
    const srcs = [0, 1, 2, 3, 4].map((slot) => resolveLandscapeCutout(slot).src);
    expect(new Set(srcs).size).toBe(2);
    expect(srcs[0]).toBe(srcs[2]);
    expect(srcs[2]).toBe(srcs[4]);
    expect(srcs[1]).toBe(srcs[3]);
    expect(srcs[0]).not.toBe(srcs[1]);
  });

  it("flips every other seat for visual variety", () => {
    expect(resolveLandscapeCutout(0).flip).toBe(false);
    expect(resolveLandscapeCutout(1).flip).toBe(true);
    expect(resolveLandscapeCutout(2).flip).toBe(false);
  });

  it("is deterministic -- the same slot always resolves the same way", () => {
    expect(resolveLandscapeCutout(3)).toEqual(resolveLandscapeCutout(3));
  });

  it("never throws on an out-of-range slot", () => {
    expect(() => resolveLandscapeCutout(-1)).not.toThrow();
    expect(() => resolveLandscapeCutout(99)).not.toThrow();
  });
});

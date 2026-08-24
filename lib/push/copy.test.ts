import { describe, expect, it } from "vitest";
import { COME_BACK_PUSH_COPY, pickComeBackPushCopy } from "./copy";

describe("pickComeBackPushCopy", () => {
  it("always returns a line from the pool", () => {
    for (const seed of [0, 1, 7, 42, 1000, -5]) {
      expect(COME_BACK_PUSH_COPY).toContain(pickComeBackPushCopy(seed));
    }
  });

  it("is deterministic for the same seed", () => {
    expect(pickComeBackPushCopy(123)).toBe(pickComeBackPushCopy(123));
  });

  it("has more than one line, so a daily push doesn't always read the same", () => {
    expect(COME_BACK_PUSH_COPY.length).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from "vitest";
import { hashString, mulberry32, mulberry32Step } from "./seeded-random";

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("stackchips")).toBe(hashString("stackchips"));
  });

  it("differs for different inputs", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});

describe("mulberry32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it("produces values in [0, 1)", () => {
    const next = mulberry32(7);
    for (let i = 0; i < 50; i += 1) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("mulberry32Step", () => {
  it("matches mulberry32's own generator step for step", () => {
    const next = mulberry32(123);
    let state = 123;
    for (let i = 0; i < 10; i += 1) {
      const [nextState, value] = mulberry32Step(state);
      state = nextState;
      expect(value).toBe(next());
    }
  });

  it("is a pure function of its input state", () => {
    expect(mulberry32Step(999)).toEqual(mulberry32Step(999));
  });
});

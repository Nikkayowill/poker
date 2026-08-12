import { describe, expect, it } from "vitest";
import { allSeatsLoaded } from "./avatar-load-gate";

describe("allSeatsLoaded", () => {
  it("is true for an empty table -- nothing to wait for", () => {
    expect(allSeatsLoaded([], new Set())).toBe(true);
  });

  it("is false while any expected seat is missing", () => {
    expect(allSeatsLoaded([0, 1, 2], new Set([0, 1]))).toBe(false);
  });

  it("is true once every expected seat has reported", () => {
    expect(allSeatsLoaded([0, 1, 2], new Set([2, 0, 1]))).toBe(true);
  });

  it("ignores loaded slots nobody is waiting on", () => {
    expect(allSeatsLoaded([0], new Set([0, 1, 2, 5]))).toBe(true);
  });

  it("is idempotent -- a slot reporting twice changes nothing", () => {
    const loaded = new Set([0]);
    expect(allSeatsLoaded([0], loaded)).toBe(true);
    loaded.add(0);
    expect(allSeatsLoaded([0], loaded)).toBe(true);
  });
});

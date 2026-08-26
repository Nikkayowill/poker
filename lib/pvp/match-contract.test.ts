import { describe, expect, it } from "vitest";
import { otherSeat, remainingTime, type DuelSeat } from "./match-contract";

describe("otherSeat", () => {
  it("flips the seat", () => {
    expect(otherSeat(0)).toBe(1);
    expect(otherSeat(1)).toBe(0);
  });
});

describe("remainingTime", () => {
  const seat: DuelSeat = 0;
  const other: DuelSeat = 1;

  it("returns the stored value untouched when the match is over", () => {
    expect(remainingTime(5_000, seat, seat, 1_000, 4_000, true)).toBe(5_000);
  });

  it("returns the stored value untouched when it is not this seat's turn", () => {
    expect(remainingTime(5_000, seat, other, 1_000, 9_000, false)).toBe(5_000);
  });

  it("clamps a stored value that somehow went negative on an early return", () => {
    expect(remainingTime(-50, seat, seat, 1_000, 1_000, true)).toBe(0);
    expect(remainingTime(-50, seat, other, 1_000, 1_000, false)).toBe(0);
  });

  it("subtracts elapsed time while it is this seat's own turn", () => {
    expect(remainingTime(5_000, seat, seat, 1_000, 3_000, false)).toBe(3_000);
  });

  it("floors at zero rather than going negative", () => {
    expect(remainingTime(1_000, seat, seat, 0, 5_000, false)).toBe(0);
  });

  it("treats a negative elapsed time (clock skew) as zero elapsed", () => {
    expect(remainingTime(1_000, seat, seat, 5_000, 1_000, false)).toBe(1_000);
  });
});

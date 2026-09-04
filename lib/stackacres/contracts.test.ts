import { describe, expect, it } from "vitest";
import { canFulfillContract, drawContract } from "./contracts";

describe("drawContract", () => {
  it("is deterministic under an injected random source", () => {
    expect(drawContract(() => 0)).toEqual(drawContract(() => 0));
  });

  it("never draws past the end of the table on a roll near 1", () => {
    expect(() => drawContract(() => 0.999999)).not.toThrow();
  });
});

describe("canFulfillContract", () => {
  it("requires the contract still open and the full quantity held", () => {
    expect(canFulfillContract(4, { quantity: 4, status: "open" })).toBe(true);
    expect(canFulfillContract(3, { quantity: 4, status: "open" })).toBe(false);
    expect(canFulfillContract(10, { quantity: 4, status: "fulfilled" })).toBe(false);
  });
});

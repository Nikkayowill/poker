import { describe, expect, it } from "vitest";
import {
  CONTRACT_RUNGS,
  canFulfillContract,
  contractProgress,
  drawContract,
  isPostedRung,
  type StackAcresContractRow,
} from "./contracts";
import { MACHINE_PROCESSED_ITEMS } from "./machine-items";

const EVERYTHING = [...MACHINE_PROCESSED_ITEMS];

describe("drawContract", () => {
  it("is deterministic under an injected random source", () => {
    expect(drawContract(EVERYTHING, () => 0)).toEqual(drawContract(EVERYTHING, () => 0));
  });

  it("never draws past the end of the table on a roll near 1", () => {
    expect(drawContract(EVERYTHING, () => 0.999999)).not.toBeNull();
  });

  it("only ever asks for a good the farm can actually make", () => {
    // The whole point of the gate: one open contract at a time, no cancel, so
    // a Flour contract handed to a player with no Mill blocks every future
    // one. Rolled across the table rather than at one point, since a filtered
    // draw that ignored `producible` would still pass a single-point check.
    for (let roll = 0; roll < 1; roll += 0.05) {
      expect(drawContract(["cheese"], () => roll)?.item).toBe("cheese");
    }
  });

  it("refuses rather than drawing when the farm can make nothing", () => {
    expect(drawContract([], () => 0)).toBeNull();
  });

  it("can reach every rung in the table", () => {
    const seen = new Set(
      CONTRACT_RUNGS.map((_, index) =>
        JSON.stringify(drawContract(EVERYTHING, () => index / CONTRACT_RUNGS.length)),
      ),
    );
    expect(seen.size).toBe(CONTRACT_RUNGS.length);
  });
});

describe("canFulfillContract", () => {
  it("requires the contract still open and the full quantity held", () => {
    expect(canFulfillContract(4, { quantity: 4, status: "open" })).toBe(true);
    expect(canFulfillContract(3, { quantity: 4, status: "open" })).toBe(false);
    expect(canFulfillContract(10, { quantity: 4, status: "fulfilled" })).toBe(false);
  });
});

describe("contractProgress", () => {
  it("is the plain fraction between empty and full", () => {
    expect(contractProgress(0, 4)).toBe(0);
    expect(contractProgress(1, 4)).toBe(0.25);
    expect(contractProgress(4, 4)).toBe(1);
  });

  it("clamps a surplus to a full bar rather than an overflowing one", () => {
    expect(contractProgress(9, 4)).toBe(1);
  });

  it("reads a zero requirement as done instead of dividing by nothing", () => {
    expect(contractProgress(0, 0)).toBe(1);
  });
});

describe("isPostedRung", () => {
  const row = (over: Partial<StackAcresContractRow> = {}): StackAcresContractRow => ({
    id: "c1",
    item: "flour",
    quantity: 4,
    goldReward: 300,
    influenceReward: 25,
    status: "open",
    createdAt: "2026-09-04T00:00:00.000Z",
    ...over,
  });

  it("marks exactly one rung of the board as posted", () => {
    const contract = row();
    const posted = CONTRACT_RUNGS.filter((def) => isPostedRung(contract, def));
    expect(posted).toHaveLength(1);
    expect(posted[0].quantity).toBe(4);
  });

  it("marks none when the town has nothing open", () => {
    expect(CONTRACT_RUNGS.some((def) => isPostedRung(null, def))).toBe(false);
  });

  it("does not match a rung on the item alone", () => {
    expect(isPostedRung(row({ quantity: 3 }), CONTRACT_RUNGS[0])).toBe(false);
  });
});

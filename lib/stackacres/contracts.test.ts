import { describe, expect, it } from "vitest";
import {
  CONTRACT_RUNGS,
  canFulfillContract,
  contractProgress,
  contractRequirements,
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

  it("a raw-crop extra requirement never blocks a draw, unlike a processed one", () => {
    // The Flour + Spinach rung's primary (Flour) still needs a Mill; its
    // extra (Spinach, a raw crop) needs no machine at all -- see
    // contracts.ts's `requirementProducible`. With only "flour" producible,
    // that rung must still be reachable.
    const flourOnly = ["flour"] as const;
    const seen = new Set<string>();
    for (let roll = 0; roll < 1; roll += 0.02) {
      const drawn = drawContract([...flourOnly], () => roll);
      if (drawn) seen.add(JSON.stringify(drawn));
    }
    const hasSpinachRung = [...seen].some((entry) => entry.includes("spinach"));
    expect(hasSpinachRung).toBe(true);
  });
});

describe("canFulfillContract", () => {
  const singleGood = { item: "flour" as const, quantity: 4, extraRequirements: [] };

  it("requires the contract still open and the full quantity held", () => {
    expect(canFulfillContract(() => 4, { ...singleGood, status: "open" })).toBe(true);
    expect(canFulfillContract(() => 3, { ...singleGood, status: "open" })).toBe(false);
    expect(canFulfillContract(() => 10, { ...singleGood, status: "fulfilled" })).toBe(false);
  });

  it("requires every good on a multi-good contract, not just the primary", () => {
    const multiGood = {
      item: "flour" as const,
      quantity: 4,
      extraRequirements: [{ item: "cheese" as const, quantity: 1 }],
      status: "open" as const,
    };
    const held = (item: string) => (item === "flour" ? 10 : 0);
    expect(canFulfillContract(held, multiGood)).toBe(false);

    const heldBoth = (item: string) => (item === "flour" ? 10 : 1);
    expect(canFulfillContract(heldBoth, multiGood)).toBe(true);
  });
});

describe("contractRequirements", () => {
  it("is just the primary pair for a single-good rung", () => {
    expect(contractRequirements({ item: "flour", quantity: 4 })).toEqual([
      { item: "flour", quantity: 4 },
    ]);
  });

  it("puts the primary pair first, then every extra", () => {
    expect(
      contractRequirements({
        item: "flour",
        quantity: 4,
        extraRequirements: [{ item: "cheese", quantity: 1 }],
      }),
    ).toEqual([
      { item: "flour", quantity: 4 },
      { item: "cheese", quantity: 1 },
    ]);
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
    extraRequirements: [],
    ...over,
  });

  it("marks exactly one rung of the board as posted", () => {
    // Two rungs share item "flour" / quantity 4 today -- the plain single-
    // good one and a multi-good one that also asks for Cheese -- so this is
    // exactly the case `isPostedRung`'s extra-requirements comparison exists
    // for; without it this contract would ambiguously match both.
    const contract = row();
    const posted = CONTRACT_RUNGS.filter((def) => isPostedRung(contract, def));
    expect(posted).toHaveLength(1);
    expect(posted[0].quantity).toBe(4);
    expect(posted[0].extraRequirements ?? []).toEqual([]);
  });

  it("marks none when the town has nothing open", () => {
    expect(CONTRACT_RUNGS.some((def) => isPostedRung(null, def))).toBe(false);
  });

  it("does not match a rung on the item alone", () => {
    expect(isPostedRung(row({ quantity: 3 }), CONTRACT_RUNGS[0])).toBe(false);
  });

  it("does not match a single-good rung against a multi-good posted contract, or vice versa", () => {
    const multiGoodRung = CONTRACT_RUNGS.find((def) => (def.extraRequirements?.length ?? 0) > 0);
    expect(multiGoodRung).toBeDefined();
    const singleGoodSameHead = row({ item: multiGoodRung!.item, quantity: multiGoodRung!.quantity });
    expect(isPostedRung(singleGoodSameHead, multiGoodRung!)).toBe(false);

    const multiGoodPosted = row({
      item: multiGoodRung!.item,
      quantity: multiGoodRung!.quantity,
      extraRequirements: multiGoodRung!.extraRequirements!,
    });
    expect(isPostedRung(multiGoodPosted, multiGoodRung!)).toBe(true);
  });
});

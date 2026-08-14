import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEALER_BOX, DEALER_IDS } from "./dealer-art.generated";
import {
  DEALER_SLOT,
  HANDS_PER_DOWN,
  dealerArtSrc,
  dealerForHand,
  dealerSlotBox,
} from "./dealer-roster";

const publicDir = path.join(process.cwd(), "public");

describe("the dealer roster", () => {
  it("has art on disk for every dealer", () => {
    for (const id of DEALER_IDS) {
      const file = path.join(publicDir, dealerArtSrc(id).slice(1));
      expect(existsSync(file), `${dealerArtSrc(id)} is missing from public/`).toBe(true);
    }
  });

  it("gives every dealer their own identity", () => {
    expect(new Set(DEALER_IDS).size).toBe(DEALER_IDS.length);
    expect(DEALER_IDS.length).toBeGreaterThan(0);
  });

  /* The dogs deal Blackjack too, and one room naming them differently from
     the other is how a mascot turns into two mascots. */
  it("uses the same two dogs the arcade does", () => {
    expect(DEALER_IDS).toContain("loki");
    expect(DEALER_IDS).toContain("finn");
  });
});

describe("the dealer slot", () => {
  const anchor = { x: 800, y: 120, shoulderPx: 200 };

  /* The whole promise of the normalised bucket: the slot is solved without
     reference to WHO is in it. A per-dealer term creeping back in would show
     up as a signature change here long before anyone saw it on a table. */
  it("is the same box whoever is dealing", () => {
    expect(dealerSlotBox(anchor)).toEqual(dealerSlotBox(anchor));
    expect(dealerSlotBox.length).toBe(1);
  });

  it("centres the dealer on their anchor", () => {
    const box = dealerSlotBox(anchor);
    expect(box.left + box.width / 2).toBeCloseTo(anchor.x, 6);
  });

  /* It has to grow with the table, not sit at a fixed pixel size: the camera
     re-solves the gap between the flanking chairs every frame, and a viewport
     twice as wide has to produce a dealer twice as big. */
  it("scales with the camera's own shoulder budget", () => {
    const small = dealerSlotBox({ ...anchor, shoulderPx: 100 });
    const large = dealerSlotBox({ ...anchor, shoulderPx: 200 });
    expect(large.width).toBeCloseTo(small.width * 2, 6);
    expect(anchor.y - large.top).toBeCloseTo((anchor.y - small.top) * 2, 6);
  });

  it("keeps the art's own proportions", () => {
    const box = dealerSlotBox(anchor);
    const height = anchor.shoulderPx * DEALER_SLOT.height;
    expect(box.width / height).toBeCloseTo(DEALER_BOX.width / DEALER_BOX.height, 6);
  });

  /* Behind the table, not leaning over it -- the dealer is drawn short of the
     full gap between the chairs, and their crown sits above the projected
     head height rather than below it. */
  it("sits the dealer back from the chairs beside them", () => {
    expect(DEALER_SLOT.height).toBeLessThan(1.5);
    expect(DEALER_SLOT.crown).toBeGreaterThanOrEqual(0);
    expect(dealerSlotBox(anchor).top).toBeLessThan(anchor.y);
  });
});

describe("dealerForHand", () => {
  it("holds one dealer for a whole down, then hands over", () => {
    const first = dealerForHand("table-a", 0);
    for (let hand = 0; hand < HANDS_PER_DOWN; hand += 1) {
      expect(dealerForHand("table-a", hand)).toBe(first);
    }
    expect(dealerForHand("table-a", HANDS_PER_DOWN)).not.toBe(first);
  });

  /* A rotation that revisits somebody before it has been round is not a
     rotation -- it is a shuffle that happens to look like one for a while. */
  it("works through the whole roster before repeating anyone", () => {
    const seen = new Set<string>();
    for (let down = 0; down < DEALER_IDS.length; down += 1) {
      seen.add(dealerForHand("table-a", down * HANDS_PER_DOWN));
    }
    expect(seen.size).toBe(DEALER_IDS.length);
    expect(dealerForHand("table-a", DEALER_IDS.length * HANDS_PER_DOWN))
      .toBe(dealerForHand("table-a", 0));
  });

  /* Two clients at the same table must agree, which is the whole reason this
     is derived from the snapshot rather than picked locally. */
  it("is a pure function of the table id and hand number", () => {
    expect(dealerForHand("table-a", 17)).toBe(dealerForHand("table-a", 17));
  });

  it("does not open every table with the same dealer", () => {
    const openers = new Set(
      ["table-a", "table-b", "table-c", "table-d", "table-e", "table-f"]
        .map((id) => dealerForHand(id, 1)),
    );
    expect(openers.size).toBeGreaterThan(1);
  });

  /* Total over the junk a caller can hand it: the alternative to answering is
     an empty dealer cutout, which reads as the art failing to load. */
  it("answers for any hand number, including nonsense ones", () => {
    for (const hand of [0, 1, -5, 3.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(DEALER_IDS).toContain(dealerForHand("table-a", hand));
    }
    expect(DEALER_IDS).toContain(dealerForHand("", 4));
  });
});

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEALER_BOX } from "./dealer-art.generated";
import { DEALER_ART_SRC, DEALER_SLOT, dealerSlotBox } from "./table-dealer";

const publicDir = path.join(process.cwd(), "public");

describe("the dealer's artwork", () => {
  it("is on disk where the manifest says it is", () => {
    const file = path.join(publicDir, DEALER_ART_SRC.slice(1));
    expect(existsSync(file), `${DEALER_ART_SRC} is missing from public/`).toBe(true);
  });

  /* The manifest is generated from the file it points at, so a box that has
     lost its shape means the two have been edited apart by hand. */
  it("was normalised onto a real box", () => {
    expect(DEALER_BOX.width).toBeGreaterThan(0);
    expect(DEALER_BOX.height).toBeGreaterThan(0);
  });
});

describe("the dealer slot", () => {
  const anchor = { x: 800, y: 120, shoulderPx: 200 };

  /* The whole promise of the normalised plate: the slot is solved without
     reference to WHO is in it, so a redraw needs no number here. An offset
     creeping back in would show up as a signature change long before anyone
     saw it on a table. */
  it("is solved from the anchor alone", () => {
    expect(dealerSlotBox(anchor)).toEqual(dealerSlotBox(anchor));
    expect(dealerSlotBox.length).toBe(1);
  });

  it("centres the dealer on her anchor", () => {
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
     full gap between the chairs, and her crown sits above the projected head
     height rather than below it. */
  it("sits the dealer back from the chairs beside her", () => {
    expect(DEALER_SLOT.height).toBeLessThan(1.5);
    expect(DEALER_SLOT.crown).toBeGreaterThanOrEqual(0);
    expect(dealerSlotBox(anchor).top).toBeLessThan(anchor.y);
  });
});

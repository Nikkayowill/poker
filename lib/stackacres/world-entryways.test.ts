import { describe, expect, it } from "vitest";
import { YARD_PROPS, propRect, type PropKind } from "./props";
import {
  barnHitAt,
  growAreaInterior,
  penFeedSpot,
  rayHouseHitAt,
  signpostHitAt,
  yardWellHitAt,
} from "./world";
import { PEN_ZONE_IDS } from "./zones";

/** The middle of a yard prop's own picture, straight off props.ts. */
function centreOf(kind: PropKind): { x: number; y: number } {
  const prop = YARD_PROPS.find((candidate) => candidate.kind === kind);
  if (!prop) throw new Error(`no ${kind} in YARD_PROPS`);
  const rect = propRect(prop);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// The Town Board and the well are walked up to in the world now, so each box
// has to sit on the art it answers for and nowhere else. The windmill used to
// be a third (the Workshop's own entryway) but it was pulled from the yard --
// see props.ts's own header -- so there is no windmill box to test any more.
describe("the yard's entryways", () => {
  const hits = { signpost: signpostHitAt, well: yardWellHitAt } as const;
  const kinds = Object.keys(hits) as (keyof typeof hits)[];

  for (const kind of kinds) {
    it(`answers a tap on the ${kind}'s own picture`, () => {
      const at = centreOf(kind);
      expect(hits[kind](at.x, at.y)).toBe(true);
    });

    it(`keeps the ${kind} clear of the others, the barn and Ray's house`, () => {
      const at = centreOf(kind);
      for (const other of kinds) {
        if (other !== kind) expect(hits[other](at.x, at.y)).toBe(false);
      }
      expect(barnHitAt(at.x, at.y)).toBe(false);
      expect(rayHouseHitAt(at.x, at.y)).toBe(false);
    });
  }
});

describe("penFeedSpot", () => {
  it("puts every pen's trough on its own walkable ground", () => {
    for (const zone of PEN_ZONE_IDS) {
      const spot = penFeedSpot(zone);
      const inside = growAreaInterior(zone);
      expect(spot.x).toBeGreaterThan(inside.x);
      expect(spot.x).toBeLessThan(inside.x + inside.width);
      expect(spot.y).toBeGreaterThan(inside.y);
      expect(spot.y).toBeLessThan(inside.y + inside.height);
    }
  });
});

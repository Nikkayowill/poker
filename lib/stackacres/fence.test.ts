import { describe, expect, it } from "vitest";
import {
  FENCE_BAY,
  FENCE_BAY_DROP,
  FENCE_BOX,
  FENCE_CAP_H,
  FENCE_POST_H,
  FENCE_POST_W,
  FENCE_RAIL_AT,
  bayFitsDistrict,
  fenceBayStep,
} from "./fence";
import { isoProject } from "./iso";
import { ZONE_IDS } from "./zones";
import { growAreaBounds } from "./world";

describe("fence bay geometry", () => {
  it("leans by exactly what the projection does to a bay-length world step", () => {
    // The whole point of the standing fence. The rails are drawn to
    // FENCE_BAY_DROP; if that ever stops matching isoProject, a bay's far
    // post no longer sits on the ground its neighbour starts from.
    expect(fenceBayStep("x")).toEqual({ x: FENCE_BAY, y: FENCE_BAY_DROP });
    expect(fenceBayStep("y")).toEqual({ x: -FENCE_BAY, y: FENCE_BAY_DROP });
    expect(FENCE_BAY_DROP).toBeCloseTo(isoProject(FENCE_BAY, 0).y, 9);
  });

  it("drops by the same amount whichever axis the run follows", () => {
    // One box shape serves both edge directions only because of this.
    expect(fenceBayStep("x").y).toBeCloseTo(fenceBayStep("y").y, 9);
    expect(fenceBayStep("x").x).toBeCloseTo(-fenceBayStep("y").x, 9);
  });

  it("anchors on the near post's foot, mirrored for the +y run", () => {
    expect(FENCE_BOX.ax * FENCE_BOX.w).toBeCloseTo(FENCE_BOX.footX, 9);
    expect(FENCE_BOX.ay * FENCE_BOX.h).toBeCloseTo(FENCE_BOX.footY, 9);
    // The +y painter mirrors in x and reuses the same box, so its own anchor
    // has to be the mirror of this one.
    expect((1 - FENCE_BOX.ax) * FENCE_BOX.w).toBeCloseTo(FENCE_BOX.w - FENCE_BOX.footX, 9);
  });

  it("fits the whole bay -- both posts, the cap and the drop -- inside its box", () => {
    // Half a post either end, plus the run between them.
    expect(FENCE_BOX.w).toBeCloseTo(FENCE_BOX.footX * 2 + FENCE_BAY, 9);
    // The far post's foot is the lowest thing drawn; its cap the highest.
    expect(FENCE_BOX.footY + FENCE_BAY_DROP).toBeCloseTo(FENCE_BOX.h, 9);
    expect(FENCE_BOX.footY - FENCE_POST_H - FENCE_CAP_H).toBeCloseTo(0, 9);
    for (const at of FENCE_RAIL_AT) expect(at).toBeGreaterThan(0);
    for (const at of FENCE_RAIL_AT) expect(at).toBeLessThan(FENCE_POST_H);
  });

  it("keeps posts taller than they are wide", () => {
    // A post that is not clearly upright is the flat fence coming back.
    expect(FENCE_POST_H).toBeGreaterThan(FENCE_POST_W * 2);
  });

  it("divides every district's edge into whole bays", () => {
    // A run is laid from one corner in fixed steps and each bay carries a
    // post at both ends, so a remainder leaves the last bay past the corner.
    for (const id of ZONE_IDS) {
      const area = growAreaBounds(id);
      expect(bayFitsDistrict(area.width), `${id} width`).toBe(true);
      expect(bayFitsDistrict(area.height), `${id} height`).toBe(true);
    }
    expect(bayFitsDistrict(FENCE_BAY - 1)).toBe(false);
    expect(bayFitsDistrict(0)).toBe(false);
  });
});

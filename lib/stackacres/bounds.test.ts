import { describe, expect, it } from "vitest";
import { worldBoundsRect, worldBoundsScreenRect } from "./bounds";
import { WORLD_BOUND_MARGIN } from "./world";
import { projectedCorners } from "./iso";
import { ZONE_LIST } from "./zones";

describe("worldBoundsRect", () => {
  it("contains every district's own bounds with the margin to spare", () => {
    const rect = worldBoundsRect();
    for (const zone of ZONE_LIST) {
      const b = zone.bounds;
      expect(b.x - rect.x).toBeGreaterThanOrEqual(WORLD_BOUND_MARGIN);
      expect(b.y - rect.y).toBeGreaterThanOrEqual(WORLD_BOUND_MARGIN);
      expect(rect.x + rect.width - (b.x + b.width)).toBeGreaterThanOrEqual(WORLD_BOUND_MARGIN);
      expect(rect.y + rect.height - (b.y + b.height)).toBeGreaterThanOrEqual(WORLD_BOUND_MARGIN);
    }
  });

  it("is exactly the union of every district, padded by the margin on all four sides", () => {
    const rect = worldBoundsRect();
    const minX = Math.min(...ZONE_LIST.map((z) => z.bounds.x));
    const minY = Math.min(...ZONE_LIST.map((z) => z.bounds.y));
    const maxX = Math.max(...ZONE_LIST.map((z) => z.bounds.x + z.bounds.width));
    const maxY = Math.max(...ZONE_LIST.map((z) => z.bounds.y + z.bounds.height));
    expect(rect.x).toBe(minX - WORLD_BOUND_MARGIN);
    expect(rect.y).toBe(minY - WORLD_BOUND_MARGIN);
    expect(rect.width).toBe(maxX - minX + WORLD_BOUND_MARGIN * 2);
    expect(rect.height).toBe(maxY - minY + WORLD_BOUND_MARGIN * 2);
  });
});

describe("worldBoundsScreenRect", () => {
  it("contains the projected corners of every district's own bounds", () => {
    const screen = worldBoundsScreenRect();
    for (const zone of ZONE_LIST) {
      const corners = projectedCorners(zone.bounds);
      for (const p of [corners.n, corners.e, corners.s, corners.w]) {
        expect(p.x).toBeGreaterThanOrEqual(screen.x);
        expect(p.x).toBeLessThanOrEqual(screen.x + screen.width);
        expect(p.y).toBeGreaterThanOrEqual(screen.y);
        expect(p.y).toBeLessThanOrEqual(screen.y + screen.height);
      }
    }
  });

  it("is wide enough that a fully zoomed-out mobile viewport is never wider than it", () => {
    // The narrowest real case this world has to frame: a phone in landscape,
    // logical width ~700 CSS px, at the camera's own minimum zoom. Below
    // STACKACRES_ZOOM_MIN the world would look smaller than the viewport and
    // Phaser centers rather than clips (Camera.clampX/clampY's own
    // documented behaviour) -- this just confirms that degenerate case is
    // nowhere near the sizes this world actually uses.
    const screen = worldBoundsScreenRect();
    const STACKACRES_ZOOM_MIN = 0.6;
    const worstCaseViewportWidth = 700 / STACKACRES_ZOOM_MIN;
    expect(screen.width).toBeGreaterThan(worstCaseViewportWidth);
  });
});

import { describe, expect, it } from "vitest";
import { DRAG_DROP_RADIUS, DRAG_ICON_EDGE, DRAG_ICON_OFFSET, dragIconSpot, isDragDrop } from "./drag-affordance";

const FIELD = { width: 800, height: 600 };

describe("dragIconSpot", () => {
  it("floats up and to the right of the tap by default", () => {
    expect(dragIconSpot({ x: 400, y: 300 }, FIELD)).toEqual({
      x: 400 + DRAG_ICON_OFFSET.x,
      y: 300 + DRAG_ICON_OFFSET.y,
    });
  });

  it("flips to the left of a tap near the right edge", () => {
    const anchor = { x: FIELD.width - 10, y: 300 };
    expect(dragIconSpot(anchor, FIELD).x).toBe(anchor.x - DRAG_ICON_OFFSET.x);
  });

  it("flips below a tap near the top edge", () => {
    const anchor = { x: 400, y: 10 };
    expect(dragIconSpot(anchor, FIELD).y).toBe(anchor.y - DRAG_ICON_OFFSET.y);
  });

  it("never leaves the field, whichever corner was tapped", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: FIELD.width, y: 0 },
      { x: 0, y: FIELD.height },
      { x: FIELD.width, y: FIELD.height },
    ];
    for (const anchor of corners) {
      const spot = dragIconSpot(anchor, FIELD);
      expect(spot.x).toBeGreaterThanOrEqual(DRAG_ICON_EDGE);
      expect(spot.x).toBeLessThanOrEqual(FIELD.width - DRAG_ICON_EDGE);
      expect(spot.y).toBeGreaterThanOrEqual(DRAG_ICON_EDGE);
      expect(spot.y).toBeLessThanOrEqual(FIELD.height - DRAG_ICON_EDGE);
    }
  });

  // The whole point is that the player has to drag. A token that already
  // sat on its own target would count a bare tap as a drop.
  it("starts outside the drop radius of the tap it came from", () => {
    const anchor = { x: 400, y: 300 };
    expect(isDragDrop(dragIconSpot(anchor, FIELD), anchor)).toBe(false);
  });
});

describe("isDragDrop", () => {
  const target = { x: 100, y: 100 };

  it("counts a release on the edge of the radius", () => {
    expect(isDragDrop({ x: 100 + DRAG_DROP_RADIUS, y: 100 }, target)).toBe(true);
  });

  it("rejects a release just past it", () => {
    expect(isDragDrop({ x: 100 + DRAG_DROP_RADIUS + 1, y: 100 }, target)).toBe(false);
  });
});

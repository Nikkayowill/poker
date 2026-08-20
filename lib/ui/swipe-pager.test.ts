import { describe, expect, it } from "vitest";

import {
  AXIS_LOCK_PX,
  EDGE_RESISTANCE,
  SETTLE_FRACTION,
  beginSwipe,
  clampPage,
  settleSwipe,
  trackSwipe,
} from "./swipe-pager";

const WIDTH = 390;
const PAGES = 3;

function drag(dx: number, dy: number, page: number) {
  const start = beginSwipe(0, 0, WIDTH);
  return trackSwipe(start, dx, dy, page, PAGES);
}

describe("axis lock", () => {
  it("stays undecided until movement passes the lock distance", () => {
    const move = drag(AXIS_LOCK_PX - 1, AXIS_LOCK_PX - 1, 0);
    expect(move.gesture.axis).toBe("undecided");
    expect(move.offset).toBeNull();
  });

  it("locks horizontal when x dominates", () => {
    expect(drag(40, 5, 1).gesture.axis).toBe("horizontal");
  });

  it("locks vertical when y dominates, and reports no offset", () => {
    const move = drag(5, 40, 1);
    expect(move.gesture.axis).toBe("vertical");
    expect(move.offset).toBeNull();
  });

  /* A pane is a scrolling list. If a mostly-vertical drag could still turn a
     page the list would scroll and the screen would slide at the same time. */
  it("keeps a vertical gesture vertical even once it wanders sideways", () => {
    const locked = drag(5, 40, 1).gesture;
    const later = trackSwipe(locked, 200, 60, 1, PAGES);
    expect(later.gesture.axis).toBe("vertical");
    expect(later.offset).toBeNull();
    expect(settleSwipe(later.gesture, 0, 1, PAGES)).toBe(1);
  });
});

describe("edge resistance", () => {
  it("passes a mid-track drag through at full distance", () => {
    expect(drag(-80, 0, 1).offset).toBe(-80);
  });

  it("damps a drag back past the first pane", () => {
    expect(drag(80, 0, 0).offset).toBeCloseTo(80 * EDGE_RESISTANCE);
  });

  it("damps a drag forward past the last pane", () => {
    expect(drag(-80, 0, PAGES - 1).offset).toBeCloseTo(-80 * EDGE_RESISTANCE);
  });

  it("does not damp the direction that has somewhere to go", () => {
    expect(drag(-80, 0, 0).offset).toBe(-80);
    expect(drag(80, 0, PAGES - 1).offset).toBe(80);
  });
});

describe("settling", () => {
  const horizontal = { startX: 0, startY: 0, width: WIDTH, axis: "horizontal" as const };
  const threshold = WIDTH * SETTLE_FRACTION;

  it("advances once the drag clears the threshold", () => {
    expect(settleSwipe(horizontal, -threshold, 0, PAGES)).toBe(1);
  });

  it("goes back the other way", () => {
    expect(settleSwipe(horizontal, threshold, 2, PAGES)).toBe(1);
  });

  it("snaps back when the drag falls short", () => {
    expect(settleSwipe(horizontal, -threshold + 1, 0, PAGES)).toBe(0);
    expect(settleSwipe(horizontal, threshold - 1, 2, PAGES)).toBe(2);
  });

  /* Resistance moves the track past the end; it must never move the page. */
  it("cannot walk off either end", () => {
    expect(settleSwipe(horizontal, WIDTH, 0, PAGES)).toBe(0);
    expect(settleSwipe(horizontal, -WIDTH, PAGES - 1, PAGES)).toBe(PAGES - 1);
  });

  it("never turns a page on an undecided gesture", () => {
    const idle = { startX: 0, startY: 0, width: WIDTH, axis: "undecided" as const };
    expect(settleSwipe(idle, -WIDTH, 0, PAGES)).toBe(0);
  });
});

describe("clampPage", () => {
  it("holds the ends", () => {
    expect(clampPage(-3, PAGES)).toBe(0);
    expect(clampPage(9, PAGES)).toBe(PAGES - 1);
  });

  it("survives an empty pager rather than returning -1", () => {
    expect(clampPage(2, 0)).toBe(0);
  });
});

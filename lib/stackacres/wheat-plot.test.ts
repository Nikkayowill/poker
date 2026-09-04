import { describe, expect, it } from "vitest";
import { isWheatPlotReady, wheatPlotProgress } from "./wheat-plot";

const STARTED = "2026-09-04T00:00:00.000Z";
const READY = "2026-09-04T00:10:00.000Z";

describe("isWheatPlotReady", () => {
  it("is false before ready_at and true at or after it", () => {
    expect(isWheatPlotReady({ readyAt: READY }, new Date("2026-09-04T00:09:59.000Z"))).toBe(false);
    expect(isWheatPlotReady({ readyAt: READY }, new Date(READY))).toBe(true);
    expect(isWheatPlotReady({ readyAt: READY }, new Date("2026-09-04T00:20:00.000Z"))).toBe(true);
  });
});

describe("wheatPlotProgress", () => {
  it("runs 0 at start to 1 at ready, clamped either side", () => {
    expect(wheatPlotProgress({ startedAt: STARTED, readyAt: READY }, new Date(STARTED))).toBe(0);
    expect(wheatPlotProgress({ startedAt: STARTED, readyAt: READY }, new Date(READY))).toBe(1);
    expect(
      wheatPlotProgress({ startedAt: STARTED, readyAt: READY }, new Date("2026-09-04T00:05:00.000Z")),
    ).toBeCloseTo(0.5);
    expect(
      wheatPlotProgress({ startedAt: STARTED, readyAt: READY }, new Date("2027-01-01T00:00:00.000Z")),
    ).toBe(1);
  });
});

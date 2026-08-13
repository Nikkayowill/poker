import { describe, expect, it } from "vitest";
import {
  FELT_ART_NARROW_BREAKPOINT_PX,
  FELT_DESKTOP_SRC,
  FELT_MOBILE_SRC,
  feltSrcForViewport,
} from "./felt-art";

describe("feltSrcForViewport", () => {
  it("pins the boundary against 12-responsive.css's max-width: 600px", () => {
    expect(feltSrcForViewport(FELT_ART_NARROW_BREAKPOINT_PX)).toBe(FELT_MOBILE_SRC);
    expect(feltSrcForViewport(FELT_ART_NARROW_BREAKPOINT_PX + 1)).toBe(FELT_DESKTOP_SRC);
  });

  it("picks the mobile plate for a phone width", () => {
    expect(feltSrcForViewport(390)).toBe(FELT_MOBILE_SRC);
  });

  it("picks the desktop plate for a desktop width", () => {
    expect(feltSrcForViewport(1440)).toBe(FELT_DESKTOP_SRC);
  });
});

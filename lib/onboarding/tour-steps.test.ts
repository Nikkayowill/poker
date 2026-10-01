import { describe, expect, it } from "vitest";
import { LOBBY_TOUR_STEPS, STACKACRES_TOUR_STEPS, TABLE_TOUR_STEPS } from "./tour-steps";

/**
 * These are content arrays, not components, but they are still load-bearing:
 * a step whose `element` selector never matches anything real makes
 * useOnboardingTour's "wait for every target to exist" guard wait forever,
 * and the tour just never fires (see stackacres-mechanics-audit's note on
 * silent no-ops). This is a shape check, not a DOM check -- it can't confirm
 * the selectors match real elements, but it can catch an empty description,
 * a duplicate selector, or a step that isn't a `[data-tour="..."]` selector
 * at all.
 */
describe.each([
  ["LOBBY_TOUR_STEPS", LOBBY_TOUR_STEPS],
  ["TABLE_TOUR_STEPS", TABLE_TOUR_STEPS],
  ["STACKACRES_TOUR_STEPS", STACKACRES_TOUR_STEPS],
])("%s", (_name, steps) => {
  it("is non-empty", () => {
    expect(steps.length).toBeGreaterThan(0);
  });

  it("targets a data-tour selector on every step", () => {
    for (const step of steps) {
      expect(step.element).toMatch(/^\[data-tour="[a-z0-9-]+"\]$/);
    }
  });

  it("has no duplicate selectors", () => {
    const selectors = steps.map((step) => step.element);
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it("gives every step a title and a description", () => {
    for (const step of steps) {
      expect(step.popover?.title?.length).toBeGreaterThan(0);
      expect(step.popover?.description?.length).toBeGreaterThan(0);
    }
  });
});

describe("STACKACRES_TOUR_STEPS", () => {
  it("points at the tool belt, the farm world, and the Gold balance", () => {
    const selectors = STACKACRES_TOUR_STEPS.map((step) => step.element);
    expect(selectors).toContain('[data-tour="sa-tool-belt"]');
    expect(selectors).toContain('[data-tour="sa-farm-world"]');
    expect(selectors).toContain('[data-tour="sa-gold-balance"]');
  });
});

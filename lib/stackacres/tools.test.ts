import { describe, expect, it } from "vitest";
import { STACKACRES_SELECTABLE_TOOLS, STACKACRES_TOOLS, STACKACRES_TOOL_DEFS } from "./tools";

// Nothing else catches a tool added to the belt with no def, or a def whose
// name never made it into the belt -- the toolbelt component just renders
// whatever STACKACRES_TOOLS lists and would throw on `undefined.icon` at
// runtime, not at build time. zones.test.ts holds the same shape for
// zoneToolPolicy; this is the definitions' own twin.
describe("toolbelt definitions", () => {
  it("gives every tool a def with a non-empty label, hint and icon", () => {
    for (const tool of STACKACRES_TOOLS) {
      const def = STACKACRES_TOOL_DEFS[tool];
      expect(def, `${tool} has no def`).toBeDefined();
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
    }
  });

  it("defines no tool the belt never lists", () => {
    const known = new Set<string>(STACKACRES_TOOLS);
    for (const tool of Object.keys(STACKACRES_TOOL_DEFS)) {
      expect(known.has(tool), `${tool} has a def but is not in STACKACRES_TOOLS`).toBe(true);
    }
  });

  // Look is the resting state, not a button (see tools.ts's own header):
  // the dock draws every tool but that one, and drops back to it.
  it("draws a button for every tool except inspect", () => {
    expect(STACKACRES_SELECTABLE_TOOLS).not.toContain("inspect");
    expect([...STACKACRES_SELECTABLE_TOOLS].sort()).toEqual(
      STACKACRES_TOOLS.filter((tool) => tool !== "inspect").sort(),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_RENDERER,
  RACETRACK_RENDERER,
  TABLE_RENDERERS,
  TABLE_RENDERER_3D_ENABLED,
  TABLE_RENDERER_STORAGE_KEY,
  type TableRenderer,
  canRenderWebGL,
  nextTableRenderer,
  normalizeTableRenderer,
  resolveTableRenderer,
  tableRendererLabel,
} from "./table-renderer";

// The 3D room is temporarily disabled (TABLE_RENDERER_3D_ENABLED). Rather than
// hardcode the disabled behaviour, these tests read the flag so they keep
// meaning both now and once it flips back.
const webglRenderer = TABLE_RENDERER_3D_ENABLED ? "webgl_3d" : "canvas_2d";

describe("normalizeTableRenderer", () => {
  it("passes through both real renderers", () => {
    expect(normalizeTableRenderer("canvas_2d")).toBe("canvas_2d");
    expect(normalizeTableRenderer("webgl_3d")).toBe("webgl_3d");
  });

  it("falls back to the default for anything else", () => {
    for (const value of [null, undefined, "", "3d", "webgl", 1, {}, []]) {
      expect(normalizeTableRenderer(value)).toBe(DEFAULT_TABLE_RENDERER);
    }
  });
});

describe("nextTableRenderer", () => {
  it("cycles and returns to where it started", () => {
    const expectedCount = TABLE_RENDERER_3D_ENABLED ? TABLE_RENDERERS.length : TABLE_RENDERERS.length - 1;
    let renderer: TableRenderer = "canvas_2d";
    const seen = new Set<TableRenderer>();
    for (let i = 0; i < expectedCount; i += 1) {
      seen.add(renderer);
      renderer = nextTableRenderer(renderer);
    }
    expect(renderer).toBe("canvas_2d");
    expect(seen.size).toBe(expectedCount);
  });
});

describe("tableRendererLabel", () => {
  it("names each renderer distinctly", () => {
    const labels = TABLE_RENDERERS.map(tableRendererLabel);
    expect(new Set(labels).size).toBe(TABLE_RENDERERS.length);
  });

  it("keeps every label short enough for one menu row", () => {
    // Same reasoning as dealerLine's 28-character cap: variable-length prose
    // in a fixed row is what clipped before.
    for (const label of TABLE_RENDERERS.map(tableRendererLabel)) {
      expect(label.length).toBeLessThanOrEqual(28);
    }
  });
});

describe("canRenderWebGL", () => {
  const canvasReturning = (context: unknown) =>
    ({ getContext: () => context }) as unknown as HTMLCanvasElement;

  it("is true when a context comes back", () => {
    expect(canRenderWebGL(() => canvasReturning({}))).toBe(true);
  });

  it("is false when getContext returns null for every variant", () => {
    expect(canRenderWebGL(() => canvasReturning(null))).toBe(false);
  });

  it("is false rather than throwing when getContext itself raises", () => {
    // Some privacy modes raise here instead of returning null. A throw out of
    // this function would defeat the whole point of asking before mounting.
    const hostile = {
      getContext() {
        throw new Error("blocked");
      },
    } as unknown as HTMLCanvasElement;
    expect(canRenderWebGL(() => hostile)).toBe(false);
  });
});

describe("resolveTableRenderer", () => {
  it("honours a 3D preference when WebGL is available and 3D is enabled", () => {
    expect(resolveTableRenderer("webgl_3d", true)).toBe(webglRenderer);
  });

  it("falls back to the classic table when WebGL is not available", () => {
    expect(resolveTableRenderer("webgl_3d", false)).toBe("canvas_2d");
  });

  it("never upgrades a 2D preference, whatever the browser can do", () => {
    expect(resolveTableRenderer("canvas_2d", true)).toBe("canvas_2d");
    expect(resolveTableRenderer("canvas_2d", false)).toBe("canvas_2d");
  });
});

describe("the storage key", () => {
  it("shares the stackchips namespace with every other preference", () => {
    expect(TABLE_RENDERER_STORAGE_KEY.startsWith("stackchips:")).toBe(true);
  });
});

describe("the 2.5D table is landscape-only", () => {
  /* Its table is 2:1; in a portrait frame the felt collapses to a ~58px
     sliver with the opponents' nameplates on the cloth. */
  it("falls back to the classic table in portrait", () => {
    expect(resolveTableRenderer(RACETRACK_RENDERER, true, false)).toBe("canvas_2d");
  });

  it("is itself in landscape", () => {
    expect(resolveTableRenderer(RACETRACK_RENDERER, true, true)).toBe(RACETRACK_RENDERER);
  });

  /* The fallback must not be a one-way door: rotating restores it, which only
     holds because nothing here rewrites the stored preference. */
  it("comes back on rotation, having never overwritten the preference", () => {
    const stored = RACETRACK_RENDERER;
    expect(resolveTableRenderer(stored, true, false)).toBe("canvas_2d");
    expect(resolveTableRenderer(stored, true, true)).toBe(RACETRACK_RENDERER);
  });

  it("leaves the other two renderers alone in portrait", () => {
    expect(resolveTableRenderer("canvas_2d", true, false)).toBe("canvas_2d");
    expect(resolveTableRenderer("webgl_3d", true, false)).toBe(webglRenderer);
  });

  it("defaults to landscape, so every existing caller is unchanged", () => {
    expect(resolveTableRenderer(RACETRACK_RENDERER, true)).toBe(RACETRACK_RENDERER);
  });

  it("is skipped by the menu cycle in portrait", () => {
    const seen = new Set<string>();
    let renderer = resolveTableRenderer("canvas_2d", true, false);
    for (let step = 0; step < 6; step += 1) {
      renderer = nextTableRenderer(renderer, true, false);
      seen.add(renderer);
    }
    expect(seen.has(RACETRACK_RENDERER)).toBe(false);
    expect(seen).toEqual(new Set([webglRenderer, "canvas_2d"].filter((v, i, a) => a.indexOf(v) === i)));
  });

  it("is in the cycle in landscape", () => {
    const seen = new Set<string>();
    let renderer: TableRenderer = "canvas_2d";
    for (let step = 0; step < 6; step += 1) {
      renderer = nextTableRenderer(renderer, true, true);
      seen.add(renderer);
    }
    const expected = TABLE_RENDERER_3D_ENABLED
      ? new Set(["canvas_2d", "webgl_3d", RACETRACK_RENDERER])
      : new Set(["canvas_2d", RACETRACK_RENDERER]);
    expect(seen).toEqual(expected);
  });

  /**
   * The menu steps from what is MOUNTED, not from what is stored, and this is
   * the case that forced it: stored 2.5D, held in portrait, so the classic
   * table is mounted and the entry reads "Table: Classic". Stepping had to
   * move the label -- an entry that lands on what is already on screen looks
   * broken.
   */
  // Only meaningful with a second renderer available in portrait to step to --
  // with the 3D room disabled, canvas_2d is the only portrait option left.
  it.skipIf(!TABLE_RENDERER_3D_ENABLED)(
    "moves the label when cycled from a resolved-away preference",
    () => {
      const mounted = resolveTableRenderer(RACETRACK_RENDERER, true, false);
      expect(mounted).toBe("canvas_2d");
      expect(nextTableRenderer(mounted, true, false)).not.toBe(mounted);
    },
  );

  it("cycles somewhere real even with nothing else available", () => {
    // No WebGL and portrait: the classic table is the only option left, and
    // the step has to be defined rather than undefined.
    expect(nextTableRenderer("canvas_2d", false, false)).toBe("canvas_2d");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_RENDERER,
  TABLE_RENDERERS,
  TABLE_RENDERER_STORAGE_KEY,
  canRenderWebGL,
  nextTableRenderer,
  normalizeTableRenderer,
  resolveTableRenderer,
  tableRendererLabel,
  type TableRenderer,
} from "./table-renderer";

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
    let renderer: TableRenderer = "canvas_2d";
    const seen = new Set<TableRenderer>();
    for (let i = 0; i < TABLE_RENDERERS.length; i += 1) {
      seen.add(renderer);
      renderer = nextTableRenderer(renderer);
    }
    expect(renderer).toBe("canvas_2d");
    expect(seen.size).toBe(TABLE_RENDERERS.length);
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
  it("honours a 3D preference when WebGL is available", () => {
    expect(resolveTableRenderer("webgl_3d", true)).toBe("webgl_3d");
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

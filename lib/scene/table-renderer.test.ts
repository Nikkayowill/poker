import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_RENDERER,
  RACETRACK_RENDERER,
  TABLE_RENDERERS,
  TABLE_RENDERER_STORAGE_KEY,
  canRenderWebGL,
  nextTableRenderer,
  normalizeTableRenderer,
  resolveTableRenderer,
  tableRendererLabel,
} from "./table-renderer";

describe("the table renderer", () => {
  it("ships only the 2.5D table", () => {
    expect(TABLE_RENDERERS).toEqual([RACETRACK_RENDERER]);
    expect(DEFAULT_TABLE_RENDERER).toBe(RACETRACK_RENDERER);
    expect(tableRendererLabel(RACETRACK_RENDERER)).toBe("Table: 2.5D");
  });

  it("normalizes legacy renderer preferences to 2.5D", () => {
    for (const value of [null, undefined, "", "canvas_2d", "webgl_3d", "3d", 1, {}, []]) {
      expect(normalizeTableRenderer(value)).toBe(RACETRACK_RENDERER);
    }
    expect(normalizeTableRenderer(RACETRACK_RENDERER)).toBe(RACETRACK_RENDERER);
  });

  it("keeps the renderer cycle on 2.5D in every viewport", () => {
    expect(nextTableRenderer("canvas_2d", false, false)).toBe(RACETRACK_RENDERER);
    expect(nextTableRenderer(RACETRACK_RENDERER, true, true)).toBe(RACETRACK_RENDERER);
    expect(resolveTableRenderer("canvas_2d", false, false)).toBe(RACETRACK_RENDERER);
    expect(resolveTableRenderer("webgl_3d", true, true)).toBe(RACETRACK_RENDERER);
    expect(resolveTableRenderer(RACETRACK_RENDERER, true, false)).toBe(RACETRACK_RENDERER);
  });

  it("keeps the preference in the stackchips namespace", () => {
    expect(TABLE_RENDERER_STORAGE_KEY.startsWith("stackchips:")).toBe(true);
  });
});

describe("canRenderWebGL", () => {
  const canvasReturning = (context: unknown) =>
    ({ getContext: () => context }) as unknown as HTMLCanvasElement;

  it("is true when a context comes back", () => {
    expect(canRenderWebGL(() => canvasReturning({}))).toBe(true);
  });

  it("is false when getContext returns null", () => {
    expect(canRenderWebGL(() => canvasReturning(null))).toBe(false);
  });

  it("is false rather than throwing when getContext raises", () => {
    const hostile = {
      getContext() {
        throw new Error("blocked");
      },
    } as unknown as HTMLCanvasElement;
    expect(canRenderWebGL(() => hostile)).toBe(false);
  });
});

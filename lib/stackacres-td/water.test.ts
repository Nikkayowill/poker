import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FILM_DRIFT_MS,
  FILM_FRAME_MS,
  FILM_FRAMES,
  FILM_SIZE,
  FOAM_SWAP_MS,
  type WaterSpec,
  filmDrift,
  filmFrame,
  filmSheetSize,
  foamSet,
} from "./water";

const ASSETS = "public/stackacres-td";

/** A PNG's width and height, from its header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the film's timing", () => {
  it("steps through its ten frames and loops", () => {
    expect(filmFrame(0)).toBe(0);
    expect(filmFrame(FILM_FRAME_MS - 1)).toBe(0);
    expect(filmFrame(FILM_FRAME_MS)).toBe(1);
    expect(filmFrame(FILM_FRAME_MS * FILM_FRAMES)).toBe(0);
  });

  it("drifts in whole pixels and wraps at its repeat", () => {
    expect(filmDrift(FILM_DRIFT_MS - 1)).toBe(0);
    expect(filmDrift(FILM_DRIFT_MS * 3)).toBe(3);
    expect(filmDrift(FILM_DRIFT_MS * FILM_SIZE)).toBe(0);
  });

  it("swaps the foam dashes once a second", () => {
    expect(foamSet(0)).toBe(1);
    expect(foamSet(FOAM_SWAP_MS)).toBe(2);
    expect(foamSet(FOAM_SWAP_MS * 2)).toBe(1);
  });
});

describe("the exported water pictures", () => {
  it("lay the film sheet out the way the engine reads it", () => {
    expect(pngSize(`${ASSETS}/common/water-film.png`)).toEqual(filmSheetSize());
  });

  it("give the Homestead a mask exactly twice its box, inside the map", () => {
    const area = JSON.parse(readFileSync(`${ASSETS}/areas/homestead/area.json`, "utf8")) as {
      width: number;
      height: number;
      tile: number;
      water: WaterSpec;
    };
    const { x, y, w, h } = area.water;
    expect(pngSize(`${ASSETS}/areas/homestead/water.png`)).toEqual({ width: w * 2, height: h * 2 });
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(area.width * area.tile);
    expect(y + h).toBeLessThanOrEqual(area.height * area.tile);
  });
});

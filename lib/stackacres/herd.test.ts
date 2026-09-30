import { describe, expect, it } from "vitest";
import { HOMESTEAD_HOEABLE_ROWS, HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "./homestead-ground";
import { isWildMapTile } from "./hoeable";
import {
  herdKey,
  herdPlacementProblem,
  herdSquares,
  isHerdMapTile,
  isHerdStock,
  isPlaced,
  unplacedHerd,
} from "./herd";

const none = { beds: new Set<string>(), fences: new Set<string>(), animals: new Set<string>() };

/** The first yard square (open grass, not overgrown) and a wild one, found from the map itself. */
function findTile(wild: boolean): { tx: number; ty: number } {
  for (let ty = 0; ty < HOMESTEAD_MAP_HEIGHT; ty++) {
    for (let tx = 0; tx < HOMESTEAD_MAP_WIDTH; tx++) {
      if (HOMESTEAD_HOEABLE_ROWS[ty]?.[tx] === "1" && isWildMapTile(tx, ty) === wild) return { tx, ty };
    }
  }
  throw new Error("map has no such tile");
}

describe("herd placement", () => {
  const yard = findTile(false);
  const wild = findTile(true);

  it("puts sheep and cattle in the herd, and hens and crops out of it", () => {
    expect(isHerdStock("pig")).toBe(true);
    expect(isHerdStock("cattle")).toBe(true);
    expect(isHerdStock("hen")).toBe(false);
    expect(isHerdStock("wheat")).toBe(false);
  });

  it("allows open yard grass and refuses the overgrown ring", () => {
    expect(isHerdMapTile(yard.tx, yard.ty)).toBe(true);
    expect(isHerdMapTile(wild.tx, wild.ty)).toBe(false);
    expect(herdPlacementProblem(wild.tx, wild.ty, none)).toBe("off_yard");
  });

  it("refuses squares off the map and non-integer squares", () => {
    expect(herdPlacementProblem(-1, 0, none)).toBe("off_yard");
    expect(herdPlacementProblem(HOMESTEAD_MAP_WIDTH, 0, none)).toBe("off_yard");
    expect(herdPlacementProblem(0, HOMESTEAD_MAP_HEIGHT, none)).toBe("off_yard");
    expect(herdPlacementProblem(yard.tx + 0.5, yard.ty, none)).toBe("off_yard");
  });

  it("refuses a bed, a fence and another animal, in that order", () => {
    const key = herdKey(yard.tx, yard.ty);
    expect(herdPlacementProblem(yard.tx, yard.ty, { ...none, beds: new Set([key]) })).toBe("bed");
    expect(herdPlacementProblem(yard.tx, yard.ty, { ...none, fences: new Set([key]) })).toBe("fence");
    expect(herdPlacementProblem(yard.tx, yard.ty, { ...none, animals: new Set([key]) })).toBe("occupied");
    expect(
      herdPlacementProblem(yard.tx, yard.ty, { beds: new Set([key]), fences: new Set([key]), animals: new Set([key]) }),
    ).toBe("bed");
    expect(herdPlacementProblem(yard.tx, yard.ty, none)).toBeNull();
  });

  it("treats a missing position as not placed, so animals bought before placement load as to-place", () => {
    const old = { id: "a", stock: "pig" as const };
    const placed = { id: "b", stock: "cattle" as const, mapTx: yard.tx, mapTy: yard.ty };
    const hen = { id: "c", stock: "hen" as const };
    expect(isPlaced(old)).toBe(false);
    expect(isPlaced(placed)).toBe(true);
    expect(isPlaced(hen)).toBe(false);
    expect(unplacedHerd([placed, old, hen]).map((unit) => unit.id)).toEqual(["a"]);
  });

  it("lists other animals' squares and leaves out the one being moved", () => {
    const a = { id: "a", stock: "pig" as const, mapTx: 1, mapTy: 2 };
    const b = { id: "b", stock: "cattle" as const, mapTx: 3, mapTy: 4 };
    expect([...herdSquares([a, b], "a")]).toEqual(["3,4"]);
    expect([...herdSquares([a, b])].sort()).toEqual(["1,2", "3,4"]);
  });
});

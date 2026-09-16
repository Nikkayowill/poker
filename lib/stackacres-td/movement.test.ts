import { describe, expect, it } from "vitest";
import { advance, findPath, lineClear, tileKey, type Grid } from "./movement";

function grid(rows: string[]): Grid {
  const blocked = new Set<string>();
  rows.forEach((row, ty) => [...row].forEach((c, tx) => c === "#" && blocked.add(tileKey(tx, ty))));
  return { width: rows[0].length, height: rows.length, tile: 16, blocked };
}

const at = (tx: number, ty: number) => ({ x: tx * 16 + 8, y: ty * 16 + 8 });

describe("findPath", () => {
  it("walks straight when nothing is in the way", () => {
    const g = grid(["........", "........", "........"]);
    expect(findPath(g, at(0, 1), at(7, 1))).toEqual([at(7, 1)]);
  });

  it("goes around a signpost instead of stopping against it", () => {
    const g = grid([".....", "..#..", "....."]);
    const path = findPath(g, at(0, 1), at(4, 1));
    expect(path.at(-1)).toEqual(at(4, 1));
    let from = at(0, 1);
    for (const p of path) {
      expect(lineClear(g, from, p)).toBe(true);
      from = p;
    }
  });

  it("walks up to a building when the tap lands on it", () => {
    const g = grid(["......", "...##.", "...##.", "......"]);
    const path = findPath(g, at(0, 2), at(4, 2));
    const end = path.at(-1)!;
    expect(g.blocked.has(tileKey(Math.floor(end.x / 16), Math.floor(end.y / 16)))).toBe(false);
    expect(Math.abs(end.x - at(4, 2).x) + Math.abs(end.y - at(4, 2).y)).toBeLessThanOrEqual(32);
  });

  it("never squeezes diagonally between two blocked corners", () => {
    const g = grid(["#.", ".#"]);
    expect(findPath(g, at(1, 0), at(0, 1))).toEqual([]);
  });
});

describe("advance", () => {
  it("carries leftover distance past a waypoint", () => {
    const { at: pos, path } = advance({ x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: 10, y: 10 }], 15);
    expect(pos).toEqual({ x: 10, y: 5 });
    expect(path).toEqual([{ x: 10, y: 10 }]);
  });
});

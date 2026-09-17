import { describe, expect, it } from "vitest";
import { FOOT, advance, findPath, footClear, lineClear, steer, stickVector, tileKey, type Grid } from "./movement";

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

describe("stickVector", () => {
  it("ignores a thumb resting near the middle", () => {
    expect(stickVector(5, 5, 50)).toBeNull();
  });

  it("walks slowly just past the dead zone and at full speed near the edge", () => {
    const slow = stickVector(0, -12, 50)!;
    expect(slow.x).toBeCloseTo(0);
    expect(Math.hypot(slow.x, slow.y)).toBeCloseTo(0.45 + 0.55 * ((0.24 - 0.2) / 0.55));
    expect(stickVector(40, 0, 50)).toEqual({ x: 1, y: 0 });
    expect(stickVector(0, 500, 50)).toEqual({ x: 0, y: 1 });
  });
});

describe("steer", () => {
  it("walks straight across open ground", () => {
    const g = grid(["......", "......", "......"]);
    const to = steer(g, at(1, 1), { x: 1, y: 0 }, 20);
    expect(to.x).toBeCloseTo(at(1, 1).x + 20);
    expect(to.y).toBeCloseTo(at(1, 1).y);
  });

  it("stops his feet at a wall instead of walking into it", () => {
    const g = grid(["...#", "...#", "...#"]);
    const to = steer(g, at(1, 1), { x: 1, y: 0 }, 60);
    expect(footClear(g, to)).toBe(true);
    expect(to.x + FOOT.halfWidth).toBeLessThan(48);
    expect(to.x).toBeGreaterThan(40);
  });

  it("slides along a wall when pushed into it at an angle", () => {
    const g = grid(["#####", ".....", ".....", "....."]);
    const from = { x: 24, y: 16 + FOOT.halfHeight };
    const to = steer(g, from, { x: 1, y: -1 }, 20);
    expect(to.y).toBeCloseTo(from.y);
    expect(to.x).toBeGreaterThan(from.x + 10);
  });

  it("is nudged through a one-tile gateway it is a few pixels off", () => {
    const g = grid(["##.##", ".....", "....."]);
    // Far enough left of the gap that his feet catch its post, pushing straight up.
    let p = { x: 40 - 5, y: 24 };
    for (let i = 0; i < 20; i++) p = steer(g, p, { x: 0, y: -1 }, 2);
    expect(p.y).toBeLessThan(12);
    expect(footClear(g, p)).toBe(true);
  });

  it("stays put pushing straight into a flat wall", () => {
    const g = grid(["#####", ".....", "....."]);
    const from = { x: 40, y: 16 + FOOT.halfHeight };
    expect(steer(g, from, { x: 0, y: -1 }, 10)).toEqual(from);
  });

  it("can always walk back out when a tap walk left his feet over a building's edge", () => {
    const g = grid(["#####", ".....", "....."]);
    const from = { x: 40, y: 17 };
    expect(footClear(g, from)).toBe(false);
    expect(steer(g, from, { x: 0, y: 1 }, 6).y).toBeGreaterThan(from.y);
  });

  it("never leaves the map", () => {
    const g = grid(["...", "...", "..."]);
    const to = steer(g, at(0, 1), { x: -1, y: 0 }, 50);
    expect(to.x - FOOT.halfWidth).toBeGreaterThanOrEqual(0);
  });
});

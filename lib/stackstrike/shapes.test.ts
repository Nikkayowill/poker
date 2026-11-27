import { describe, expect, it } from "vitest";
import { distanceToWall, lineOfSight, resolveCircleAgainstWalls } from "./geometry";
import { arcWall, bar, chamfered, cutCorner, post, ringWall } from "./shapes";

const solid = (walls: Parameters<typeof lineOfSight>[2], x: number, y: number) => walls.some((wall) => distanceToWall(x, y, wall) === 0);
const at = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + Math.cos((deg * Math.PI) / 180) * r, y: cy + Math.sin((deg * Math.PI) / 180) * r });

describe("arcWall", () => {
  const arc = arcWall(500, 500, 100, 20, 0, 90);

  it("is solid along its whole length and its full thickness", () => {
    for (let deg = 1; deg < 90; deg += 3) {
      for (const r of [91, 100, 109]) {
        const p = at(500, 500, r, deg);
        expect(solid(arc, p.x, p.y), `${deg} deg at ${r}`).toBe(true);
      }
    }
  });

  it("leaves the floor either side open, and the ends where they should be", () => {
    for (const r of [70, 85, 115, 130]) {
      const p = at(500, 500, r, 45);
      expect(solid(arc, p.x, p.y), `${r}`).toBe(false);
    }
    const past = at(500, 500, 100, 100);
    expect(solid(arc, past.x, past.y)).toBe(false);
  });

  it("blocks sight across the band and not along the open side", () => {
    expect(lineOfSight(at(500, 500, 60, 45), at(500, 500, 140, 45), arc)).toBe(false);
    expect(lineOfSight(at(500, 500, 60, 20), at(500, 500, 60, 70), arc)).toBe(true);
  });
});

describe("ringWall", () => {
  const ring = ringWall(500, 500, 100, 20, [[180, 10], [0, 10]]);

  it("is solid all round except in the doorways", () => {
    for (const deg of [30, 90, 150, 210, 270, 330]) {
      const p = at(500, 500, 100, deg);
      expect(solid(ring, p.x, p.y), `${deg}`).toBe(true);
    }
    for (const deg of [180, 0, 5, 175]) {
      const p = at(500, 500, 100, deg);
      expect(solid(ring, p.x, p.y), `${deg}`).toBe(false);
    }
  });

  it("lets a body walk through a doorway wide enough for it and sees through it", () => {
    expect(lineOfSight(at(500, 500, 40, 180), at(500, 500, 160, 180), ring)).toBe(true);
    const walker = at(500, 500, 100, 180);
    resolveCircleAgainstWalls(walker, 12, ring);
    expect(Math.hypot(walker.x - at(500, 500, 100, 180).x, walker.y - at(500, 500, 100, 180).y)).toBeLessThan(1);
  });

  it("is a closed circle with no gaps given", () => {
    const closed = ringWall(500, 500, 100, 20, []);
    for (let deg = 0; deg < 360; deg += 13) {
      const p = at(500, 500, 100, deg);
      expect(solid(closed, p.x, p.y), `${deg}`).toBe(true);
    }
  });
});

describe("other shapes", () => {
  it("a bar is a wall of the given thickness at any angle", () => {
    const wall = bar({ x: 100, y: 100 }, { x: 200, y: 200 }, 20);
    expect(solid([wall], 150, 150)).toBe(true);
    expect(solid([wall], 150 + 6, 150 - 6)).toBe(true);
    expect(distanceToWall(150 + 20, 150 - 20, wall)).toBeCloseTo(Math.hypot(20, 20) - 10, 4);
    expect(solid([wall], 103, 103)).toBe(true);
    expect(solid([wall], 95, 95)).toBe(false);
    expect(solid([wall], 60, 100)).toBe(false);
  });

  it("a chamfered block has its corners cut and its sides full", () => {
    const desk = chamfered(100, 100, 100, 50, 10);
    expect(solid([desk], 150, 125)).toBe(true);
    expect(solid([desk], 101, 101)).toBe(false);
    expect(solid([desk], 101, 125)).toBe(true);
    expect(chamfered(0, 0, 10, 10, 50).points.length).toBe(8);
  });

  it("a cut corner fills the sharp corner and leaves the room open beyond the cut", () => {
    const wedge = cutCorner({ x: 0, y: 0 }, 40, { x: 100, y: 100 });
    expect(solid([wedge], 5, 5)).toBe(true);
    expect(solid([wedge], 30, 30)).toBe(false);
    const other = cutCorner({ x: 200, y: 200 }, 40, { x: 100, y: 100 });
    expect(solid([other], 195, 195)).toBe(true);
    expect(solid([other], 170, 170)).toBe(false);
  });

  it("a post is a round block", () => {
    const p = post(300, 300, 15);
    expect(p).toEqual({ x: 300, y: 300, r: 15, style: "pillar" });
  });
});

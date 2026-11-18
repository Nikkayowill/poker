import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findPath, tileKey, type Point } from "@/lib/stackacres-td/movement";
import { areaMapOf, type AreaSpecForRoutines } from "@/lib/stackacres-td/npc-routine";
import { cropFieldObstaclePlacements } from "./crop-field-obstacles";
import {
  OPENING_BUS_STOP,
  OPENING_CARDS,
  OPENING_DOOR,
  OPENING_LINES,
  OPENING_MEET_FARMER,
  OPENING_PORCH_FARMER,
  OPENING_PORCH_RAY,
  OPENING_RAY_WAIT,
  facingToward,
  openingLineMs,
  openingOwed,
} from "./opening";

interface PropBox {
  frame: string;
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  scale?: number;
}
const areaJson = readFileSync("public/stackacres-td/areas/homestead/area.json", "utf8");
const spec = JSON.parse(areaJson) as AreaSpecForRoutines;
const { props } = JSON.parse(areaJson) as { props: PropBox[] };
// A new farm: the wild land still all overgrown.
const { grid } = areaMapOf(spec);
for (const obstacle of cropFieldObstaclePlacements()) grid.blocked.add(tileKey(obstacle.tx, obstacle.ty));

const open = (p: Point) => !grid.blocked.has(tileKey(Math.floor(p.x / grid.tile), Math.floor(p.y / grid.tile)));
const walkable = (from: Point, to: Point) => {
  const path = findPath(grid, from, to);
  const last = path[path.length - 1];
  return path.length > 0 && Math.hypot(last.x - to.x, last.y - to.y) <= grid.tile;
};

describe("the opening on the Homestead", () => {
  it("stands everyone on open ground", () => {
    for (const p of [OPENING_DOOR, OPENING_RAY_WAIT, OPENING_MEET_FARMER, OPENING_PORCH_RAY, OPENING_PORCH_FARMER]) {
      expect(open(p), `${p.x},${p.y}`).toBe(true);
    }
  });

  it("parks the bus where nothing on the map is drawn over it or sits on its roof", () => {
    // The bus picture is 96 by 64 with its wheels 52 down, and the body takes up all but two pixels each side.
    const left = OPENING_BUS_STOP.x - 48 + 2;
    const right = OPENING_BUS_STOP.x - 48 + 94;
    const top = OPENING_BUS_STOP.y - 43;
    const bottom = OPENING_BUS_STOP.y + 4;
    const over = props
      // Ground shadows are drawn flat under everything: the "t" frames.
      .filter((prop) => !/^t\d+$/.test(prop.frame))
      .filter((prop) => {
        const scale = prop.scale ?? 1;
        const x0 = prop.x - prop.ax * scale;
        const y0 = prop.y - prop.ay * scale;
        return x0 + prop.w * scale > left && x0 < right && y0 + prop.h * scale > top && y0 < bottom;
      })
      .map((prop) => prop.frame);
    expect(over).toEqual([]);
  });

  it("can walk him off the bus to Ray, and both of them up to the porch", () => {
    expect(walkable(OPENING_DOOR, OPENING_MEET_FARMER)).toBe(true);
    expect(walkable(OPENING_RAY_WAIT, OPENING_PORCH_RAY)).toBe(true);
    expect(walkable(OPENING_MEET_FARMER, OPENING_PORCH_FARMER)).toBe(true);
  });

  it("has cards to show and Ray's last word is to go to the city", () => {
    expect(OPENING_CARDS.length).toBeGreaterThan(0);
    expect(OPENING_LINES[OPENING_LINES.length - 1].text).toMatch(/city/i);
    expect(OPENING_LINES.some((line) => line.at === "stop")).toBe(true);
    expect(OPENING_LINES.some((line) => line.at === "porch")).toBe(true);
  });
});

describe("how long a line stays up", () => {
  it("holds a short line for a beat and a long one no more than a few seconds", () => {
    expect(openingLineMs("Hi.")).toBe(2400);
    expect(openingLineMs("x".repeat(400))).toBe(6500);
    expect(openingLineMs("x".repeat(60))).toBeGreaterThan(openingLineMs("x".repeat(30)));
  });
});

describe("which way to look", () => {
  it("faces along the longer way between two points", () => {
    expect(facingToward({ x: 0, y: 0 }, { x: 10, y: 2 })).toBe("right");
    expect(facingToward({ x: 0, y: 0 }, { x: -10, y: 2 })).toBe("left");
    expect(facingToward({ x: 0, y: 0 }, { x: 2, y: 10 })).toBe("down");
    expect(facingToward({ x: 0, y: 0 }, { x: 2, y: -10 })).toBe("up");
  });
});

describe("who is owed the opening", () => {
  it("is a farm the server says has not seen it", () => {
    expect(openingOwed({ seen: false, replay: false, off: false })).toBe(true);
    expect(openingOwed({ seen: true, replay: false, off: false })).toBe(false);
  });

  it("is nobody the server has not answered for, so an offline copy never gets it", () => {
    expect(openingOwed({ seen: null, replay: false, off: false })).toBe(false);
  });

  it("can be turned off for a fresh farm, and asked for by address on any", () => {
    expect(openingOwed({ seen: false, replay: false, off: true })).toBe(false);
    expect(openingOwed({ seen: true, replay: true, off: false })).toBe(true);
    expect(openingOwed({ seen: false, replay: true, off: true })).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The City's crossings (art/stackacres-td/areas/rig/city.py): the Homestead's west bridge and the City's road back,
 * and the grocery's front door and the shop door back out. Nothing in the scene's types says an exit's `to` names a
 * real area or that its spawn lands where the farmer can stand, so these pin both.
 */

interface AreaExit {
  to: string;
  x: number;
  y: number;
  w: number;
  h: number;
  spawn: { x: number; y: number };
}

interface AreaJson {
  width: number;
  tile: number;
  blocked: [number, number][];
  props: { blocks: [number, number][] }[];
  npcs: { name: string; x: number; y: number }[];
  exits: AreaExit[];
}

function readArea(name: string): AreaJson {
  return JSON.parse(readFileSync(`public/stackacres-td/areas/${name}/area.json`, "utf8")) as AreaJson;
}

// Open the way the scene builds its walk grid: not a blocked square and not under any prop's footprint.
function isWalkable(area: AreaJson, worldX: number, worldY: number): boolean {
  const tx = Math.floor(worldX / area.tile);
  const ty = Math.floor(worldY / area.tile);
  const hit = ([bx, by]: [number, number]) => bx === tx && by === ty;
  return !area.blocked.some(hit) && !area.props.some((p) => p.blocks.some(hit));
}

function onlyExit(from: AreaJson, to: string): AreaExit {
  const exits = from.exits.filter((e) => e.to === to);
  expect(exits).toHaveLength(1);
  return exits[0];
}

const homestead = readArea("homestead");
const city = readArea("city");
const grocery = readArea("grocery");

describe("the Homestead's west bridge", () => {
  it("leads to the City, and the City's road leads back", () => {
    expect(onlyExit(homestead, "city").x).toBe(0);
    const back = onlyExit(city, "homestead");
    expect(back.x + back.w).toBe(city.width * city.tile);
  });

  it("no longer leads to the Far Field", () => {
    expect(homestead.exits.filter((e) => e.to === "empire")).toHaveLength(0);
  });

  it("lands the farmer on open ground at both ends", () => {
    const over = onlyExit(homestead, "city").spawn;
    expect(isWalkable(city, over.x, over.y)).toBe(true);
    const back = onlyExit(city, "homestead").spawn;
    expect(isWalkable(homestead, back.x, back.y)).toBe(true);
  });
});

describe("the grocery's front door", () => {
  it("leads in from the City's square and back out onto it", () => {
    onlyExit(city, "grocery");
    onlyExit(grocery, "city");
  });

  it("lands the farmer on open ground on both sides", () => {
    const inside = onlyExit(city, "grocery").spawn;
    expect(isWalkable(grocery, inside.x, inside.y)).toBe(true);
    const outside = onlyExit(grocery, "city").spawn;
    expect(isWalkable(city, outside.x, outside.y)).toBe(true);
  });

  it("sets the farmer down on the step outside the door he went in by", () => {
    const door = onlyExit(city, "grocery");
    const out = onlyExit(grocery, "city").spawn;
    expect(out.x).toBeGreaterThanOrEqual(door.x);
    expect(out.x).toBeLessThanOrEqual(door.x + door.w);
    expect(out.y).toBeGreaterThan(door.y + door.h);
    expect(out.y - (door.y + door.h)).toBeLessThanOrEqual(2 * city.tile);
  });
});

describe("the City's townsfolk", () => {
  it("each stand on open ground", () => {
    expect(city.npcs.length).toBeGreaterThan(0);
    for (const person of city.npcs) expect(isWalkable(city, person.x, person.y), person.name).toBe(true);
  });
});

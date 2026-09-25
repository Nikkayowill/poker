import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The bridge onto the empire district (docs/stackacres-second-map-direction.md
 * section 6a): a small, static contract between the two area.json files that
 * a future hand-edit of either one could silently break -- the scene has no
 * type-level guarantee that an exit's `to` names a real area, or that a
 * spawn point lands on walkable ground rather than inside a wall.
 */

interface AreaExit {
  to: string;
  x: number;
  y: number;
  w: number;
  h: number;
  spawn: { x: number; y: number };
}

interface AreaProp {
  frame: string;
  frames: string[];
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  blocks: [number, number][];
}

interface AreaJson {
  width: number;
  height: number;
  tile: number;
  spawn: { x: number; y: number };
  props: AreaProp[];
  npcs: unknown[];
  blocked: [number, number][];
  exits: AreaExit[];
}

interface PropAtlas {
  frames: Record<string, unknown>;
}

function readArea(name: string): AreaJson {
  return JSON.parse(readFileSync(`public/stackacres-td/areas/${name}/area.json`, "utf8")) as AreaJson;
}

function readPropAtlas(name: string): PropAtlas {
  return JSON.parse(readFileSync(`public/stackacres-td/areas/${name}/props.json`, "utf8")) as PropAtlas;
}

function isWalkable(area: AreaJson, worldX: number, worldY: number): boolean {
  const tx = Math.floor(worldX / area.tile);
  const ty = Math.floor(worldY / area.tile);
  return !area.blocked.some(([bx, by]) => bx === tx && by === ty);
}

// Also checks props' own `blocks` footprints, unlike isWalkable above (which only
// checks ground). Used for the empire district's own wilderness-prop assertions
// below; kept separate so it doesn't change what the pre-existing bridge tests
// (against homestead's already-shipped prop layout) assert.
function isWalkableWithProps(area: AreaJson, worldX: number, worldY: number): boolean {
  const tx = Math.floor(worldX / area.tile);
  const ty = Math.floor(worldY / area.tile);
  const blockedByGround = area.blocked.some(([bx, by]) => bx === tx && by === ty);
  const blockedByProp = area.props.some((p) => p.blocks.some(([bx, by]) => bx === tx && by === ty));
  return !blockedByGround && !blockedByProp;
}

const homestead = readArea("homestead");
const empire = readArea("empire");
const empirePropAtlas = readPropAtlas("empire");

describe("the bridge to the empire district", () => {
  it("gives the Homestead exactly one exit onto it", () => {
    const toEmpire = homestead.exits.filter((e) => e.to === "empire");
    expect(toEmpire).toHaveLength(1);
  });

  it("gives the empire district an exit straight back", () => {
    const toHomestead = empire.exits.filter((e) => e.to === "homestead");
    expect(toHomestead).toHaveLength(1);
  });

  it("lands the farmer on open ground on both sides of the crossing", () => {
    const toEmpire = homestead.exits.find((e) => e.to === "empire")!;
    expect(isWalkable(empire, toEmpire.spawn.x, toEmpire.spawn.y)).toBe(true);

    const toHomestead = empire.exits.find((e) => e.to === "homestead")!;
    expect(isWalkable(homestead, toHomestead.spawn.x, toHomestead.spawn.y)).toBe(true);
  });

  it("starts the empire district with nothing built, only uncleared wilderness", () => {
    // section 6a: no pre-placed buildings, no pre-built terraces -- the map
    // is chopped/cleared/built by the player over time, never a default.
    // Scattered wilderness props (trees/boulders/scrub) are scenery only here --
    // they aren't wired to a clearing mechanic yet, so they carry no `tag`.
    expect(empire.npcs).toHaveLength(0);
    expect(empire.props.length).toBeGreaterThan(0);
    for (const p of empire.props) {
      expect(p).not.toHaveProperty("tag");
    }
  });

  it("gives every empire wilderness prop a frame that actually exists in its atlas", () => {
    for (const p of empire.props) {
      expect(empirePropAtlas.frames).toHaveProperty(p.frame);
      for (const f of p.frames) {
        expect(empirePropAtlas.frames).toHaveProperty(f);
      }
    }
  });

  it("never lets an empire wilderness prop block the spawn point", () => {
    expect(isWalkableWithProps(empire, empire.spawn.x, empire.spawn.y)).toBe(true);
  });

  it("never lets an empire wilderness prop block the doorway back to the Homestead", () => {
    const toHomestead = empire.exits.find((e) => e.to === "homestead")!;
    const tx0 = Math.floor(toHomestead.x / empire.tile);
    const tx1 = Math.floor((toHomestead.x + toHomestead.w - 1) / empire.tile);
    const ty0 = Math.floor(toHomestead.y / empire.tile);
    const ty1 = Math.floor((toHomestead.y + toHomestead.h - 1) / empire.tile);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        expect(isWalkableWithProps(empire, tx * empire.tile + 1, ty * empire.tile + 1)).toBe(true);
      }
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_HALF_WIDTH, depthStrips } from "./building-depth";

interface AreaProp {
  frame: string;
  frames: string[];
  x: number;
  y: number;
  ax: number;
  ay: number;
  w: number;
  h: number;
  scale: number;
  blocks: [number, number][];
  tag?: string;
  flat?: boolean;
  sway?: unknown;
  passable?: boolean;
  falls?: unknown;
}

interface Area {
  tile: number;
  width: number;
  height: number;
  indoor: boolean;
  props: AreaProp[];
  blocked: [number, number][];
}

function area(name: string): Area {
  return JSON.parse(readFileSync(join(process.cwd(), "public/stackacres-td/areas", name, "area.json"), "utf8")) as Area;
}

/** The same test scene.ts uses to decide a prop is a walled building. */
function isBuilding(prop: AreaProp): boolean {
  const natural = prop.tag?.startsWith("tree:") || prop.tag?.startsWith("stone:") || prop.tag?.startsWith("land:");
  return !natural && !prop.flat && !prop.sway && !prop.passable && !prop.falls && prop.frames.length === 1 && prop.blocks.length >= 6 && prop.h >= 32;
}

const strips = (prop: AreaProp, tile: number) =>
  depthStrips({ left: prop.x - prop.ax, right: prop.x - prop.ax + prop.w, baseY: prop.y, blocks: prop.blocks, tile, backY: prop.y - prop.ay });

describe("depthStrips", () => {
  it("leaves a building that blocks nothing as one strip at its base", () => {
    expect(depthStrips({ left: 10, right: 50, baseY: 90, blocks: [], tile: 16 })).toEqual([{ x0: 10, x1: 50, depth: 90 }]);
  });

  it("sorts a doorway and what is within a body of it at the lane's front, and the sides at the back", () => {
    // Three tiles wide and three deep with the middle column open for the last row: a door.
    const blocks: [number, number][] = [];
    for (let tx = 0; tx < 3; tx += 1) for (let ty = 0; ty < 3; ty += 1) if (!(tx === 1 && ty === 2)) blocks.push([tx, ty]);
    const result = depthStrips({ left: 0, right: 48, baseY: 44, blocks, tile: 16 });
    const at = (x: number) => result.find((strip) => x >= strip.x0 && x < strip.x1)!.depth;
    expect(at(24)).toBe(32); // the doorway: the lane stops being walled at its second row
    expect(at(16 - BODY_HALF_WIDTH + 1)).toBe(32); // a body's width from the doorway
    expect(at(8)).toBe(44); // wall well away from the doorway and the sides keeps the picture's own base
    expect(at(2)).toBe(0); // within a body of the side: sorted at the back, so someone beside it is in front
  });
});

describe("the real buildings", () => {
  for (const name of ["homestead", "city"]) {
    const map = area(name);
    const blocked = new Set([...map.blocked, ...map.props.flatMap((prop) => prop.blocks)].map(([tx, ty]) => `${tx},${ty}`));

    it(`cuts only walled buildings on the ${name} map`, () => {
      const cut = map.props.filter((prop) => isBuilding(prop) && strips(prop, map.tile).length > 1);
      // Everything cut is something a person is walked into or around, never scenery.
      for (const prop of cut) expect(prop.blocks.length).toBeGreaterThanOrEqual(6);
      console.log(name, "cut:", cut.map((prop) => `${prop.tag ?? prop.frame} ${strips(prop, map.tile).length} strips`).join("; "));
    });

    it(`never draws a building over someone beside it or in its doorway, only behind its walls, on the ${name} map`, () => {
      for (const prop of map.props.filter(isBuilding)) {
        const list = strips(prop, map.tile);
        const left = prop.x - prop.ax;
        const columns = prop.blocks.map(([tx]) => tx);
        const wallsLeft = Math.min(...columns) * map.tile;
        const wallsRight = (Math.max(...columns) + 1) * map.tile;
        const wallsTop = Math.min(...prop.blocks.map(([, ty]) => ty)) * map.tile;
        // From the picture's top edge south: north of it he is behind everything and nothing is drawn over him.
        for (let y = prop.y - prop.ay + 1; y < prop.y + 48; y += 2) {
          for (let x = left - 12; x < left + prop.w + 12; x += 2) {
            if (blocked.has(`${Math.floor(x / map.tile)},${Math.floor((y - 1) / map.tile)}`)) continue;
            // The roof above the walls is open ground he walks in behind: there, and only there, he is covered.
            const behindWalls = y <= wallsTop && x >= wallsLeft && x < wallsRight;
            if (behindWalls) continue;
            const covering = list.filter((strip) => strip.x1 > x - BODY_HALF_WIDTH && strip.x0 < x + BODY_HALF_WIDTH && strip.depth > y);
            expect(covering, `${prop.tag ?? prop.frame} over feet at ${x},${y}`).toEqual([]);
          }
        }
      }
    });
  }

  it("lets him walk in behind the farmhouse, barn and workshop, where they are drawn over him", () => {
    const map = area("homestead");
    const blocked = new Set([...map.blocked, ...map.props.flatMap((prop) => prop.blocks)].map(([tx, ty]) => `${tx},${ty}`));
    for (const tag of ["farmhouse", "barn", "workshop"]) {
      const prop = map.props.find((candidate) => candidate.tag === tag)!;
      const columns = prop.blocks.map(([tx]) => tx);
      const wallsTop = Math.min(...prop.blocks.map(([, ty]) => ty)) * map.tile;
      const x = ((Math.min(...columns) + Math.max(...columns) + 1) / 2) * map.tile;
      // The last open row above the walls, from the centre of the building.
      const feet = { x, y: wallsTop - 1 };
      expect(blocked.has(`${Math.floor(feet.x / map.tile)},${Math.floor((feet.y - 1) / map.tile)}`), `${tag} roof row is open`).toBe(false);
      // His whole body is inside the picture, and the picture is drawn over it.
      expect(feet.y - 28, `${tag} body is inside the picture`).toBeGreaterThanOrEqual(prop.y - prop.ay);
      const covering = strips(prop, map.tile).filter((strip) => strip.x0 <= feet.x && strip.x1 > feet.x && strip.depth > feet.y);
      expect(covering.length, `${tag} is drawn over him`).toBeGreaterThan(0);
    }
  });
});

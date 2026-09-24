import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPath, tileKey } from "./movement";
import { areaMapOf, areaRoute, planDay, poseAt, routineSpots, type AreaMap, type AreaSpecForRoutines } from "./npc-routine";
import { NPC_ROUTINES, NPC_STATIONS } from "./npc-schedules";
import { cropFieldObstaclePlacements } from "@/lib/stackacres/crop-field-obstacles";
import { isWildMapTile } from "@/lib/stackacres/hoeable";

const AREA_DIR = join(process.cwd(), "public/stackacres-td/areas");
const areaNames = [...new Set(Object.values(NPC_STATIONS).map((station) => station.area)), "homestead"];
interface AreaSpecFull extends AreaSpecForRoutines {
  props: { x: number; y: number; ax: number; ay: number; w: number; h: number; blocks?: [number, number][] }[];
}
const specs: Record<string, AreaSpecFull> = Object.fromEntries(
  areaNames.map((name) => [name, JSON.parse(readFileSync(join(AREA_DIR, name, "area.json"), "utf8")) as AreaSpecFull]),
);
const areas: Record<string, AreaMap> = Object.fromEntries(areaNames.map((name) => [name, areaMapOf(specs[name])]));
// A new farm: the wild land round the yard still all overgrown, every tree and boulder standing.
for (const obstacle of cropFieldObstaclePlacements()) areas.homestead.grid.blocked.add(tileKey(obstacle.tx, obstacle.ty));

/** The wild land's trees are dealt onto it at runtime and stand in front of anyone just north of them, so
 *  a spot keeps off it and out of reach of the canopies of what grows on it. */
const nearWildLand = (x: number, y: number) => {
  const tx = Math.floor(x / 16);
  const ty = Math.floor(y / 16);
  for (let dy = 0; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) if (isWildMapTile(tx + dx, ty + dy)) return true;
  return false;
};

/** A tall prop drawn in front of someone standing at (x, y), covering the middle of their body: a tree's
 *  canopy, a roof. Props are drawn from (x - ax, y - ay), w by h map px, in front of anyone whose feet are
 *  above their own ground line. */
const hiddenBehind = (area: string, x: number, y: number) =>
  specs[area].props.find((prop) => prop.h >= 24 && prop.y > y && x >= prop.x - prop.ax && x <= prop.x - prop.ax + prop.w && y - 14 >= prop.y - prop.ay && y - 14 <= prop.y - prop.ay + prop.h);

const openAt = (area: string, x: number, y: number) => {
  const { grid } = areas[area];
  const tx = Math.floor(x / grid.tile);
  const ty = Math.floor(y / grid.tile);
  return tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height && !grid.blocked.has(tileKey(tx, ty));
};

describe("the farm's routines", () => {
  for (const [name, routine] of Object.entries(NPC_ROUTINES)) {
    describe(name, () => {
      it("stands only on open ground", () => {
        for (const { station, area, spot } of routineSpots(routine, NPC_STATIONS)) {
          expect(openAt(area, spot.x, spot.y), `${station} at ${spot.x},${spot.y}`).toBe(true);
        }
      });

      it("is never hidden behind a tree or a roof while at a spot", () => {
        for (const { station, area, spot } of routineSpots(routine, NPC_STATIONS)) {
          const prop = hiddenBehind(area, spot.x, spot.y);
          expect(prop && `${prop.x},${prop.y}`, `${station} at ${spot.x},${spot.y}`).toBeUndefined();
          if (area === "homestead") expect(nearWildLand(spot.x, spot.y), `${station} at ${spot.x},${spot.y} is by the wild land`).toBe(false);
        }
      });

      it("can walk to every station from the Homestead", () => {
        for (const { station, area, spot } of routineSpots(routine, NPC_STATIONS)) {
          expect(areaRoute(areas, "homestead", area), `${station} in ${area}`).not.toBeNull();
          // The barn counter is walled off on purpose: Ray steps round behind it. Everything else is
          // walked to all the way.
          if (station === "ray-counter") continue;
          const [entry] = area === "homestead" ? [{ x: 496, y: 344 }] : areas[area].exits.filter((exit) => exit.to === "homestead").map((exit) => ({ x: exit.x + exit.w / 2, y: exit.y + exit.h / 2 }));
          const path = findPath(areas[area].grid, entry, spot);
          expect(path.at(-1), `${station} at ${spot.x},${spot.y}`).toEqual({ x: spot.x, y: spot.y });
        }
      });

      it("walks the whole day without stepping onto anything, or jumping", () => {
        const plan = planDay(routine, NPC_STATIONS, areas, 3_600_000);
        let previous = poseAt(plan, 0);
        for (let s = 0; s < 24 * 3600; s += 1) {
          const pose = poseAt(plan, s / 3600);
          if (pose.area === previous.area && !(name === "ray" && pose.area === "barn")) {
            expect(Math.hypot(pose.x - previous.x, pose.y - previous.y), `${name} at ${(s / 3600).toFixed(3)}h`).toBeLessThanOrEqual(routine.speed + 0.5);
          }
          // A smoothed walk may run exactly along the edge of a blocked tile, as the farmer's does: 1px of slack.
          const onOpenGround = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => openAt(pose.area, pose.x + dx, pose.y + dy));
          if (pose.doing !== "walk" || !(name === "ray" && pose.area === "barn")) {
            expect(onOpenGround, `${name} in ${pose.area} at ${pose.x.toFixed(0)},${pose.y.toFixed(0)}, ${(s / 3600).toFixed(3)}h`).toBe(true);
          }
          previous = pose;
        }
      }, 30_000);
    });
  }

  it("has Ray on the Homestead at mid-morning and gone to town at night", () => {
    const plan = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000);
    expect(poseAt(plan, 8).area).toBe("homestead");
    expect(poseAt(plan, 10.5).area).toBe("barn");
    expect(poseAt(plan, 23).area).toBe("townsquare");
  });
});

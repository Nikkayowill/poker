import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPath, tileKey } from "./movement";
import { areaMapOf, areaRoute, daySeed, planDay, poseAt, poseOn, routineSpots, type AreaMap, type AreaSpecForRoutines, type DayPlan } from "./npc-routine";
import { NPC_ROUTINES, NPC_STATIONS, NPC_TEMPERAMENTS } from "./npc-schedules";
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

  it("gives everyone who keeps a routine a temperament", () => {
    for (const name of Object.keys(NPC_ROUTINES)) expect(NPC_TEMPERAMENTS[name], name).toBeDefined();
  });

  describe("on a seeded day", () => {
    const DAYS = [0, 1, 2, 17, 365];

    for (const [name, routine] of Object.entries(NPC_ROUTINES)) {
      it(`${name} still walks the whole day without stepping onto anything, or jumping`, () => {
        for (const day of DAYS) {
          const plan = planDay(routine, NPC_STATIONS, areas, 3_600_000, daySeed(name, day));
          let previous = poseAt(plan, 0);
          for (let s = 0; s < 24 * 3600; s += 2) {
            const pose = poseAt(plan, s / 3600);
            const inBarn = name === "ray" && pose.area === "barn";
            if (pose.area === previous.area && !inBarn) {
              expect(Math.hypot(pose.x - previous.x, pose.y - previous.y), `${name} day ${day} at ${(s / 3600).toFixed(3)}h`).toBeLessThanOrEqual(routine.speed * 1.08 * 2 + 0.5);
            }
            const onOpenGround = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => openAt(pose.area, pose.x + dx, pose.y + dy));
            if (pose.doing !== "walk" || !inBarn) expect(onOpenGround, `${name} day ${day} in ${pose.area} at ${pose.x.toFixed(0)},${pose.y.toFixed(0)}`).toBe(true);
            previous = pose;
          }
        }
      }, 60_000);
    }

    for (const [name, routine] of Object.entries(NPC_ROUTINES)) {
      it(`${name} goes from one day into the next without a jump, however the two days start`, () => {
        const plans = new Map<number, DayPlan>();
        const planFor = (day: number) => {
          if (!plans.has(day)) plans.set(day, planDay(routine, NPC_STATIONS, areas, 3_600_000, daySeed(name, day)));
          return plans.get(day)!;
        };
        for (let day = 1; day <= 40; day++) {
          let previous = poseOn(planFor, day * 24 - 2);
          for (let s = 1; s <= 10 * 3600; s += 2) {
            const pose = poseOn(planFor, day * 24 - 2 + s / 3600);
            const when = `${name} day ${day} at ${(s / 3600 - 2).toFixed(3)}h`;
            if (pose.area === previous.area) {
              expect(Math.hypot(pose.x - previous.x, pose.y - previous.y), when).toBeLessThanOrEqual(routine.speed * 1.08 * 2 + 0.5);
            } else {
              // Changing area is walking through a door, never popping up somewhere else.
              expect([previous.doing, pose.doing], when).toEqual(["walk", "walk"]);
            }
            previous = pose;
          }
        }
      }, 60_000);
    }

    it("is the same day on every device, and not the same as yesterday", () => {
      const at = (day: number) => {
        const plan = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000, daySeed("ray", day));
        return [7.5, 8, 8.5, 11, 12.4, 16.2].map((hour) => poseAt(plan, hour));
      };
      expect(at(4)).toEqual(at(4));
      expect(at(4)).not.toEqual(at(5));
    });

    it("keeps each part of the day at about its hour", () => {
      for (let day = 0; day < 40; day++) {
        const plan = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000, daySeed("ray", day));
        expect(poseAt(plan, 8).area, `day ${day}`).toBe("homestead");
        expect(poseAt(plan, 10.5).area, `day ${day}`).toBe("barn");
        expect(poseAt(plan, 23).area, `day ${day}`).toBe("townsquare");
        const pilgrim = planDay(NPC_ROUTINES.pilgrim, NPC_STATIONS, areas, 3_600_000, daySeed("pilgrim", day));
        expect(poseAt(pilgrim, 10).area, `day ${day}`).toBe("homestead");
      }
    });
  });

  it("has Ray on the Homestead at mid-morning and gone to town at night", () => {
    const plan = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000);
    expect(poseAt(plan, 8).area).toBe("homestead");
    expect(poseAt(plan, 10.5).area).toBe("barn");
    expect(poseAt(plan, 23).area).toBe("townsquare");
  });
});

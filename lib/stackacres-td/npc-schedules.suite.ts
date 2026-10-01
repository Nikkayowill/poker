import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPath, tileKey } from "./movement";
import { areaMapOf, areaRoute, daySeed, planDay, poseAt, poseOn, routineSpots, type AreaMap, type AreaSpecForRoutines, type DayPlan } from "./npc-routine";
import { NPC_ROUTINES, NPC_STATIONS, NPC_TEMPERAMENTS } from "./npc-schedules";
import { cropFieldObstaclePlacements } from "@/lib/stackacres/crop-field-obstacles";
import { isWildMapTile } from "@/lib/stackacres/hoeable";

/**
 * The routine checks, shared by one spec file per routine plus one for what
 * is not about a single routine. Walking a whole day a second at a time is a
 * few seconds a routine and a day-boundary sweep is ten, so in one file the
 * four routines ran back to back for close to two minutes and were the slowest
 * thing in the unit suite by a wide margin. A file each lets Vitest run them
 * on separate workers.
 *
 * `npc-schedules.test.ts` checks that every routine has its own file, so a new
 * routine cannot go untested by being left out here.
 */

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

/** Every routine name that has its own `npc-schedules.<name>.test.ts` beside this file. */
export function routinesWithOwnSpec(): string[] {
  return readdirSync(join(process.cwd(), "lib/stackacres-td"))
    .map((file) => /^npc-schedules\.([a-z]+)\.test\.ts$/.exec(file)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** The checks for one routine: where it stands, where it walks, and that no day or week has a jump in it. */
export function describeRoutine(name: string): void {
  const routine = NPC_ROUTINES[name];
  if (!routine) throw new Error(`No routine is called ${name}`);

  describe(`${name}'s routine`, () => {
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

    describe("on a seeded day", () => {
      const DAYS = [0, 1, 2, 17, 365];

      it("still walks the whole day without stepping onto anything, or jumping", () => {
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

      it("goes from one day into the next without a jump, however the two days start", () => {
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
    });

    describe("on the weekly rest day", () => {
      it("goes from every weekday into the next without a jump", () => {
        // Memoised like the everyday sweep above. Without this every sample
        // replanned both days it straddles, about 35ms a plan over a million
        // samples: the test ran for hours and looked like a hang.
        const plans = new Map<number, DayPlan>();
        const planFor = (day: number) => {
          if (!plans.has(day)) plans.set(day, planDay(routine, NPC_STATIONS, areas, 3_600_000, daySeed(name, day), day));
          return plans.get(day)!;
        };
        for (let day = 1; day <= 14; day++) {
          let previous = poseOn(planFor, day * 24 - 2);
          for (let s = 1; s <= 10 * 3600; s += 2) {
            const pose = poseOn(planFor, day * 24 - 2 + s / 3600);
            const when = `${name} day ${day} at ${(s / 3600 - 2).toFixed(3)}h`;
            if (pose.area === previous.area) {
              expect(Math.hypot(pose.x - previous.x, pose.y - previous.y), when).toBeLessThanOrEqual(routine.speed * 1.08 * 2 + 0.5);
            } else {
              expect([previous.doing, pose.doing], when).toEqual(["walk", "walk"]);
            }
            previous = pose;
          }
        }
      }, 60_000);

      it("ends every variant at the station the everyday routine ends at", () => {
        const last = (steps: { hour: number; station: string }[]) => [...steps].sort((a, b) => a.hour - b.hour).at(-1)!.station;
        for (const steps of Object.values(routine.weekly ?? {})) expect(last(steps!)).toBe(last(routine.steps));
      });
    });
  });
}

/** What is true of the cast as a whole, and of Ray's day in particular. */
export function describeSharedRoutineChecks(): void {
  describe("the farm's routines", () => {
    it("gives everyone who keeps a routine a temperament", () => {
      for (const name of Object.keys(NPC_ROUTINES)) expect(NPC_TEMPERAMENTS[name], name).toBeDefined();
    });

    it("gives everyone who keeps a routine a spec file of their own", () => {
      expect(routinesWithOwnSpec().sort()).toEqual(Object.keys(NPC_ROUTINES).sort());
    });

    describe("on a seeded day", () => {
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
          // Ray's own home station is on the Homestead now -- see NPC_STATIONS' own header on why.
          expect(poseAt(plan, 23).area, `day ${day}`).toBe("homestead");
          const pilgrim = planDay(NPC_ROUTINES.pilgrim, NPC_STATIONS, areas, 3_600_000, daySeed("pilgrim", day));
          expect(poseAt(pilgrim, 10).area, `day ${day}`).toBe("homestead");
        }
      });
    });

    describe("on the weekly rest day", () => {
      const REST = 6;

      it("keeps the barn shut and Ray out on the Homestead", () => {
        for (const day of [REST, REST + 7, REST + 70]) {
          const plan = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000, daySeed("ray", day), day);
          for (let h = 7; h < 20.5; h += 0.05) expect(poseAt(plan, h).area, `day ${day} at ${h.toFixed(2)}h`).toBe("homestead");
        }
      });

      it("leaves the other days alone", () => {
        const plain = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000, daySeed("ray", 3));
        const dated = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000, daySeed("ray", 3), 3);
        expect(dated).toEqual(plain);
        expect(poseAt(dated, 10.5).area).toBe("barn");
      });
    });

    it("has Ray on the Homestead at mid-morning and turned in for the night by the east gate", () => {
      const plan = planDay(NPC_ROUTINES.ray, NPC_STATIONS, areas, 3_600_000);
      expect(poseAt(plan, 8).area).toBe("homestead");
      expect(poseAt(plan, 10.5).area).toBe("barn");
      expect(poseAt(plan, 23).area).toBe("homestead");
      expect(poseAt(plan, 23).x).toBeGreaterThan(900);
    });
  });
}

import { describe, expect, it } from "vitest";
import { tileKey, type Grid } from "./movement";
import { areaRoute, planDay, poseAt, type AreaMap, type Routine, type Station } from "./npc-routine";

function grid(rows: string[]): Grid {
  const blocked = new Set<string>();
  rows.forEach((row, ty) => [...row].forEach((c, tx) => c === "#" && blocked.add(tileKey(tx, ty))));
  return { width: rows[0].length, height: rows.length, tile: 16, blocked };
}

const at = (tx: number, ty: number) => ({ x: tx * 16 + 8, y: ty * 16 + 8 });
const HOUR = 3_600_000;

// A yard with a shed in the middle, and a one-room house through a door on the yard's east edge.
const yard: AreaMap = {
  grid: grid(["..........", "..........", "....##....", "....##....", "..........", ".........."]),
  exits: [{ to: "house", x: 152, y: 32, w: 8, h: 16, spawn: at(1, 1) }],
};
const house: AreaMap = {
  grid: grid(["......", "......", "......"]),
  exits: [{ to: "yard", x: 0, y: 16, w: 8, h: 16, spawn: at(8, 2) }],
};
const areas = { yard, house };

const stations: Record<string, Station> = {
  field: {
    area: "yard",
    spots: [
      { ...at(1, 1), facing: "down", chore: "water", ms: 4000 },
      { ...at(8, 4), facing: "left", chore: "harvest", ms: 4000 },
    ],
  },
  bed: { area: "house", spots: [{ ...at(3, 1), facing: "down", chore: "idle", ms: 60_000 }] },
};

const routine: Routine = { speed: 32, steps: [{ hour: 8, station: "field" }, { hour: 20, station: "bed" }] };

describe("areaRoute", () => {
  it("finds the doors between two areas, and none within one", () => {
    expect(areaRoute(areas, "yard", "yard")).toEqual([]);
    expect(areaRoute(areas, "yard", "house")?.map((exit) => exit.to)).toEqual(["house"]);
    expect(areaRoute(areas, "house", "yard")?.map((exit) => exit.to)).toEqual(["yard"]);
  });

  it("says so when no door leads there", () => {
    expect(areaRoute({ yard: { ...yard, exits: [] }, house }, "yard", "house")).toBeNull();
  });
});

describe("poseAt", () => {
  const plan = planDay(routine, stations, areas, HOUR);

  it("works at the first spot of the station once they've walked there", () => {
    // 20:00 to 08:00 they're in bed; at 10:00 they have long since arrived at the field.
    expect(poseAt(plan, 3)).toMatchObject({ area: "house", doing: "idle" });
    const working = [9, 9.5, 10, 11].map((h) => poseAt(plan, h));
    for (const pose of working) expect(pose.area).toBe("yard");
    expect(working.some((pose) => pose.doing === "water")).toBe(true);
    expect(working.some((pose) => pose.doing === "harvest") || working.some((pose) => pose.doing === "walk")).toBe(true);
  });

  it("is mid-walk right after a step's hour, leaving the house by its door", () => {
    const pose = poseAt(plan, 8 + 1000 / HOUR);
    expect(pose.area).toBe("house");
    expect(pose.doing).toBe("walk");
  });

  it("never steps onto the shed, and never jumps inside an area", () => {
    let previous = poseAt(plan, 7.99);
    for (let ms = 7.99 * HOUR; ms < 8 * HOUR + 120_000; ms += 100) {
      const pose = poseAt(plan, ms / HOUR);
      if (pose.area === "yard") expect(yard.grid.blocked.has(tileKey(Math.floor(pose.x / 16), Math.floor(pose.y / 16)))).toBe(false);
      if (pose.area === previous.area) expect(Math.hypot(pose.x - previous.x, pose.y - previous.y)).toBeLessThanOrEqual(32 * 0.1 + 0.01);
      previous = pose;
    }
  });

  it("is the same function of the hour whatever the day, including across midnight", () => {
    expect(poseAt(plan, 23.5)).toEqual(poseAt(plan, 23.5 + 24));
    expect(poseAt(plan, 0.25)).toEqual(poseAt(plan, 24.25));
  });

  it("walks at their own pace on a faster game clock", () => {
    const fast = planDay(routine, stations, areas, 30_000);
    // Two real seconds after 08:00 on a 30-second hour is 8 + 2/30 hours; they have walked 64px.
    const pose = poseAt(fast, 8 + 2 / 30);
    expect(pose.doing).toBe("walk");
  });

  it("refuses a routine naming a station that doesn't exist", () => {
    expect(() => planDay({ speed: 30, steps: [{ hour: 1, station: "nowhere" }] }, stations, areas, HOUR)).toThrow(/nowhere/);
  });
});

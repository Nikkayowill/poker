import { describe, expect, it } from "vitest";
import {
  EMPIRE_BUILDINGS,
  EMPIRE_BUILDING_KINDS,
  EMPIRE_MAP,
  buildingTiles,
  doorTile,
  layoutFingerprint,
  placementProblem,
  type PlacedEmpireBuilding,
} from "./empire-buildings";

const barnAt = (id: string, tx: number, ty: number): PlacedEmpireBuilding => ({ id, kind: "barn", tx, ty });

/** The first top-left tile, scanning from the map's middle outward, where `kind` fits beside `placed`. */
function firstFit(kind: "barn", placed: PlacedEmpireBuilding[] = []): { tx: number; ty: number } {
  for (let ty = 0; ty < EMPIRE_MAP.height; ty++) {
    for (let tx = 0; tx < EMPIRE_MAP.width; tx++) {
      if (placementProblem(kind, tx, ty, placed) === null) return { tx, ty };
    }
  }
  throw new Error(`no room for a ${kind}`);
}

describe("empire buildings", () => {
  it("every kind costs Gold, Wood and Metal", () => {
    for (const kind of EMPIRE_BUILDING_KINDS) {
      const def = EMPIRE_BUILDINGS[kind];
      expect(def.gold).toBeGreaterThan(0);
      expect(def.materials.map((m) => m.item).sort()).toEqual(["metal", "wood"]);
      expect(def.doorDx).toBeLessThan(def.w);
    }
  });

  it("covers its plan and opens onto the square below its door", () => {
    expect(buildingTiles("barn", 10, 5)).toHaveLength(EMPIRE_BUILDINGS.barn.w * EMPIRE_BUILDINGS.barn.h);
    expect(doorTile("barn", 10, 5)).toEqual({ tx: 10 + EMPIRE_BUILDINGS.barn.doorDx, ty: 5 + EMPIRE_BUILDINGS.barn.h });
  });

  it("fits somewhere on the Far Field as it comes", () => {
    for (const kind of EMPIRE_BUILDING_KINDS) expect(() => firstFit(kind)).not.toThrow();
  });

  it("refuses the map's edge", () => {
    expect(placementProblem("barn", -1, 10, [])).toBe("edge");
    expect(placementProblem("barn", EMPIRE_MAP.width - 3, 10, [])).toBe("edge");
    // Its door would open off the bottom of the map.
    expect(placementProblem("barn", 12, EMPIRE_MAP.height - EMPIRE_BUILDINGS.barn.h, [])).toBe("edge");
  });

  it("keeps the way in over the bridge clear", () => {
    const { spawn } = EMPIRE_MAP;
    expect(placementProblem("barn", spawn.tx - 1, spawn.ty - 2, [])).toBe("bridge");
  });

  it("won't stand on a tree, a rock or the map's own walls", () => {
    const [blocked] = [...EMPIRE_MAP.blocked].filter((k) => {
      const [tx, ty] = k.split(",").map(Number);
      return tx > 3 && ty > 3 && tx < EMPIRE_MAP.width - 10 && ty < EMPIRE_MAP.height - 10;
    });
    const [tx, ty] = blocked.split(",").map(Number);
    expect(placementProblem("barn", tx, ty, [])).toBe("blocked");
  });

  it("won't stand on another building, but a building doesn't block its own move", () => {
    const spot = firstFit("barn");
    const barn = barnAt("a", spot.tx, spot.ty);
    expect(placementProblem("barn", spot.tx, spot.ty, [barn])).toBe("overlap");
    expect(placementProblem("barn", spot.tx, spot.ty, [barn], "a")).toBeNull();
  });

  it("won't cover the square in front of another building's door", () => {
    const spot = firstFit("barn");
    const barn = barnAt("a", spot.tx, spot.ty);
    const door = doorTile("barn", spot.tx, spot.ty);
    // Put a second barn's top-left row on the first one's doorstep.
    const problem = placementProblem("barn", door.tx - 1, door.ty, [barn]);
    expect(problem === "overlap" || problem === "path" || problem === "blocked" || problem === "bridge").toBe(true);
    expect(problem).not.toBeNull();
  });

  it("two buildings can stand side by side with both doors reachable", () => {
    const first = firstFit("barn");
    const barn = barnAt("a", first.tx, first.ty);
    const second = firstFit("barn", [barn]);
    expect(placementProblem("barn", second.tx, second.ty, [barn])).toBeNull();
  });

  it("fingerprints the layout the same way place_empire_building does: placed only, by id, id:tx:ty", () => {
    const a = "cf412476-e2df-4bda-89cd-4f79871b5b7b";
    const b = "c50bf165-5e3d-4cc1-bc3d-c7b035d83eda";
    // The same buildings and the same string the migration test in Postgres produced.
    expect(
      layoutFingerprint([
        { id: a, kind: "barn", tx: 5, ty: 5 },
        { id: "0f000000-0000-0000-0000-000000000000", kind: "barn", tx: null, ty: null },
        { id: b, kind: "barn", tx: 20, ty: 5 },
      ]),
    ).toBe(`${b}:20:5,${a}:5:5`);
    expect(layoutFingerprint([])).toBe("");
  });

  it("keeps an extra square (the farmer's) reachable", () => {
    const spot = firstFit("barn");
    // On the doorstep, which the rule already keeps open.
    const farmer = doorTile("barn", spot.tx, spot.ty);
    expect(placementProblem("barn", spot.tx, spot.ty, [], null, [farmer])).toBeNull();
    // Standing inside the plan he can't be reached at all.
    expect(placementProblem("barn", spot.tx, spot.ty, [], null, [{ tx: spot.tx + 1, ty: spot.ty + 1 }])).toBe("path");
  });
});

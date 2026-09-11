import { describe, expect, it } from "vitest";
import { PROP_SHADOW, PROP_SIZE, YARD_PROPS, farmsteadClutter, propRect } from "../props";
import { BARN_FOOTPRINT, RAY_HOUSE_FOOTPRINT, rayHouseHitAt } from "../world";
import { GREENHOUSE_PLOT } from "../greenhouse";
import { MONK_HOUSE_FOOTPRINT, monkHitAt } from "../monk";
import { nearPath } from "../paths";
import { inPondZone } from "../water";
import { zoneAt } from "../zones";
import { CROP_FIELD } from "../yard";
import { TRAVELER_PROPS, TRAVELER_KIND, travelerForKind, travelerHitAt, travelerSpot } from "./placement";
import { TRAVELER_CATALOGUE, TRAVELER_IDS } from "./travelers";

/** width/height of each PNG as shipped, so a box is never stretched. */
const PNG_ASPECT: Record<string, number> = {
  ray: 158 / 320,
  pierre: 150 / 288,
  miles: 132 / 288,
  skye: 156 / 288,
  barnaby: 132 / 288,
  arthur: 198 / 288,
  brayden: 174 / 288,
  ivy: 186 / 288,
  wes: 108 / 288,
  bea: 162 / 288,
  leo: 174 / 288,
};

function inside(x: number, y: number, rect: { x: number; y: number; width: number; height: number }): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("traveler placement", () => {
  it("places all eleven travelers, one kind each", () => {
    expect(TRAVELER_PROPS).toHaveLength(TRAVELER_IDS.length);
    expect(new Set(TRAVELER_PROPS.map((p) => p.kind)).size).toBe(TRAVELER_IDS.length);
    expect(new Set(TRAVELER_PROPS.map((p) => p.traveler)).size).toBe(TRAVELER_IDS.length);
  });

  it("has a size and a shadow for every traveler kind, in the PNG's own aspect", () => {
    for (const id of TRAVELER_IDS) {
      const kind = TRAVELER_KIND[id];
      expect(PROP_SIZE[kind].h).toBeGreaterThan(0);
      expect(PROP_SHADOW[kind].w).toBeGreaterThan(0);
      expect(PROP_SHADOW[kind].h).toBeGreaterThan(0);
      expect(PROP_SIZE[kind].w / PROP_SIZE[kind].h).toBeCloseTo(PNG_ASPECT[id], 2);
    }
  });

  it("stands each traveler in the district the cast names", () => {
    for (const prop of TRAVELER_PROPS) {
      expect(zoneAt(prop.x, prop.y), prop.traveler).toBe(TRAVELER_CATALOGUE[prop.traveler].zone);
    }
  });

  it("never lands on a path or in the pond", () => {
    for (const prop of TRAVELER_PROPS) {
      expect(nearPath(prop.x, prop.y), prop.traveler).toBe(false);
      expect(inPondZone(prop.x, prop.y), prop.traveler).toBe(false);
    }
  });

  it("keeps every Farmstead traveler's feet out of the buildings and the worked ground", () => {
    const keepOut = [BARN_FOOTPRINT, RAY_HOUSE_FOOTPRINT, MONK_HOUSE_FOOTPRINT, GREENHOUSE_PLOT, CROP_FIELD];
    for (const prop of TRAVELER_PROPS) {
      if (TRAVELER_CATALOGUE[prop.traveler].zone !== "farmstead") continue;
      for (const rect of keepOut) expect(inside(prop.x, prop.y, rect), prop.traveler).toBe(false);
      expect(rayHouseHitAt(prop.x, prop.y), prop.traveler).toBe(false);
      expect(monkHitAt(prop.x, prop.y), prop.traveler).toBe(false);
    }
  });

  it("keeps Pierre and Ivy's pictures off the yard's furniture and clutter", () => {
    const furniture = [...YARD_PROPS, ...farmsteadClutter()].map(propRect);
    for (const id of ["pierre", "ivy"] as const) {
      const box = propRect(travelerSpot(id));
      for (const other of furniture) expect(overlaps(box, other), id).toBe(false);
    }
  });

  it("stands Ray beside his house", () => {
    const ray = travelerSpot("ray");
    const house = RAY_HOUSE_FOOTPRINT;
    const dx = Math.max(house.x - ray.x, ray.x - (house.x + house.width), 0);
    const dy = Math.abs(ray.y - (house.y + house.height));
    expect(dx).toBeLessThanOrEqual(50);
    expect(dy).toBeLessThanOrEqual(24);
  });

  it("never overlaps another traveler's own picture box", () => {
    for (let i = 0; i < TRAVELER_PROPS.length; i += 1) {
      for (let j = i + 1; j < TRAVELER_PROPS.length; j += 1) {
        expect(overlaps(propRect(TRAVELER_PROPS[i]), propRect(TRAVELER_PROPS[j]))).toBe(false);
      }
    }
  });

  it("round-trips a placed kind back to its traveler", () => {
    for (const prop of TRAVELER_PROPS) expect(travelerForKind(prop.kind)).toBe(prop.traveler);
    expect(travelerForKind("windmill")).toBeNull();
  });
});

describe("travelerHitAt", () => {
  it("hits every traveler at their own feet", () => {
    for (const prop of TRAVELER_PROPS) expect(travelerHitAt(prop.x, prop.y - 1)).toBe(prop.traveler);
  });

  it("misses empty ground far from anyone", () => {
    expect(travelerHitAt(0, 0)).toBeNull();
  });

  it("never claims a tap that belongs to Ray's house or the shrine", () => {
    for (const prop of TRAVELER_PROPS) {
      const box = propRect(prop);
      // Ray stands right beside his house, so his picture's far corner may
      // reach over its footprint; his feet and his middle must not. The
      // scene checks travelers before the house, so a tap on his picture is
      // his either way -- this holds the reverse: a tap on the house's own
      // door never lands on him.
      const points =
        prop.traveler === "ray"
          ? [
              [prop.x, prop.y],
              [box.x + box.width / 2, box.y + box.height / 2],
            ]
          : [
              [box.x, box.y],
              [box.x + box.width, box.y],
              [box.x, box.y + box.height],
              [box.x + box.width, box.y + box.height],
            ];
      for (const [x, y] of points) {
        expect(rayHouseHitAt(x, y), prop.traveler).toBe(false);
        expect(monkHitAt(x, y), prop.traveler).toBe(false);
      }
    }
  });
});

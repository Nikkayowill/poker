import { describe, expect, it } from "vitest";
import { herdKey, type HerdUnit } from "./herd";
import {
  CROWDED_RISK,
  OPEN_RISK,
  PEN_TILE_CAP,
  herdAway,
  herdNight,
  herdNightRoll,
  herdNightStartMs,
  herdRisk,
  herdShelter,
  penOf,
} from "./herd-risk";

const DAY = 86_400_000;

function sheep(id: string, mapTx: number | null, mapTy: number | null): HerdUnit {
  return { id, stock: "pig", mapTx, mapTy };
}

/** Fence pieces on the four sides of a rectangle of squares. */
function pen(x0: number, y0: number, x1: number, y1: number): Set<string> {
  const fences = new Set<string>();
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    fences.add(herdKey(x, y0 - 1));
    fences.add(herdKey(x, y1 + 1));
  }
  for (let y = y0; y <= y1; y++) {
    fences.add(herdKey(x0 - 1, y));
    fences.add(herdKey(x1 + 1, y));
  }
  return fences;
}

describe("herd night", () => {
  it("is the UTC day and only moves at midnight", () => {
    expect(herdNight(0)).toBe(0);
    expect(herdNight(DAY - 1)).toBe(0);
    expect(herdNight(DAY)).toBe(1);
    expect(herdNightStartMs(DAY * 5 + 12345)).toBe(DAY * 5);
  });

  it("gives an animal the same number for the same night, every time", () => {
    expect(herdNightRoll("a", 7)).toEqual(herdNightRoll("a", 7));
    expect(herdNightRoll("a", 7)).not.toEqual(herdNightRoll("a", 8));
    const { loss } = herdNightRoll("a", 7);
    expect(loss).toBeGreaterThanOrEqual(0);
    expect(loss).toBeLessThan(1);
  });
});

describe("pens", () => {
  it("closes a lone square with four pieces", () => {
    const fences = new Set([herdKey(4, 3), herdKey(4, 5), herdKey(3, 4), herdKey(5, 4)]);
    expect(penOf(4, 4, fences)?.size).toBe(1);
  });

  it("does not leak through a diagonal gap", () => {
    const fences = pen(4, 4, 5, 5);
    fences.delete(herdKey(3, 3));
    expect(penOf(4, 4, fences)?.size).toBe(4);
  });

  it("leaks through a missing piece", () => {
    const fences = pen(4, 4, 5, 5);
    fences.delete(herdKey(6, 4));
    expect(penOf(4, 4, fences)).toBeNull();
  });

  it("calls a pen bigger than the cap open ground", () => {
    expect(penOf(10, 10, pen(10, 10, 15, 15))?.size).toBe(PEN_TILE_CAP);
    expect(penOf(10, 10, pen(10, 10, 16, 15))).toBeNull();
  });
});

describe("shelter", () => {
  it("is open with no fences", () => {
    const a = sheep("a", 4, 4);
    expect(herdShelter(a, new Set(), [a])).toBe("open");
  });

  it("is a pen when fenced in, even alone in a small one", () => {
    const a = sheep("a", 4, 4);
    expect(herdShelter(a, pen(4, 4, 4, 4), [a])).toBe("pen");
  });

  it("is crowded when a pen is more than half full of animals", () => {
    const fences = pen(4, 4, 5, 5);
    const a = sheep("a", 4, 4);
    const b = sheep("b", 5, 4);
    const c = sheep("c", 4, 5);
    expect(herdShelter(a, fences, [a, b])).toBe("pen");
    expect(herdShelter(a, fences, [a, b, c])).toBe("crowded");
  });

  it("ignores animals outside the pen when counting", () => {
    const fences = pen(4, 4, 5, 5);
    const a = sheep("a", 4, 4);
    const others = [sheep("b", 20, 20), sheep("c", 21, 20), sheep("d", 22, 20)];
    expect(herdShelter(a, fences, [a, ...others])).toBe("pen");
  });

  it("prices each shelter", () => {
    expect(herdRisk("open")).toBe(OPEN_RISK);
    expect(herdRisk("crowded")).toBe(CROWDED_RISK);
    expect(herdRisk("pen")).toBe(0);
  });
});

describe("who is away", () => {
  const units = Array.from({ length: 200 }, (_, i) => sheep(`unit-${i}`, i % 20, Math.floor(i / 20) * 2));

  it("is stable for a night and moves for the next", () => {
    const now = DAY * 100 + 5000;
    expect(herdAway(units, new Set(), now)).toEqual(herdAway(units, new Set(), now + 3_600_000));
    expect(herdAway(units, new Set(), now)).not.toEqual(herdAway(units, new Set(), now + DAY));
  });

  it("loses about the open share of an open herd, and splits the reasons", () => {
    let lost = 0;
    let predators = 0;
    const nights = 20;
    for (let n = 0; n < nights; n++) {
      const away = herdAway(units, new Set(), DAY * (50 + n));
      lost += away.size;
      predators += [...away.values()].filter((kind) => kind === "predator").length;
    }
    const share = lost / (units.length * nights);
    expect(share).toBeGreaterThan(OPEN_RISK - 0.04);
    expect(share).toBeLessThan(OPEN_RISK + 0.04);
    expect(predators).toBeGreaterThan(0);
    expect(predators).toBeLessThan(lost);
  });

  it("never loses a fenced animal", () => {
    const a = sheep("a", 4, 4);
    const fences = pen(4, 4, 4, 4);
    for (let n = 0; n < 500; n++) expect(herdAway([a], fences, DAY * n).size).toBe(0);
  });

  it("brings the same animal back the moment it is fenced, and loses it again unfenced", () => {
    const a = sheep("a", 4, 4);
    let night = -1;
    for (let n = 0; n < 500 && night < 0; n++) if (herdAway([a], new Set(), DAY * n).size === 1) night = n;
    expect(night).toBeGreaterThanOrEqual(0);
    expect(herdAway([a], pen(4, 4, 4, 4), DAY * night).size).toBe(0);
    expect(herdAway([a], new Set(), DAY * night).size).toBe(1);
  });

  it("leaves animals that are not set down alone", () => {
    const loose = Array.from({ length: 100 }, (_, i) => sheep(`x${i}`, null, null));
    expect(herdAway(loose, new Set(), DAY * 9).size).toBe(0);
  });

  it("leaves hens and crops alone", () => {
    const hens: HerdUnit[] = Array.from({ length: 100 }, (_, i) => ({ id: `h${i}`, stock: "hen", mapTx: i, mapTy: 1 }));
    expect(herdAway(hens, new Set(), DAY * 9).size).toBe(0);
  });
});

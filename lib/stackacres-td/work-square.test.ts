import { describe, expect, it } from "vitest";
import { besideSquare, facedTile, tileCentre, workSpot, type Facing } from "./work-square";

const T = 16;
const everywhereOpen = () => true;
const centreOf = (mx: number, my: number) => tileCentre({ mx, my }, T);

describe("facedTile -- the Use key works the square in front", () => {
  const standing = centreOf(10, 10);
  const cases: [Facing, { mx: number; my: number }][] = [
    ["up", { mx: 10, my: 9 }],
    ["down", { mx: 10, my: 11 }],
    ["left", { mx: 9, my: 10 }],
    ["right", { mx: 11, my: 10 }],
  ];
  for (const [facing, expected] of cases) {
    it(`looking ${facing}, it is the square ${facing} of him`, () => {
      expect(facedTile(standing, facing, T)).toEqual(expected);
    });
  }

  it("is never the square he is standing on", () => {
    for (const facing of ["up", "down", "left", "right"] as const) {
      expect(facedTile(standing, facing, T)).not.toEqual({ mx: 10, my: 10 });
    }
  });

  it("goes by the square his feet are in, not by where in it he stands", () => {
    expect(facedTile({ x: 10 * T + 1, y: 10 * T + 15 }, "right", T)).toEqual({ mx: 11, my: 10 });
  });
});

describe("workSpot -- a tapped square is worked from beside it", () => {
  it("stands him beside it and turns him to face it", () => {
    const spot = workSpot({ mx: 10, my: 10 }, centreOf(10, 14), T, everywhereOpen);
    expect(spot).toEqual({ mx: 10, my: 11, facing: "up" });
    expect(facedTile(centreOf(spot!.mx, spot!.my), spot!.facing, T)).toEqual({ mx: 10, my: 10 });
  });

  it("walks up from his own side rather than around to another", () => {
    expect(workSpot({ mx: 10, my: 10 }, centreOf(4, 10), T, everywhereOpen)).toEqual({ mx: 9, my: 10, facing: "right" });
    expect(workSpot({ mx: 10, my: 10 }, centreOf(16, 10), T, everywhereOpen)).toEqual({ mx: 11, my: 10, facing: "left" });
    expect(workSpot({ mx: 10, my: 10 }, centreOf(10, 4), T, everywhereOpen)).toEqual({ mx: 10, my: 9, facing: "down" });
  });

  it("steps him off the square when he tapped the one he is standing on", () => {
    const spot = workSpot({ mx: 10, my: 10 }, centreOf(10, 10), T, everywhereOpen);
    expect(spot).not.toBeNull();
    expect(besideSquare(spot!, { mx: 10, my: 10 })).toBe(true);
  });

  it("goes round a side that is shut", () => {
    // A fence along the bottom: he cannot stand below it, so he takes a side.
    const open = (mx: number, my: number) => !(my === 11);
    const spot = workSpot({ mx: 10, my: 10 }, centreOf(10, 14), T, open);
    expect(spot).not.toBeNull();
    expect(spot!.my).not.toBe(11);
    expect(besideSquare(spot!, { mx: 10, my: 10 })).toBe(true);
  });

  it("says so when every side is shut", () => {
    expect(workSpot({ mx: 10, my: 10 }, centreOf(10, 14), T, () => false)).toBeNull();
  });
});

describe("besideSquare", () => {
  it("is true across a shared side only", () => {
    expect(besideSquare({ mx: 5, my: 5 }, { mx: 5, my: 6 })).toBe(true);
    expect(besideSquare({ mx: 5, my: 5 }, { mx: 6, my: 6 })).toBe(false);
    expect(besideSquare({ mx: 5, my: 5 }, { mx: 5, my: 5 })).toBe(false);
  });
});

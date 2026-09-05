import { describe, expect, it } from "vitest";

import {
  ARRIVE_WITHIN,
  FARMHAND_SPEED,
  MAX_FRAME_MS,
  advanceTowards,
  frameSeconds,
  sameTile,
  tileCentre,
  tileOf,
  withinReach,
  type Walker,
} from "./farmhand-path";
import { isoProject } from "./iso";
import { STACKACRES_TILE } from "./world";

function walker(x: number, y: number): Walker {
  return { x, y, facing: 1, towards: 1, travelled: 0 };
}

describe("the tile grid", () => {
  it("floors rather than truncates, so negative ground gets its own tiles", () => {
    // The Wallow sits at x -320, so this is not hypothetical.
    expect(tileOf({ x: -1, y: -1 })).toEqual({ tx: -1, ty: -1 });
    expect(tileOf({ x: 1, y: 1 })).toEqual({ tx: 0, ty: 0 });
  });

  it("puts a point back in the tile its centre came from", () => {
    for (const tile of [{ tx: 0, ty: 0 }, { tx: 21, ty: 9 }, { tx: -20, ty: -25 }]) {
      expect(tileOf(tileCentre(tile))).toEqual(tile);
    }
  });

  it("centres, rather than corners, so adjacent tiles are a full tile apart", () => {
    const a = tileCentre({ tx: 3, ty: 0 });
    const b = tileCentre({ tx: 4, ty: 0 });
    expect(b.x - a.x).toBe(STACKACRES_TILE);
  });

  it("compares by index, not by object identity", () => {
    expect(sameTile({ tx: 2, ty: 3 }, { tx: 2, ty: 3 })).toBe(true);
    expect(sameTile({ tx: 2, ty: 3 }, { tx: 3, ty: 2 })).toBe(false);
  });
});

describe("frameSeconds", () => {
  it("clamps the enormous delta a backgrounded tab hands back", () => {
    expect(frameSeconds(60_000)).toBe(MAX_FRAME_MS / 1000);
  });

  it("never runs a walk backwards on a negative delta", () => {
    expect(frameSeconds(-5)).toBe(0);
  });
});

describe("advanceTowards", () => {
  it("walks at FARMHAND_SPEED along the line to the target", () => {
    const step = advanceTowards(walker(0, 0), { x: 100, y: 0 }, 1);
    expect(step.walker.x).toBeCloseTo(FARMHAND_SPEED);
    expect(step.arrived).toBe(false);
    expect(step.walker.travelled).toBeCloseTo(FARMHAND_SPEED);
  });

  it("walks at the given speed instead, when one is passed", () => {
    const step = advanceTowards(walker(0, 0), { x: 100, y: 0 }, 1, FARMHAND_SPEED * 1.15);
    expect(step.walker.x).toBeCloseTo(FARMHAND_SPEED * 1.15);
  });

  it("snaps to the target inside the dead-band rather than easing forever", () => {
    const step = advanceTowards(walker(0, 0), { x: ARRIVE_WITHIN / 2, y: 0 }, 0.0001);
    expect(step.arrived).toBe(true);
    expect(step.walker.x).toBe(ARRIVE_WITHIN / 2);
  });

  it("does not mutate the walker it was handed", () => {
    const before = walker(0, 0);
    advanceTowards(before, { x: 100, y: 100 }, 1);
    expect(before).toEqual(walker(0, 0));
  });

  it("faces by the SCREEN step, not the world one", () => {
    // A step due +y has a positive world x-component of zero and projects
    // LEFTWARD: isoProject sends (0, 10) to a negative screen x.
    expect(isoProject(0, 10).x).toBeLessThan(0);
    const step = advanceTowards(walker(0, 0), { x: 0, y: 100 }, 1);
    expect(step.walker.facing).toBe(-1);
    // ...and toward the camera, since x + y grows.
    expect(step.walker.towards).toBe(1);
  });

  it("keeps the sign it had when a step is a pure screen up/down", () => {
    // Equal parts +x and +y runs straight down the picture: not a turn.
    const facingLeft: Walker = { ...walker(0, 0), facing: -1 };
    const step = advanceTowards(facingLeft, { x: 100, y: 100 }, 1);
    expect(step.walker.facing).toBe(-1);
  });

  it("covers the four isometric diagonals with its two signs", () => {
    // The diagonals are the WORLD axes, not the screen ones: isoProject
    // sends a pure +x step to screen (+1, +0.5) and a pure +y step to
    // (-1, +0.5). A step along a screen axis (+x -y, say) is a tie on one
    // sign and deliberately not a turn -- that case is covered above.
    const axes: [number, number, 1 | -1, 1 | -1][] = [
      [100, 0, 1, 1], // world +x: screen SE
      [0, 100, -1, 1], // world +y: screen SW
      [0, -100, 1, -1], // world -y: screen NE
      [-100, 0, -1, -1], // world -x: screen NW
    ];
    for (const [dx, dy, facing, towards] of axes) {
      const step = advanceTowards(walker(0, 0), { x: dx, y: dy }, 1);
      const screen = isoProject(dx, dy);
      expect(Math.sign(screen.x) || step.walker.facing).toBe(facing);
      expect(Math.sign(screen.y) || step.walker.towards).toBe(towards);
      expect(step.walker.facing).toBe(facing);
      expect(step.walker.towards).toBe(towards);
    }
  });
});

describe("advanceTowards's speedMultiplier", () => {
  it("defaults to 1 -- every caller that predates the Frenzy Heat Combo Engine walks unchanged", () => {
    const plain = advanceTowards(walker(0, 0), { x: 100, y: 0 }, 1);
    const explicit = advanceTowards(walker(0, 0), { x: 100, y: 0 }, 1, 1);
    expect(explicit.walker.x).toBe(plain.walker.x);
  });

  it("scales the stride, not the arrival dead-band", () => {
    const doubled = advanceTowards(walker(0, 0), { x: 100, y: 0 }, 1, 2);
    expect(doubled.walker.x).toBeCloseTo(FARMHAND_SPEED * 2);

    // A target inside ARRIVE_WITHIN is still snapped to in one step however
    // fast he is walking -- the dead-band is a distance, not a stride.
    const snap = advanceTowards(walker(0, 0), { x: ARRIVE_WITHIN / 2, y: 0 }, 0.0001, 3);
    expect(snap.arrived).toBe(true);
    expect(snap.walker.x).toBe(ARRIVE_WITHIN / 2);
  });

  it("a multiplier of 0 holds him in place", () => {
    const held = advanceTowards(walker(0, 0), { x: 100, y: 0 }, 1, 0);
    expect(held.walker.x).toBe(0);
    expect(held.arrived).toBe(false);
  });
});

describe("withinReach", () => {
  it("is true at the dead-band's edge and false past it", () => {
    expect(withinReach(walker(0, 0), { x: ARRIVE_WITHIN, y: 0 })).toBe(true);
    expect(withinReach(walker(0, 0), { x: ARRIVE_WITHIN + 0.01, y: 0 })).toBe(false);
  });
});

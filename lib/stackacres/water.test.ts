import { describe, expect, it } from "vitest";
import {
  DOCK,
  DOCK_LENGTH,
  DUCK_ORBIT,
  LILY_DOCK_CLEARANCE,
  LILY_PADS,
  POND,
  POND_CLEARANCE,
  POND_SAND,
  POND_SHALLOW,
  POND_ZONE,
  REEDS,
  RIPPLE_SPOTS,
  dockRect,
  inPond,
  inPondZone,
  pondRadial,
} from "./water";
import { FARM_PATHS, nearPath } from "./paths";
import { STACKACRES_CHUNK, chunkScenery, growAreaBounds } from "./world";
import { YARD_DELTA } from "./yard";
import { ZONE_IDS } from "./zones";

/** Distance from a point to the nearest point of a rectangle. */
function rectDistance(x: number, y: number, r: { x: number; y: number; width: number; height: number }): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

describe("the pond", () => {
  it("sits on the west verge, inside the home frame and clear of the lane", () => {
    // Measured in the YARD's own frame, not in absolute world units. The
    // 2026-09-07 map re-lay moved the Farmstead as a rigid body, so the pond
    // is at a different world position and in exactly the same place relative
    // to the lane, the barn and the opening shot -- which is what this test
    // was ever about. Subtracting YARD_DELTA puts these back on the numbers
    // the yard was drawn with, and they are unchanged.
    const px = POND.x - YARD_DELTA.x;
    const py = POND.y - YARD_DELTA.y;
    expect(px + POND.rx).toBeLessThanOrEqual(20);
    expect(px - POND.rx).toBeGreaterThanOrEqual(-96);
    expect(py - POND.ry).toBeGreaterThanOrEqual(-41);
    expect(py + POND.ry).toBeLessThanOrEqual(184);
    // The lane's body starts at x 43 in that frame; the sand must not reach it.
    expect(px + POND.rx + POND_SAND).toBeLessThan(43);
    // Its clearing, which is what keeps the woods off, stops short of it too.
    expect(POND_ZONE.x - YARD_DELTA.x + POND_ZONE.width).toBeLessThan(43);
  });

  it("pads its zone by the clearance on every side", () => {
    expect(POND_ZONE).toEqual({
      x: POND.x - POND.rx - POND_CLEARANCE,
      y: POND.y - POND.ry - POND_CLEARANCE,
      width: (POND.rx + POND_CLEARANCE) * 2,
      height: (POND.ry + POND_CLEARANCE) * 2,
    });
    expect(inPondZone(POND.x, POND.y)).toBe(true);
    expect(inPondZone(POND.x - POND.rx - POND_CLEARANCE + 1, POND.y)).toBe(true);
    expect(inPondZone(POND.x - POND.rx - POND_CLEARANCE - 1, POND.y)).toBe(false);
    expect(inPondZone(POND.x, POND.y + POND.ry + POND_CLEARANCE + 1)).toBe(false);
    // The lane itself, and every district's grow area, are outside it.
    expect(inPondZone(50, 120)).toBe(false);
    for (const zone of ZONE_IDS) {
      const area = growAreaBounds(zone);
      const points = [
        { x: area.x, y: area.y },
        { x: area.x + area.width, y: area.y },
        { x: area.x, y: area.y + area.height },
        { x: area.x + area.width, y: area.y + area.height },
        { x: area.x + area.width / 2, y: area.y + area.height / 2 },
      ];
      for (const p of points) expect(inPondZone(p.x, p.y), `${zone} at ${p.x},${p.y}`).toBe(false);
    }
  });

  it("measures water by the ellipse, not its box", () => {
    expect(inPond(POND.x, POND.y)).toBe(true);
    expect(pondRadial(POND.x + POND.rx, POND.y)).toBeCloseTo(1);
    expect(pondRadial(POND.x, POND.y - POND.ry)).toBeCloseTo(1);
    // The box's corner is outside the water.
    expect(inPond(POND.x + POND.rx, POND.y + POND.ry)).toBe(false);
  });

  it("keeps wild scenery out of the water in every chunk the pond touches", () => {
    // Derived rather than hand-listed. The chunks the pond falls in moved with
    // the yard in the 2026-09-07 re-lay, and a hardcoded list of four would
    // have to be recomputed by hand every time the Farmstead moves -- the
    // property being tested is "no wild scenery grows in the water", in
    // whichever chunks the water happens to occupy.
    const chunkRange = (lo: number, hi: number) => {
      const out: number[] = [];
      for (let c = Math.floor(lo / STACKACRES_CHUNK); c <= Math.floor(hi / STACKACRES_CHUNK); c += 1) {
        out.push(c);
      }
      return out;
    };
    const cells: [number, number][] = [];
    for (const cx of chunkRange(POND_ZONE.x, POND_ZONE.x + POND_ZONE.width)) {
      for (const cy of chunkRange(POND_ZONE.y, POND_ZONE.y + POND_ZONE.height)) {
        cells.push([cx, cy]);
      }
    }
    expect(cells.length).toBeGreaterThanOrEqual(4);
    const touched = new Set<string>();
    for (const [cx, cy] of cells) {
      const x0 = cx * STACKACRES_CHUNK;
      const y0 = cy * STACKACRES_CHUNK;
      const overlaps =
        x0 < POND_ZONE.x + POND_ZONE.width &&
        x0 + STACKACRES_CHUNK > POND_ZONE.x &&
        y0 < POND_ZONE.y + POND_ZONE.height &&
        y0 + STACKACRES_CHUNK > POND_ZONE.y;
      expect(overlaps, `chunk ${cx}:${cy} should meet the pond zone`).toBe(true);
      touched.add(`${cx}:${cy}`);
      for (const piece of chunkScenery(cx, cy)) {
        expect(inPondZone(piece.x, piece.y), `${piece.kind} at ${piece.x},${piece.y}`).toBe(false);
      }
    }
    expect(touched.size).toBe(cells.length);
  });

  it("leaves a tile's width for each of the sand ring, the shallows and the deep middle", () => {
    // The pond is cut from 16-unit tiles (./terrain.ts): a band narrower than
    // a tile's diagonal would skip a level somewhere around the ellipse.
    expect(POND_SAND).toBeGreaterThanOrEqual(22);
    expect(POND_SHALLOW).toBeGreaterThanOrEqual(22);
    expect(Math.min(POND.rx, POND.ry) - POND_SHALLOW).toBeGreaterThanOrEqual(16);
  });
});

describe("the dock", () => {
  it("roots on the sand at its east end and reaches west over the water", () => {
    const r = pondRadial(DOCK.x, DOCK.y);
    // On the sand: past the waterline, inside the ring.
    expect(r).toBeGreaterThan(1);
    expect(r).toBeLessThan(1 + (POND_SAND + 1) / POND.rx);
    // Its far end is well out on the water.
    expect(pondRadial(DOCK.x - DOCK_LENGTH, DOCK.y)).toBeLessThan(0.8);
    expect(pondRadial(DOCK.x - DOCK_LENGTH, DOCK.y - 18)).toBeLessThan(0.95);
  });

  it("is where the spur off the lane ends", () => {
    // Renamed `spur` -> `dockSpur` in the 2026-09-07 re-lay: the map has a
    // spur into every district now, so the yard's one needed a name that says
    // which spur it is.
    const spur = FARM_PATHS.find((p) => p.key === "dockSpur");
    expect(spur).toBeDefined();
    if (!spur) return;
    const end = spur.points[spur.points.length - 1];
    // The spur's end sits on the sand beside the dock's root, and its start
    // is inside the lane's body.
    expect(Math.abs(end.y - DOCK.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(end.x - DOCK.x)).toBeLessThanOrEqual(4);
    expect(nearPath(spur.points[0].x, spur.points[0].y)).toBe(true);
    const lane = FARM_PATHS.find((p) => p.key === "lane");
    expect(lane && Math.abs(spur.points[0].x - lane.points[lane.points.length - 1].x)).toBeLessThan(
      (lane?.width ?? 0) / 2,
    );
  });
});

describe("pond decor", () => {
  it("floats four to six lily pads on the water, clear of the dock and each other", () => {
    expect(LILY_PADS.length).toBeGreaterThanOrEqual(4);
    expect(LILY_PADS.length).toBeLessThanOrEqual(6);
    const dock = dockRect();
    for (const pad of LILY_PADS) {
      expect(pondRadial(pad.x, pad.y), `pad at ${pad.x},${pad.y}`).toBeLessThan(0.9);
      expect(rectDistance(pad.x, pad.y, dock), `pad at ${pad.x},${pad.y} vs dock`).toBeGreaterThanOrEqual(
        LILY_DOCK_CLEARANCE,
      );
    }
    for (let i = 0; i < LILY_PADS.length; i += 1) {
      for (let j = i + 1; j < LILY_PADS.length; j += 1) {
        const a = LILY_PADS[i];
        const b = LILY_PADS[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(12);
      }
    }
    expect(LILY_PADS.filter((p) => p.flower).length).toBeGreaterThanOrEqual(1);
  });

  it("stands five to eight reeds on the sand at the water's edge", () => {
    expect(REEDS.length).toBeGreaterThanOrEqual(5);
    expect(REEDS.length).toBeLessThanOrEqual(8);
    const dock = dockRect();
    for (const reed of REEDS) {
      const r = pondRadial(reed.x, reed.y);
      expect(r, `reed at ${reed.x},${reed.y}`).toBeGreaterThanOrEqual(0.96);
      expect(r, `reed at ${reed.x},${reed.y}`).toBeLessThanOrEqual(1 + POND_SAND / POND.ry);
      expect(rectDistance(reed.x, reed.y, dock)).toBeGreaterThanOrEqual(8);
    }
    // A stand on the north shore and one at the south-west.
    expect(REEDS.some((r) => r.y < POND.y - POND.ry + 6)).toBe(true);
    expect(REEDS.some((r) => r.x < POND.x - 30 && r.y > POND.y)).toBe(true);
  });

  it("spreads ripples and paddles the duck on open water", () => {
    for (const spot of RIPPLE_SPOTS) expect(pondRadial(spot.x, spot.y)).toBeLessThan(0.9);
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      const x = DUCK_ORBIT.x + Math.cos(a) * DUCK_ORBIT.rx;
      const y = DUCK_ORBIT.y + Math.sin(a) * DUCK_ORBIT.ry;
      expect(pondRadial(x, y), `duck at ${x},${y}`).toBeLessThan(0.85);
      // The duck is 14 wide; it never paddles into a lily pad or the dock.
      for (const pad of LILY_PADS) expect(Math.hypot(pad.x - x, pad.y - y)).toBeGreaterThanOrEqual(11);
      expect(rectDistance(x, y, dockRect())).toBeGreaterThanOrEqual(6);
    }
  });
});

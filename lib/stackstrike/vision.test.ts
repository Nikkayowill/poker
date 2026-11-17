import { describe, expect, it } from "vitest";
import { PLAYER_GLOW, SENSE } from "./content";
import type { Arena, EnemyState } from "./types";
import { angleDiff, assistAim, beamPolygon, coverAt, glowPolygon, roomAt, sensedEnemies } from "./vision";

const origin = { x: 500, y: 500 };

describe("angleDiff", () => {
  it("takes the short way round", () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2, 6);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
    expect(angleDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });
});

describe("beamPolygon", () => {
  it("starts at the player and reaches full range in the open", () => {
    const poly = beamPolygon(origin, 0, [], 380, 0.5);
    expect(poly[0]).toEqual(origin);
    const farthest = Math.max(...poly.slice(1).map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)));
    expect(farthest).toBeCloseTo(380, 3);
  });

  it("is cut short by a wall", () => {
    const wall = { x: 600, y: 300, w: 20, h: 400 };
    const poly = beamPolygon(origin, 0, [wall], 380, 0.5);
    for (const point of poly.slice(1)) expect(point.x).toBeLessThanOrEqual(600 + 0.001);
  });
});

describe("glowPolygon", () => {
  it("is a ring of the glow radius in the open and shrinks against a wall", () => {
    const open = glowPolygon(origin, []);
    for (const p of open) expect(Math.hypot(p.x - origin.x, p.y - origin.y)).toBeCloseTo(PLAYER_GLOW.radius, 3);
    const walled = glowPolygon(origin, [{ x: 520, y: 400, w: 10, h: 200 }]);
    expect(Math.max(...walled.map((p) => p.x))).toBeLessThanOrEqual(520.001);
  });
});

describe("coverAt", () => {
  it("is zero in the open, a third against a flat wall and over half in a corner", () => {
    expect(coverAt(origin, [])).toBe(0);
    expect(coverAt({ x: 514, y: 500 }, [{ x: 400, y: 300, w: 100, h: 400 }])).toBeCloseTo(3 / 8, 6);
    const corner = [
      { x: 400, y: 300, w: 100, h: 400 },
      { x: 400, y: 300, w: 400, h: 100 },
    ];
    expect(coverAt({ x: 514, y: 414 }, corner)).toBeGreaterThanOrEqual(0.5);
  });
});

const twoRooms: Arena = {
  width: 1000,
  height: 400,
  walls: [{ x: 490, y: 0, w: 20, h: 400 }],
  rooms: [
    { id: "left", rect: { x: 0, y: 0, w: 490, h: 400 } },
    { id: "right", rect: { x: 510, y: 0, w: 490, h: 400 } },
  ],
  corners: [],
  guards: [],
  loot: [],
  exit: { door: { x: 0, y: 0, w: 1, h: 1 }, zone: { x: 0, y: 0, w: 1, h: 1 } },
  playerSpawn: { x: 100, y: 200 },
};

function enemyAt(x: number, y: number): EnemyState {
  return { pos: { x, y } } as EnemyState;
}

describe("roomAt", () => {
  it("names the room a point is in, and the nearest one from a doorway", () => {
    expect(roomAt(twoRooms, { x: 100, y: 100 })?.id).toBe("left");
    expect(roomAt(twoRooms, { x: 800, y: 100 })?.id).toBe("right");
    expect(roomAt(twoRooms, { x: 497, y: 100 })?.id).toBe("left");
    expect(roomAt(twoRooms, { x: 506, y: 100 })?.id).toBe("right");
  });
});

describe("sensedEnemies", () => {
  const me = { x: 100, y: 200 };

  it("shows a guard that is close, wall or no wall", () => {
    const near = enemyAt(300, 200);
    const sensed = sensedEnemies(me, [near]);
    expect(sensed).toHaveLength(1);
    expect(sensed[0].strength).toBe(1);
  });

  it("shows a guard in the next room right through the wall", () => {
    const next = enemyAt(600, 200);
    expect(sensedEnemies({ x: 400, y: 200 }, [next]).map((entry) => entry.enemy)).toEqual([next]);
  });

  it("does not show a guard that is far away until the player gets closer", () => {
    const far = enemyAt(100 + SENSE.range + 20, 200);
    expect(sensedEnemies(me, [far])).toEqual([]);
    expect(sensedEnemies({ x: me.x + 100, y: me.y }, [far])).toHaveLength(1);
  });

  it("fades with distance: full when close, dimmer toward the edge, never fully gone inside the range", () => {
    const close = sensedEnemies(me, [enemyAt(100 + SENSE.clearRange - 10, 200)])[0].strength;
    const mid = sensedEnemies(me, [enemyAt(100 + (SENSE.clearRange + SENSE.range) / 2, 200)])[0].strength;
    const edge = sensedEnemies(me, [enemyAt(100 + SENSE.range - 1, 200)])[0].strength;
    expect(close).toBe(1);
    expect(mid).toBeLessThan(close);
    expect(edge).toBeLessThan(mid);
    expect(edge).toBeGreaterThanOrEqual(SENSE.farStrength - 0.01);
  });
});

describe("assistAim", () => {
  const from = { x: 0, y: 0 };
  const target = { pos: { x: 200, y: 0 }, radius: 14 };

  it("leaves the aim alone when nothing is near the sights", () => {
    expect(assistAim(0.5, from, [target], [], 500)).toBe(0.5);
  });

  it("pulls a near miss toward the enemy but never past it", () => {
    const aim = 0.05;
    const helped = assistAim(aim, from, [target], [], 500);
    expect(helped).toBeLessThan(aim);
    expect(helped).toBeGreaterThanOrEqual(0);
  });

  it("pulls harder the closer to dead on", () => {
    const near = 0.02 - assistAim(0.02, from, [target], [], 500);
    const edge = 0.09 - assistAim(0.09, from, [target], [], 500);
    expect(near / 0.02).toBeGreaterThan(edge / 0.09);
  });

  it("ignores an enemy behind a wall or out of range", () => {
    expect(assistAim(0.05, from, [target], [{ x: 100, y: -50, w: 10, h: 100 }], 500)).toBe(0.05);
    expect(assistAim(0.05, from, [target], [], 150)).toBe(0.05);
  });

  it("helps less at long range, where the enemy looks smaller", () => {
    const far = { pos: { x: 480, y: 0 }, radius: 14 };
    expect(assistAim(0.05, from, [far], [], 500)).toBe(0.05);
    expect(assistAim(0.05, from, [target], [], 500)).not.toBe(0.05);
  });
});

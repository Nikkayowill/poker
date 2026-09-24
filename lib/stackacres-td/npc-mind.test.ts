import { describe, expect, it } from "vitest";
import { CATCH_UP, MAX_SIDESTEP, Mind, facingToward, pickChat, type Frame, type Look, type Temperament } from "./npc-mind";
import { seededRandom, type Pose } from "./npc-routine";

const TEMPER: Temperament = { react: [300, 300], attention: [3000, 3000], fidget: [4000, 4000], chatty: 1, tempo: 1 };
const FRAME_MS = 16;

/** A day for one person, as a function of real ms: `pose(t)`. */
type Day = (t: number) => Pose;

const standing = (x: number, y: number, facing: Pose["facing"] = "down", doing: Pose["doing"] = "water"): Day => () => ({ area: "yard", x, y, facing, doing, speed: 0 });

/** Stands at (100, 100) watering until `leaveAt`, then walks right at 40 px/s. */
const leavesAt =
  (leaveAt: number): Day =>
  (t) =>
    t < leaveAt
      ? { area: "yard", x: 100, y: 100, facing: "down", doing: "water", speed: 0 }
      : { area: "yard", x: 100 + ((t - leaveAt) / 1000) * 40, y: 100, facing: "right", doing: "walk", speed: 40 };

interface Sim {
  mind: Mind;
  now: number;
  look: Look | null;
  run(ms: number, frame?: Partial<Omit<Frame, "now" | "dt" | "scheduled">>): Look[];
}

function sim(day: Day, temper: Temperament = TEMPER, seed = 1): Sim {
  const mind = new Mind(temper, seededRandom(seed));
  const state: Sim = {
    mind,
    now: 0,
    look: null,
    run(ms, frame = {}) {
      const looks: Look[] = [];
      for (let t = 0; t < ms; t += FRAME_MS) {
        state.now += FRAME_MS;
        const now = state.now;
        state.look = mind.step({
          now,
          dt: FRAME_MS,
          night: false,
          scheduled: (lag) => day(now - lag),
          farmer: null,
          talking: false,
          others: [],
          open: () => true,
          ...frame,
        });
        looks.push(state.look);
      }
      return looks;
    },
  };
  return state;
}

describe("facingToward", () => {
  it("faces the stronger direction", () => {
    expect(facingToward(10, 2, "down")).toBe("right");
    expect(facingToward(-2, -10, "down")).toBe("up");
  });

  it("keeps facing the way it already does near a diagonal", () => {
    expect(facingToward(10, 11, "right")).toBe("right");
    expect(facingToward(11, 10, "down")).toBe("down");
    // Well past the diagonal, it turns.
    expect(facingToward(10, 20, "right")).toBe("down");
  });
});

describe("noticing the farmer", () => {
  it("takes a moment to react, then turns to him", () => {
    const s = sim(standing(100, 100, "down"));
    s.run(200);
    const farmer = { x: 150, y: 100, walking: false };
    const early = s.run(150, { farmer });
    expect(early.every((look) => look.facing === "down" && look.anim === "water")).toBe(true);
    const later = s.run(400, { farmer });
    expect(later.at(-1)).toMatchObject({ facing: "right", anim: "idle" });
  });

  it("gets back to work after a while, then glances over now and then", () => {
    const s = sim(standing(100, 100, "down"));
    const farmer = { x: 150, y: 100, walking: false };
    s.run(3000, { farmer });
    expect(s.look?.facing).toBe("right");
    const after = s.run(12_000, { farmer });
    expect(after.some((look) => look.anim === "water" && look.facing === "down")).toBe(true);
    // A glance, after going back to work.
    const firstWork = after.findIndex((look) => look.anim === "water");
    expect(after.slice(firstWork).some((look) => look.facing === "right" && look.anim === "idle")).toBe(true);
  });

  it("doesn't flick between two directions when the farmer stands on a diagonal", () => {
    const s = sim(standing(100, 100, "down"));
    const looks: Look[] = [];
    for (let i = 0; i < 60; i++) looks.push(...s.run(48, { farmer: { x: 130 + (i % 2), y: 130 - (i % 2), walking: false } }));
    let turns = 0;
    for (let i = 1; i < looks.length; i++) if (looks[i].facing !== looks[i - 1].facing) turns++;
    expect(turns).toBeLessThanOrEqual(1);
  });

  it("greets him once when he comes close, not every frame", () => {
    const s = sim(standing(100, 100));
    const looks = s.run(3000, { farmer: { x: 120, y: 100, walking: false } });
    expect(looks.filter((look) => look.says === "greet")).toHaveLength(1);
  });
});

describe("walking", () => {
  it("turns the way they are going and takes a breath before setting off", () => {
    const s = sim(leavesAt(1000));
    s.run(1000);
    const setOff = s.run(250);
    expect(setOff.every((look) => Math.abs(look.x - 100) < 1 && look.anim === "idle" && look.facing === "right")).toBe(true);
  });

  it("speeds up to their pace instead of snapping to it, then makes up the pause without sprinting", () => {
    const s = sim(leavesAt(1000));
    s.run(1000);
    const walk = s.run(1500);
    const speeds = walk.filter((look) => look.anim === "walk").map((look) => look.walkSpeed);
    expect(speeds[0]).toBeLessThan(40);
    expect(Math.max(...speeds)).toBeGreaterThan(40);
    expect(Math.max(...speeds)).toBeLessThan(40 * 1.3);
  });

  it("catches up with their day after the pause, along the same path", () => {
    const s = sim(leavesAt(1000));
    s.run(6000);
    expect(s.mind.behind()).toBe(0);
    expect(s.look?.x).toBeCloseTo(100 + (5000 / 1000) * 40, 0);
    expect(s.look?.y).toBe(100);
  });

  it("stops to let the farmer by when he is stood in the way, then carries on", () => {
    const s = sim(leavesAt(0));
    s.run(1500);
    const x = s.look!.x;
    const farmer = { x: x + 18, y: 100, walking: false };
    const stopped = s.run(600, { farmer });
    expect(stopped.at(-1)).toMatchObject({ anim: "idle", facing: "right" });
    const on = s.run(6000, { farmer });
    expect(on.at(-1)!.x).toBeGreaterThan(farmer.x + 20);
  });
});

describe("seeing the way ahead", () => {
  it("stops for a farmer stood on a diagonal walk while on time, not only on straight ones", () => {
    // Walking down and to the right at 40 px/s, where facing alone says "right".
    const diagonal: Day = (t) => ({ area: "yard", x: 100 + (t / 1000) * 28, y: 100 + (t / 1000) * 28.6, facing: "down", doing: "walk", speed: 40 });
    const s = sim(diagonal);
    s.run(2000);
    expect(s.mind.behind()).toBe(0);
    const { x, y } = s.look!;
    // A few pixels off his diagonal path, in his way, but 60 degrees off a straight "down".
    const farmer = { x: x + 13.9, y: y + 8, walking: false };
    const looks = s.run(300, { farmer });
    expect(looks.some((look) => look.anim === "idle")).toBe(true);
  });
});

describe("talking", () => {
  it("stops them while the farmer talks, then they hurry back to their day", () => {
    const s = sim(leavesAt(0));
    s.run(1000);
    const farmer = { x: s.look!.x + 30, y: 100, walking: false };
    const talking = s.run(4000, { farmer, talking: true });
    const held = talking.slice(40);
    expect(Math.max(...held.map((look) => look.x)) - Math.min(...held.map((look) => look.x))).toBeLessThan(1);
    expect(held.at(-1)).toMatchObject({ anim: "idle", facing: "right" });
    expect(s.mind.behind()).toBeGreaterThan(3000);
    // A long stop is made up at a real hurry.
    expect(Math.max(...s.run(2000).map((look) => look.walkSpeed))).toBeCloseTo(40 * CATCH_UP, 0);
    s.run(16_000);
    expect(s.mind.behind()).toBe(0);
  });

  it("never holds them forever", () => {
    const s = sim(leavesAt(0));
    s.run(120_000, { farmer: { x: 100, y: 130, walking: false }, talking: true });
    expect(s.mind.behind()).toBeLessThanOrEqual(46_000);
    s.run(120_000);
    expect(s.mind.behind()).toBe(0);
  });
});

describe("personal space", () => {
  it("steps aside from the farmer standing on top of them, a few pixels at most", () => {
    const s = sim(standing(100, 100));
    s.run(1500, { farmer: { x: 104, y: 100, walking: false } });
    const { x, y } = s.look!;
    expect(Math.hypot(x - 104, y - 100)).toBeGreaterThan(8);
    expect(Math.hypot(x - 100, y - 100)).toBeLessThanOrEqual(MAX_SIDESTEP + 0.01);
  });

  it("only ever steps onto open ground", () => {
    const s = sim(standing(100, 100));
    s.run(1500, { farmer: { x: 104, y: 100, walking: false }, open: (p) => p.x >= 99 && p.x <= 101 && p.y >= 99 && p.y <= 101 });
    expect(Math.abs(s.look!.x - 100)).toBeLessThanOrEqual(1);
  });

  it("drifts back onto their spot once there is room", () => {
    const s = sim(standing(100, 100));
    s.run(1500, { others: [{ name: "ivy", x: 103, y: 100 }] });
    expect(s.look!.x).not.toBe(100);
    s.run(3000);
    expect(s.look).toMatchObject({ x: 100, y: 100 });
  });
});

describe("quiet moments", () => {
  it("look around now and then while idle, and not like clockwork", () => {
    const s = sim(standing(100, 100, "down", "idle"), { ...TEMPER, fidget: [1500, 4000] }, 7);
    const looks = s.run(60_000);
    const turnedAt: number[] = [];
    for (let i = 1; i < looks.length; i++) if (looks[i].facing !== "down" && looks[i - 1].facing === "down") turnedAt.push(i * FRAME_MS);
    expect(turnedAt.length).toBeGreaterThanOrEqual(3);
    const gaps = turnedAt.slice(1).map((t, i) => t - turnedAt[i]);
    expect(new Set(gaps.map((gap) => Math.round(gap / 100))).size).toBeGreaterThan(1);
  });

  it("stays still at night", () => {
    const mind = new Mind({ ...TEMPER, fidget: [500, 500] }, seededRandom(3));
    for (let now = 16; now < 20_000; now += 16) {
      const look = mind.step({ now, dt: 16, night: true, scheduled: standing(100, 100, "down", "idle"), farmer: null, talking: false, others: [], open: () => true });
      expect(look.facing).toBe("down");
    }
  });
});

describe("pickChat", () => {
  const free = () => {
    const s = sim(standing(100, 100, "down", "idle"));
    s.run(2000);
    return s;
  };

  it("pairs two people who are free and a few steps apart, then not again for a while", () => {
    const a = free();
    const b = free();
    const people = [
      { name: "ray", x: 100, y: 100, mind: a.mind },
      { name: "ivy", x: 130, y: 100, mind: b.mind },
    ];
    const last = new Map<string, number>();
    const chat = pickChat(people, 5000, last, () => 0);
    expect(chat).toMatchObject({ a: "ray", b: "ivy" });
    expect(pickChat(people, 6000, last, () => 0)).toBeNull();
  });

  it("leaves people too far apart alone", () => {
    const people = [
      { name: "ray", x: 100, y: 100, mind: free().mind },
      { name: "ivy", x: 300, y: 100, mind: free().mind },
    ];
    expect(pickChat(people, 5000, new Map(), () => 0)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { CAUTION, CONTRACTS, ENEMIES, STEALTH } from "./content";
import { beamRange, createState, enemyDef, NO_INPUT, radioDelay, STEP_SECONDS, step } from "./sim";
import type { Arena, ContractId, EnemyState, Guard, PlayerInput, SimState, Vec } from "./types";

function arena(guards: Guard[] = [], walls: Arena["walls"] = [], contract?: ContractId): Arena {
  return {
    width: 1000,
    height: 1000,
    walls,
    rooms: [],
    corners: [],
    guards,
    loot: [],
    contract,
    exit: { door: { x: 0, y: 450, w: 10, h: 100 }, zone: { x: 0, y: 450, w: 60, h: 100 } },
    playerSpawn: { x: 100, y: 900 },
  };
}

const idle = (patch: Partial<PlayerInput> = {}): PlayerInput => ({ ...NO_INPUT, move: { x: 0, y: 0 }, ...patch });

function run(state: SimState, seconds: number): void {
  for (let n = 0; n < Math.round(seconds / STEP_SECONDS); n += 1) step(state, idle());
}

function guardAt(state: SimState, x: number, y: number, facing: number): EnemyState {
  const def = ENEMIES.grunt;
  const enemy: EnemyState = {
    id: state.nextId++,
    defId: "grunt",
    pos: { x, y },
    facing,
    health: def.health,
    maxHealth: def.health,
    mode: "patrol",
    awareness: 0,
    investigate: null,
    queue: [],
    lastKnown: null,
    cooldown: 0,
    searchLeft: 0,
    route: [{ x, y }],
    routeIndex: 0,
    routeDir: 1,
    watch: null,
    sweepClock: 0,
    patrolTarget: null,
    path: [],
    pathAge: 0,
    pathGoal: null,
    reaction: def.reactionTime,
    radio: null,
    hurt: 0,
  };
  state.enemies.push(enemy);
  return enemy;
}

function bodyAt(state: SimState, pos: Vec): void {
  state.bodies.push({ id: state.nextId++, pos, found: false });
}

describe("bodies", () => {
  it("a guard that is shot leaves a body where it fell", () => {
    const state = createState(1, "vanguard", arena());
    state.player.pos = { x: 300, y: 500 };
    const target = guardAt(state, 500, 500, Math.PI);
    step(state, idle({ fire: true, aim: 0 }));
    run(state, 0.5);
    expect(state.enemies).not.toContain(target);
    expect(state.bodies).toHaveLength(1);
    expect(state.bodies[0].found).toBe(false);
  });

  it("a calm guard whose light falls on a body finds it, goes to look and winds the building up", () => {
    const state = createState(1, "vanguard", arena());
    const finder = guardAt(state, 500, 500, 0);
    bodyAt(state, { x: 600, y: 500 });
    step(state, idle());
    expect(state.bodies[0].found).toBe(true);
    expect(finder.investigate).not.toBeNull();
    expect(finder.awareness).toBeGreaterThanOrEqual(CAUTION.bodyAwareness - 0.01);
    expect(state.caution).toBeGreaterThanOrEqual(CAUTION.bodyRaise - 0.01);
    expect(state.events.some((event) => event.type === "body")).toBe(true);
    // Finding a body is not spotting the player.
    expect(state.timesSpotted).toBe(0);
  });

  it("a body is only found once", () => {
    const state = createState(1, "vanguard", arena());
    guardAt(state, 500, 500, 0);
    bodyAt(state, { x: 600, y: 500 });
    step(state, idle());
    const after = state.caution;
    run(state, 1);
    expect(state.caution).toBeLessThanOrEqual(after);
  });

  it("a guard facing away does not notice a body farther off than arm's reach", () => {
    const state = createState(1, "vanguard", arena());
    guardAt(state, 500, 500, Math.PI);
    bodyAt(state, { x: 600, y: 500 });
    step(state, idle());
    expect(state.bodies[0].found).toBe(false);
  });

  it("but one right beside it is noticed whatever way the guard faces", () => {
    const state = createState(1, "vanguard", arena());
    guardAt(state, 500, 500, Math.PI);
    bodyAt(state, { x: 530, y: 500 });
    step(state, idle());
    expect(state.bodies[0].found).toBe(true);
  });

  it("a wall hides a body, and a body past the beam is safe", () => {
    const walled = createState(1, "vanguard", arena([], [{ x: 540, y: 400, w: 20, h: 200 }]));
    guardAt(walled, 500, 500, 0);
    bodyAt(walled, { x: 600, y: 500 });
    step(walled, idle());
    expect(walled.bodies[0].found).toBe(false);

    const far = createState(1, "vanguard", arena());
    guardAt(far, 100, 500, 0);
    bodyAt(far, { x: 100 + ENEMIES.grunt.detectionRange + 80, y: 500 });
    step(far, idle());
    expect(far.bodies[0].found).toBe(false);
  });

  it("guards near the finder come to look too, and ones far off do not", () => {
    const state = createState(1, "vanguard", arena());
    guardAt(state, 500, 500, 0);
    const near = guardAt(state, 560, 560, Math.PI);
    const far = guardAt(state, 500 + CAUTION.bodySquadRange + 300, 900, Math.PI);
    bodyAt(state, { x: 600, y: 500 });
    step(state, idle());
    expect(near.investigate).not.toBeNull();
    expect(far.investigate).toBeNull();
  });
});

describe("caution", () => {
  it("settles back to calm over time", () => {
    const state = createState(1, "vanguard", arena());
    state.caution = 1;
    run(state, 1 / CAUTION.decayPerSecond + 1);
    expect(state.caution).toBe(0);
  });

  it("is raised by a guard spotting the player", () => {
    const state = createState(1, "vanguard", arena());
    state.player.pos = { x: 500, y: 500 };
    guardAt(state, 560, 500, Math.PI);
    run(state, 4);
    expect(state.timesSpotted).toBeGreaterThan(0);
    expect(state.caution).toBeGreaterThan(0.2);
  });

  it("stretches flashlight beams", () => {
    const state = createState(1, "vanguard", arena());
    const calm = beamRange(state, enemyDef("grunt"));
    state.caution = 1;
    expect(beamRange(state, enemyDef("grunt"))).toBeCloseTo(calm * (1 + CAUTION.beamBoost));
  });

  it("makes guards walk faster", () => {
    const walked = (caution: number): number => {
      const route: Guard = { defId: "grunt", tier: 1, route: [{ x: 300, y: 500 }, { x: 900, y: 500 }] };
      const state = createState(1, "vanguard", arena([route]));
      state.player.pos = { x: 100, y: 950 };
      state.caution = caution;
      const start = state.enemies[0].pos.x;
      for (let n = 0; n < 240; n += 1) {
        state.caution = caution;
        step(state, idle());
      }
      return state.enemies[0].pos.x - start;
    };
    expect(walked(1)).toBeGreaterThan(walked(0) * 1.1);
  });

  it("makes the spotted meter fill faster", () => {
    const fill = (caution: number): number => {
      const state = createState(1, "vanguard", arena());
      state.player.pos = { x: 500, y: 500 };
      const guard = guardAt(state, 640, 500, Math.PI);
      state.caution = caution;
      step(state, idle());
      return guard.awareness;
    };
    expect(fill(1)).toBeGreaterThan(fill(0) * 1.2);
  });
});

describe("patrols", () => {
  const loop: Guard = { defId: "grunt", tier: 1, route: [{ x: 200, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 600 }, { x: 200, y: 600 }] };

  function visits(seed: number, seconds: number): { order: number[]; pauses: number[] } {
    const state = createState(seed, "vanguard", arena([loop]));
    state.player.pos = { x: 950, y: 950 };
    const guard = state.enemies[0];
    const order: number[] = [];
    const pauses: number[] = [];
    let last = guard.routeIndex;
    let pauseStart: number | null = null;
    for (let n = 0; n < seconds / STEP_SECONDS; n += 1) {
      step(state, idle());
      if (guard.routeIndex !== last) {
        order.push(guard.routeIndex);
        last = guard.routeIndex;
        pauseStart = state.time;
      }
      if (pauseStart !== null && guard.searchLeft <= 0 && guard.mode === "patrol") {
        pauses.push(state.time - pauseStart);
        pauseStart = null;
      }
    }
    return { order, pauses };
  }

  it("does not walk the same loop every time: some stops turn back", () => {
    const orders = Array.from({ length: 12 }, (_, seed) => visits(seed + 1, 150).order.join(""));
    expect(new Set(orders).size).toBeGreaterThan(6);
    const turnedBack = orders.some((order) => {
      for (let i = 1; i < order.length; i += 1) if ((Number(order[i - 1]) - Number(order[i]) + 4) % 4 === 1) return true;
      return false;
    });
    expect(turnedBack).toBe(true);
  });

  it("stops for a different time at each corner, within bounds", () => {
    const { pauses } = visits(7, 200);
    expect(pauses.length).toBeGreaterThan(4);
    for (const pause of pauses) {
      expect(pause).toBeGreaterThanOrEqual(CAUTION.pauseMin - 0.1);
      expect(pause).toBeLessThanOrEqual(CAUTION.pauseMax + 0.2);
    }
    expect(new Set(pauses.map((pause) => pause.toFixed(1))).size).toBeGreaterThan(2);
  });

  it("a single post still just holds its spot", () => {
    const post: Guard = { defId: "grunt", tier: 1, route: [{ x: 500, y: 500 }], watch: 0 };
    const state = createState(3, "vanguard", arena([post]));
    state.player.pos = { x: 950, y: 950 };
    run(state, 20);
    expect(Math.hypot(state.enemies[0].pos.x - 500, state.enemies[0].pos.y - 500)).toBeLessThan(2);
  });
});

describe("contracts in play", () => {
  it("night shift stretches beams, double time hurries guards, tight radio shortens the call", () => {
    const base = createState(1, "vanguard", arena([], [], "standard"));
    const night = createState(1, "vanguard", arena([], [], "night-shift"));
    expect(beamRange(night, enemyDef("grunt"))).toBeCloseTo(beamRange(base, enemyDef("grunt")) * CONTRACTS["night-shift"].beamScale);
    expect(radioDelay(createState(1, "vanguard", arena([], [], "tight-radio")))).toBeLessThan(radioDelay(base) * 0.5);
    expect(radioDelay(base)).toBe(STEALTH.radioSeconds);

    const walked = (contract: ContractId): number => {
      const route: Guard = { defId: "grunt", tier: 1, route: [{ x: 300, y: 500 }, { x: 900, y: 500 }] };
      const state = createState(1, "vanguard", arena([route], [], contract));
      state.player.pos = { x: 100, y: 950 };
      const start = state.enemies[0].pos.x;
      run(state, 4);
      return state.enemies[0].pos.x - start;
    };
    expect(walked("double-time")).toBeGreaterThan(walked("standard") * 1.15);
  });

  it("defaults to the plain job", () => {
    expect(createState(1, "vanguard", arena()).contract.id).toBe("standard");
  });
});

describe("loadout", () => {
  it("carries only the guns it is given", () => {
    const state = createState(1, "vanguard", arena(), "normal", ["pistol"]);
    expect(state.player.weaponIds).toEqual(["pistol"]);
    expect(state.player.ammo).toHaveLength(1);
  });

  it("refuses an empty kit", () => {
    expect(() => createState(1, "vanguard", arena(), "normal", [])).toThrow();
  });
});

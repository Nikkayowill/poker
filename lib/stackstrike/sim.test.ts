import { describe, expect, it } from "vitest";
import { DIFFICULTIES, ENEMIES, STEALTH, WAVE_TUNING, WEAPONS, waveComposition } from "./content";
import { createState, currentWeapon, enemyDef, NO_INPUT, perceive, STEP_SECONDS, step } from "./sim";
import type { Arena, DifficultyId, EnemyState, PlayerInput, SimState } from "./types";

/** An open room with no walls unless a test adds some. */
function room(walls: Arena["walls"] = [], hides: Arena["hides"] = [], patrol: Arena["patrol"] = []): Arena {
  return {
    width: 1000,
    height: 1000,
    walls,
    hides,
    patrol,
    playerSpawn: { x: 500, y: 500 },
    entries: [{ id: "door", label: "Door", door: { x: 0, y: 0, w: 10, h: 10 }, pos: { x: 100, y: 100 } }],
  };
}

function input(patch: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, move: { x: 0, y: 0 }, ...patch };
}

function run(state: SimState, seconds: number, make: () => PlayerInput = () => input()): void {
  const steps = Math.round(seconds / STEP_SECONDS);
  for (let n = 0; n < steps; n += 1) step(state, make());
}

/** A fresh state with the wave director parked, so tests place enemies by hand. */
function quiet(arena: Arena = room(), difficulty: DifficultyId = "normal"): SimState {
  const state = createState(1, "vanguard", arena, difficulty);
  state.intermission = 1e9;
  return state;
}

function addEnemy(state: SimState, defId: string, x: number, y: number): EnemyState {
  const def = ENEMIES[defId];
  const enemy: EnemyState = {
    id: state.nextId++,
    defId,
    pos: { x, y },
    facing: Math.atan2(state.player.pos.y - y, state.player.pos.x - x),
    health: def.health,
    maxHealth: def.health,
    mode: "patrol",
    awareness: 0,
    investigate: null,
    queue: [],
    lastKnown: null,
    cooldown: 0,
    searchLeft: 0,
    patrolTarget: null,
    path: [],
    pathAge: 0,
    pathGoal: null,
    reaction: def.reactionTime,
    damageScale: 1,
    hurt: 0,
  };
  state.enemies.push(enemy);
  return enemy;
}

/** Puts an enemy straight into the fight, as if it had already spotted the player. */
function alert(state: SimState, enemy: EnemyState): EnemyState {
  enemy.mode = "chase";
  enemy.awareness = 1;
  enemy.lastKnown = { x: state.player.pos.x, y: state.player.pos.y };
  return enemy;
}

function perception(state: SimState, enemy: EnemyState): number {
  return perceive(state, enemy, enemyDef(enemy.defId));
}

const isAlert = (enemy: EnemyState): boolean => enemy.mode === "chase" || enemy.mode === "attack";

describe("movement", () => {
  it("moves at operator speed, and diagonals are no faster", () => {
    const straight = quiet();
    const diagonal = quiet();
    run(straight, 1, () => input({ move: { x: 1, y: 0 } }));
    run(diagonal, 1, () => input({ move: { x: 1, y: 1 } }));

    const speed = straight.player.moveSpeed;
    const dStraight = straight.player.pos.x - 500;
    const dDiagonal = Math.hypot(diagonal.player.pos.x - 500, diagonal.player.pos.y - 500);
    expect(dStraight).toBeCloseTo(speed, 0);
    expect(dDiagonal).toBeCloseTo(speed, 0);
  });

  it("keeps a half-tilted stick at half speed", () => {
    const state = quiet();
    run(state, 1, () => input({ move: { x: 0.5, y: 0 } }));
    expect(state.player.pos.x - 500).toBeCloseTo(state.player.moveSpeed / 2, 0);
  });

  it("stops at a wall instead of passing through", () => {
    const state = quiet(room([{ x: 600, y: 400, w: 40, h: 200 }]));
    run(state, 3, () => input({ move: { x: 1, y: 0 } }));
    expect(state.player.pos.x).toBeLessThanOrEqual(600 - state.player.radius + 0.01);
  });

  it("covers the same ground whatever the step size", () => {
    const fine = quiet();
    const coarse = quiet();
    for (let n = 0; n < 120; n += 1) step(fine, input({ move: { x: 1, y: 0 } }), 1 / 120);
    for (let n = 0; n < 30; n += 1) step(coarse, input({ move: { x: 1, y: 0 } }), 1 / 30);
    expect(fine.player.pos.x).toBeCloseTo(coarse.player.pos.x, 3);
  });
});

describe("weapons", () => {
  it("respects fire rate", () => {
    const state = quiet();
    run(state, 1, () => input({ fire: true }));
    // Pistol: 4 shots a second, the first lands on step one.
    expect(state.shotsFired).toBe(4);
  });

  it("empties the magazine, reloads on its own, then fires again", () => {
    const state = quiet();
    const pistol = WEAPONS.pistol;
    run(state, pistol.magazineSize / pistol.fireRate + 0.05, () => input({ fire: true }));
    expect(state.player.ammo[0]).toBe(0);
    expect(state.player.reloadLeft).toBeGreaterThan(0);

    run(state, pistol.reloadDuration + 0.05);
    expect(state.player.ammo[0]).toBe(pistol.magazineSize);
    expect(state.player.reloadLeft).toBe(0);
  });

  it("cannot fire mid-reload", () => {
    const state = quiet();
    step(state, input({ reload: false, fire: true }));
    step(state, input({ reload: true }));
    const before = state.shotsFired;
    run(state, 0.5, () => input({ fire: true }));
    expect(state.shotsFired).toBe(before);
  });

  it("ignores reload on a full magazine", () => {
    const state = quiet();
    step(state, input({ reload: true }));
    expect(state.player.reloadLeft).toBe(0);
  });

  it("switching weapons cancels a reload and keeps each magazine", () => {
    const state = quiet();
    step(state, input({ fire: true }));
    step(state, input({ reload: true }));
    expect(state.player.reloadLeft).toBeGreaterThan(0);

    step(state, input({ selectWeapon: 1 }));
    expect(state.player.reloadLeft).toBe(0);
    expect(currentWeapon(state).id).toBe("smg");
    expect(state.player.ammo[0]).toBe(WEAPONS.pistol.magazineSize - 1);
    expect(state.player.ammo[1]).toBe(WEAPONS.smg.magazineSize);
  });

  it("ignores a weapon slot that does not exist", () => {
    const state = quiet();
    step(state, input({ selectWeapon: 9 }));
    expect(state.player.weaponIndex).toBe(0);
  });

  it("fires one shotgun round as several pellets", () => {
    const state = quiet();
    step(state, input({ selectWeapon: 2 }));
    run(state, 0.2);
    step(state, input({ fire: true }));
    expect(state.projectiles).toHaveLength(WEAPONS.shotgun.pellets);
    expect(state.player.ammo[2]).toBe(WEAPONS.shotgun.magazineSize - 1);
  });
});

describe("combat", () => {
  it("kills an enemy in the line of fire and scores it", () => {
    const state = quiet();
    addEnemy(state, "runner", 700, 500);
    run(state, 1, () => input({ fire: true, aim: 0 }));
    expect(state.kills).toBe(1);
    expect(state.score).toBe(ENEMIES.runner.score);
    expect(state.enemies).toHaveLength(0);
    expect(state.shotsHit).toBeGreaterThan(0);
  });

  it("is stopped by a wall in between", () => {
    const state = quiet(room([{ x: 600, y: 300, w: 40, h: 400 }]));
    const enemy = addEnemy(state, "grunt", 800, 500);
    run(state, 1, () => input({ fire: true, aim: 0 }));
    expect(enemy.health).toBe(ENEMIES.grunt.health);
    expect(state.shotsHit).toBe(0);
  });

  it("drops a bullet past its range", () => {
    const state = quiet();
    step(state, input({ fire: true }));
    run(state, WEAPONS.pistol.range / WEAPONS.pistol.projectileSpeed + 0.2);
    expect(state.projectiles).toHaveLength(0);
  });

  it("registers a hit on a target the bullet would tunnel through in one step", () => {
    const state = quiet();
    const enemy = addEnemy(state, "grunt", 530, 500);
    step(state, input({ fire: true, aim: 0 }));
    // One step moves a pistol round 15 px: enough to cross a 28 px target.
    step(state, input({ aim: 0 }), 0.5);
    expect(enemy.health).toBeLessThan(ENEMIES.grunt.health);
  });

  it("only a clear line lets a hunting grunt see and shoot the player", () => {
    const seen = quiet();
    const gruntA = alert(seen, addEnemy(seen, "grunt", 750, 500));
    run(seen, 2);
    expect(seen.damageTaken).toBeGreaterThan(0);
    expect(perception(seen, gruntA)).toBeGreaterThan(0);

    const blocked = quiet(room([{ x: 650, y: 300, w: 40, h: 400 }]));
    const gruntB = alert(blocked, addEnemy(blocked, "grunt", 750, 500));
    expect(perception(blocked, gruntB)).toBe(0);
    run(blocked, 0.3);
    expect(blocked.damageTaken).toBe(0);
  });

  it("gives the player a reaction window before the first enemy shot", () => {
    const state = quiet();
    alert(state, addEnemy(state, "grunt", 750, 500));
    run(state, ENEMIES.grunt.reactionTime - 0.1);
    expect(state.projectiles.filter((shot) => shot.from === "enemy")).toHaveLength(0);
  });

  it("runner hits in melee and the hit costs health", () => {
    const state = quiet();
    alert(state, addEnemy(state, "runner", 600, 500));
    run(state, 2);
    expect(state.player.health).toBeLessThan(state.player.maxHealth);
  });

  it("ends the run at zero health and stops simulating", () => {
    const state = quiet();
    state.player.health = 1;
    alert(state, addEnemy(state, "runner", 520, 500));
    run(state, 2);
    expect(state.status).toBe("dead");
    expect(state.player.health).toBe(0);

    const time = state.time;
    step(state, input({ move: { x: 1, y: 0 }, fire: true }));
    expect(state.time).toBe(time);
  });

  it("an enemy that loses sight walks to where it last saw the player", () => {
    const state = quiet();
    const enemy = alert(state, addEnemy(state, "runner", 750, 500));
    step(state, input());
    expect(enemy.lastKnown).not.toBeNull();
    state.arena.walls.push({ x: 640, y: 300, w: 40, h: 400 });
    enemy.pos.x = 900;
    step(state, input());
    expect(enemy.lastKnown).not.toBeNull();
    expect(enemy.mode).toBe("chase");
  });

  it("getting shot makes an unaware enemy hunt you", () => {
    const state = quiet();
    const enemy = addEnemy(state, "grunt", 700, 500);
    enemy.facing = 0;
    step(state, input({ fire: true, aim: 0 }));
    run(state, 0.3, () => input({ aim: 0 }));
    expect(enemy.health).toBeLessThan(ENEMIES.grunt.health);
    expect(isAlert(enemy)).toBe(true);
  });
});

describe("getting around walls", () => {
  it("a runner finds its way round a long wall to the player", () => {
    const state = quiet(room([{ x: 300, y: 100, w: 40, h: 700 }]));
    state.player.pos = { x: 600, y: 450 };
    const enemy = addEnemy(state, "runner", 100, 450);
    alert(state, enemy);
    run(state, 10);
    expect(state.player.health).toBeLessThan(state.player.maxHealth);
    expect(enemy.pos.x).toBeGreaterThan(300);
  });
});

describe("stealth", () => {
  it("is not spotted at once: the meter fills while an enemy watches you", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 750, 500);
    run(state, 0.3);
    expect(grunt.awareness).toBeGreaterThan(0.05);
    expect(grunt.awareness).toBeLessThan(1);
    expect(grunt.mode).toBe("suspicious");
    expect(isAlert(grunt)).toBe(false);
    expect(state.damageTaken).toBe(0);
  });

  it("is spotted once the meter is full, and then the enemy hunts", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 750, 500);
    let spotted = false;
    const steps = Math.round(6 / STEP_SECONDS);
    for (let n = 0; n < steps && !spotted; n += 1) {
      step(state, input());
      spotted = state.events.some((event) => event.type === "spotted");
    }
    expect(spotted).toBe(true);
    expect(isAlert(grunt)).toBe(true);
    expect(grunt.lastKnown).not.toBeNull();
  });

  it("a harder difficulty fills the meter faster", () => {
    const fill = (difficulty: DifficultyId): number => {
      const state = quiet(room(), difficulty);
      const grunt = addEnemy(state, "grunt", 750, 500);
      run(state, 0.4);
      return grunt.awareness;
    };
    expect(fill("hard")).toBeGreaterThan(fill("normal"));
    expect(fill("normal")).toBeGreaterThan(fill("easy"));
  });

  it("closer fills faster", () => {
    const state = quiet();
    const near = addEnemy(state, "grunt", 640, 500);
    const far = addEnemy(state, "grunt", 780, 500);
    expect(perception(state, near)).toBeGreaterThan(perception(state, far));
  });

  it("the meter drains once the enemy loses sight of you", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 750, 500);
    run(state, 0.4);
    const peak = grunt.awareness;
    expect(peak).toBeGreaterThan(0.1);
    state.arena.walls.push({ x: 640, y: 300, w: 40, h: 400 });
    run(state, DIFFICULTIES.normal.decaySeconds + 0.5);
    expect(grunt.awareness).toBeLessThan(peak);
    expect(isAlert(grunt)).toBe(false);
  });

  it("standing still is harder to notice than walking", () => {
    const still = quiet();
    const walker = quiet();
    const a = addEnemy(still, "grunt", 750, 500);
    const b = addEnemy(walker, "grunt", 750, 500);
    step(still, input());
    step(walker, input({ move: { x: 0, y: 1 } }));
    expect(perception(walker, b)).toBeGreaterThan(perception(still, a));
  });

  it("the flashlight off halves how far an enemy can notice you", () => {
    const lit = quiet();
    const gruntLit = addEnemy(lit, "grunt", 700, 500);
    expect(perception(lit, gruntLit)).toBeGreaterThan(0);

    const dark = quiet();
    dark.player.lightOn = false;
    const gruntDark = addEnemy(dark, "grunt", 700, 500);
    expect(perception(dark, gruntDark)).toBe(0);
  });

  it("toggling the light is an edge, not a hold", () => {
    const state = quiet();
    step(state, input({ toggleLight: true }));
    expect(state.player.lightOn).toBe(false);
    step(state, input());
    expect(state.player.lightOn).toBe(false);
    step(state, input({ toggleLight: true }));
    expect(state.player.lightOn).toBe(true);
  });

  it("an enemy facing away does not see you, and one facing you does", () => {
    const away = quiet();
    const awayGrunt = addEnemy(away, "grunt", 750, 500);
    awayGrunt.facing = 0;
    expect(perception(away, awayGrunt)).toBe(0);

    const toward = quiet();
    const towardGrunt = addEnemy(toward, "grunt", 750, 500);
    expect(perception(toward, towardGrunt)).toBeGreaterThan(0);
  });

  it("but anything right behind you is noticed whatever way it faces", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 500 + STEALTH.closeNotice - 20, 500);
    grunt.facing = 0;
    expect(perception(state, grunt)).toBeGreaterThan(0);
  });

  it("an enemy that has noticed something stops and stares at it", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 750, 500);
    run(state, 0.2);
    const there = { ...grunt.pos };
    run(state, 0.2);
    expect(Math.hypot(grunt.pos.x - there.x, grunt.pos.y - there.y)).toBeLessThan(1);
  });

  describe("hiding", () => {
    const nook = { x: 450, y: 450, w: 100, h: 100 };

    it("the hide button ducks you into a nearby nook: still, light off", () => {
      const state = quiet(room([], [nook]));
      step(state, input());
      expect(state.player.nearHide).toBe(true);
      step(state, input({ hide: true }));
      expect(state.player.hidden).toBe(true);
      expect(state.player.lightOn).toBe(false);
      expect(state.events.some((event) => event.type === "hide" && event.on)).toBe(true);
    });

    it("does nothing away from a nook", () => {
      const state = quiet(room([], [{ x: 100, y: 100, w: 60, h: 60 }]));
      step(state, input({ hide: true }));
      expect(state.player.hidden).toBe(false);
      expect(state.player.nearHide).toBe(false);
    });

    it("pressing it again steps out and gives the light back", () => {
      const state = quiet(room([], [nook]));
      step(state, input({ hide: true }));
      expect(state.player.hidden).toBe(true);
      step(state, input({ hide: true }));
      expect(state.player.hidden).toBe(false);
      expect(state.player.lightOn).toBe(true);
    });

    it("a hidden player cannot walk, shoot, or switch the light on", () => {
      const state = quiet(room([], [nook]));
      step(state, input({ hide: true }));
      const at = { ...state.player.pos };
      run(state, 0.5, () => input({ move: { x: 1, y: 0 }, fire: true, toggleLight: false }));
      expect(state.player.pos).toEqual(at);
      expect(state.shotsFired).toBe(0);
      step(state, input({ toggleLight: true }));
      expect(state.player.lightOn).toBe(false);
    });

    it("far enemies cannot see a hidden player, and near ones notice slowly", () => {
      const far = quiet(room([], [nook]));
      step(far, input({ hide: true }));
      const farGrunt = addEnemy(far, "grunt", 750, 500);
      expect(perception(far, farGrunt)).toBe(0);

      const visible = quiet();
      const exposed = addEnemy(visible, "grunt", 570, 500);
      const hiddenState = quiet(room([], [nook]));
      step(hiddenState, input({ hide: true }));
      const hiddenGrunt = addEnemy(hiddenState, "grunt", 570, 500);
      expect(perception(hiddenState, hiddenGrunt)).toBeGreaterThan(0);
      expect(perception(hiddenState, hiddenGrunt)).toBeLessThan(perception(visible, exposed) / 3);
    });

    it("an enemy passing by does not find you, but one checking the nook does", () => {
      const passing = quiet(room([], [nook]));
      step(passing, input({ hide: true }));
      const passer = addEnemy(passing, "grunt", 570, 500);
      run(passing, 1.2);
      expect(isAlert(passer)).toBe(false);

      const checking = quiet(room([], [nook]));
      step(checking, input({ hide: true }));
      const checker = addEnemy(checking, "grunt", 500 + STEALTH.hideCheckRange - 10, 500);
      run(checking, 2);
      expect(isAlert(checker)).toBe(true);
    });
  });

  it("a gunshot is heard through a wall and sends an enemy to look, without telling it where you are", () => {
    const state = quiet(room([{ x: 600, y: 300, w: 40, h: 400 }]));
    const grunt = addEnemy(state, "grunt", 800, 500);
    step(state, input({ fire: true }));
    expect(grunt.investigate).not.toBeNull();
    expect(grunt.lastKnown).toBeNull();
    expect(isAlert(grunt)).toBe(false);
    expect(grunt.awareness).toBeGreaterThan(STEALTH.noiseAwareness - 0.05);
    expect(grunt.mode).toBe("suspicious");
  });

  it("a gunshot beyond hearing range goes unnoticed", () => {
    const state = quiet(room([{ x: 100, y: 300, w: 40, h: 400 }]));
    const grunt = addEnemy(state, "grunt", 20, 500);
    state.player.pos = { x: 20 + STEALTH.hearRange + 200, y: 500 };
    step(state, input({ fire: true }));
    expect(grunt.investigate).toBeNull();
  });

  it("an enemy that reaches where it last saw you looks around, then goes back to sweeping", () => {
    const state = quiet(room([], [], [{ x: 100, y: 900 }, { x: 900, y: 900 }]));
    state.player.pos = { x: 900, y: 100 };
    const grunt = addEnemy(state, "grunt", 200, 100);
    grunt.facing = Math.PI;
    grunt.mode = "chase";
    grunt.awareness = 1;
    grunt.lastKnown = { x: 260, y: 100 };
    run(state, 2);
    expect(grunt.mode).toBe("search");
    run(state, STEALTH.searchSeconds + 0.5);
    expect(grunt.mode).toBe("patrol");
    expect(grunt.patrolTarget).not.toBeNull();
  });

  it("after losing you an enemy checks the nooks nearby", () => {
    const nook = { x: 300, y: 150, w: 60, h: 60 };
    const state = quiet(room([], [nook], [{ x: 900, y: 900 }]));
    state.player.pos = { x: 900, y: 100 };
    const grunt = addEnemy(state, "grunt", 200, 100);
    grunt.facing = Math.PI;
    grunt.mode = "chase";
    grunt.awareness = 1;
    grunt.lastKnown = { x: 260, y: 100 };
    run(state, 1.5);
    expect(grunt.investigate).not.toBeNull();
    expect(grunt.investigate?.x).toBeCloseTo(330, 0);
    expect(grunt.mode).toBe("suspicious");
  });

  it("with nothing to chase an enemy walks between sweep points", () => {
    const state = quiet(
      room([], [], [{ x: 100, y: 900 }, { x: 900, y: 900 }, { x: 500, y: 900 }]),
    );
    state.player.pos = { x: 900, y: 80 };
    const grunt = addEnemy(state, "grunt", 200, 100);
    grunt.facing = Math.PI;
    const start = { ...grunt.pos };
    run(state, 4);
    expect(Math.hypot(grunt.pos.x - start.x, grunt.pos.y - start.y)).toBeGreaterThan(40);
    expect(["patrol", "search"]).toContain(grunt.mode);
  });

  it("enemies sweeping together head for different places", () => {
    const points = [{ x: 100, y: 900 }, { x: 900, y: 900 }, { x: 500, y: 900 }, { x: 900, y: 500 }];
    const state = quiet(room([], [], points));
    state.player.pos = { x: 80, y: 80 };
    const a = addEnemy(state, "grunt", 400, 800);
    const b = addEnemy(state, "grunt", 420, 800);
    const c = addEnemy(state, "grunt", 440, 800);
    run(state, 0.2);
    const targets = [a, b, c].map((enemy) => `${enemy.patrolTarget?.x},${enemy.patrolTarget?.y}`);
    expect(new Set(targets).size).toBe(3);
  });

  it("a point nobody has looked at in a while gets picked over one just checked", () => {
    const points = [{ x: 100, y: 900 }, { x: 900, y: 900 }];
    const state = quiet(room([], [], points));
    state.player.pos = { x: 80, y: 80 };
    state.time = 100;
    state.sweepAt = [100, 0];
    const grunt = addEnemy(state, "grunt", 500, 900);
    run(state, 0.1);
    expect(grunt.patrolTarget).toEqual(points[1]);
  });

  it("once a wave drags on the sweep starts checking the nooks too", () => {
    const state = quiet(room([], [{ x: 800, y: 800, w: 60, h: 60 }], []));
    state.player.pos = { x: 80, y: 80 };
    const grunt = addEnemy(state, "grunt", 200, 500);
    run(state, 0.2);
    expect(grunt.patrolTarget).toBeNull();

    state.waveStartedAt = state.time - STEALTH.thoroughAfter - 1;
    run(state, 0.2);
    expect(grunt.patrolTarget).toEqual({ x: 830, y: 830 });
  });

  it("sweeping enemies walk, they do not run", () => {
    const state = quiet(room([], [], [{ x: 900, y: 900 }]));
    state.player.pos = { x: 100, y: 80 };
    const grunt = addEnemy(state, "grunt", 200, 500);
    grunt.facing = 0;
    const start = { ...grunt.pos };
    run(state, 1);
    const travelled = Math.hypot(grunt.pos.x - start.x, grunt.pos.y - start.y);
    expect(travelled).toBeLessThan(ENEMIES.grunt.moveSpeed * 0.8);
    expect(travelled).toBeGreaterThan(10);
  });

  it("a spotted enemy tells friends nearby, who come to look rather than know", () => {
    const state = quiet();
    const spotter = addEnemy(state, "grunt", 700, 500);
    const friend = addEnemy(state, "grunt", 760, 700);
    friend.facing = 0;
    const far = addEnemy(state, "grunt", 100, 100);
    far.facing = 0;
    run(state, 4);
    expect(isAlert(spotter)).toBe(true);
    expect(friend.awareness).toBeGreaterThanOrEqual(STEALTH.calloutAwareness - 0.01);
    expect(far.awareness).toBe(0);
  });
});

describe("waves", () => {
  const grace = (difficulty: DifficultyId) => DIFFICULTIES[difficulty].graceFirst;

  it("gives planning time before the first wave, and announces the doors", () => {
    const state = createState(7);
    expect(state.intermission).toBe(grace("normal"));
    expect(state.incoming).toHaveLength(DIFFICULTIES.normal.entries);
    run(state, grace("normal") - 0.5);
    expect(state.wave).toBe(0);
    expect(state.enemies).toHaveLength(0);
    expect(state.spawnQueue).toHaveLength(0);
  });

  it("uses more doors on harder settings", () => {
    const doors = (difficulty: DifficultyId): number => createState(7, "vanguard", undefined, difficulty).incoming.length;
    expect(doors("easy")).toBe(1);
    expect(doors("normal")).toBe(2);
    expect(doors("hard")).toBe(3);
  });

  it("hard adds a door later on", () => {
    const state = createState(7, "vanguard", undefined, "hard");
    state.wave = DIFFICULTIES.hard.moreEntriesFromWave - 1;
    state.enemies = [];
    state.intermission = 0;
    step(state, input());
    expect(state.incoming).toHaveLength(4);
  });

  it("every announced door exists", () => {
    const state = createState(11);
    const ids = state.arena.entries.map((entry) => entry.id);
    for (const id of state.incoming) expect(ids).toContain(id);
  });

  it("starts wave 1 after the planning time with the planned composition", () => {
    const state = createState(7);
    state.player.health = state.player.maxHealth = 1e9;
    run(state, grace("normal") + 12);
    expect(state.wave).toBe(1);
    const planned = waveComposition(1).reduce((sum, row) => sum + row.count, 0);
    expect(state.enemies).toHaveLength(planned);
  });

  it("enemies step in one at a time, just inside the announced doors", () => {
    const state = createState(7);
    state.player.health = state.player.maxHealth = 1e9;
    const doors = state.arena.entries.filter((entry) => state.incoming.includes(entry.id));
    state.intermission = 0.01;
    let guard = 0;
    while (state.enemies.length === 0 && guard++ < 600) step(state, input());
    expect(state.enemies).toHaveLength(1);
    const first = state.enemies[0];
    expect(doors.some((door) => Math.hypot(first.pos.x - door.pos.x, first.pos.y - door.pos.y) < 40)).toBe(true);

    // Not all at once.
    expect(state.spawnQueue.length).toBeGreaterThan(0);
  });

  it("a new wave starts sweeping, knowing nothing about you", () => {
    const state = createState(7, "vanguard", room());
    state.player.health = state.player.maxHealth = 1e9;
    run(state, grace("normal") + 1);
    expect(state.enemies.length).toBeGreaterThan(0);
    for (const enemy of state.enemies) {
      expect(enemy.mode).toBe("patrol");
      expect(enemy.awareness).toBe(0);
      expect(enemy.lastKnown).toBeNull();
      expect(enemy.investigate).toBeNull();
    }
  });

  it("clearing a wave pays a bonus, heals, and announces the next doors", () => {
    const state = createState(7);
    state.player.health = 50;
    state.intermission = 0.01;
    run(state, 0.1);
    state.enemies = [];
    state.spawnQueue = [];
    const scoreBefore = state.score;
    const healthBefore = state.player.health;

    step(state, input());
    expect(state.score).toBe(scoreBefore + WAVE_TUNING.waveClearScore);
    expect(state.player.health).toBe(healthBefore + WAVE_TUNING.clearHeal);
    expect(state.intermission).toBe(DIFFICULTIES.normal.grace);
    expect(state.incoming.length).toBeGreaterThan(0);

    state.player.health = state.player.maxHealth = 1e9;
    run(state, DIFFICULTIES.normal.grace + 2);
    expect(state.wave).toBe(2);
    expect(state.enemies.length).toBeGreaterThan(0);
  });

  it("caps stat scaling so late waves add enemies, not sponges", () => {
    const state = createState(7);
    state.wave = 99;
    state.intermission = 0.01;
    run(state, 0.3);
    const grunt = state.enemies.find((enemy) => enemy.defId === "grunt");
    expect(grunt?.maxHealth).toBe(ENEMIES.grunt.health * WAVE_TUNING.maxScale);
    expect(grunt?.damageScale).toBe(WAVE_TUNING.maxScale);
  });
});

describe("determinism", () => {
  it("the same seed and inputs give the same fight", () => {
    const play = (): string => {
      const state = createState(42);
      run(state, 14, () => input({ fire: true, aim: 1, move: { x: 0.3, y: -0.2 } }));
      return JSON.stringify({ score: state.score, p: state.player, e: state.enemies.length, rng: state.rng });
    };
    expect(play()).toBe(play());
  });
});

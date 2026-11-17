import { describe, expect, it } from "vitest";
import { DIFFICULTIES, ENEMIES, MISSION, SHADOW, STEALTH, WEAPONS } from "./content";
import { createState, currentWeapon, enemyDef, NO_INPUT, perceive, rating, STEP_SECONDS, step } from "./sim";
import type { Arena, DifficultyId, EnemyState, PlayerInput, SimState } from "./types";

/** An open room with no walls and no guards unless a test adds them. */
function room(walls: Arena["walls"] = [], corners: Arena["corners"] = [], loot: Arena["loot"] = [], guards: Arena["guards"] = []): Arena {
  return {
    width: 1000,
    height: 1000,
    walls,
    rooms: [],
    corners,
    guards,
    loot,
    exit: { door: { x: 0, y: 450, w: 10, h: 100 }, zone: { x: 0, y: 450, w: 60, h: 100 } },
    playerSpawn: { x: 500, y: 500 },
  };
}

function input(patch: Partial<PlayerInput> = {}): PlayerInput {
  return { ...NO_INPUT, move: { x: 0, y: 0 }, ...patch };
}

function run(state: SimState, seconds: number, make: () => PlayerInput = () => input()): void {
  const steps = Math.round(seconds / STEP_SECONDS);
  for (let n = 0; n < steps; n += 1) step(state, make());
}

/** A fresh state with no guards unless the arena names some, so tests place enemies by hand. */
function quiet(arena: Arena = room(), difficulty: DifficultyId = "normal"): SimState {
  return createState(1, "vanguard", arena, difficulty);
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
    route: [{ x, y }],
    routeIndex: 0,
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

  it("every weapon kills with a single bullet", () => {
    const toughest = Math.max(...Object.values(ENEMIES).map((def) => def.health));
    for (const weapon of Object.values(WEAPONS)) expect(weapon.damage, weapon.id).toBeGreaterThanOrEqual(toughest);
  });

  it("one shot takes down an unaware enemy, and it never gets the chance to hunt you", () => {
    const state = quiet();
    const enemy = addEnemy(state, "grunt", 700, 500);
    enemy.facing = 0;
    step(state, input({ fire: true, aim: 0 }));
    run(state, 0.3, () => input({ aim: 0 }));
    expect(state.enemies).not.toContain(enemy);
    expect(state.kills).toBe(1);
    expect(enemy.radio).toBeNull();
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

  it("an enemy facing away does not see you, and one facing you does", () => {
    const away = quiet();
    const awayGrunt = addEnemy(away, "grunt", 750, 500);
    awayGrunt.facing = 0;
    expect(perception(away, awayGrunt)).toBe(0);

    const toward = quiet();
    const towardGrunt = addEnemy(toward, "grunt", 750, 500);
    expect(perception(toward, towardGrunt)).toBeGreaterThan(0);
  });

  it("only the enemy's own flashlight beam counts: just outside the cone you are not seen", () => {
    const def = ENEMIES.grunt;
    const make = (offset: number): number => {
      const state = quiet();
      const grunt = addEnemy(state, "grunt", 750, 500);
      grunt.facing = Math.PI + offset;
      return perception(state, grunt);
    };
    expect(make(def.fieldOfView - 0.1)).toBeGreaterThan(0);
    expect(make(def.fieldOfView + 0.1)).toBe(0);
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

  describe("hiding in the shadows", () => {
    /** A player jammed into the north-west corner of a room: walls to the west and north. */
    const bay = (): SimState => {
      const state = quiet(
        room([
          { x: 400, y: 300, w: 30, h: 400 },
          { x: 400, y: 300, w: 400, h: 30 },
        ]),
      );
      state.player.pos = { x: 430 + state.player.radius, y: 330 + state.player.radius };
      return state;
    };

    it("pressed into a corner, you are hidden", () => {
      const state = bay();
      step(state, input());
      expect(state.player.cover).toBeGreaterThanOrEqual(0.5);
      expect(state.player.hidden).toBe(true);
    });

    it("open floor does not hide you", () => {
      const state = quiet();
      step(state, input());
      expect(state.player.cover).toBe(0);
      expect(state.player.hidden).toBe(false);
    });

    it("hugging a single flat wall is not enough", () => {
      const state = quiet(room([{ x: 400, y: 300, w: 30, h: 400 }]));
      state.player.pos = { x: 430 + state.player.radius, y: 500 };
      step(state, input());
      expect(state.player.hidden).toBe(false);
    });

    it("walking out of the corner un-hides you, and you can still walk and shoot while hidden", () => {
      const state = bay();
      step(state, input());
      expect(state.player.hidden).toBe(true);
      const at = { ...state.player.pos };
      run(state, 0.1, () => input({ move: { x: 1, y: 1 } }));
      expect(state.player.pos.y).toBeGreaterThan(at.y);
      run(state, 1.5, () => input({ move: { x: 1, y: 1 } }));
      expect(state.player.hidden).toBe(false);
    });

    it("a shot gives you away for a moment, then the shadow takes you back", () => {
      const state = bay();
      step(state, input());
      expect(state.player.hidden).toBe(true);
      step(state, input({ fire: true }));
      expect(state.shotsFired).toBe(1);
      expect(state.player.hidden).toBe(false);
      run(state, 0.5);
      expect(state.player.hidden).toBe(false);
      run(state, SHADOW.exposedSeconds);
      expect(state.player.hidden).toBe(true);
    });

    it("far enemies cannot see a hidden player, and near ones notice slowly", () => {
      const far = bay();
      step(far, input());
      const farGrunt = addEnemy(far, "grunt", far.player.pos.x + 250, far.player.pos.y);
      expect(perception(far, farGrunt)).toBe(0);

      const open = quiet();
      const exposed = addEnemy(open, "grunt", 570, 500);
      const hiddenState = bay();
      step(hiddenState, input());
      const hiddenGrunt = addEnemy(hiddenState, "grunt", hiddenState.player.pos.x + 70, hiddenState.player.pos.y);
      expect(perception(hiddenState, hiddenGrunt)).toBeGreaterThan(0);
      expect(perception(hiddenState, hiddenGrunt)).toBeLessThan(perception(open, exposed) / 3);
    });

    it("an enemy passing by does not find you, but one that walks right up does", () => {
      const passing = bay();
      step(passing, input());
      const passer = addEnemy(passing, "grunt", passing.player.pos.x + 70, passing.player.pos.y);
      run(passing, 1.2);
      expect(isAlert(passer)).toBe(false);

      const checking = bay();
      step(checking, input());
      const checker = addEnemy(checking, "grunt", checking.player.pos.x + STEALTH.hideCheckRange - 10, checking.player.pos.y);
      run(checking, 2);
      expect(isAlert(checker)).toBe(true);
    });
  });

  it("a silenced shot heard close by, even through a thin wall, sends an enemy to look without telling it where you are", () => {
    const state = quiet(room([{ x: 530, y: 300, w: 20, h: 400 }]));
    const grunt = addEnemy(state, "grunt", 575, 500);
    grunt.facing = 0;
    step(state, input({ fire: true }));
    expect(grunt.investigate).not.toBeNull();
    expect(grunt.lastKnown).toBeNull();
    expect(isAlert(grunt)).toBe(false);
    expect(grunt.awareness).toBeGreaterThan(STEALTH.noiseAwareness - 0.05);
    expect(grunt.mode).toBe("suspicious");
  });

  it("a silenced shot is not heard across the room", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 500 + STEALTH.hearRange + 60, 500);
    grunt.facing = 0;
    step(state, input({ fire: true, aim: Math.PI }));
    expect(grunt.investigate).toBeNull();
    expect(grunt.awareness).toBe(0);
  });

  it("through a wall a shot carries only half as far", () => {
    const state = quiet(room([{ x: 530, y: 300, w: 20, h: 400 }]));
    const grunt = addEnemy(state, "grunt", 500 + STEALTH.hearRange * 0.5 + 40, 500);
    grunt.facing = 0;
    step(state, input({ fire: true, aim: Math.PI }));
    expect(grunt.investigate).toBeNull();
  });

  it("a miss that whizzes past an enemy puts it on alert, though it still does not know where you are", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 760, 528);
    grunt.facing = 0;
    step(state, input({ fire: true, aim: 0 }));
    run(state, 0.5, () => input({ aim: 0 }));
    expect(state.enemies).toContain(grunt);
    expect(grunt.mode).toBe("suspicious");
    expect(grunt.awareness).toBeGreaterThan(0.3);
    expect(isAlert(grunt)).toBe(false);
    expect(grunt.lastKnown).toBeNull();
  });

  it("a miss that flies well clear of an enemy goes unnoticed", () => {
    const state = quiet();
    const grunt = addEnemy(state, "grunt", 760, 560);
    grunt.facing = 0;
    step(state, input({ fire: true, aim: 0 }));
    run(state, 0.5, () => input({ aim: 0 }));
    expect(grunt.investigate).toBeNull();
  });

  it("an enemy that reaches where it last saw you looks around, then goes back to its route", () => {
    const state = quiet();
    state.player.pos = { x: 900, y: 100 };
    const grunt = addEnemy(state, "grunt", 200, 100);
    grunt.route = [{ x: 100, y: 900 }, { x: 200, y: 900 }];
    grunt.routeIndex = 1;
    grunt.facing = Math.PI;
    grunt.mode = "chase";
    grunt.awareness = 1;
    grunt.lastKnown = { x: 260, y: 100 };
    run(state, 2);
    expect(grunt.mode).toBe("search");
    run(state, STEALTH.searchSeconds + 0.5);
    expect(grunt.mode).toBe("patrol");
    expect(grunt.patrolTarget).toEqual({ x: 200, y: 900 });
  });

  it("after losing you an enemy checks the dark corners nearby", () => {
    const state = quiet(room([], [{ x: 330, y: 180 }]));
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

  describe("guard duty", () => {
    const loop = [{ x: 200, y: 500 }, { x: 600, y: 500 }, { x: 600, y: 700 }];

    it("a roamer walks its loop, one waypoint after another, and looks around at each stop", () => {
      const state = quiet(room([], [], [], [{ defId: "grunt", tier: 1, route: loop }]));
      state.player.pos = { x: 900, y: 50 };
      const guard = state.enemies[0];
      const visited = new Set<number>();
      let looked = false;
      for (let n = 0; n < 60 * 40; n += 1) {
        step(state, input());
        visited.add(guard.routeIndex);
        if (guard.mode === "search") looked = true;
      }
      expect(visited.size).toBe(loop.length);
      expect(looked).toBe(true);
      expect(isAlert(guard)).toBe(false);
    });

    it("a roamer is not hunting anyone: left alone it never goes after the player", () => {
      const state = quiet(room([], [], [], [{ defId: "grunt", tier: 1, route: loop }]));
      state.player.pos = { x: 900, y: 50 };
      run(state, 30);
      expect(state.timesSpotted).toBe(0);
      expect(state.enemies[0].lastKnown).toBeNull();
    });

    it("a posted guard stays put and sweeps its gaze either side of the way it faces", () => {
      const post = { x: 300, y: 300 };
      const state = quiet(room([], [], [], [{ defId: "grunt", tier: 1, route: [post], watch: 0 }]));
      state.player.pos = { x: 900, y: 900 };
      const guard = state.enemies[0];
      let low = Infinity;
      let high = -Infinity;
      for (let n = 0; n < 60 * 12; n += 1) {
        step(state, input());
        low = Math.min(low, guard.facing);
        high = Math.max(high, guard.facing);
      }
      expect(Math.hypot(guard.pos.x - post.x, guard.pos.y - post.y)).toBeLessThan(1);
      expect(low).toBeLessThan(-0.3);
      expect(high).toBeGreaterThan(0.3);
      expect(high).toBeLessThanOrEqual(STEALTH.postSweep + 0.05);
    });

    it("a posted guard that was drawn off by a noise walks back to its post", () => {
      const post = { x: 300, y: 300 };
      const state = quiet(room([], [], [], [{ defId: "grunt", tier: 1, route: [post], watch: 0 }]));
      state.player.pos = { x: 900, y: 900 };
      const guard = state.enemies[0];
      guard.pos = { x: 300, y: 600 };
      run(state, 12);
      expect(Math.hypot(guard.pos.x - post.x, guard.pos.y - post.y)).toBeLessThan(30);
    });

    it("walking guards walk, they do not run", () => {
      const state = quiet(room([], [], [], [{ defId: "grunt", tier: 1, route: loop }]));
      state.player.pos = { x: 900, y: 50 };
      const guard = state.enemies[0];
      const start = { ...guard.pos };
      run(state, 1);
      const travelled = Math.hypot(guard.pos.x - start.x, guard.pos.y - start.y);
      expect(travelled).toBeLessThan(ENEMIES.grunt.moveSpeed * 0.8);
      expect(travelled).toBeGreaterThan(10);
    });

    it("the difficulty decides who is on duty", () => {
      const arena = room([], [], [], [
        { defId: "grunt", tier: 1, route: [{ x: 100, y: 100 }] },
        { defId: "grunt", tier: 2, route: [{ x: 200, y: 100 }] },
        { defId: "grunt", tier: 3, route: [{ x: 300, y: 100 }] },
      ]);
      expect(createState(1, "vanguard", arena, "easy").enemies).toHaveLength(1);
      expect(createState(1, "vanguard", arena, "normal").enemies).toHaveLength(2);
      expect(createState(1, "vanguard", arena, "hard").enemies).toHaveLength(3);
    });
  });

  /** Runs until the spotter has noticed the player, so its radio call is running. */
  function spotted(state: SimState, spotter: EnemyState): void {
    for (let n = 0; n < 600 && !isAlert(spotter); n += 1) step(state, input());
    expect(isAlert(spotter)).toBe(true);
  }

  it("a spotted enemy tells its squad at once, but they come to look rather than know", () => {
    const state = quiet();
    const spotter = addEnemy(state, "grunt", 700, 500);
    const mate = addEnemy(state, "grunt", 760, 560);
    mate.facing = 0;
    let matePeak = 0;
    for (let n = 0; n < 240; n += 1) {
      step(state, input());
      matePeak = Math.max(matePeak, mate.awareness);
    }
    expect(isAlert(spotter)).toBe(true);
    expect(matePeak).toBeGreaterThanOrEqual(STEALTH.calloutAwareness - 0.01);
  });

  it("an enemy out of the squad only learns by radio, after the call has had time to go out", () => {
    const state = quiet();
    const spotter = addEnemy(state, "grunt", 700, 500);
    const far = addEnemy(state, "grunt", 600, 900);
    far.facing = Math.PI / 2;
    spotted(state, spotter);
    expect(spotter.radio).not.toBeNull();
    expect(far.awareness).toBe(0);
    expect(far.investigate).toBeNull();
    let peak = 0;
    for (let n = 0; n < Math.round((STEALTH.radioSeconds + 0.2) / STEP_SECONDS); n += 1) {
      step(state, input());
      peak = Math.max(peak, far.awareness);
    }
    expect(spotter.radio).toBeNull();
    expect(peak).toBeGreaterThanOrEqual(STEALTH.radioAwareness - 0.01);
    expect(far.investigate).not.toBeNull();
    expect(isAlert(far)).toBe(false);
    expect(far.lastKnown).toBeNull();
  });

  it("the radio call announces itself with an event", () => {
    const state = quiet();
    const spotter = addEnemy(state, "grunt", 700, 500);
    addEnemy(state, "grunt", 600, 900).facing = Math.PI / 2;
    spotted(state, spotter);
    let called = false;
    for (let n = 0; n < 300; n += 1) {
      step(state, input());
      if (state.events.some((event) => event.type === "radio")) called = true;
    }
    expect(called).toBe(true);
  });

  it("killing the spotter before its call goes out keeps everyone else in the dark", () => {
    const state = quiet();
    state.player.health = state.player.maxHealth = 1e9;
    const spotter = addEnemy(state, "grunt", 700, 500);
    const far = addEnemy(state, "grunt", 600, 900);
    far.facing = Math.PI / 2;
    spotted(state, spotter);
    const aim = Math.atan2(spotter.pos.y - state.player.pos.y, spotter.pos.x - state.player.pos.x);
    step(state, input({ fire: true, aim }));
    run(state, STEALTH.radioSeconds + 1, () => input({ aim }));
    expect(state.enemies).not.toContain(spotter);
    expect(far.awareness).toBe(0);
    expect(far.investigate).toBeNull();
  });

  it("radioed enemies get a fuzzy position, not the exact spot", () => {
    const state = quiet();
    const spotter = addEnemy(state, "grunt", 700, 500);
    const far = addEnemy(state, "grunt", 600, 900);
    far.facing = Math.PI / 2;
    spotted(state, spotter);
    run(state, STEALTH.radioSeconds + 0.1);
    const spot = far.investigate;
    expect(spot).not.toBeNull();
    expect(Math.hypot((spot?.x ?? 0) - state.player.pos.x, (spot?.y ?? 0) - state.player.pos.y)).toBeLessThanOrEqual(STEALTH.radioScatter);
  });
});

describe("pace", () => {
  it("the player can outwalk a grunt, so retreating works", () => {
    const state = quiet();
    expect(state.player.moveSpeed).toBeGreaterThan(ENEMIES.grunt.moveSpeed * 1.5);
  });

  it("guards walk slower on easy than on hard", () => {
    const travelled = (difficulty: DifficultyId): number => {
      const state = quiet(room([], [], [], [{ defId: "grunt", tier: 1, route: [{ x: 200, y: 500 }, { x: 900, y: 500 }] }]), difficulty);
      state.player.pos = { x: 100, y: 80 };
      const guard = state.enemies[0];
      const start = { ...guard.pos };
      run(state, 1);
      return Math.hypot(guard.pos.x - start.x, guard.pos.y - start.y);
    };
    expect(travelled("easy")).toBeLessThan(travelled("normal"));
    expect(travelled("normal")).toBeLessThan(travelled("hard"));
  });
});

describe("the heist", () => {
  const gold = { id: "gold", label: "Gold", pos: { x: 600, y: 500 }, value: 1000, main: true };
  const trinket = { id: "trinket", label: "Trinket", pos: { x: 500, y: 600 }, value: 150, main: false };
  const heist = (): SimState => quiet(room([], [], [gold, trinket]));
  const walkTo = (state: SimState, to: { x: number; y: number }): void => {
    state.player.pos = { x: to.x - 40, y: to.y };
    run(state, 1, () => input({ move: { x: 1, y: 0 } }));
  };

  it("starts with the mission still to do", () => {
    const state = heist();
    expect(state.status).toBe("playing");
    expect(state.hasGold).toBe(false);
    expect(state.loot.every((entry) => !entry.taken)).toBe(true);
  });

  it("picking up the gold case pays and marks it carried", () => {
    const state = heist();
    walkTo(state, gold.pos);
    expect(state.hasGold).toBe(true);
    expect(state.score).toBe(gold.value);
    expect(state.loot[0].taken).toBe(true);
  });

  it("a side valuable pays but is not the mission", () => {
    const state = heist();
    walkTo(state, trinket.pos);
    expect(state.hasGold).toBe(false);
    expect(state.score).toBe(trinket.value);
  });

  it("loot is only taken once", () => {
    const state = heist();
    walkTo(state, gold.pos);
    run(state, 1);
    expect(state.score).toBe(gold.value);
  });

  it("the exit does nothing without the gold", () => {
    const state = heist();
    state.player.pos = { x: 30, y: 500 };
    run(state, 0.5);
    expect(state.status).toBe("playing");
  });

  it("walking into the exit with the gold ends the mission and pays for the escape", () => {
    const state = heist();
    walkTo(state, gold.pos);
    state.player.pos = { x: 30, y: 500 };
    step(state, input());
    expect(state.status).toBe("escaped");
    expect(state.events.some((event) => event.type === "escaped")).toBe(true);
    expect(state.score).toBe(gold.value + MISSION.escapeBonus + MISSION.unseenBonus + MISSION.ghostBonus);
    expect(rating(state)).toBe("GHOST");
  });

  it("being spotted costs the unseen bonus, and a kill costs the ghost bonus", () => {
    const seen = heist();
    seen.timesSpotted = 1;
    walkTo(seen, gold.pos);
    seen.player.pos = { x: 30, y: 500 };
    step(seen, input());
    expect(seen.score).toBe(gold.value + MISSION.escapeBonus);
    expect(rating(seen)).toBe("SEEN");

    const quietKill = heist();
    quietKill.kills = 1;
    walkTo(quietKill, gold.pos);
    quietKill.player.pos = { x: 30, y: 500 };
    step(quietKill, input());
    expect(quietKill.score).toBe(gold.value + MISSION.escapeBonus + MISSION.unseenBonus);
    expect(rating(quietKill)).toBe("SHADOW");
  });

  it("counts every time a guard spots you", () => {
    const state = quiet();
    addEnemy(state, "grunt", 700, 500);
    run(state, 4);
    expect(state.timesSpotted).toBe(1);
  });

  it("freezes the world once you are out", () => {
    const state = heist();
    walkTo(state, gold.pos);
    state.player.pos = { x: 30, y: 500 };
    step(state, input());
    const time = state.time;
    step(state, input({ move: { x: 1, y: 0 } }));
    expect(state.time).toBe(time);
  });
});

describe("determinism", () => {
  it("the same seed and inputs give the same fight", () => {
    const play = (): string => {
      const state = createState(42);
      run(state, 14, () => input({ fire: true, aim: 1, move: { x: 0.3, y: -0.2 } }));
      return JSON.stringify({ score: state.score, p: state.player, e: state.enemies.map((enemy) => enemy.pos), rng: state.rng });
    };
    expect(play()).toBe(play());
  });
});

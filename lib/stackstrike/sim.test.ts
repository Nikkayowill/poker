import { describe, expect, it } from "vitest";
import { ARENA, BARRELS, ENEMIES, HORDE, LEVELING, PICKUPS, WEAPONS } from "./content";
import { choosePerk, comboMultiplier, createState, magazineSize, NO_INPUT, redrawOffer, skipOffer, step, STEP_SECONDS } from "./sim";
import type { Arena, EnemyState, PlayerInput, SimState } from "./types";
import { waveMix } from "./waves";

/** A bare field with one spawn in the corner, so a scenario is about the rules and not the map. */
function field(over: Partial<Arena> = {}): Arena {
  return {
    width: 1000,
    height: 1000,
    walls: [],
    rooms: [],
    lights: [],
    ambient: 1,
    spawns: [{ x: 900, y: 900 }],
    playerSpawn: { x: 100, y: 100 },
    ...over,
  };
}

function run(state: SimState, seconds: number, input: PlayerInput = NO_INPUT): void {
  const steps = Math.round(seconds / STEP_SECONDS);
  for (let i = 0; i < steps; i += 1) step(state, input);
}

/** Puts a zombie in by hand. A scenario with hand-placed zombies has no waves of its own. */
function zombie(state: SimState, defId: string, x: number, y: number): EnemyState {
  const def = ENEMIES[defId];
  state.wave.breakLeft = 1e9;
  const enemy: EnemyState = { id: state.nextId++, defId, pos: { x, y }, facing: 0, health: def.health, maxHealth: def.health, cooldown: 0, hurt: 0 };
  state.enemies.push(enemy);
  return enemy;
}

/** Holds the first wave back for good, so a scenario is only about the zombies it sets up. */
function noWaves(state: SimState): SimState {
  state.wave.breakLeft = 1e9;
  return state;
}

/** Skips the quiet before the first wave so the next step starts it. */
function startFirstWave(state: SimState): void {
  state.wave.breakLeft = STEP_SECONDS / 2;
}

const aimAt = (state: SimState, x: number, y: number): number => Math.atan2(y - state.player.pos.y, x - state.player.pos.x);

describe("a new run", () => {
  it("starts quiet, with no zombies and the first wave on its way", () => {
    const state = createState(1, "vanguard", field());
    expect(state.status).toBe("playing");
    expect(state.enemies).toEqual([]);
    expect(state.wave.number).toBe(0);
    expect(state.wave.breakLeft).toBe(HORDE.startDelay);
  });

  it("insists on a weapon", () => {
    expect(() => createState(1, "vanguard", field(), "normal", [])).toThrow();
  });
});

describe("waves", () => {
  it("starts wave 1 after the quiet, queues its zombies and sends the first batch", () => {
    const state = createState(1, "vanguard", field());
    run(state, HORDE.startDelay + 1);
    expect(state.wave.number).toBe(1);
    expect(state.enemies.length).toBeGreaterThan(0);
    const mix = waveMix(1, 1);
    expect(state.enemies.length + state.wave.queue.length).toBe(mix.walker + mix.runner + mix.bloater + mix.armored + mix.brute);
  });

  it("announces each wave", () => {
    const state = createState(1, "vanguard", field());
    startFirstWave(state);
    step(state, NO_INPUT);
    expect(state.events).toContainEqual({ type: "wave", number: 1 });
  });

  it("brings zombies in a long way from the player", () => {
    const state = createState(2, "vanguard", field());
    startFirstWave(state);
    step(state, NO_INPUT);
    run(state, 0.2);
    for (const enemy of state.enemies) {
      const dist = Math.hypot(enemy.pos.x - state.player.pos.x, enemy.pos.y - state.player.pos.y);
      expect(dist).toBeGreaterThan(HORDE.spawnMinDistance - 100);
    }
  });

  it("never has more than the cap alive at once", () => {
    const state = createState(3, "vanguard", field());
    state.player.health = state.player.maxHealth = 1e9;
    state.wave.number = 14;
    startFirstWave(state);
    let most = 0;
    for (let i = 0; i < 60 * 40; i += 1) {
      step(state, NO_INPUT);
      most = Math.max(most, state.enemies.length);
    }
    expect(most).toBeLessThanOrEqual(HORDE.maxAlive);
    expect(most).toBeGreaterThan(10);
  });

  it("pays a bonus, heals a little and rests when a wave is cleared, then starts the next", () => {
    const state = createState(4, "vanguard", field());
    startFirstWave(state);
    step(state, NO_INPUT);
    state.wave.queue = [];
    state.enemies = [];
    state.player.health = 50;
    step(state, NO_INPUT);
    expect(state.score).toBe(HORDE.waveBonus);
    expect(state.player.health).toBeGreaterThan(50);
    expect(state.wave.breakLeft).toBe(HORDE.breakSeconds);
    run(state, HORDE.breakSeconds + 0.2);
    expect(state.wave.number).toBe(2);
  });
});

describe("tougher waves", () => {
  const spawnedHealth = (wave: number, defId = "walker"): number => {
    const state = createState(40, "vanguard", field());
    state.wave.number = wave - 1;
    startFirstWave(state);
    step(state, NO_INPUT);
    state.enemies = [];
    state.wave.queue = [defId];
    state.wave.spawnIn = 0;
    run(state, 1);
    return state.enemies[0].maxHealth;
  };

  it("makes each zombie tougher every wave, up to a cap", () => {
    expect(spawnedHealth(1)).toBe(ENEMIES.walker.health);
    expect(spawnedHealth(6)).toBeGreaterThan(spawnedHealth(2));
    expect(spawnedHealth(100)).toBe(Math.round(ENEMIES.walker.health * HORDE.healthCap));
  });

  it("sends a riot zombie that stops half of every bullet but none of a blast", () => {
    const state = createState(41, "vanguard", field());
    const riot = zombie(state, "armored", 300, 100);
    const plain = zombie(state, "walker", 300, 160);
    plain.health = riot.health;
    plain.maxHealth = riot.maxHealth;
    const aim = aimAt(state, 300, 100);
    step(state, { ...NO_INPUT, aim, fire: true });
    run(state, 0.5);
    expect(riot.maxHealth - riot.health).toBe(WEAPONS.pistol.damage * ENEMIES.armored.armor);
    state.pickups.push({ id: 950, kind: "bomb", pos: { ...state.player.pos }, left: 5 });
    step(state, NO_INPUT);
    expect(state.enemies.find((enemy) => enemy.defId === "armored")).toBeUndefined();
  });

  it("announces a cleared wave with its bonus", () => {
    const state = createState(42, "vanguard", field());
    startFirstWave(state);
    step(state, NO_INPUT);
    state.wave.queue = [];
    state.enemies = [];
    step(state, NO_INPUT);
    expect(state.events).toContainEqual({ type: "waveclear", number: 1, bonus: HORDE.waveBonus });
  });
});

describe("bloaters", () => {
  const shootDown = (state: SimState, bloater: EnemyState): void => {
    bloater.health = 1;
    const aim = aimAt(state, bloater.pos.x, bloater.pos.y);
    for (let i = 0; i < 90 && state.enemies.includes(bloater); i += 1) step(state, { ...NO_INPUT, aim, fire: true });
  };

  it("burst when they die, hurting zombies beside them but not ones well away", () => {
    const state = createState(70, "vanguard", field());
    const bloater = zombie(state, "bloater", 400, 100);
    const beside = zombie(state, "walker", 440, 120);
    beside.health = beside.maxHealth = 5;
    const far = zombie(state, "walker", 400 + (ENEMIES.bloater.burst?.radius ?? 0) + 150, 100);
    shootDown(state, bloater);
    expect(state.enemies.includes(beside)).toBe(false);
    expect(far.health).toBe(far.maxHealth);
    expect(state.kills).toBeGreaterThanOrEqual(2);
  });

  it("hurt a player standing too close when they burst, but not one at range", () => {
    const close = createState(71, "vanguard", field());
    const near = zombie(close, "bloater", close.player.pos.x + 60, close.player.pos.y);
    near.health = 1;
    close.projectiles.push({ id: 800, pos: { x: close.player.pos.x + 30, y: close.player.pos.y }, vel: { x: 600, y: 0 }, damage: 40, travelled: 0, maxRange: 200 });
    run(close, 0.2);
    expect(close.player.health).toBeLessThan(close.player.maxHealth);

    const ranged = createState(72, "vanguard", field());
    const farOff = zombie(ranged, "bloater", ranged.player.pos.x + 400, ranged.player.pos.y);
    shootDown(ranged, farOff);
    expect(ranged.enemies.includes(farOff)).toBe(false);
    expect(ranged.player.health).toBe(ranged.player.maxHealth);
  });

  it("set off a chain through a pack of bloaters", () => {
    const state = createState(73, "vanguard", field());
    const pack = [0, 1, 2].map((n) => zombie(state, "bloater", 420 + n * 60, 100));
    for (const bloater of pack) bloater.health = 1;
    shootDown(state, pack[0]);
    run(state, 0.1);
    expect(pack.every((bloater) => !state.enemies.includes(bloater))).toBe(true);
  });
});

describe("explosive barrels", () => {
  const withBarrels = (spots: { x: number; y: number }[], over: Partial<Arena> = {}): SimState => noWaves(createState(50, "vanguard", field({ barrels: spots, ...over })));

  it("stand on their spots at the start, and stop bullets", () => {
    const state = withBarrels([{ x: 300, y: 100 }]);
    expect(state.barrels).toHaveLength(1);
    const walker = zombie(state, "walker", 500, 100);
    const aim = aimAt(state, 500, 100);
    // The barrel is in the way, so the first shots go into it and not the zombie.
    step(state, { ...NO_INPUT, aim, fire: true });
    run(state, 0.5);
    expect(walker.health).toBe(walker.maxHealth);
  });

  it("blow up when shot enough, hurting zombies in the blast and sparing those outside", () => {
    const state = withBarrels([{ x: 300, y: 100 }]);
    const near = zombie(state, "walker", 360, 140);
    const far = zombie(state, "walker", 300 + BARRELS.blastRadius + 120, 100);
    const aim = aimAt(state, 300, 100);
    for (let i = 0; i < 90 && state.barrels.length > 0; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
    expect(state.barrels).toHaveLength(0);
    expect(state.enemies.includes(near)).toBe(false);
    expect(state.kills).toBeGreaterThanOrEqual(1);
    expect(far.health).toBe(far.maxHealth);
  });

  it("hurt a player who is too close to the blast but not one well away", () => {
    const close = withBarrels([{ x: 140, y: 100 }]);
    close.barrels[0].health = 1;
    close.projectiles.push({ id: 900, pos: { x: 130, y: 100 }, vel: { x: 600, y: 0 }, damage: 40, travelled: 0, maxRange: 300 });
    run(close, 0.2);
    expect(close.player.health).toBeLessThan(close.player.maxHealth);

    const wide = withBarrels([{ x: 100 + BARRELS.blastRadius + 200, y: 100 }]);
    wide.barrels[0].health = 1;
    wide.projectiles.push({ id: 901, pos: { x: 500, y: 100 }, vel: { x: 600, y: 0 }, damage: 40, travelled: 0, maxRange: 300 });
    run(wide, 0.2);
    expect(wide.player.health).toBe(wide.player.maxHealth);
  });

  it("set each other off in a chain", () => {
    const state = withBarrels([
      { x: 300, y: 100 },
      { x: 300 + BARRELS.blastRadius - 20, y: 100 },
      { x: 300 + (BARRELS.blastRadius - 20) * 2, y: 100 },
    ]);
    state.barrels[0].health = 1;
    state.projectiles.push({ id: 902, pos: { x: 280, y: 100 }, vel: { x: 600, y: 0 }, damage: 40, travelled: 0, maxRange: 300 });
    run(state, 0.2);
    expect(state.barrels).toHaveLength(0);
  });

  it("do not wedge a zombie that is heading straight through one", () => {
    // The player is straight on from a zombie with a barrel dead in line between them, in a room with no other way round.
    const state = withBarrels([{ x: 300, y: 300 }], { playerSpawn: { x: 600, y: 300 } });
    const walker = zombie(state, "walker", 150, 300);
    run(state, 20);
    expect(Math.hypot(walker.pos.x - state.player.pos.x, walker.pos.y - state.player.pos.y)).toBeLessThan(60);
  });

  it("are walked round, not through", () => {
    const state = withBarrels([{ x: 200, y: 100 }]);
    run(state, 2, { ...NO_INPUT, move: { x: 1, y: 0 } });
    expect(state.player.pos.x).toBeLessThan(200 - BARRELS.radius);
  });

  it("come back at the start of the next wave", () => {
    const state = withBarrels([{ x: 600, y: 600 }]);
    state.barrels = [];
    state.wave.breakLeft = STEP_SECONDS / 2;
    step(state, NO_INPUT);
    expect(state.barrels).toHaveLength(1);
  });
});

describe("zombies", () => {
  it("walk at the player and bite", () => {
    const state = createState(5, "vanguard", field());
    zombie(state, "walker", 300, 100);
    const before = state.player.health;
    run(state, 8);
    expect(state.player.health).toBeLessThan(before);
    expect(state.events.length + state.damageTaken).toBeGreaterThan(0);
  });

  it("are slower than the player, so running keeps you clear", () => {
    const state = createState(6, "vanguard", field());
    const walker = zombie(state, "walker", 300, 100);
    run(state, 6, { ...NO_INPUT, move: { x: 0, y: 1 } });
    const gap = Math.hypot(walker.pos.x - state.player.pos.x, walker.pos.y - state.player.pos.y);
    expect(gap).toBeGreaterThan(200);
    expect(state.player.health).toBe(state.player.maxHealth);
  });

  it("find their way round a wall to the player", () => {
    // A long wall splits the field with a gap at the bottom. The zombie starts at the top, on the far side.
    const arena = field({ walls: [{ x: 480, y: 0, w: 40, h: 760 }], playerSpawn: { x: 800, y: 300 } });
    const state = noWaves(createState(7, "vanguard", arena));
    const walker = zombie(state, "walker", 200, 300);
    run(state, 40);
    const dist = Math.hypot(walker.pos.x - state.player.pos.x, walker.pos.y - state.player.pos.y);
    expect(dist).toBeLessThan(60);
  });

  it("get out of a room corner they were shoved into", () => {
    const arena = field({
      walls: [
        { x: 0, y: 0, w: 1000, h: 32 },
        { x: 0, y: 0, w: 32, h: 1000 },
      ],
      playerSpawn: { x: 700, y: 700 },
    });
    const state = noWaves(createState(9, "vanguard", arena));
    const walker = zombie(state, "walker", 45, 45);
    run(state, 30);
    expect(Math.hypot(walker.pos.x - state.player.pos.x, walker.pos.y - state.player.pos.y)).toBeLessThan(60);
  });

  it("are moved to a spawn when they are stuck somewhere that cannot be walked out of", () => {
    // Sealed in a box with no way out, nowhere near the player.
    const arena = field({
      walls: [
        { x: 400, y: 400, w: 200, h: 24 },
        { x: 400, y: 600, w: 200, h: 24 },
        { x: 400, y: 400, w: 24, h: 224 },
        { x: 576, y: 400, w: 24, h: 224 },
      ],
    });
    const state = noWaves(createState(11, "vanguard", arena));
    const walker = zombie(state, "walker", 500, 500);
    run(state, 30);
    // It was lifted out of the box: it is now well outside it, and nearer the spawn than the box.
    const inBox = walker.pos.x > 400 && walker.pos.x < 600 && walker.pos.y > 400 && walker.pos.y < 624;
    expect(inBox).toBe(false);
  });

  it("leave a crowd waiting round the player alone: a jam in the fight is not stuck", () => {
    const state = noWaves(createState(13, "vanguard", field()));
    state.player.health = state.player.maxHealth = 1e9;
    const crowd = Array.from({ length: 14 }, (_, n) => zombie(state, "walker", 140 + (n % 7) * 22, 140 + Math.floor(n / 7) * 22));
    run(state, 20);
    for (const walker of crowd) expect(Math.hypot(walker.pos.x - 900, walker.pos.y - 900)).toBeGreaterThan(300);
  });

  it("slide past each other in a narrow lane instead of standing off head-on", () => {
    // A one-zombie-wide corridor, two zombies coming from opposite ends toward a player off to one side.
    const arena = field({
      walls: [
        { x: 200, y: 280, w: 600, h: 24 },
        { x: 200, y: 360, w: 600, h: 24 },
      ],
      playerSpawn: { x: 100, y: 330 },
    });
    const state = noWaves(createState(12, "vanguard", arena));
    const near = zombie(state, "walker", 260, 332);
    const far = zombie(state, "walker", 700, 332);
    run(state, 40);
    expect(Math.hypot(near.pos.x - state.player.pos.x, near.pos.y - state.player.pos.y)).toBeLessThan(60);
    expect(Math.hypot(far.pos.x - state.player.pos.x, far.pos.y - state.player.pos.y)).toBeLessThan(60);
  });

  it("do not walk through walls or each other", () => {
    const arena = field({ walls: [{ x: 480, y: 0, w: 40, h: 760 }], playerSpawn: { x: 800, y: 300 } });
    const state = noWaves(createState(8, "vanguard", arena));
    for (let i = 0; i < 12; i += 1) zombie(state, "walker", 200 + (i % 4) * 10, 280 + Math.floor(i / 4) * 10);
    for (let i = 0; i < 60 * 12; i += 1) {
      step(state, NO_INPUT);
      for (const enemy of state.enemies) expect(enemy.pos.x > 480 && enemy.pos.x < 520 && enemy.pos.y < 760).toBe(false);
    }
  });

  it("hit harder and bite faster on hard", () => {
    const damage = (difficulty: "easy" | "hard") => {
      const state = createState(9, "vanguard", field(), difficulty);
      zombie(state, "walker", state.player.pos.x + 20, state.player.pos.y);
      run(state, 3);
      return state.damageTaken;
    };
    expect(damage("hard")).toBeGreaterThan(damage("easy"));
  });

  it("end the run when the player runs out of health", () => {
    const state = createState(10, "vanguard", field());
    state.player.health = 5;
    zombie(state, "brute", state.player.pos.x + 25, state.player.pos.y);
    run(state, 3);
    expect(state.status).toBe("dead");
    expect(state.player.health).toBe(0);
    expect(state.endedAt).not.toBeNull();
    const time = state.time;
    step(state, NO_INPUT);
    expect(state.time).toBe(time);
  });
});

describe("shooting", () => {
  it("kills a walker in a few pistol shots, and scores it", () => {
    const state = createState(11, "vanguard", field());
    zombie(state, "walker", 400, 100);
    const aim = aimAt(state, 400, 100);
    for (let i = 0; i < 60 * 3 && state.kills === 0; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
    expect(state.kills).toBe(1);
    expect(state.enemies).toHaveLength(0);
    expect(state.score).toBe(ENEMIES.walker.score);
    expect(state.shotsHit).toBe(Math.ceil(ENEMIES.walker.health / WEAPONS.pistol.damage));
  });

  it("is stopped by a wall", () => {
    const arena = field({ walls: [{ x: 250, y: 60, w: 30, h: 100 }] });
    const state = createState(12, "vanguard", arena);
    const walker = zombie(state, "walker", 600, 100);
    walker.pos.x = 600;
    run(state, 2, { ...NO_INPUT, aim: 0, fire: true });
    expect(state.kills).toBe(0);
  });

  it("reloads after a magazine and shoots again", () => {
    const state = createState(13, "vanguard", field());
    const aim = 0;
    let reloaded = false;
    for (let i = 0; i < 60 * 8; i += 1) {
      step(state, { ...NO_INPUT, aim, fire: true });
      if (state.events.some((event) => event.type === "reload")) reloaded = true;
    }
    expect(reloaded).toBe(true);
    expect(state.shotsFired).toBeGreaterThan(WEAPONS.pistol.magazineSize);
  });

  it("shoves a zombie back a little, and a brute less", () => {
    const state = createState(14, "vanguard", field());
    const walker = zombie(state, "walker", 300, 100);
    const brute = zombie(state, "brute", 300, 140);
    const aim = aimAt(state, 300, 100);
    step(state, { ...NO_INPUT, aim, fire: true });
    run(state, 0.3);
    expect(walker.hurt + brute.hurt).toBeGreaterThanOrEqual(0);
  });
});

describe("the streak", () => {
  it("multiplies the score as kills pile up, up to a cap", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(HORDE.comboStep - 1)).toBe(1);
    expect(comboMultiplier(HORDE.comboStep)).toBe(1.5);
    expect(comboMultiplier(HORDE.comboStep * 4)).toBe(3);
    expect(comboMultiplier(10_000)).toBe(HORDE.comboMax);
  });

  it("runs while kills keep coming and ends when they stop", () => {
    const state = createState(15, "vanguard", field());
    state.combo = { count: 7, left: HORDE.comboWindow };
    run(state, HORDE.comboWindow + 0.2);
    expect(state.combo.count).toBe(0);
  });

  it("scores a kill at the streak's multiplier and remembers the best streak", () => {
    const state = createState(16, "vanguard", field());
    state.combo = { count: HORDE.comboStep - 1, left: HORDE.comboWindow };
    const walker = zombie(state, "walker", 300, 100);
    walker.health = 1;
    const aim = aimAt(state, 300, 100);
    for (let i = 0; i < 60 && state.kills === 0; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
    expect(state.score).toBe(Math.round(ENEMIES.walker.score * 1.5));
    expect(state.best.combo).toBe(HORDE.comboStep);
  });
});

/** Gets a run to the point where a card choice is on the table. */
function onTheTable(seed = 20): SimState {
  const state = createState(seed, "vanguard", field());
  state.player.health = state.player.maxHealth = 1e9;
  state.xp.into = state.xp.needed - 1;
  const walker = zombie(state, "walker", 300, 100);
  walker.health = 1;
  const aim = aimAt(state, 300, 100);
  for (let i = 0; i < 120 && state.status === "playing"; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
  return state;
}

describe("leveling up", () => {
  it("pauses the game on three cards when the XP bar fills", () => {
    const state = onTheTable();
    expect(state.status).toBe("perk");
    expect(state.offer?.cards).toHaveLength(3);
    expect(new Set(state.offer?.cards).size).toBe(3);
    expect(state.xp.level).toBe(2);
    const time = state.time;
    step(state, NO_INPUT);
    expect(state.time).toBe(time);
  });

  it("applies the chosen card and carries on", () => {
    const state = onTheTable();
    const pick = state.offer?.cards[1] as string;
    expect(choosePerk(state, 1)).toBe(true);
    expect(state.status).toBe("playing");
    expect(state.offer).toBeNull();
    expect(state.perks[pick]).toBe(1);
  });

  it("does not take a card that is not on the table", () => {
    const state = onTheTable();
    expect(choosePerk(state, 5)).toBe(false);
    expect(state.status).toBe("perk");
  });

  it("lets the hand be redrawn three times, then no more", () => {
    const state = onTheTable();
    for (let i = 0; i < LEVELING.redraws; i += 1) expect(redrawOffer(state)).toBe(true);
    expect(redrawOffer(state)).toBe(false);
    expect(state.redraws).toBe(0);
    expect(state.offer?.cards).toHaveLength(3);
  });

  it("keeps the redraws used up for the rest of the run", () => {
    const state = onTheTable();
    redrawOffer(state);
    skipOffer(state);
    state.xp.into = state.xp.needed - 1;
    state.pendingLevels = 1;
    run(state, 0.1);
    expect(state.status).toBe("perk");
    expect(state.offer?.redraws).toBe(LEVELING.redraws - 1);
  });

  it("can be skipped without taking anything", () => {
    const state = onTheTable();
    expect(skipOffer(state)).toBe(true);
    expect(state.status).toBe("playing");
    expect(Object.keys(state.perks)).toHaveLength(0);
  });

  it("offers one hand after another when several levels land at once", () => {
    const state = onTheTable();
    state.pendingLevels += 1;
    choosePerk(state, 0);
    expect(state.status).toBe("perk");
    choosePerk(state, 0);
    expect(state.status).toBe("playing");
  });

  it("makes Thick Skin raise max health and heal", () => {
    const state = onTheTable();
    state.offer = { cards: ["thick-skin", "leech", "fast-feet"], redraws: 3 };
    state.player.maxHealth = 100;
    state.player.health = 60;
    choosePerk(state, 0);
    expect(state.player.maxHealth).toBe(125);
    expect(state.player.health).toBe(85);
  });

  it("makes Hot Barrel fire faster and Hollow Points hit harder", () => {
    const plain = createState(21, "vanguard", field());
    const tuned = createState(21, "vanguard", field());
    tuned.perks = { "hot-barrel": 2, "hollow-points": 2 };
    const input = { ...NO_INPUT, fire: true };
    step(plain, input);
    step(tuned, input);
    expect(tuned.player.cooldown).toBeLessThan(plain.player.cooldown);
    expect(tuned.projectiles[0].damage).toBeGreaterThan(plain.projectiles[0].damage);
  });

  it("makes Fast Feet speed the player up", () => {
    const plain = createState(22, "vanguard", field());
    const quick = createState(22, "vanguard", field());
    quick.perks = { "fast-feet": 3 };
    run(plain, 1, { ...NO_INPUT, move: { x: 1, y: 0 } });
    run(quick, 1, { ...NO_INPUT, move: { x: 1, y: 0 } });
    expect(quick.player.pos.x).toBeGreaterThan(plain.player.pos.x);
  });

  it("makes Leech heal on a kill and Second Wind heal when left alone", () => {
    const leeched = createState(23, "vanguard", field());
    leeched.perks = { leech: 2 };
    leeched.player.health = 50;
    const walker = zombie(leeched, "walker", 300, 100);
    walker.health = 1;
    const aim = aimAt(leeched, 300, 100);
    for (let i = 0; i < 60 && leeched.kills === 0; i += 1) step(leeched, { ...NO_INPUT, aim, fire: true });
    expect(leeched.player.health).toBeGreaterThan(50);

    const rested = createState(24, "vanguard", field());
    rested.perks = { "second-wind": 2 };
    rested.player.health = 50;
    run(rested, 6);
    expect(rested.player.health).toBeGreaterThan(55);
  });

  it("makes Scavenger bring the next level sooner", () => {
    const gain = (perks: Record<string, number>) => {
      const state = createState(25, "vanguard", field());
      state.perks = perks;
      state.xp.into = 0;
      const walker = zombie(state, "walker", 300, 100);
      walker.health = 1;
      const aim = aimAt(state, 300, 100);
      for (let i = 0; i < 60 && state.kills === 0; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
      return state.xp.into;
    };
    expect(gain({ scavenger: 2 })).toBeGreaterThan(gain({}));
  });

  it("stops offering a card once it has been taken as many times as it allows", () => {
    const state = createState(26, "vanguard", field());
    state.perks = { "second-wind": 3, "fast-feet": 4 };
    state.pendingLevels = 5;
    for (let i = 0; i < 5; i += 1) {
      step(state, NO_INPUT);
      expect(state.offer?.cards).not.toContain("second-wind");
      expect(state.offer?.cards).not.toContain("fast-feet");
      skipOffer(state);
    }
  });
});

describe("gun perks", () => {
  it("make Big Mags hold more rounds, full after a reload", () => {
    const state = createState(60, "vanguard", field());
    state.perks = { "big-mags": 2 };
    const base = WEAPONS.pistol.magazineSize;
    expect(magazineSize(state, WEAPONS.pistol)).toBe(Math.round(base * 1.5));
    state.player.ammo[0] = 0;
    step(state, { ...NO_INPUT, reload: true });
    run(state, WEAPONS.pistol.reloadDuration + 0.2);
    expect(state.player.ammo[0]).toBe(Math.round(base * 1.5));
  });

  it("make Piercing Rounds go through zombies, once per card, and not hit one twice", () => {
    const line = (pierce: number) => {
      const state = createState(61, "vanguard", field());
      state.perks = { piercing: pierce };
      const first = zombie(state, "walker", 250, 100);
      const second = zombie(state, "walker", 300, 100);
      const third = zombie(state, "walker", 350, 100);
      first.health = second.health = third.health = 1000;
      first.maxHealth = second.maxHealth = third.maxHealth = 1000;
      step(state, { ...NO_INPUT, aim: 0, fire: true });
      run(state, 0.4);
      return [first, second, third].filter((enemy) => enemy.health < 1000).length;
    };
    expect(line(0)).toBe(1);
    expect(line(1)).toBe(2);
    expect(line(2)).toBe(3);
  });

  it("hits a pierced zombie only once per bullet", () => {
    const state = createState(62, "vanguard", field());
    state.perks = { piercing: 1 };
    const target = zombie(state, "walker", 250, 100);
    target.health = target.maxHealth = 1000;
    step(state, { ...NO_INPUT, aim: 0, fire: true });
    run(state, 0.5);
    expect(target.maxHealth - target.health).toBe(WEAPONS.pistol.damage);
  });
});

describe("pickups", () => {
  it("heal on touch and then disappear", () => {
    const state = createState(30, "vanguard", field());
    state.player.health = 40;
    state.pickups.push({ id: 900, kind: "health", pos: { ...state.player.pos }, left: 10 });
    step(state, NO_INPUT);
    expect(state.player.health).toBe(40 + PICKUPS.healAmount);
    expect(state.pickups).toHaveLength(0);
    expect(state.events).toContainEqual({ type: "pickup", pos: state.player.pos, kind: "health" });
  });

  it("never heal past full", () => {
    const state = createState(31, "vanguard", field());
    state.pickups.push({ id: 901, kind: "health", pos: { ...state.player.pos }, left: 10 });
    step(state, NO_INPUT);
    expect(state.player.health).toBe(state.player.maxHealth);
  });

  it("fade away if nobody takes them", () => {
    const state = createState(32, "vanguard", field());
    state.pickups.push({ id: 902, kind: "health", pos: { x: 800, y: 800 }, left: 1 });
    run(state, 1.2);
    expect(state.pickups).toHaveLength(0);
  });

  it("make a bomb that kills everything nearby but not far-off zombies", () => {
    const state = createState(33, "vanguard", field());
    zombie(state, "walker", 200, 100);
    zombie(state, "brute", 100, 300);
    const far = zombie(state, "walker", 950, 950);
    state.pickups.push({ id: 903, kind: "bomb", pos: { ...state.player.pos }, left: 10 });
    step(state, NO_INPUT);
    expect(state.enemies).toEqual([far]);
    expect(state.kills).toBe(2);
    expect(state.events.some((event) => event.type === "bomb")).toBe(true);
  });

  it("make frenzy double the fire rate for a while", () => {
    const state = createState(34, "vanguard", field());
    state.pickups.push({ id: 904, kind: "frenzy", pos: { ...state.player.pos }, left: 10 });
    step(state, NO_INPUT);
    expect(state.frenzyLeft).toBeGreaterThan(PICKUPS.frenzySeconds - 0.1);
    const calm = createState(34, "vanguard", field());
    step(calm, { ...NO_INPUT, fire: true });
    step(state, { ...NO_INPUT, fire: true });
    expect(state.player.cooldown).toBeLessThan(calm.player.cooldown);
    run(state, PICKUPS.frenzySeconds + 0.5);
    expect(state.frenzyLeft).toBe(0);
  });

  it("make double points double what a kill scores, for a while", () => {
    const state = createState(36, "vanguard", field());
    state.pickups.push({ id: 905, kind: "double", pos: { ...state.player.pos }, left: 10 });
    step(state, NO_INPUT);
    expect(state.doubleLeft).toBeGreaterThan(PICKUPS.doubleSeconds - 0.1);
    const walker = zombie(state, "walker", 300, 100);
    walker.health = 1;
    const aim = aimAt(state, 300, 100);
    for (let i = 0; i < 60 && state.kills === 0; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
    expect(state.score).toBe(ENEMIES.walker.score * 2);
    run(state, PICKUPS.doubleSeconds + 0.5);
    expect(state.doubleLeft).toBe(0);
  });

  it("make a shield that stops all damage until it runs out", () => {
    const state = createState(37, "vanguard", field());
    state.pickups.push({ id: 906, kind: "shield", pos: { ...state.player.pos }, left: 10 });
    step(state, NO_INPUT);
    zombie(state, "brute", state.player.pos.x + 25, state.player.pos.y);
    run(state, 3);
    expect(state.player.health).toBe(state.player.maxHealth);
    run(state, PICKUPS.shieldSeconds);
    expect(state.player.health).toBeLessThan(state.player.maxHealth);
  });

  it("are taken from farther off with Magnet", () => {
    const place = (perks: Record<string, number>) => {
      const state = createState(38, "vanguard", field());
      state.perks = perks;
      state.pickups.push({ id: 907, kind: "health", pos: { x: state.player.pos.x + 55, y: state.player.pos.y }, left: 10 });
      state.player.health = 10;
      step(state, NO_INPUT);
      return state.pickups.length;
    };
    expect(place({})).toBe(1);
    expect(place({ magnet: 2 })).toBe(0);
  });

  it("always come from a brute", () => {
    const state = createState(35, "vanguard", field());
    const brute = zombie(state, "brute", 300, 100);
    brute.health = 1;
    const aim = aimAt(state, 300, 100);
    for (let i = 0; i < 60 && state.kills === 0; i += 1) step(state, { ...NO_INPUT, aim, fire: true });
    expect(state.pickups).toHaveLength(1);
  });
});

describe("determinism", () => {
  it("plays the same run for the same seed and inputs", () => {
    const play = () => {
      const state = createState(77, "vanguard", ARENA);
      state.player.health = state.player.maxHealth = 1e9;
      startFirstWave(state);
      for (let i = 0; i < 60 * 20; i += 1) step(state, { ...NO_INPUT, aim: (i % 360) * 0.017, fire: i % 3 === 0, move: { x: Math.sin(i / 50), y: Math.cos(i / 70) } });
      return { enemies: state.enemies.map((e) => [e.id, Math.round(e.pos.x), Math.round(e.pos.y)]), score: state.score, kills: state.kills, status: state.status };
    };
    expect(play()).toEqual(play());
  });
});

describe("the real compound", () => {
  it("lets a stationary player get swarmed and killed by the first waves", () => {
    const state = createState(88, "vanguard", ARENA);
    startFirstWave(state);
    run(state, 90);
    expect(state.status).toBe("dead");
    expect(state.wave.number).toBeGreaterThanOrEqual(1);
  });

  it("keeps a moving, shooting player alive through wave 1 on easy", () => {
    const state = createState(89, "vanguard", ARENA, "easy");
    startFirstWave(state);
    const shootNearest = (): PlayerInput => {
      let near: EnemyState | null = null;
      let best = Infinity;
      for (const enemy of state.enemies) {
        const dist = Math.hypot(enemy.pos.x - state.player.pos.x, enemy.pos.y - state.player.pos.y);
        if (dist < best) {
          best = dist;
          near = enemy;
        }
      }
      const away = near ? { x: state.player.pos.x - near.pos.x, y: state.player.pos.y - near.pos.y } : { x: 0, y: 0 };
      const len = Math.hypot(away.x, away.y) || 1;
      return { ...NO_INPUT, aim: near ? aimAt(state, near.pos.x, near.pos.y) : 0, fire: near !== null && best < 400, move: best < 160 ? { x: away.x / len, y: away.y / len } : { x: 0, y: 0 } };
    };
    for (let i = 0; i < 60 * 60 && state.wave.number < 2 && state.status === "playing"; i += 1) step(state, shootNearest());
    expect(state.kills).toBeGreaterThan(5);
  });
});

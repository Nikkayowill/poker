import { mulberry32Step } from "@/lib/seeded-random";
import { ARENA, BARRELS, DEFAULT_DIFFICULTY, DIFFICULTIES, ENEMIES, HORDE, LEVELING, OPERATORS, PERKS, PICKUPS, WEAPONS } from "./content";
import { buildFlow, flowDirection, type FlowField } from "./flow";
import {
  distance,
  lineOfSight,
  resolveCircleAgainstWalls,
  segmentCircleHit,
  segmentClear,
  segmentWallHit,
} from "./geometry";
import { cellOf, navGridFor } from "./pathfinding";
import { drawCards, playerStats, xpNeeded } from "./perks";
import type {
  Arena,
  BarrelState,
  DifficultyDefinition,
  DifficultyId,
  EnemyDefinition,
  EnemyState,
  PickupKind,
  PlayerInput,
  SimState,
  Vec,
  Wall,
  WeaponDefinition,
} from "./types";
import { spawnInterval, waveQueue } from "./waves";

/**
 * The whole fight, with no Phaser in it, so it can be tested and later
 * replayed or checked on the server. `step` mutates the state it is given:
 * the scene calls it 60 times a second and a fresh copy each time would only
 * feed the garbage collector.
 *
 * Waves of zombies walk in from the spawns and head straight for the player.
 * Kills build a streak that multiplies the score and give XP; each level-up
 * pauses the game on three perk cards.
 */

export const STEP_SECONDS = 1 / 60;

const WEAPON_SWAP_DELAY = 0.15;
const PLAYER_HURT_FLASH = 0.15;
const ENEMY_HURT_FLASH = 0.1;
/** Movement input above this counts as walking. */
const MOVING_THRESHOLD = 0.1;
/** A zombie this close with a clear line walks straight at the player instead of following the map. */
const DIRECT_RANGE = 260;
/** How fast a zombie turns to face where it is going, per second. */
const TURN_RATE = 9;
/** The "which way" map is rebuilt when the player changes cell, or at least this often. */
const FLOW_REFRESH = 0.25;
/** A shot pushes a zombie back this far (a brute shrugs most of it off). */
const KNOCKBACK = 5;
/** Zombies lean a little to one side or the other (each its own way), so two meeting head-on slide past instead of standing off. */
const LEAN = 0.15;
/** Only far from the player: close in, a zombie heads straight at them. */
const LEAN_RANGE = 90;
/** A zombie that stays within STUCK_RADIUS of one spot this long, while not yet in reach of the player, is stuck and gets moved to a spawn. */
const STUCK_SECONDS = 6;
const STUCK_RADIUS = 30;
/** Zombies closer than this are in the fight, where a jam is just a crowd waiting its turn, so they are never moved. */
const STUCK_MIN_DISTANCE = 180;
/** Quiet time after a wave is cleared that heals a little, so a clean wave is rewarded. */
const WAVE_HEAL = 10;

export const NO_INPUT: PlayerInput = {
  move: { x: 0, y: 0 },
  aim: 0,
  fire: false,
  reload: false,
  selectWeapon: null,
};

export function createState(
  seed: number,
  operatorId = "vanguard",
  arena: Arena = ARENA,
  difficulty: DifficultyId = DEFAULT_DIFFICULTY,
  /** The guns carried. Defaults to the operator's full kit; rank decides what a real run gets. */
  loadout: string[] = OPERATORS[operatorId]?.startingWeapons ?? [],
): SimState {
  const operator = OPERATORS[operatorId];
  if (!operator) throw new Error(`Unknown operator ${operatorId}`);
  if (loadout.length === 0) throw new Error("A loadout needs at least one weapon");
  const weapons = loadout.map(weaponDef);
  return {
    arena,
    time: 0,
    status: "playing",
    difficulty,
    wave: { number: 0, queue: [], spawnIn: 0, breakLeft: HORDE.startDelay },
    combo: { count: 0, left: 0 },
    best: { combo: 0 },
    xp: { level: 1, into: 0, needed: xpNeeded(1) },
    pendingLevels: 0,
    redraws: LEVELING.redraws,
    offer: null,
    perks: {},
    frenzyLeft: 0,
    doubleLeft: 0,
    shieldLeft: 0,
    player: {
      pos: { ...arena.playerSpawn },
      aim: 0,
      health: operator.maxHealth,
      maxHealth: operator.maxHealth,
      radius: operator.radius,
      moveSpeed: operator.moveSpeed,
      weaponIndex: 0,
      weaponIds: [...loadout],
      ammo: weapons.map((weapon) => weapon.magazineSize),
      reloadLeft: 0,
      cooldown: 0,
      hurt: 0,
      sinceHurt: 99,
      moving: false,
    },
    enemies: [],
    projectiles: [],
    pickups: [],
    barrels: (arena.barrels ?? []).map((pos, home) => ({ id: home + 1, home, pos: { ...pos }, health: BARRELS.health })),
    events: [],
    score: 0,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageTaken: 0,
    endedAt: null,
    rng: seed >>> 0,
    nextId: (arena.barrels?.length ?? 0) + 1,
  };
}

export function difficultyDef(id: DifficultyId): DifficultyDefinition {
  const difficulty = DIFFICULTIES[id];
  if (!difficulty) throw new Error(`Unknown difficulty ${id}`);
  return difficulty;
}

export function weaponDef(id: string): WeaponDefinition {
  const weapon = WEAPONS[id];
  if (!weapon) throw new Error(`Unknown weapon ${id}`);
  return weapon;
}

export function enemyDef(id: string): EnemyDefinition {
  const enemy = ENEMIES[id];
  if (!enemy) throw new Error(`Unknown enemy ${id}`);
  return enemy;
}

export function currentWeapon(state: SimState): WeaponDefinition {
  return weaponDef(state.player.weaponIds[state.player.weaponIndex]);
}

function random(state: SimState): number {
  const [next, value] = mulberry32Step(state.rng);
  state.rng = next;
  return value;
}

/** The score multiplier the streak has earned: 1 to start, half a point more for every few kills. */
export function comboMultiplier(count: number): number {
  return Math.min(HORDE.comboMax, 1 + 0.5 * Math.floor(count / HORDE.comboStep));
}

export function step(state: SimState, input: PlayerInput, dt: number = STEP_SECONDS): void {
  state.events.length = 0;
  if (state.status !== "playing") return;
  state.time += dt;

  const solids = solidsFor(state);
  updatePlayer(state, input, dt, solids);
  updateWaves(state, dt);
  updateEnemies(state, dt);
  updateProjectiles(state, dt);
  updatePickups(state, dt);
  updateStreak(state, dt);
  openOfferIfDue(state);
}

/* ----------------------------------------------------------------- player */

function updatePlayer(state: SimState, input: PlayerInput, dt: number, solids: Wall[]): void {
  const player = state.player;
  const stats = playerStats(state);

  player.aim = input.aim;
  player.hurt = Math.max(0, player.hurt - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.sinceHurt += dt;
  state.frenzyLeft = Math.max(0, state.frenzyLeft - dt);
  state.doubleLeft = Math.max(0, state.doubleLeft - dt);
  state.shieldLeft = Math.max(0, state.shieldLeft - dt);
  if (stats.regen > 0 && player.sinceHurt > 3) player.health = Math.min(player.maxHealth, player.health + stats.regen * dt);

  const wanted = input.selectWeapon;
  if (wanted !== null && wanted >= 0 && wanted < player.weaponIds.length && wanted !== player.weaponIndex) {
    player.weaponIndex = wanted;
    player.reloadLeft = 0;
    player.cooldown = WEAPON_SWAP_DELAY;
  }

  // Diagonals are normalised so they are no faster than straight lines; a
  // half-tilted stick keeps its partial speed.
  let mx = input.move.x;
  let my = input.move.y;
  const length = Math.hypot(mx, my);
  if (length > 1) {
    mx /= length;
    my /= length;
  }
  player.moving = Math.hypot(mx, my) > MOVING_THRESHOLD;
  const speed = player.moveSpeed * stats.speed;
  player.pos.x += mx * speed * dt;
  player.pos.y += my * speed * dt;
  resolveCircleAgainstWalls(player.pos, player.radius, solids);

  const weapon = currentWeapon(state);
  const index = player.weaponIndex;

  if (player.reloadLeft > 0) {
    player.reloadLeft -= dt;
    if (player.reloadLeft <= 0) {
      player.reloadLeft = 0;
      player.ammo[index] = magazineSize(state, weapon);
    }
    return;
  }

  if (input.reload && player.ammo[index] < magazineSize(state, weapon)) {
    startReload(state, weapon);
    return;
  }

  if (input.fire && player.cooldown <= 0) {
    if (player.ammo[index] <= 0) {
      startReload(state, weapon);
      return;
    }
    fireWeapon(state, weapon);
  }
}

/** Rounds in a full magazine, with Big Mags counted. */
export function magazineSize(state: Pick<SimState, "perks" | "frenzyLeft">, weapon: WeaponDefinition): number {
  return Math.round(weapon.magazineSize * playerStats(state).mags);
}

function startReload(state: SimState, weapon: WeaponDefinition): void {
  state.player.reloadLeft = weapon.reloadDuration * playerStats(state).reload;
  state.events.push({ type: "reload" });
}

function fireWeapon(state: SimState, weapon: WeaponDefinition): void {
  const player = state.player;
  const stats = playerStats(state);
  for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
    const angle = player.aim + (random(state) - 0.5) * weapon.spread;
    state.projectiles.push({
      id: state.nextId++,
      pos: { x: player.pos.x, y: player.pos.y },
      vel: { x: Math.cos(angle) * weapon.projectileSpeed, y: Math.sin(angle) * weapon.projectileSpeed },
      damage: weapon.damage * stats.damage,
      travelled: 0,
      maxRange: weapon.range,
      pierce: stats.pierce,
      hit: [],
    });
  }
  state.shotsFired += weapon.pellets;
  player.ammo[player.weaponIndex] -= 1;
  player.cooldown = 1 / (weapon.fireRate * stats.fireRate);
  state.events.push({ type: "shot", from: "player", pos: { x: player.pos.x, y: player.pos.y } });
  if (player.ammo[player.weaponIndex] <= 0) startReload(state, weapon);
}

function damagePlayer(state: SimState, amount: number, at: Vec): void {
  const player = state.player;
  if (state.shieldLeft > 0) return;
  player.health -= amount;
  player.hurt = PLAYER_HURT_FLASH;
  player.sinceHurt = 0;
  state.damageTaken += amount;
  state.events.push({ type: "hit", pos: { x: at.x, y: at.y }, target: "player" });
  if (player.health <= 0) {
    player.health = 0;
    state.status = "dead";
    state.endedAt = state.time;
    state.events.push({ type: "dead" });
  }
}

/* ------------------------------------------------------------------ waves */

function updateWaves(state: SimState, dt: number): void {
  const wave = state.wave;
  if (wave.breakLeft > 0) {
    wave.breakLeft -= dt;
    if (wave.breakLeft <= 0) startWave(state);
    return;
  }
  if (wave.queue.length > 0) {
    wave.spawnIn -= dt;
    if (wave.spawnIn <= 0) {
      spawnBatch(state);
      wave.spawnIn = spawnInterval(wave.number);
    }
    return;
  }
  if (state.enemies.length === 0) {
    const bonus = HORDE.waveBonus * wave.number;
    state.score += bonus;
    state.events.push({ type: "waveclear", number: wave.number, bonus });
    state.player.health = Math.min(state.player.maxHealth, state.player.health + WAVE_HEAL);
    wave.breakLeft = HORDE.breakSeconds;
  }
}

function startWave(state: SimState): void {
  const wave = state.wave;
  wave.number += 1;
  wave.queue = waveQueue(wave.number, difficultyDef(state.difficulty).horde, () => random(state));
  wave.spawnIn = 0.4;
  restockBarrels(state);
  state.events.push({ type: "wave", number: wave.number });
}

/** The spawns far enough away to come in unseen, or failing that the farthest one. */
function pickSpawn(state: SimState): Vec {
  const { spawns, walls } = state.arena;
  const player = state.player.pos;
  const far = spawns.filter((spawn) => distance(spawn, player) >= HORDE.spawnMinDistance);
  const hidden = far.filter((spawn) => !lineOfSight(spawn, player, walls));
  const pool = hidden.length > 0 ? hidden : far;
  if (pool.length > 0) return pool[Math.floor(random(state) * pool.length)];
  return spawns.reduce((best, spawn) => (distance(spawn, player) > distance(best, player) ? spawn : best), spawns[0]);
}

function spawnBatch(state: SimState): void {
  const wave = state.wave;
  const room = HORDE.maxAlive - state.enemies.length;
  if (room <= 0) return;
  const want = HORDE.batch.min + Math.floor(random(state) * (HORDE.batch.max - HORDE.batch.min + 1));
  const count = Math.min(want, wave.queue.length, room);
  const at = pickSpawn(state);
  for (let i = 0; i < count; i += 1) {
    const defId = wave.queue.shift();
    if (!defId) break;
    const def = enemyDef(defId);
    const angle = random(state) * Math.PI * 2;
    const pos = { x: at.x + Math.cos(angle) * 22 * i, y: at.y + Math.sin(angle) * 22 * i };
    resolveCircleAgainstWalls(pos, def.radius, state.arena.walls);
    const health = Math.round(def.health * Math.min(HORDE.healthCap, 1 + HORDE.healthPerWave * (wave.number - 1)));
    state.enemies.push({
      id: state.nextId++,
      defId,
      pos,
      facing: Math.atan2(state.player.pos.y - pos.y, state.player.pos.x - pos.x),
      health,
      maxHealth: health,
      cooldown: 0.5,
      hurt: 0,
    });
  }
}

/* ---------------------------------------------------------------- zombies */

interface FlowCache {
  field: FlowField | null;
  cell: number;
  age: number;
}

const flowCaches = new WeakMap<SimState, FlowCache>();

/** The shared map to the player, rebuilt only when it has gone stale. */
function flowFor(state: SimState, dt: number): FlowField {
  const grid = navGridFor(state.arena);
  let cache = flowCaches.get(state);
  if (!cache) {
    cache = { field: null, cell: -1, age: 0 };
    flowCaches.set(state, cache);
  }
  cache.age += dt;
  const cell = cellOf(grid, state.player.pos);
  if (!cache.field || cell !== cache.cell || cache.age > FLOW_REFRESH) {
    cache.field = buildFlow(grid, state.player.pos, cache.field ?? undefined);
    cache.cell = cell;
    cache.age = 0;
  }
  return cache.field;
}

function updateEnemies(state: SimState, dt: number): void {
  if (state.enemies.length === 0) return;
  const { player, arena } = state;
  const difficulty = difficultyDef(state.difficulty);
  const field = flowFor(state, dt);

  for (const enemy of state.enemies) {
    const def = enemyDef(enemy.defId);
    enemy.hurt = Math.max(0, enemy.hurt - dt);
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);

    const dx = player.pos.x - enemy.pos.x;
    const dy = player.pos.y - enemy.pos.y;
    const dist = Math.hypot(dx, dy);
    const reach = def.radius + player.radius + def.attackRange;

    // Straight at the player when it can, otherwise along the shared map.
    let heading = Math.atan2(dy, dx);
    if (dist > DIRECT_RANGE || !segmentClear(enemy.pos, player.pos, def.radius, arena.walls)) {
      const way = flowDirection(field, enemy.pos);
      if (way) heading = Math.atan2(way.y, way.x);
    }
    if (dist > reach + LEAN_RANGE) heading += (((enemy.id * 37) % 7) - 3) * (LEAN / 3);
    const turn = Math.atan2(Math.sin(heading - enemy.facing), Math.cos(heading - enemy.facing));
    enemy.facing += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, turn));

    if (dist > reach) {
      const speed = def.moveSpeed * difficulty.speed;
      enemy.pos.x += Math.cos(enemy.facing) * speed * dt;
      enemy.pos.y += Math.sin(enemy.facing) * speed * dt;
    } else if (enemy.cooldown <= 0) {
      damagePlayer(state, def.damage * difficulty.damage, enemy.pos);
      enemy.cooldown = 1 / def.fireRate;
      if (state.status !== "playing") return;
    }
  }
  separateEnemies(state);
  freeStuckZombies(state, dt);
}

/**
 * Last resort for a zombie wedged somewhere the steering cannot fix (it can circle in place at full speed, so
 * speed tells nothing): one that has not got out of a small circle for a few seconds while still far from the
 * player is picked up and put at a spawn, as zombie games do. Without it a single stuck zombie would hold a
 * whole wave open for good.
 */
function freeStuckZombies(state: SimState, dt: number): void {
  const { player } = state;
  for (const enemy of state.enemies) {
    const def = enemyDef(enemy.defId);
    const outOfReach = distance(enemy.pos, player.pos) > STUCK_MIN_DISTANCE;
    if (!outOfReach || !enemy.anchor || distance(enemy.pos, enemy.anchor) > STUCK_RADIUS) {
      enemy.anchor = { x: enemy.pos.x, y: enemy.pos.y };
      enemy.stuck = 0;
      continue;
    }
    enemy.stuck = (enemy.stuck ?? 0) + dt;
    if (enemy.stuck < STUCK_SECONDS) continue;
    const at = pickSpawn(state);
    enemy.pos = { x: at.x, y: at.y };
    resolveCircleAgainstWalls(enemy.pos, def.radius, state.arena.walls);
    enemy.anchor = { x: enemy.pos.x, y: enemy.pos.y };
    enemy.stuck = 0;
  }
}

/** Zombies shoulder each other apart, and none walks through the player. */
function separateEnemies(state: SimState): void {
  const { enemies, player } = state;
  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i];
    const ra = enemyDef(a.defId).radius;
    for (let j = i + 1; j < enemies.length; j += 1) {
      const b = enemies[j];
      const min = ra + enemyDef(b.defId).radius;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
      const dist = Math.hypot(dx, dy);
      if (dist >= min) continue;
      // Exactly stacked: separate along a fixed axis rather than divide by zero.
      const nx = dist > 1e-6 ? dx / dist : 1;
      const ny = dist > 1e-6 ? dy / dist : 0;
      const half = (min - dist) / 2;
      a.pos.x -= nx * half;
      a.pos.y -= ny * half;
      b.pos.x += nx * half;
      b.pos.y += ny * half;
    }
    const dx = a.pos.x - player.pos.x;
    const dy = a.pos.y - player.pos.y;
    const dist = Math.hypot(dx, dy);
    const min = ra + player.radius;
    if (dist < min && dist > 1e-6) {
      a.pos.x = player.pos.x + (dx / dist) * min;
      a.pos.y = player.pos.y + (dy / dist) * min;
    }
  }
  for (const enemy of enemies) resolveCircleAgainstWalls(enemy.pos, enemyDef(enemy.defId).radius, state.arena.walls);
}

function damageEnemy(state: SimState, enemy: EnemyState, amount: number, at: Vec, push: Vec | null): void {
  const def = enemyDef(enemy.defId);
  enemy.health -= amount;
  enemy.hurt = ENEMY_HURT_FLASH;
  state.events.push({ type: "hit", pos: { x: at.x, y: at.y }, target: "enemy" });
  if (push && enemy.health > 0) {
    // Heavier zombies get shoved less.
    const shove = (KNOCKBACK * 13) / def.radius;
    enemy.pos.x += push.x * shove;
    enemy.pos.y += push.y * shove;
  }
  if (enemy.health <= 0) kill(state, enemy);
}

function kill(state: SimState, enemy: EnemyState): void {
  const def = enemyDef(enemy.defId);
  const stats = playerStats(state);

  state.combo.count += 1;
  state.combo.left = HORDE.comboWindow;
  state.best.combo = Math.max(state.best.combo, state.combo.count);
  const points = Math.round(def.score * comboMultiplier(state.combo.count) * (state.doubleLeft > 0 ? 2 : 1));
  state.score += points;
  state.kills += 1;
  state.events.push({ type: "kill", pos: { x: enemy.pos.x, y: enemy.pos.y }, defId: enemy.defId, points });
  if (def.burst) burstZombie(state, enemy, def.burst);

  if (stats.leech > 0) state.player.health = Math.min(state.player.maxHealth, state.player.health + stats.leech);
  if (random(state) < Math.min(1, def.dropChance * stats.drops)) dropPickup(state, enemy.pos);
  gainXp(state, def.xp * stats.xp);
}

/** A bloater bursts: nearby zombies take the blast (and may burst too), and so does the player if they were too close. */
function burstZombie(state: SimState, source: EnemyState, burst: { radius: number; damage: number }): void {
  state.events.push({ type: "burst", pos: { x: source.pos.x, y: source.pos.y }, radius: burst.radius });
  for (const other of state.enemies) {
    if (other === source || other.health <= 0) continue;
    const reach = distance(other.pos, source.pos);
    if (reach > burst.radius) continue;
    damageEnemy(state, other, burst.damage * (1 - 0.5 * (reach / burst.radius)), other.pos, null);
  }
  const away = distance(state.player.pos, source.pos);
  if (away <= burst.radius && state.status === "playing") {
    damagePlayer(state, burst.damage * (1 - 0.5 * (away / burst.radius)), source.pos);
  }
}

function dropPickup(state: SimState, at: Vec): void {
  const entries = Object.entries(PICKUPS.weights) as [PickupKind, number][];
  let roll = random(state) * entries.reduce((sum, [, weight]) => sum + weight, 0);
  let kind = entries[0][0];
  for (const [candidate, weight] of entries) {
    kind = candidate;
    if (roll < weight) break;
    roll -= weight;
  }
  state.pickups.push({ id: state.nextId++, kind, pos: { x: at.x, y: at.y }, left: PICKUPS.life });
}

/* --------------------------------------------------------- xp and perks */

function gainXp(state: SimState, amount: number): void {
  const xp = state.xp;
  xp.into += amount;
  while (xp.into >= xp.needed) {
    xp.into -= xp.needed;
    xp.level += 1;
    xp.needed = xpNeeded(xp.level);
    state.pendingLevels += 1;
    state.events.push({ type: "levelup", level: xp.level });
  }
}

/** Pauses the game on a fresh hand of cards when a level-up is waiting for one. */
function openOfferIfDue(state: SimState): void {
  if (state.status !== "playing" || state.offer || state.pendingLevels <= 0) return;
  const cards = drawCards(state, () => random(state));
  if (cards.length === 0) {
    state.pendingLevels = 0;
    return;
  }
  state.offer = { cards, redraws: state.redraws };
  state.status = "perk";
}

function closeOffer(state: SimState): void {
  state.offer = null;
  state.pendingLevels = Math.max(0, state.pendingLevels - 1);
  state.status = "playing";
  openOfferIfDue(state);
}

/** Takes the card at `index` of the hand on the table. Returns false if there is no such card. */
export function choosePerk(state: SimState, index: number): boolean {
  if (state.status !== "perk" || !state.offer) return false;
  const id = state.offer.cards[index];
  const perk = id ? PERKS[id] : undefined;
  if (!perk) return false;
  state.perks[id] = (state.perks[id] ?? 0) + 1;
  const player = state.player;
  if (id === "thick-skin") {
    player.maxHealth += 25;
    player.health = Math.min(player.maxHealth, player.health + 25);
  } else if (id === "frenzy") {
    state.frenzyLeft = PICKUPS.frenzySeconds;
  } else if (id === "nuke") {
    explode(state, player.pos);
  }
  closeOffer(state);
  return true;
}

/** Throws the hand back for a new one. Three a run. */
export function redrawOffer(state: SimState): boolean {
  if (state.status !== "perk" || !state.offer || state.redraws <= 0) return false;
  state.redraws -= 1;
  state.offer = { cards: drawCards(state, () => random(state), state.offer.cards), redraws: state.redraws };
  return true;
}

/** Leaves the cards on the table and carries on. */
export function skipOffer(state: SimState): boolean {
  if (state.status !== "perk" || !state.offer) return false;
  closeOffer(state);
  return true;
}

/* ------------------------------------------------------------- projectiles */

function updateProjectiles(state: SimState, dt: number): void {
  const survivors: SimState["projectiles"] = [];

  for (const shot of state.projectiles) {
    const speed = Math.hypot(shot.vel.x, shot.vel.y);
    const stepLength = Math.min(speed * dt, shot.maxRange - shot.travelled);
    const scale = speed > 0 ? stepLength / speed : 0;
    const from = shot.pos;
    const to = { x: from.x + shot.vel.x * scale, y: from.y + shot.vel.y * scale };

    // The nearest thing along this step wins, so a wall shields what is behind it.
    let wallT = Infinity;
    for (const wall of state.arena.walls) {
      const t = segmentWallHit(from, to, wall);
      if (t !== null && t < wallT) wallT = t;
    }

    let targetT = Infinity;
    let hit: EnemyState | null = null;
    for (const enemy of state.enemies) {
      if (enemy.health <= 0 || shot.hit?.includes(enemy.id)) continue;
      const t = segmentCircleHit(from, to, enemy.pos, enemyDef(enemy.defId).radius);
      if (t !== null && t < targetT) {
        targetT = t;
        hit = enemy;
      }
    }

    let barrelT = Infinity;
    let barrelHit: BarrelState | null = null;
    for (const barrel of state.barrels) {
      const t = segmentCircleHit(from, to, barrel.pos, BARRELS.radius);
      if (t !== null && t < barrelT) {
        barrelT = t;
        barrelHit = barrel;
      }
    }

    if (barrelHit && barrelT < wallT && barrelT <= targetT) {
      barrelHit.health -= shot.damage;
      if (barrelHit.health <= 0) popBarrel(state, barrelHit);
      continue;
    }
    if (wallT <= targetT && wallT !== Infinity) {
      state.events.push({ type: "wall", pos: { x: from.x + (to.x - from.x) * wallT, y: from.y + (to.y - from.y) * wallT } });
      continue;
    }
    if (hit) {
      const at = { x: from.x + (to.x - from.x) * targetT, y: from.y + (to.y - from.y) * targetT };
      state.shotsHit += 1;
      damageEnemy(state, hit, shot.damage * enemyDef(hit.defId).armor, at, { x: shot.vel.x / speed, y: shot.vel.y / speed });
      if ((shot.pierce ?? 0) > 0) {
        // Through and on: it keeps flying a little weaker, and cannot hit the same one twice.
        shot.pierce = (shot.pierce ?? 0) - 1;
        shot.hit = [...(shot.hit ?? []), hit.id];
        shot.damage *= 0.75;
      } else {
        continue;
      }
    }

    shot.pos = to;
    shot.travelled += stepLength;
    if (shot.travelled < shot.maxRange) survivors.push(shot);
  }

  state.projectiles = survivors;
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
}

/* ----------------------------------------------------------------- barrels */

const solidCache = new WeakMap<SimState, { barrels: SimState["barrels"]; count: number; walls: Wall[] }>();

/**
 * The walls plus a round wall for every barrel standing, so the player walks round barrels. Zombies do not:
 * they steer by a map that knows nothing of barrels and would wedge against one, stalling a wave.
 */
function solidsFor(state: SimState): Wall[] {
  if (state.barrels.length === 0) return state.arena.walls;
  const cached = solidCache.get(state);
  if (cached && cached.barrels === state.barrels && cached.count === state.barrels.length) return cached.walls;
  const walls: Wall[] = [...state.arena.walls, ...state.barrels.map((barrel) => ({ x: barrel.pos.x, y: barrel.pos.y, r: BARRELS.radius }))];
  solidCache.set(state, { barrels: state.barrels, count: state.barrels.length, walls });
  return walls;
}

/** Puts back every barrel that was blown up since the last wave. */
function restockBarrels(state: SimState): void {
  const spots = state.arena.barrels ?? [];
  const standing = new Set(state.barrels.map((barrel) => barrel.home));
  const fresh = spots
    .map((pos, home) => ({ pos, home }))
    .filter(({ pos, home }) => !standing.has(home) && distance(pos, state.player.pos) > 60 && !state.enemies.some((enemy) => distance(enemy.pos, pos) < 40));
  if (fresh.length === 0) return;
  state.barrels = [
    ...state.barrels,
    ...fresh.map(({ pos, home }) => ({ id: state.nextId++, home, pos: { ...pos }, health: BARRELS.health })),
  ];
}

/** A barrel goes up: zombies and the player in the blast are hurt, and any barrel in reach goes up with it. */
function popBarrel(state: SimState, barrel: BarrelState): void {
  state.barrels = state.barrels.filter((other) => other !== barrel);
  state.events.push({ type: "barrel", pos: { x: barrel.pos.x, y: barrel.pos.y } });
  for (const enemy of state.enemies) {
    if (enemy.health <= 0) continue;
    const reach = distance(enemy.pos, barrel.pos);
    if (reach > BARRELS.blastRadius) continue;
    damageEnemy(state, enemy, BARRELS.zombieDamage * (1 - 0.5 * (reach / BARRELS.blastRadius)), enemy.pos, null);
  }
  const player = state.player;
  const away = distance(player.pos, barrel.pos);
  if (away <= BARRELS.blastRadius && state.status === "playing") {
    damagePlayer(state, Math.max(BARRELS.playerFloor, BARRELS.playerDamage * (1 - away / BARRELS.blastRadius)), barrel.pos);
  }
  for (const other of [...state.barrels]) {
    if (distance(other.pos, barrel.pos) <= BARRELS.blastRadius) popBarrel(state, other);
  }
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
}

/* ---------------------------------------------------------------- pickups */

/** Blows up every zombie within the bomb's reach. */
function explode(state: SimState, at: Vec): void {
  state.events.push({ type: "bomb", pos: { x: at.x, y: at.y } });
  for (const enemy of state.enemies) {
    if (enemy.health <= 0 || distance(enemy.pos, at) > PICKUPS.bombRadius) continue;
    damageEnemy(state, enemy, PICKUPS.bombDamage, enemy.pos, null);
  }
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
}

function updatePickups(state: SimState, dt: number): void {
  const player = state.player;
  const reach = PICKUPS.radius * playerStats(state).magnet + player.radius;
  const kept: SimState["pickups"] = [];
  for (const pickup of state.pickups) {
    pickup.left -= dt;
    if (pickup.left <= 0) continue;
    if (distance(pickup.pos, player.pos) > reach) {
      kept.push(pickup);
      continue;
    }
    state.events.push({ type: "pickup", pos: { ...pickup.pos }, kind: pickup.kind });
    if (pickup.kind === "health") player.health = Math.min(player.maxHealth, player.health + PICKUPS.healAmount);
    else if (pickup.kind === "frenzy") state.frenzyLeft = PICKUPS.frenzySeconds;
    else if (pickup.kind === "double") state.doubleLeft = PICKUPS.doubleSeconds;
    else if (pickup.kind === "shield") state.shieldLeft = PICKUPS.shieldSeconds;
    else explode(state, player.pos);
  }
  state.pickups = kept;
}

function updateStreak(state: SimState, dt: number): void {
  if (state.combo.count === 0) return;
  state.combo.left -= dt;
  if (state.combo.left <= 0) state.combo = { count: 0, left: 0 };
}

export function accuracy(state: SimState): number {
  return state.shotsFired === 0 ? 0 : state.shotsHit / state.shotsFired;
}

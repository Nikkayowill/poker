import { mulberry32Step } from "@/lib/seeded-random";
import {
  ARENA,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  ENEMIES,
  MISSION,
  OPERATORS,
  SHADOW,
  STEALTH,
  WEAPONS,
} from "./content";
import {
  distance,
  lineOfSight,
  resolveCircleAgainstRects,
  segmentCircleHit,
  segmentClear,
  segmentRectHit,
} from "./geometry";
import { findPath, navGridFor } from "./pathfinding";
import type {
  Arena,
  DifficultyDefinition,
  DifficultyId,
  EnemyDefinition,
  EnemyState,
  Guard,
  PlayerInput,
  SimState,
  Vec,
  WeaponDefinition,
} from "./types";
import { angleDiff, coverAt } from "./vision";

/**
 * The whole fight, with no Phaser in it, so it can be tested and later
 * replayed or checked on the server. `step` mutates the state it is given:
 * the scene calls it 60 times a second and a fresh copy each time would only
 * feed the garbage collector.
 */

export const STEP_SECONDS = 1 / 60;

const WEAPON_SWAP_DELAY = 0.15;
const PLAYER_HURT_FLASH = 0.15;
const ENEMY_HURT_FLASH = 0.1;
/** Enemies stop walking to a spot this close to it. */
const ARRIVE_DISTANCE = 14;
/** Faster than the usual turn, for an enemy that has just glimpsed something. */
const STARE_TURN_RATE = 10;
/** Movement input above this counts as walking, for stealth. */
const MOVING_THRESHOLD = 0.1;

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
): SimState {
  const operator = OPERATORS[operatorId];
  if (!operator) throw new Error(`Unknown operator ${operatorId}`);
  const weapons = operator.startingWeapons.map(weaponDef);
  const state: SimState = {
    arena,
    time: 0,
    status: "playing",
    difficulty,
    loot: arena.loot.map((spot) => ({ spot, taken: false })),
    hasGold: false,
    player: {
      pos: { ...arena.playerSpawn },
      aim: 0,
      health: operator.maxHealth,
      maxHealth: operator.maxHealth,
      radius: operator.radius,
      moveSpeed: operator.moveSpeed,
      weaponIndex: 0,
      weaponIds: [...operator.startingWeapons],
      ammo: weapons.map((weapon) => weapon.magazineSize),
      reloadLeft: 0,
      cooldown: 0,
      hurt: 0,
      hidden: false,
      cover: 0,
      exposedLeft: 0,
      moving: false,
    },
    enemies: [],
    projectiles: [],
    events: [],
    score: 0,
    kills: 0,
    timesSpotted: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageTaken: 0,
    endedAt: null,
    rng: seed >>> 0,
    nextId: 1,
  };
  const tier = difficultyDef(difficulty).tier;
  for (const guard of arena.guards) {
    if (guard.tier <= tier) state.enemies.push(guardState(state, guard));
  }
  return state;
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

export function step(state: SimState, input: PlayerInput, dt: number = STEP_SECONDS): void {
  state.events.length = 0;
  if (state.status !== "playing") return;
  state.time += dt;

  updatePlayer(state, input, dt);
  updateEnemies(state, dt);
  updateProjectiles(state, dt);
  updateMission(state);
}

/* ----------------------------------------------------------------- player */

function updatePlayer(state: SimState, input: PlayerInput, dt: number): void {
  const player = state.player;
  const radius = player.radius;

  player.aim = input.aim;
  player.hurt = Math.max(0, player.hurt - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);

  player.exposedLeft = Math.max(0, player.exposedLeft - dt);

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
  player.pos.x += mx * player.moveSpeed * dt;
  player.pos.y += my * player.moveSpeed * dt;
  resolveCircleAgainstRects(player.pos, radius, state.arena.walls);
  updateShadow(state);

  const weapon = currentWeapon(state);
  const index = player.weaponIndex;

  if (player.reloadLeft > 0) {
    player.reloadLeft -= dt;
    if (player.reloadLeft <= 0) {
      player.reloadLeft = 0;
      player.ammo[index] = weapon.magazineSize;
    }
    return;
  }

  if (input.reload && player.ammo[index] < weapon.magazineSize) {
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

/** Hidden means pressed into a dark corner and not just fired a shot. */
function updateShadow(state: SimState): void {
  const player = state.player;
  player.cover = coverAt(player.pos, state.arena.walls);
  const hidden = player.exposedLeft <= 0 && player.cover >= SHADOW.hiddenAt;
  if (hidden !== player.hidden) {
    player.hidden = hidden;
    state.events.push({ type: "hide", on: hidden });
  }
}

function startReload(state: SimState, weapon: WeaponDefinition): void {
  state.player.reloadLeft = weapon.reloadDuration;
  state.events.push({ type: "reload" });
}

function fireWeapon(state: SimState, weapon: WeaponDefinition): void {
  const player = state.player;
  for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
    const angle = player.aim + (random(state) - 0.5) * weapon.spread;
    state.projectiles.push({
      id: state.nextId++,
      pos: { x: player.pos.x, y: player.pos.y },
      vel: { x: Math.cos(angle) * weapon.projectileSpeed, y: Math.sin(angle) * weapon.projectileSpeed },
      damage: weapon.damage,
      from: "player",
      travelled: 0,
      maxRange: weapon.range,
    });
  }
  state.shotsFired += weapon.pellets;
  hearShot(state);
  player.exposedLeft = SHADOW.exposedSeconds;
  player.hidden = false;
  player.ammo[player.weaponIndex] -= 1;
  player.cooldown = 1 / weapon.fireRate;
  state.events.push({ type: "shot", from: "player", pos: { x: player.pos.x, y: player.pos.y } });
  if (player.ammo[player.weaponIndex] <= 0) startReload(state, weapon);
}

function damagePlayer(state: SimState, amount: number, at: Vec): void {
  const player = state.player;
  player.health -= amount;
  player.hurt = PLAYER_HURT_FLASH;
  state.damageTaken += amount;
  state.events.push({ type: "hit", pos: { x: at.x, y: at.y }, target: "player" });
  if (player.health <= 0) {
    player.health = 0;
    state.status = "dead";
    state.endedAt = state.time;
    state.events.push({ type: "dead" });
  }
}

/* ---------------------------------------------------------------- enemies */

function isAlert(enemy: EnemyState): boolean {
  return enemy.mode === "chase" || enemy.mode === "attack";
}

/**
 * How fast this enemy's awareness fills right now, as a multiplier on
 * 1 / detectSeconds. Zero means it cannot see the player at all. The enemy's
 * flashlight is its eyes: the player has to be inside the beam (in range, in
 * the cone, nothing in the way) for the meter to move. A player in a dark
 * corner is nearly invisible unless someone walks up to them, and creeping up
 * behind a sweep works. Enemies already in the fight track farther and ignore
 * facing.
 */
export function perceive(state: SimState, enemy: EnemyState, def: EnemyDefinition): number {
  const player = state.player;
  const alert = isAlert(enemy);
  const dist = distance(enemy.pos, player.pos);

  let range = def.detectionRange * (alert ? STEALTH.alertRangeBonus : 1);
  if (player.hidden) range = Math.min(range, STEALTH.hideRange);
  if (dist > range) return 0;
  if (!lineOfSight(enemy.pos, player.pos, state.arena.walls)) return 0;

  if (!alert && dist > STEALTH.closeNotice) {
    const toPlayer = Math.atan2(player.pos.y - enemy.pos.y, player.pos.x - enemy.pos.x);
    if (Math.abs(angleDiff(enemy.facing, toPlayer)) > def.fieldOfView) return 0;
  }

  // Someone walking right up to a hiding player finds them.
  if (player.hidden && dist <= STEALTH.hideCheckRange) return STEALTH.hideCheckFill;

  const span = Math.max(1, range - STEALTH.closeNotice);
  const far = Math.min(1, Math.max(0, (dist - STEALTH.closeNotice) / span));
  let fill = STEALTH.closeFill + (STEALTH.farFill - STEALTH.closeFill) * far;
  if (!player.moving) fill *= STEALTH.stillFill;
  if (player.hidden) fill *= STEALTH.hideFill;
  return fill;
}

/** True if this enemy can see the player right now, whether or not it has yet noticed. */
export function enemySees(state: SimState, enemy: EnemyState, def: EnemyDefinition): boolean {
  return perceive(state, enemy, def) > 0;
}

function turnToward(enemy: EnemyState, angle: number, rate: number, dt: number): void {
  const diff = angleDiff(enemy.facing, angle);
  const turn = Math.min(Math.abs(diff), rate * dt);
  enemy.facing += Math.sign(diff) * turn;
}

/** An enemy has the player: hunt them, and tell the friends nearby. */
function spot(state: SimState, enemy: EnemyState): void {
  const player = state.player;
  const def = enemyDef(enemy.defId);
  const wasAlert = isAlert(enemy);
  enemy.awareness = 1;
  enemy.lastKnown = { x: player.pos.x, y: player.pos.y };
  enemy.investigate = null;
  enemy.queue = [];
  enemy.searchLeft = 0;
  enemy.patrolTarget = null;
  enemy.mode = "chase";
  if (wasAlert) return;
  enemy.reaction = def.reactionTime;
  state.timesSpotted += 1;
  state.events.push({ type: "spotted", pos: { x: enemy.pos.x, y: enemy.pos.y } });

  // The squad standing near sees it too and knows at once. Everyone else has to be told by radio.
  for (const other of state.enemies) {
    if (other === enemy || isAlert(other)) continue;
    if (distance(other.pos, enemy.pos) > STEALTH.squadRange) continue;
    alarm(state, other, STEALTH.calloutAwareness, player.pos, STEALTH.noiseScatter / 2);
  }
  enemy.radio = { left: STEALTH.radioSeconds, pos: { x: player.pos.x, y: player.pos.y } };
}

/** Sends an enemy to look at a spot, without telling it where the player really is. */
function alarm(state: SimState, enemy: EnemyState, awareness: number, at: Vec, scatter: number): void {
  enemy.awareness = Math.max(enemy.awareness, awareness);
  enemy.investigate = jitter(state, at, scatter);
  enemy.queue = [];
  enemy.patrolTarget = null;
  enemy.searchLeft = 0;
}

/** Counts a radio call down. If the spotter is still alive when it ends, every calm enemy is sent to the spot. */
function updateRadio(state: SimState, enemy: EnemyState, dt: number): void {
  const call = enemy.radio;
  if (!call) return;
  call.left -= dt;
  if (call.left > 0) return;
  enemy.radio = null;
  const at = enemy.lastKnown ?? call.pos;
  for (const other of state.enemies) {
    if (other === enemy || isAlert(other)) continue;
    alarm(state, other, STEALTH.radioAwareness, at, STEALTH.radioScatter);
  }
  state.events.push({ type: "radio", pos: { x: enemy.pos.x, y: enemy.pos.y } });
}

function jitter(state: SimState, at: Vec, scatter: number): Vec {
  return { x: at.x + (random(state) - 0.5) * scatter, y: at.y + (random(state) - 0.5) * scatter };
}

/** The guns are silenced, so only enemies close by hear a shot, and less through a wall. They go and look, but are not told where the player is. */
function hearShot(state: SimState): void {
  for (const enemy of state.enemies) {
    if (isAlert(enemy)) continue;
    const walled = !lineOfSight(enemy.pos, state.player.pos, state.arena.walls);
    if (distance(enemy.pos, state.player.pos) > STEALTH.hearRange * (walled ? 0.5 : 1)) continue;
    alarm(state, enemy, STEALTH.noiseAwareness, state.player.pos, STEALTH.noiseScatter);
  }
}

/** A bullet that flies past an enemy without hitting it puts that enemy on alert. */
function whizzPast(state: SimState, from: Vec, to: Vec, except: EnemyState | null): void {
  for (const enemy of state.enemies) {
    if (enemy === except || enemy.health <= 0 || isAlert(enemy)) continue;
    const reach = enemyDef(enemy.defId).radius + STEALTH.nearMissRange;
    if (segmentCircleHit(from, to, enemy.pos, reach) === null) continue;
    alarm(state, enemy, STEALTH.nearMissAwareness, state.player.pos, STEALTH.nearMissScatter);
  }
}

/** The dark corners an enemy that just lost the player should look in, nearest first. */
function nooksNear(state: SimState, at: Vec): Vec[] {
  return state.arena.corners
    .filter((centre) => distance(centre, at) <= STEALTH.nookCheckRadius)
    .sort((a, b) => distance(a, at) - distance(b, at))
    .slice(0, 2);
}

function updateEnemies(state: SimState, dt: number): void {
  const player = state.player;
  const walls = state.arena.walls;
  const pr = player.radius;
  const difficulty = difficultyDef(state.difficulty);

  for (const enemy of state.enemies) {
    const def = enemyDef(enemy.defId);
    enemy.hurt = Math.max(0, enemy.hurt - dt);
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    updateRadio(state, enemy, dt);

    const dist = distance(enemy.pos, player.pos);
    const seen = perceive(state, enemy, def);

    let target: Vec | null = null;
    let holdPosition = false;
    let pace = 1;
    let facingSet = false;

    if (isAlert(enemy)) {
      if (seen > 0) {
        enemy.reaction = Math.max(0, enemy.reaction - dt);
        enemy.lastKnown = { x: player.pos.x, y: player.pos.y };
        enemy.facing = Math.atan2(player.pos.y - enemy.pos.y, player.pos.x - enemy.pos.x);
        facingSet = true;
        target = enemy.lastKnown;

        if (def.attack === "ranged") {
          holdPosition = dist <= def.attackRange * 0.85;
          if (enemy.reaction <= 0 && enemy.cooldown <= 0 && dist <= def.attackRange) {
            enemyShoot(state, enemy, def);
          }
        } else {
          const reach = def.radius + pr + def.attackRange;
          holdPosition = dist <= reach;
          if (holdPosition && enemy.reaction <= 0 && enemy.cooldown <= 0) {
            enemy.cooldown = 1 / def.fireRate;
            damagePlayer(state, def.damage, player.pos);
          }
        }
        enemy.mode = holdPosition ? "attack" : "chase";
      } else if (enemy.lastKnown) {
        // Lost them: go to where they were last seen, then look around.
        enemy.reaction = def.reactionTime;
        enemy.mode = "chase";
        target = enemy.lastKnown;
        if (distance(enemy.pos, target) < ARRIVE_DISTANCE) {
          const lost = enemy.lastKnown;
          enemy.lastKnown = null;
          enemy.mode = "search";
          enemy.awareness = STEALTH.searchAwareness;
          enemy.searchLeft = STEALTH.searchSeconds;
          enemy.queue = nooksNear(state, lost);
          enemy.investigate = enemy.queue.shift() ?? null;
          target = null;
        }
      } else {
        // Nowhere left to go on: stand down into a search.
        enemy.mode = "search";
        enemy.awareness = STEALTH.searchAwareness;
        enemy.searchLeft = STEALTH.searchSeconds;
      }
    } else if (seen > 0) {
      // In view but not yet spotted: the meter fills, and the enemy stares at what it saw.
      enemy.awareness = Math.min(1, enemy.awareness + (seen / difficulty.detectSeconds) * dt);
      enemy.investigate = { x: player.pos.x, y: player.pos.y };
      enemy.queue = [];
      enemy.patrolTarget = null;
      enemy.searchLeft = 0;
      turnToward(enemy, Math.atan2(player.pos.y - enemy.pos.y, player.pos.x - enemy.pos.x), STARE_TURN_RATE, dt);
      facingSet = true;
      if (enemy.awareness >= 1) {
        spot(state, enemy);
      } else {
        enemy.mode = "suspicious";
        holdPosition = true;
      }
    } else {
      enemy.awareness = Math.max(0, enemy.awareness - dt / difficulty.decaySeconds);
      enemy.reaction = def.reactionTime;

      if (enemy.investigate) {
        enemy.mode = "suspicious";
        target = enemy.investigate;
        pace = STEALTH.investigateSpeed;
        if (distance(enemy.pos, target) < ARRIVE_DISTANCE) {
          enemy.investigate = enemy.queue.shift() ?? null;
          if (!enemy.investigate) enemy.searchLeft = STEALTH.searchSeconds;
          target = null;
        }
      } else if (enemy.searchLeft > 0) {
        // Looking around, not walking.
        enemy.mode = "search";
        enemy.searchLeft -= dt;
        enemy.facing += STEALTH.lookTurnRate * dt;
      } else {
        const stop = patrol(enemy, dt);
        target = stop.target;
        pace = stop.pace;
        facingSet = stop.facingSet;
      }
    }

    if (target && !holdPosition) {
      const angle = headingFor(state, enemy, def, target, dt);
      const speed = def.moveSpeed * difficulty.enemySpeed * pace;
      enemy.pos.x += Math.cos(angle) * speed * dt;
      enemy.pos.y += Math.sin(angle) * speed * dt;
      if (!facingSet) turnToward(enemy, angle, STEALTH.turnRate, dt);
    }
    resolveCircleAgainstRects(enemy.pos, def.radius, walls);
  }

  separateEnemies(state);
}

/**
 * What a guard does when nothing has caught its eye: walk its loop, looking
 * around at each stop, or stand at its post and sweep its gaze either side.
 * It is not hunting anyone.
 */
function patrol(enemy: EnemyState, dt: number): { target: Vec | null; pace: number; facingSet: boolean } {
  enemy.mode = "patrol";
  const waypoint = enemy.route[enemy.routeIndex];
  const arrived = distance(enemy.pos, waypoint) < ARRIVE_DISTANCE;

  if (enemy.watch !== null && arrived) {
    // On post: hold the spot and let the gaze drift either side of the way it faces.
    const sweep = Math.sin(enemy.sweepClock) * STEALTH.postSweep;
    enemy.sweepClock += dt * STEALTH.postSweepRate * Math.PI * 2;
    turnToward(enemy, enemy.watch + sweep, STEALTH.postTurnRate, dt);
    return { target: null, pace: 0, facingSet: true };
  }
  if (arrived) {
    // A stop on the loop: look around, then move on to the next waypoint.
    enemy.routeIndex = (enemy.routeIndex + 1) % enemy.route.length;
    enemy.patrolTarget = null;
    enemy.searchLeft = STEALTH.lookSeconds;
    enemy.mode = "search";
    return { target: null, pace: 0, facingSet: false };
  }
  enemy.patrolTarget = waypoint;
  return { target: waypoint, pace: STEALTH.patrolSpeed, facingSet: false };
}

function enemyShoot(state: SimState, enemy: EnemyState, def: EnemyDefinition): void {
  const angle = enemy.facing + (random(state) - 0.5) * def.spread;
  state.projectiles.push({
    id: state.nextId++,
    pos: { x: enemy.pos.x, y: enemy.pos.y },
    vel: { x: Math.cos(angle) * def.projectileSpeed, y: Math.sin(angle) * def.projectileSpeed },
    damage: def.damage,
    from: "enemy",
    travelled: 0,
    maxRange: def.attackRange * 1.4,
  });
  enemy.cooldown = 1 / def.fireRate;
  state.events.push({ type: "shot", from: "enemy", pos: { x: enemy.pos.x, y: enemy.pos.y } });
}

/** How often a blocked enemy replans, and how far its goal may drift before it must. */
const REPLAN_SECONDS = 0.5;
const REPLAN_DRIFT = 60;
const WAYPOINT_REACHED = 14;

/**
 * Heading toward `target`: straight there when the body fits the whole way,
 * otherwise along an A* route that is replanned as the target moves.
 */
function headingFor(state: SimState, enemy: EnemyState, def: EnemyDefinition, target: Vec, dt: number): number {
  const walls = state.arena.walls;
  const direct = Math.atan2(target.y - enemy.pos.y, target.x - enemy.pos.x);
  if (segmentClear(enemy.pos, target, def.radius, walls)) {
    enemy.path = [];
    enemy.pathGoal = null;
    return direct;
  }

  enemy.pathAge += dt;
  const stale =
    enemy.path.length === 0 ||
    enemy.pathAge > REPLAN_SECONDS ||
    (enemy.pathGoal !== null && distance(enemy.pathGoal, target) > REPLAN_DRIFT);
  if (stale) {
    enemy.path = findPath(navGridFor(state.arena), walls, enemy.pos, target, def.radius) ?? [];
    enemy.pathGoal = { x: target.x, y: target.y };
    enemy.pathAge = 0;
  }
  while (enemy.path.length > 0 && distance(enemy.pos, enemy.path[0]) < WAYPOINT_REACHED) enemy.path.shift();
  const next = enemy.path[0];
  return next ? Math.atan2(next.y - enemy.pos.y, next.x - enemy.pos.x) : direct;
}

function separateEnemies(state: SimState): void {
  const { enemies, player } = state;
  const pr = player.radius;
  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i];
    const ra = enemyDef(a.defId).radius;

    for (let j = i + 1; j < enemies.length; j += 1) {
      const b = enemies[j];
      const min = ra + enemyDef(b.defId).radius;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
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

    // Enemies do not walk through the player either.
    const dx = a.pos.x - player.pos.x;
    const dy = a.pos.y - player.pos.y;
    const dist = Math.hypot(dx, dy);
    const min = ra + pr;
    if (dist < min && dist > 1e-6) {
      a.pos.x = player.pos.x + (dx / dist) * min;
      a.pos.y = player.pos.y + (dy / dist) * min;
    }
  }
  for (const enemy of enemies) {
    resolveCircleAgainstRects(enemy.pos, enemyDef(enemy.defId).radius, state.arena.walls);
  }
}

function damageEnemy(state: SimState, enemy: EnemyState, amount: number, at: Vec): void {
  enemy.health -= amount;
  enemy.hurt = ENEMY_HURT_FLASH;
  state.shotsHit += 1;
  state.events.push({ type: "hit", pos: { x: at.x, y: at.y }, target: "enemy" });
  // Getting shot is as good as seeing the shooter.
  if (enemy.health > 0) {
    if (isAlert(enemy)) enemy.lastKnown = { x: state.player.pos.x, y: state.player.pos.y };
    else spot(state, enemy);
    return;
  }
  const def = enemyDef(enemy.defId);
  state.score += def.score;
  state.kills += 1;
  state.events.push({ type: "kill", pos: { x: enemy.pos.x, y: enemy.pos.y }, defId: enemy.defId });
}

/* ------------------------------------------------------------ projectiles */

function updateProjectiles(state: SimState, dt: number): void {
  const survivors: SimState["projectiles"] = [];
  const pr = state.player.radius;

  for (const shot of state.projectiles) {
    const speed = Math.hypot(shot.vel.x, shot.vel.y);
    const stepLength = Math.min(speed * dt, shot.maxRange - shot.travelled);
    const scale = speed > 0 ? stepLength / speed : 0;
    const from = shot.pos;
    const to = { x: from.x + shot.vel.x * scale, y: from.y + shot.vel.y * scale };

    // The nearest thing along this step wins, so a wall shields what is behind it.
    let wallT = Infinity;
    for (const wall of state.arena.walls) {
      const t = segmentRectHit(from, to, wall);
      if (t !== null && t < wallT) wallT = t;
    }

    let targetT = Infinity;
    let hitEnemy: EnemyState | null = null;
    if (shot.from === "player") {
      for (const enemy of state.enemies) {
        if (enemy.health <= 0) continue;
        const t = segmentCircleHit(from, to, enemy.pos, enemyDef(enemy.defId).radius);
        if (t !== null && t < targetT) {
          targetT = t;
          hitEnemy = enemy;
        }
      }
    } else {
      const t = segmentCircleHit(from, to, state.player.pos, pr);
      if (t !== null) targetT = t;
    }

    if (wallT <= targetT && wallT !== Infinity) {
      const at = { x: from.x + (to.x - from.x) * wallT, y: from.y + (to.y - from.y) * wallT };
      if (shot.from === "player") whizzPast(state, from, at, null);
      state.events.push({ type: "wall", pos: at });
      continue;
    }
    if (targetT !== Infinity) {
      const at = { x: from.x + (to.x - from.x) * targetT, y: from.y + (to.y - from.y) * targetT };
      if (shot.from === "player") whizzPast(state, from, at, hitEnemy);
      if (hitEnemy) damageEnemy(state, hitEnemy, shot.damage, at);
      else damagePlayer(state, shot.damage, at);
      continue;
    }
    if (shot.from === "player") whizzPast(state, from, to, null);

    shot.pos = to;
    shot.travelled += stepLength;
    if (shot.travelled < shot.maxRange) survivors.push(shot);
  }

  state.projectiles = survivors;
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
}

/* ---------------------------------------------------------------- mission */

/** Picking things up, and walking out with the gold. */
function updateMission(state: SimState): void {
  const player = state.player;
  for (const entry of state.loot) {
    if (entry.taken || distance(entry.spot.pos, player.pos) > MISSION.pickupRadius) continue;
    entry.taken = true;
    state.score += entry.spot.value;
    if (entry.spot.main) state.hasGold = true;
    state.events.push({ type: "pickup", pos: { ...entry.spot.pos }, main: entry.spot.main, value: entry.spot.value });
  }

  const zone = state.arena.exit.zone;
  const inside =
    player.pos.x >= zone.x && player.pos.x <= zone.x + zone.w && player.pos.y >= zone.y && player.pos.y <= zone.y + zone.h;
  if (state.hasGold && inside) {
    state.status = "escaped";
    state.endedAt = state.time;
    state.score += MISSION.escapeBonus;
    if (state.timesSpotted === 0) state.score += MISSION.unseenBonus;
    if (state.timesSpotted === 0 && state.kills === 0) state.score += MISSION.ghostBonus;
    state.events.push({ type: "escaped" });
  }
}

/** How the run is remembered: unseen and unbloodied is the best there is. */
export function rating(state: SimState): "GHOST" | "SHADOW" | "SEEN" {
  if (state.timesSpotted > 0) return "SEEN";
  return state.kills === 0 ? "GHOST" : "SHADOW";
}

function guardState(state: SimState, guard: Guard): EnemyState {
  const def = enemyDef(guard.defId);
  const start = guard.route[0];
  const pos = { x: start.x, y: start.y };
  const watch = guard.watch ?? null;
  const next = guard.route[Math.min(1, guard.route.length - 1)];
  return {
    id: state.nextId++,
    defId: guard.defId,
    pos,
    facing: watch ?? Math.atan2(next.y - start.y, next.x - start.x),
    health: def.health,
    maxHealth: def.health,
    mode: "patrol",
    awareness: 0,
    investigate: null,
    queue: [],
    lastKnown: null,
    cooldown: 0,
    searchLeft: 0,
    route: guard.route.map((point) => ({ x: point.x, y: point.y })),
    // A roamer starts on its way to the second waypoint; a post is already there.
    routeIndex: guard.route.length > 1 ? 1 : 0,
    watch,
    sweepClock: random(state) * Math.PI * 2,
    patrolTarget: null,
    path: [],
    pathAge: 0,
    pathGoal: null,
    reaction: def.reactionTime,
    radio: null,
    hurt: 0,
  };
}

export function accuracy(state: SimState): number {
  return state.shotsFired === 0 ? 0 : state.shotsHit / state.shotsFired;
}

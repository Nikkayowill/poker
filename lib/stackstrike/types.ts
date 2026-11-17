export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WeaponDefinition {
  id: string;
  name: string;
  /** Damage per projectile. */
  damage: number;
  /** Shots per second. */
  fireRate: number;
  /** Projectiles die after travelling this far. */
  range: number;
  projectileSpeed: number;
  magazineSize: number;
  reloadDuration: number;
  /** Total cone width in radians. */
  spread: number;
  /** Projectiles per shot. */
  pellets: number;
}

export interface OperatorDefinition {
  id: string;
  name: string;
  maxHealth: number;
  moveSpeed: number;
  radius: number;
  startingWeapons: string[];
}

export interface EnemyDefinition {
  id: string;
  name: string;
  health: number;
  moveSpeed: number;
  radius: number;
  /** How far the enemy's flashlight reaches. It sees the player only inside the beam, with a clear line. */
  detectionRange: number;
  /** Half the width of the flashlight beam, in radians. Alert enemies ignore it. */
  fieldOfView: number;
  attackRange: number;
  attack: "ranged" | "melee";
  damage: number;
  /** Attacks per second. */
  fireRate: number;
  projectileSpeed: number;
  spread: number;
  /** Seconds between first seeing the player and first attack. */
  reactionTime: number;
  score: number;
}

export type DifficultyId = "easy" | "normal" | "hard";

export interface DifficultyDefinition {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** Seconds one enemy needs to spot a player in clear view at medium range. */
  detectSeconds: number;
  /** Seconds a half-spotted player takes to fade from an enemy's mind. */
  decaySeconds: number;
  /** Guards posted on this difficulty: every guard whose tier is this or lower. */
  tier: 1 | 2 | 3;
  /** Multiplier on how fast guards walk. */
  enemySpeed: number;
}

/** A walled room, for lighting it as the player enters. */
export interface Room {
  id: string;
  rect: Rect;
}

/** A guard the map starts with: either a roamer walking a loop, or a sentry posted in one spot watching one way. */
export interface Guard {
  defId: string;
  /** The easiest difficulty this guard is on. 1 is on every difficulty, 3 only on hard. */
  tier: 1 | 2 | 3;
  /** Waypoints walked in a loop. A single point is a post. */
  route: Vec[];
  /** For a post: the way the guard faces, swept a little either side. */
  watch?: number;
}

/** Something worth taking. The main one is what the mission is for. */
export interface LootSpot {
  id: string;
  label: string;
  pos: Vec;
  value: number;
  main: boolean;
}

export interface Arena {
  width: number;
  height: number;
  walls: Rect[];
  rooms: Room[];
  /** The darkest corners. Not marked on the floor: guards check them after losing you. */
  corners: Vec[];
  guards: Guard[];
  loot: LootSpot[];
  /** The way out. The door is drawn on the outer wall; standing in the zone with the gold ends the mission. */
  exit: { door: Rect; zone: Rect };
  playerSpawn: Vec;
}

export interface PlayerInput {
  /** Movement intent, each axis -1..1. Longer than 1 is normalised. */
  move: Vec;
  /** Aim direction in radians. */
  aim: number;
  fire: boolean;
  /** True only on the step the reload key went down. */
  reload: boolean;
  /** Weapon slot to switch to, or null. */
  selectWeapon: number | null;
}

export interface PlayerState {
  pos: Vec;
  aim: number;
  health: number;
  maxHealth: number;
  radius: number;
  moveSpeed: number;
  weaponIndex: number;
  weaponIds: string[];
  /** Rounds left in each carried weapon's magazine. */
  ammo: number[];
  reloadLeft: number;
  cooldown: number;
  /** Seconds of hit flash left, for rendering only. */
  hurt: number;
  /** Pressed into a dark corner: hard to notice. Recomputed every step. */
  hidden: boolean;
  /** How boxed in the player is by walls, 0 in the open to 1 all round. Recomputed every step. */
  cover: number;
  /** Seconds left of being easy to see after a shot, however dark the corner. */
  exposedLeft: number;
  /** Walking this step. Standing still is harder to notice. */
  moving: boolean;
}

/**
 * patrol: sweeping the map, unaware. suspicious: has glimpsed or heard
 * something and is checking it out. search: looking around a spot. chase and
 * attack: has spotted the player.
 */
export type EnemyMode = "patrol" | "suspicious" | "search" | "chase" | "attack";

export interface EnemyState {
  id: number;
  defId: string;
  pos: Vec;
  facing: number;
  health: number;
  maxHealth: number;
  mode: EnemyMode;
  /** 0 knows nothing, 1 has spotted the player. Fills while the player is in view. */
  awareness: number;
  /** Somewhere to go and look: a glimpse or a sound. Not the player's true position. */
  investigate: Vec | null;
  /** Nooks still to check after the investigate spot. */
  queue: Vec[];
  /** Where the player was last seen, or null when the enemy has lost them. */
  lastKnown: Vec | null;
  cooldown: number;
  /** Seconds left looking around before going back on patrol. */
  searchLeft: number;
  /** The loop this guard walks, or a single post. */
  route: Vec[];
  /** Which waypoint it is walking to. */
  routeIndex: number;
  /** For a post: the way it faces. It sweeps a little either side. */
  watch: number | null;
  /** Phase of a post's gaze sweep. */
  sweepClock: number;
  patrolTarget: Vec | null;
  /** Waypoints still to walk when a wall is in the way. Empty when the way is clear. */
  path: Vec[];
  /** Seconds since `path` was planned. */
  pathAge: number;
  /** Where `path` was planned to end. */
  pathGoal: Vec | null;
  /** Counts down from reactionTime while the player is in view. */
  reaction: number;
  /** A radio call to the rest of the team, counting down. Dies with the spotter. */
  radio: { left: number; pos: Vec } | null;
  hurt: number;
}

export interface ProjectileState {
  id: number;
  pos: Vec;
  vel: Vec;
  damage: number;
  from: "player" | "enemy";
  travelled: number;
  maxRange: number;
}

export type SimEvent =
  | { type: "shot"; from: "player" | "enemy"; pos: Vec }
  | { type: "hit"; pos: Vec; target: "player" | "enemy" }
  | { type: "wall"; pos: Vec }
  | { type: "kill"; pos: Vec; defId: string }
  | { type: "reload" }
  | { type: "spotted"; pos: Vec }
  | { type: "radio"; pos: Vec }
  | { type: "hide"; on: boolean }
  | { type: "pickup"; pos: Vec; main: boolean; value: number }
  | { type: "escaped" }
  | { type: "dead" };

export interface LootState {
  spot: LootSpot;
  taken: boolean;
}

export interface SimState {
  arena: Arena;
  time: number;
  status: "playing" | "dead" | "escaped";
  difficulty: DifficultyId;
  loot: LootState[];
  /** The main prize is in the player's hands: now get out. */
  hasGold: boolean;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  /** What happened during the latest step. Cleared at the start of each step. */
  events: SimEvent[];
  score: number;
  kills: number;
  /** How many times a guard has spotted the player. */
  timesSpotted: number;
  shotsFired: number;
  shotsHit: number;
  damageTaken: number;
  /** When the mission ended, if it has. */
  endedAt: number | null;
  rng: number;
  nextId: number;
}

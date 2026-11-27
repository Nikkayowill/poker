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
  /** Zombies hit in melee: how close they must get, how hard, and how often per second. */
  attackRange: number;
  damage: number;
  fireRate: number;
  /** Points for a kill, before the streak multiplier. */
  score: number;
  /** XP toward the next perk card. */
  xp: number;
  /** Chance a kill leaves a pickup behind, 0 to 1. */
  dropChance: number;
  /** Bursts when it dies: everything within `radius` takes `damage` (half at the edge), the player included. */
  burst?: { radius: number; damage: number };
  /** Share of a bullet's damage that gets through: 1 is none stopped, 0.5 takes half. Blasts ignore it. */
  armor: number;
}

export type DifficultyId = "easy" | "normal" | "hard";

export interface DifficultyDefinition {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** Multiplier on how many zombies a wave has. */
  horde: number;
  /** Multiplier on how fast they walk. */
  speed: number;
  /** Multiplier on how hard they hit. */
  damage: number;
}

/** A walled room, for lighting it as the player enters. */
export interface Room {
  id: string;
  rect: Rect;
}

/** What a solid thing is, for drawing it. It changes nothing about how it blocks. */
export type WallStyle = "wall" | "crate" | "desk" | "shelf" | "case" | "console" | "machine" | "plant" | "pillar" | "plinth";

/** A straight-sided block, aligned to the map. */
export interface Block extends Rect {
  style?: WallStyle;
}

/** A round post, tank or plinth. */
export interface Disc {
  x: number;
  y: number;
  r: number;
  style?: WallStyle;
}

/** A convex shape with any angle to it: a piece of curved wall, a cut corner. Wound either way; `poly()` normalises it. */
export interface Poly {
  points: Vec[];
  style?: WallStyle;
}

/** Anything solid: blocks bullets, sight and light, and walkers go round it. */
export type Wall = Block | Disc | Poly;

export type LightTone = "warm" | "cool" | "red" | "blue";

/** A lamp, window or screen that lights the floor. Walls and props block it, so it leaves shadows behind them. */
export interface Light {
  pos: Vec;
  radius: number;
  tone: LightTone;
}

export interface Arena {
  width: number;
  height: number;
  walls: Wall[];
  rooms: Room[];
  /** Every fixed light. Where none reaches, the floor is as dark as `ambient`. */
  lights: Light[];
  /** Light on the floor where no lamp reaches, 0 to 1. */
  ambient: number;
  /** Where zombies come in: breaches in the outer walls and the far corners of rooms. */
  spawns: Vec[];
  /** Where explosive barrels stand at the start of every wave. */
  barrels?: Vec[];
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
  /** Seconds since a zombie last hit the player, for health regeneration. */
  sinceHurt: number;
  /** Walking this step. */
  moving: boolean;
}

export interface EnemyState {
  id: number;
  defId: string;
  pos: Vec;
  /** The way it faces, which is the way it is heading. */
  facing: number;
  health: number;
  maxHealth: number;
  cooldown: number;
  /** Seconds of hit flash left, for rendering only. */
  hurt: number;
  /** Seconds spent inside a small circle round `anchor` while still out of reach of the player. A zombie stuck this long is moved to a spawn. */
  stuck?: number;
  anchor?: Vec;
}

export type PickupKind = "health" | "bomb" | "frenzy" | "double" | "shield";

export interface BarrelState {
  id: number;
  /** Which of the arena's barrel spots it stands on, so it can be put back next wave. */
  home: number;
  pos: Vec;
  health: number;
}

export interface PickupState {
  id: number;
  kind: PickupKind;
  pos: Vec;
  /** Seconds before it is gone. */
  left: number;
}

export type PerkKind = "combat" | "survival" | "mobility" | "economy" | "chaos";

/** A card offered at a level-up. `max` is how many times it can be taken in one run. */
export interface PerkDefinition {
  id: string;
  name: string;
  blurb: string;
  kind: PerkKind;
  max: number;
}

/** Three cards on the table, and how many times the hand can still be redrawn. */
export interface PerkOffer {
  cards: string[];
  redraws: number;
}

export type SimEvent =
  | { type: "shot"; from: "player"; pos: Vec }
  | { type: "hit"; pos: Vec; target: "player" | "enemy" }
  | { type: "wall"; pos: Vec }
  | { type: "kill"; pos: Vec; defId: string; points: number }
  | { type: "reload" }
  | { type: "pickup"; pos: Vec; kind: PickupKind }
  | { type: "wave"; number: number }
  | { type: "levelup"; level: number }
  | { type: "bomb"; pos: Vec }
  | { type: "barrel"; pos: Vec }
  | { type: "burst"; pos: Vec; radius: number }
  | { type: "waveclear"; number: number; bonus: number }
  | { type: "dead" };

export interface ProjectileState {
  id: number;
  pos: Vec;
  vel: Vec;
  damage: number;
  travelled: number;
  maxRange: number;
  /** How many more zombies it can go through. Missing means none. */
  pierce?: number;
  /** Zombies it has already gone through, so it does not hit one twice. */
  hit?: number[];
}

/** Where the wave director is: zombies still to send in, and the pause between waves. */
export interface WaveState {
  number: number;
  /** Zombie kinds still to come in, in order. */
  queue: string[];
  /** Seconds until the next batch walks in. */
  spawnIn: number;
  /** Seconds of quiet left before the next wave starts. 0 while a wave is on. */
  breakLeft: number;
}

/** Kills in quick succession build a streak, and the streak multiplies the score. */
export interface ComboState {
  count: number;
  /** Seconds left to land the next kill and keep it going. */
  left: number;
}

export interface LevelState {
  level: number;
  /** XP earned since this level began. */
  into: number;
  /** XP the next level needs on top of that. */
  needed: number;
}

export interface SimState {
  arena: Arena;
  time: number;
  /** `perk` is the game paused on a level-up card choice. */
  status: "playing" | "perk" | "dead";
  difficulty: DifficultyId;
  wave: WaveState;
  combo: ComboState;
  best: { combo: number };
  xp: LevelState;
  /** Level-ups waiting for a card, beyond the one on the table. */
  pendingLevels: number;
  /** Redraws left for the whole run. */
  redraws: number;
  offer: PerkOffer | null;
  /** How many times each card has been taken this run. */
  perks: Record<string, number>;
  /** Seconds left of doubled fire rate. */
  frenzyLeft: number;
  /** Seconds left of double points. */
  doubleLeft: number;
  /** Seconds left of taking no damage. */
  shieldLeft: number;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
  barrels: BarrelState[];
  /** What happened during the latest step. Cleared at the start of each step. */
  events: SimEvent[];
  score: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  damageTaken: number;
  /** When the run ended, if it has. */
  endedAt: number | null;
  rng: number;
  nextId: number;
}

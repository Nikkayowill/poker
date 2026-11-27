import type {
  Arena,
  DifficultyDefinition,
  DifficultyId,
  EnemyDefinition,
  Light,
  OperatorDefinition,
  PerkDefinition,
  PickupKind,
  Rect,
  Room,
  WeaponDefinition,
} from "./types";

/**
 * All tuning lives here. The sim reads these tables and never names a weapon
 * or zombie, so a new one is a new row. Numbers are first guesses for feel.
 */

export const WEAPONS: Record<string, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Pistol",
    damage: 34,
    fireRate: 4.5,
    range: 700,
    projectileSpeed: 900,
    magazineSize: 12,
    reloadDuration: 1.1,
    spread: 0.04,
    pellets: 1,
  },
  smg: {
    id: "smg",
    name: "SMG",
    damage: 22,
    fireRate: 9,
    range: 460,
    projectileSpeed: 850,
    magazineSize: 30,
    reloadDuration: 1.6,
    spread: 0.1,
    pellets: 1,
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    damage: 26,
    fireRate: 1.1,
    range: 340,
    projectileSpeed: 800,
    magazineSize: 6,
    reloadDuration: 2.2,
    spread: 0.4,
    pellets: 8,
  },
};

export const OPERATORS: Record<string, OperatorDefinition> = {
  vanguard: {
    id: "vanguard",
    name: "Vanguard",
    maxHealth: 100,
    moveSpeed: 135,
    radius: 14,
    startingWeapons: ["pistol", "smg", "shotgun"],
  },
};

/** Zombies. Walkers are the crowd, runners punish standing still, brutes soak up a lot of lead. */
export const ENEMIES: Record<string, EnemyDefinition> = {
  walker: {
    id: "walker",
    name: "Walker",
    health: 60,
    moveSpeed: 58,
    radius: 13,
    attackRange: 8,
    damage: 10,
    fireRate: 1,
    score: 100,
    xp: 10,
    dropChance: 0.05,
    armor: 1,
  },
  runner: {
    id: "runner",
    name: "Runner",
    health: 40,
    moveSpeed: 112,
    radius: 11,
    attackRange: 8,
    damage: 8,
    fireRate: 1.4,
    score: 150,
    xp: 14,
    dropChance: 0.06,
    armor: 1,
  },
  bloater: {
    id: "bloater",
    name: "Bloater",
    health: 90,
    moveSpeed: 52,
    radius: 16,
    attackRange: 9,
    damage: 12,
    fireRate: 0.9,
    score: 200,
    xp: 20,
    dropChance: 0.1,
    armor: 1,
    burst: { radius: 110, damage: 26 },
  },
  armored: {
    id: "armored",
    name: "Riot Zombie",
    health: 240,
    moveSpeed: 50,
    radius: 15,
    attackRange: 9,
    damage: 16,
    fireRate: 1,
    score: 300,
    xp: 30,
    dropChance: 0.2,
    armor: 0.5,
  },
  brute: {
    id: "brute",
    name: "Brute",
    health: 600,
    moveSpeed: 46,
    radius: 20,
    attackRange: 10,
    damage: 28,
    fireRate: 0.8,
    score: 800,
    xp: 80,
    dropChance: 1,
    armor: 1,
  },
};

/** Explosive barrels: one stray shot sets one off, and the blast sets off any barrel next to it. */
export const BARRELS = {
  radius: 14,
  health: 30,
  blastRadius: 170,
  /** Damage to a zombie at the centre, falling to half at the edge. */
  zombieDamage: 320,
  /** Damage to the player at the centre, falling off to nothing at the edge. Never less than the floor inside the blast. */
  playerDamage: 35,
  playerFloor: 6,
};
const BARREL_SPOTS = [
  { x: 590, y: 390 },
  { x: 400, y: 200 },
  { x: 420, y: 700 },
  { x: 640, y: 690 },
  { x: 900, y: 650 },
  { x: 1400, y: 200 },
  { x: 1100, y: 500 },
  { x: 1260, y: 640 },
];

export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  easy: { id: "easy", label: "Easy", blurb: "Smaller crowds, slower and softer hitting.", horde: 0.8, speed: 0.92, damage: 0.8 },
  normal: { id: "normal", label: "Normal", blurb: "The full horde.", horde: 1, speed: 1, damage: 1 },
  hard: { id: "hard", label: "Hard", blurb: "A bigger crowd that is quicker and hits hard.", horde: 1.25, speed: 1.08, damage: 1.25 },
};

export const DEFAULT_DIFFICULTY: DifficultyId = "normal";

/** How the waves come and how a run is scored. */
export const HORDE = {
  /** Quiet before the first wave, and between waves. */
  startDelay: 3,
  breakSeconds: 5,
  /** Every wave after the first makes each zombie this much tougher, up to the cap (a multiple of its base health). */
  healthPerWave: 0.07,
  healthCap: 3,
  /** Never more than this many zombies alive at once, so a phone can keep up. */
  maxAlive: 40,
  /** Zombies come in this far from the player at least. */
  spawnMinDistance: 360,
  /** Seconds between batches, easing from the first value to the second over `rampWaves` waves. */
  spawnInterval: { start: 0.9, end: 0.3 },
  rampWaves: 12,
  batch: { min: 1, max: 3 },
  /** Paid at the end of every wave, times the wave number. */
  waveBonus: 100,
  /** Kills this close together keep a streak going. */
  comboWindow: 2.2,
  /** Every this many kills in a streak adds half a point to the multiplier, up to the cap. */
  comboStep: 5,
  comboMax: 4,
};

/** XP for the next perk card: it takes `base` for level 2, and each level after costs `step` more. */
export const LEVELING = { base: 70, step: 45, redraws: 3 };

export const PICKUPS = {
  life: 14,
  radius: 24,
  healAmount: 35,
  /** What a drop turns out to be. */
  weights: { health: 0.4, bomb: 0.12, frenzy: 0.2, double: 0.16, shield: 0.12 } satisfies Record<PickupKind, number>,
  bombRadius: 560,
  bombDamage: 700,
  frenzySeconds: 12,
  doubleSeconds: 15,
  shieldSeconds: 6,
};

/** The level-up cards. Each can be taken up to `max` times in a run and stacks. */
export const PERKS: Record<string, PerkDefinition> = {
  "hot-barrel": { id: "hot-barrel", name: "Hot Barrel", blurb: "Fire 15% faster", kind: "combat", max: 5 },
  "hollow-points": { id: "hollow-points", name: "Hollow Points", blurb: "Bullets hit 20% harder", kind: "combat", max: 5 },
  "quick-hands": { id: "quick-hands", name: "Quick Hands", blurb: "Reload 25% faster", kind: "combat", max: 3 },
  "thick-skin": { id: "thick-skin", name: "Thick Skin", blurb: "+25 max health, and heal 25", kind: "survival", max: 5 },
  "second-wind": { id: "second-wind", name: "Second Wind", blurb: "Slowly heal when nothing is biting you", kind: "survival", max: 3 },
  leech: { id: "leech", name: "Leech", blurb: "Heal 2 for every kill", kind: "survival", max: 3 },
  "fast-feet": { id: "fast-feet", name: "Fast Feet", blurb: "Move 8% faster", kind: "mobility", max: 4 },
  scavenger: { id: "scavenger", name: "Scavenger", blurb: "25% more XP from kills", kind: "economy", max: 4 },
  "big-drops": { id: "big-drops", name: "Big Drops", blurb: "Zombies drop pickups more often", kind: "economy", max: 3 },
  magnet: { id: "magnet", name: "Magnet", blurb: "Pick up drops from much farther away", kind: "economy", max: 3 },
  "big-mags": { id: "big-mags", name: "Big Mags", blurb: "+25% rounds in every magazine", kind: "combat", max: 4 },
  piercing: { id: "piercing", name: "Piercing Rounds", blurb: "Bullets go through one more zombie", kind: "combat", max: 2 },
  frenzy: { id: "frenzy", name: "Adrenaline", blurb: "Double fire rate for 12 seconds", kind: "chaos", max: 99 },
  nuke: { id: "nuke", name: "Dead Air", blurb: "Blow up every zombie nearby", kind: "chaos", max: 99 },
};

/**
 * What a perk is worth per card taken. The sim multiplies or adds these up
 * from `state.perks`.
 */
export const PERK_VALUES = {
  fireRate: 0.15,
  damage: 0.2,
  reload: 0.25,
  health: 25,
  regenPerSecond: 1.5,
  /** Seconds without being hit before regeneration starts. */
  regenDelay: 3,
  leechHeal: 2,
  speed: 0.08,
  xp: 0.25,
  drops: 0.4,
  /** Each Magnet card makes pickups reachable from this much farther off (a share of the base reach). */
  magnet: 0.7,
  /** Each Big Mags card adds this share to every magazine. */
  mags: 0.25,
};

/**
 * How far away the player can make out a zombie, through walls. Inside
 * `clearRange` they are drawn in full; out to `range` they fade to `farStrength`.
 */
export const SENSE = {
  range: 700,
  clearRange: 460,
  farStrength: 0.35,
};

/** The soft pool of light the player carries, so the ground right around them stays readable. */
export const PLAYER_GLOW = {
  radius: 230,
};

/**
 * Aim assist for a thumb on a glass screen. A zombie that is nearly in the
 * sights pulls the aim the rest of the way, more the closer to dead on.
 */
export const AIM_ASSIST = {
  /** Never wider than this either side of the zombie, in radians. */
  maxCone: 0.2,
  /** Added to the zombie's radius when working out how wide it looks. */
  slack: 6,
  /** Share of the gap to the zombie that is closed when dead on. */
  pull: 0.65,
};

const WALL = 24;
const SHELL = 32;

/** One straight wall from `from` to `to`, with doorways left open. A gap is [start, end] along the wall. */
function wallLine(axis: "h" | "v", fixed: number, from: number, to: number, gaps: [number, number][]): Rect[] {
  const walls: Rect[] = [];
  let cursor = from;
  for (const [start, end] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (start > cursor) walls.push(axis === "h" ? { x: cursor, y: fixed, w: start - cursor, h: WALL } : { x: fixed, y: cursor, w: WALL, h: start - cursor });
    cursor = end;
  }
  if (to > cursor) walls.push(axis === "h" ? { x: cursor, y: fixed, w: to - cursor, h: WALL } : { x: fixed, y: cursor, w: WALL, h: to - cursor });
  return walls;
}

/**
 * The compound, drawn as a floor plan (x across, y down, 1500 x 900):
 *
 *   NW office      | north lobby  | NE server room
 *   ---------------+==checkpoint==+---------------
 *   SW storeroom   | south lobby  | east control room
 *                  |              +---------------
 *                  |              | SE workshop
 *
 * Rooms are joined by doorways one body wide, so every doorway is a choke point
 * that a crowd has to squeeze through, and the wings loop back on themselves so
 * there is always a way round. Cover breaks up the rooms and gives you something
 * to kite a crowd around.
 */
const ROOMS: Room[] = [
  { id: "office", rect: { x: 32, y: 32, w: 464, h: 398 } },
  { id: "storeroom", rect: { x: 32, y: 454, w: 464, h: 414 } },
  { id: "north-lobby", rect: { x: 520, y: 32, w: 460, h: 398 } },
  { id: "south-lobby", rect: { x: 520, y: 454, w: 460, h: 414 } },
  { id: "servers", rect: { x: 1004, y: 32, w: 464, h: 268 } },
  { id: "control", rect: { x: 1004, y: 324, w: 464, h: 252 } },
  { id: "workshop", rect: { x: 1004, y: 600, w: 464, h: 268 } },
];

const COVER: Rect[] = [
  // Office: a desk, a pillar that shields the lobby doorway, and a locker nook along the west wall.
  { x: 150, y: 110, w: 150, h: 26 },
  { x: 330, y: 250, w: 26, h: 100 },
  { x: 32, y: 236, w: 64, h: 22 },
  { x: 32, y: 318, w: 64, h: 22 },
  // Storeroom: crates and shelving between the west door and the lobby.
  { x: 130, y: 540, w: 70, h: 70 },
  { x: 330, y: 520, w: 24, h: 120 },
  { x: 150, y: 780, w: 200, h: 24 },
  // North lobby: crates and a pillar that stops the north door seeing straight down the room.
  { x: 600, y: 260, w: 90, h: 50 },
  { x: 840, y: 150, w: 90, h: 50 },
  { x: 710, y: 170, w: 80, h: 80 },
  { x: 760, y: 330, w: 100, h: 24 },
  // South lobby.
  { x: 700, y: 740, w: 80, h: 80 },
  { x: 580, y: 560, w: 90, h: 50 },
  { x: 840, y: 560, w: 24, h: 110 },
  // Server room: three racks make two aisles.
  { x: 1090, y: 90, w: 24, h: 120 },
  { x: 1200, y: 90, w: 24, h: 120 },
  { x: 1310, y: 90, w: 24, h: 120 },
  // Control room.
  { x: 1180, y: 400, w: 100, h: 70 },
  { x: 1330, y: 350, w: 24, h: 90 },
  { x: 1300, y: 510, w: 90, h: 24 },
  // Workshop.
  { x: 1100, y: 700, w: 140, h: 26 },
  { x: 1300, y: 700, w: 26, h: 120 },
  { x: 1380, y: 780, w: 70, h: 70 },
];

const WALLS: Rect[] = [
  // Outer shell. The west door is drawn on it: the way in and out.
  { x: 0, y: 0, w: 1500, h: SHELL },
  { x: 0, y: 868, w: 1500, h: SHELL },
  { x: 0, y: 0, w: SHELL, h: 900 },
  { x: 1468, y: 0, w: SHELL, h: 900 },
  // Between the west wing and the lobbies: one doorway into each room.
  ...wallLine("v", 496, SHELL, 868, [[140, 244], [640, 744]]),
  // Between the lobbies and the east wing: a doorway into each room.
  ...wallLine("v", 980, SHELL, 868, [[100, 204], [336, 440], [690, 794]]),
  // Checkpoint between the lobbies, and the west wing's own loop round it.
  ...wallLine("h", 430, 520, 980, [[560, 664]]),
  ...wallLine("h", 430, SHELL, 496, [[90, 194]]),
  // East wing floors.
  ...wallLine("h", 300, 1004, 1468, [[1290, 1394]]),
  ...wallLine("h", 576, 1004, 1468, [[1060, 1164]]),
  ...COVER,
];

/**
 * One lamp or two per room, set so each pool leaves the corners dark. Where a
 * crate or a rack stands between a lamp and the floor, that floor is in shadow too.
 */
const LIGHTS: Light[] = [
  { pos: { x: 260, y: 190 }, radius: 200, tone: "cool" },
  { pos: { x: 230, y: 650 }, radius: 190, tone: "warm" },
  { pos: { x: 80, y: 580 }, radius: 150, tone: "warm" },
  { pos: { x: 650, y: 215 }, radius: 230, tone: "warm" },
  { pos: { x: 750, y: 650 }, radius: 230, tone: "warm" },
  { pos: { x: 1240, y: 200 }, radius: 190, tone: "blue" },
  { pos: { x: 1230, y: 525 }, radius: 210, tone: "blue" },
  { pos: { x: 1230, y: 760 }, radius: 190, tone: "warm" },
];


/**
 * Where zombies come in: breaches near the corners of every room, spread so
 * a crowd can arrive from any side and the player can never watch them all.
 */
const SPAWNS = [
  { x: 70, y: 70 },
  { x: 450, y: 390 },
  { x: 70, y: 830 },
  { x: 450, y: 500 },
  { x: 560, y: 70 },
  { x: 940, y: 400 },
  { x: 560, y: 830 },
  { x: 940, y: 500 },
  { x: 1440, y: 70 },
  { x: 1040, y: 270 },
  { x: 1440, y: 550 },
  { x: 1040, y: 540 },
  { x: 1230, y: 835 },
  { x: 1040, y: 830 },
];

export const ARENA: Arena = {
  width: 1500,
  height: 900,
  walls: WALLS,
  rooms: ROOMS,
  lights: LIGHTS,
  ambient: 0.1,
  spawns: SPAWNS,
  barrels: BARREL_SPOTS,
  // The north lobby: a doorway out of every side, and cover to dodge round.
  playerSpawn: { x: 900, y: 280 },
};

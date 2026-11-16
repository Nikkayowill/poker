import type {
  Arena,
  DifficultyDefinition,
  DifficultyId,
  EnemyDefinition,
  OperatorDefinition,
  Rect,
  Room,
  Vec,
  WeaponDefinition,
} from "./types";

/**
 * All tuning lives here. The sim reads these tables and never names a weapon
 * or enemy, so a new one is a new row. Numbers are first guesses for feel.
 */

/** Every bullet kills whatever it hits: this is a stealth game, not a gunfight. */
const ONE_SHOT = 100;

export const WEAPONS: Record<string, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Pistol",
    damage: ONE_SHOT,
    fireRate: 4,
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
    damage: ONE_SHOT,
    fireRate: 7,
    range: 460,
    projectileSpeed: 850,
    magazineSize: 24,
    reloadDuration: 1.6,
    spread: 0.1,
    pellets: 1,
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    damage: ONE_SHOT,
    fireRate: 1.2,
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
    moveSpeed: 120,
    radius: 14,
    startingWeapons: ["pistol", "smg", "shotgun"],
  },
};

export const ENEMIES: Record<string, EnemyDefinition> = {
  grunt: {
    id: "grunt",
    name: "Grunt",
    health: 100,
    moveSpeed: 62,
    radius: 14,
    detectionRange: 300,
    fieldOfView: 0.5,
    attackRange: 300,
    attack: "ranged",
    damage: 8,
    fireRate: 0.9,
    projectileSpeed: 420,
    spread: 0.14,
    reactionTime: 0.45,
    score: 100,
  },
  runner: {
    id: "runner",
    name: "Runner",
    health: 100,
    moveSpeed: 118,
    radius: 12,
    detectionRange: 340,
    fieldOfView: 0.6,
    attackRange: 30,
    attack: "melee",
    damage: 12,
    fireRate: 1.6,
    projectileSpeed: 0,
    spread: 0,
    reactionTime: 0.2,
    score: 80,
  },
};

export const WAVE_TUNING = {
  /** Health restored when a wave is cleared. */
  clearHeal: 20,
  damageScalePerWave: 0.05,
  /** Damage scaling stops here. Enemies never get tougher: one shot always kills. */
  maxScale: 2,
  waveClearScore: 50,
};

/**
 * How hard the enemy is to sneak past. Harder means a faster detection
 * meter, more doors to cover and less time to plan.
 */
export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  easy: {
    id: "easy",
    label: "Easy",
    blurb: "Slow to notice you. One door. Lots of time.",
    detectSeconds: 2.6,
    decaySeconds: 2.5,
    entries: 1,
    moreEntriesFromWave: 5,
    graceFirst: 10,
    grace: 8,
    spawnGap: 1.8,
    enemyCount: 0.6,
    enemySpeed: 0.8,
  },
  normal: {
    id: "normal",
    label: "Normal",
    blurb: "Two doors. Keep out of sight.",
    detectSeconds: 1.5,
    decaySeconds: 2,
    entries: 2,
    moreEntriesFromWave: 5,
    graceFirst: 7,
    grace: 5,
    spawnGap: 1.2,
    enemyCount: 1,
    enemySpeed: 1,
  },
  hard: {
    id: "hard",
    label: "Hard",
    blurb: "Quick to spot you. Three doors, then four.",
    detectSeconds: 0.8,
    decaySeconds: 1.5,
    entries: 3,
    moreEntriesFromWave: 4,
    graceFirst: 4,
    grace: 3,
    spawnGap: 0.7,
    enemyCount: 1.2,
    enemySpeed: 1.15,
  },
};

export const DEFAULT_DIFFICULTY: DifficultyId = "normal";

/**
 * What makes the player easy or hard to notice. An enemy that can see the
 * player fills its awareness meter at (multiplier / detectSeconds) per second;
 * the multipliers below shape that, and at 1 it has spotted them.
 */
export const STEALTH = {
  /** A player in the shadows is only in view this close. */
  hideRange: 80,
  /** Inside this an enemy walking up to a hiding player finds them fast. */
  hideCheckRange: 45,
  hideCheckFill: 1.2,
  /** Fill multiplier when hidden and not being checked up close. */
  hideFill: 0.3,
  /** Fill multiplier when not moving. */
  stillFill: 0.75,
  /** Fill multiplier up close, fading to farFill at the edge of an enemy's range. */
  closeFill: 1.6,
  farFill: 0.45,
  /** Bumping into someone is noticed whatever way they face. Everything else has to be in their beam. */
  closeNotice: 36,
  /** The guns are silenced: a shot is only heard this close, and half as far through a wall. */
  hearRange: 170,
  /** Awareness a heard shot adds. It points the enemy at the sound, not at the player. */
  noiseAwareness: 0.4,
  /** How wide the guess at where a shot came from is. */
  noiseScatter: 60,
  /** A bullet that whizzes past this close to an enemy (a miss) puts it on alert. */
  nearMissRange: 38,
  nearMissAwareness: 0.7,
  nearMissScatter: 36,
  /** A spotted enemy tells the squad this close at once, no radio needed. */
  squadRange: 150,
  calloutAwareness: 0.6,
  /** Anyone farther away only learns by radio: the spotter has to live this long after spotting you. */
  radioSeconds: 1.6,
  radioAwareness: 0.6,
  /** How wide the radioed position is, so they come to the area rather than the exact spot. */
  radioScatter: 70,
  /** Awareness an enemy keeps after losing the player. */
  searchAwareness: 0.7,
  /** Alert enemies keep tracking a little farther out than they first notice. */
  alertRangeBonus: 1.25,
  searchSeconds: 3,
  /** Looking around where a sweep stops. */
  lookSeconds: 1.2,
  /** Walking pace as a share of full speed. */
  patrolSpeed: 0.55,
  investigateSpeed: 0.7,
  turnRate: 7,
  lookTurnRate: 1.6,
  /** Sweep points this close, in view, count as checked. */
  sweepSeen: 100,
  /** After this long a wave starts checking the nooks too, so hiding in one forever fails. */
  thoroughAfter: 35,
  /** Corners this near the spot an enemy lost the player are checked. */
  nookCheckRadius: 220,
};

/**
 * There is no hide button. A player pressed into a corner or alcove is lost in
 * the shadow. "Pressed in" is measured by casting rays
 * round the player: the share that hit a wall within `reach` is the cover.
 * Against a flat wall that is 3 of 8, in a corner 5 of 8.
 */
export const SHADOW = {
  reach: 44,
  /** Cover at or above this counts as a dark corner. */
  hiddenAt: 0.5,
  /** A shot lights you up for this long, so you cannot snipe from the dark for free. */
  exposedSeconds: 1.2,
};

/**
 * The player carries no light, only a laser for aiming that enemies cannot
 * see. The floor is lit by the enemies' flashlights, plus this small glow so
 * the ground right around the player stays readable.
 */
export const PLAYER_GLOW = {
  radius: 62,
};

export function waveComposition(wave: number, countScale = 1): { defId: string; count: number }[] {
  const scaled = (count: number): number => Math.max(1, Math.round(count * countScale));
  const grunts = scaled(Math.min(2 + wave, 10));
  const runners = wave >= 2 ? scaled(Math.min(wave - 1, 6)) : 0;
  return runners > 0
    ? [
        { defId: "grunt", count: grunts },
        { defId: "runner", count: runners },
      ]
    : [{ defId: "grunt", count: grunts }];
}

/**
 * Aim assist for a thumb on a glass screen. An enemy that is nearly in the
 * sights pulls the aim the rest of the way, more the closer to dead on.
 */
export const AIM_ASSIST = {
  /** Never wider than this either side of the enemy, in radians. */
  maxCone: 0.2,
  /** Added to the enemy's radius when working out how wide it looks. */
  slack: 6,
  /** Share of the gap to the enemy that is closed when dead on. */
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
 *   ---------------+--north door  +---------------
 *   SW storeroom   |==checkpoint==| east control room
 *   west door      | south lobby  +---------------
 *                  |  south door  | SE workshop
 *
 * It is built for creeping. Rooms are joined by doorways just wide enough for
 * one body, so every doorway is a place to wait beside. The two lobbies are
 * linked by one narrow gap at the checkpoint, and the west and east wings
 * loop back on themselves, so there is always a second way round. Each room
 * has cover to break sight lines and a dark nook to hide in; the player starts
 * in the server room, the farthest corner from every way in.
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
  // Outer shell. The doors are drawn on it; enemies step in just inside.
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

/** Dark spots enemies check once a wave drags on or after losing you: every room's corners, plus the nooks behind cover. */
function cornerSpots(): Vec[] {
  const inset = 30;
  const spots: Vec[] = [];
  for (const { rect } of ROOMS) {
    for (const [x, y] of [
      [rect.x + inset, rect.y + inset],
      [rect.x + rect.w - inset, rect.y + inset],
      [rect.x + inset, rect.y + rect.h - inset],
      [rect.x + rect.w - inset, rect.y + rect.h - inset],
    ]) {
      const clear = !WALLS.some((wall) => {
        const dx = Math.max(wall.x - x, 0, x - (wall.x + wall.w));
        const dy = Math.max(wall.y - y, 0, y - (wall.y + wall.h));
        return Math.hypot(dx, dy) < 24;
      });
      if (clear) spots.push({ x, y });
    }
  }
  return spots;
}

export const ARENA: Arena = {
  width: 1500,
  height: 900,
  walls: WALLS,
  rooms: ROOMS,
  corners: [
    ...cornerSpots(),
    // The locker nook, behind the storeroom shelves and in the server aisles.
    { x: 58, y: 288 },
    { x: 250, y: 838 },
    { x: 1155, y: 150 },
    { x: 1267, y: 150 },
  ],
  patrol: [
    { x: 230, y: 330 },
    { x: 420, y: 90 },
    { x: 230, y: 700 },
    { x: 430, y: 560 },
    { x: 620, y: 100 },
    { x: 880, y: 260 },
    { x: 600, y: 380 },
    { x: 900, y: 380 },
    { x: 600, y: 780 },
    { x: 900, y: 720 },
    { x: 730, y: 640 },
    { x: 1150, y: 250 },
    { x: 1400, y: 160 },
    { x: 1100, y: 430 },
    { x: 1380, y: 420 },
    { x: 1150, y: 780 },
    { x: 1400, y: 660 },
  ],
  // Out of range of every door, so nobody steps in already looking at you.
  playerSpawn: { x: 1255, y: 200 },
  entries: [
    { id: "north", label: "NORTH DOOR", door: { x: 690, y: 0, w: 120, h: SHELL }, pos: { x: 750, y: 56 } },
    { id: "east", label: "EAST DOOR", door: { x: 1468, y: 430, w: SHELL, h: 120 }, pos: { x: 1444, y: 490 } },
    { id: "south", label: "SOUTH DOOR", door: { x: 690, y: 868, w: 120, h: SHELL }, pos: { x: 750, y: 844 } },
    { id: "west", label: "WEST DOOR", door: { x: 0, y: 520, w: SHELL, h: 120 }, pos: { x: 56, y: 580 } },
  ],
};

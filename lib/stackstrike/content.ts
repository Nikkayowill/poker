import type {
  Arena,
  ContractDefinition,
  ContractId,
  DifficultyDefinition,
  DifficultyId,
  EnemyDefinition,
  Guard,
  Light,
  LootSpot,
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

/**
 * How far away the player can make out a guard, through walls. Inside
 * `clearRange` they are drawn in full; out to `range` they fade to `farStrength`.
 */
export const SENSE = {
  range: 560,
  clearRange: 380,
  farStrength: 0.4,
};

/** The heist: what the player is paid for and how close they must be to pick something up. */
export const MISSION = {
  pickupRadius: 26,
  /** Paid for walking out with the gold. */
  escapeBonus: 500,
  /** Extra for leaving without a single guard ever spotting you. */
  unseenBonus: 500,
  /** Extra again for leaving without firing a shot that killed anyone. */
  ghostBonus: 500,
};

/**
 * How hard the enemy is to sneak past. Harder means a faster detection
 * meter, more doors to cover and less time to plan.
 */
export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  easy: {
    id: "easy",
    label: "Easy",
    blurb: "Slow to notice you. Few guards.",
    detectSeconds: 2.6,
    decaySeconds: 2.5,
    tier: 1,
    enemySpeed: 0.8,
  },
  normal: {
    id: "normal",
    label: "Normal",
    blurb: "More guards. Keep out of sight.",
    detectSeconds: 1.5,
    decaySeconds: 2,
    tier: 2,
    enemySpeed: 1,
  },
  hard: {
    id: "hard",
    label: "Hard",
    blurb: "Every guard on duty, quick to spot you.",
    detectSeconds: 0.8,
    decaySeconds: 1.5,
    tier: 3,
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
  /** Looking around where a patrol leg ends. */
  lookSeconds: 1.2,
  /** Walking pace as a share of full speed. */
  patrolSpeed: 0.55,
  /** A posted guard turns this fast and sweeps this far either side of the way it faces. */
  postTurnRate: 1.3,
  postSweep: 0.8,
  postSweepRate: 0.6,
  investigateSpeed: 0.7,
  turnRate: 7,
  lookTurnRate: 1.6,
  /** Corners this near the spot an enemy lost the player are checked. */
  nookCheckRadius: 220,
};

/**
 * What a guard does about a body, and how the whole building winds up and
 * settles. Spotting you or finding a body raises `caution`; while it is up,
 * guards walk faster, their lights reach farther and they notice you sooner.
 */
export const CAUTION = {
  /** A body is seen inside this share of a guard's beam range... */
  bodySightShare: 0.85,
  /** ...or at once this close, whichever way they face. */
  bodyCloseNotice: 50,
  /** Awareness a guard that finds a body is left with, and the squad it tells. */
  bodyAwareness: 0.65,
  bodyScatter: 50,
  bodySquadRange: 220,
  /** What each event adds to caution. */
  spottedRaise: 0.5,
  bodyRaise: 0.4,
  /** Caution lost per second. Full to calm takes 45 seconds. */
  decayPerSecond: 1 / 45,
  /** At full caution: walking speed, beam reach and meter speed are scaled by these. */
  speedBoost: 0.25,
  beamBoost: 0.2,
  meterBoost: 0.35,
  /** A roamer turns back at a stop this often, and pauses between these. */
  reverseChance: 0.25,
  pauseMin: 0.5,
  pauseMax: 2.4,
};

export const CONTRACTS: Record<ContractId, ContractDefinition> = {
  standard: {
    id: "standard",
    name: "Standard job",
    blurb: "Nothing out of the ordinary.",
    unlockLevel: 1,
    weight: 3,
    guardDelta: 0,
    beamScale: 1,
    speedScale: 1,
    radioScale: 1,
    lootDelta: 0,
    lootScale: 1,
  },
  "skeleton-crew": {
    id: "skeleton-crew",
    name: "Skeleton crew",
    blurb: "Short staffed tonight. Fewer guards, thinner pickings.",
    unlockLevel: 1,
    weight: 2,
    guardDelta: -2,
    beamScale: 1,
    speedScale: 1,
    radioScale: 1,
    lootDelta: -1,
    lootScale: 0.75,
  },
  "rich-pickings": {
    id: "rich-pickings",
    name: "Rich pickings",
    blurb: "More to steal, and someone extra on the door.",
    unlockLevel: 2,
    weight: 2,
    guardDelta: 1,
    beamScale: 1,
    speedScale: 1,
    radioScale: 1,
    lootDelta: 1,
    lootScale: 1.25,
  },
  "night-shift": {
    id: "night-shift",
    name: "Night shift",
    blurb: "Fewer guards, but their lights reach much farther.",
    unlockLevel: 3,
    weight: 2,
    guardDelta: -1,
    beamScale: 1.3,
    speedScale: 1,
    radioScale: 1,
    lootDelta: 0,
    lootScale: 1,
  },
  "double-time": {
    id: "double-time",
    name: "Double time",
    blurb: "The guards are in a hurry and walk fast.",
    unlockLevel: 4,
    weight: 2,
    guardDelta: 0,
    beamScale: 1,
    speedScale: 1.25,
    radioScale: 1,
    lootDelta: 0,
    lootScale: 1.15,
  },
  "tight-radio": {
    id: "tight-radio",
    name: "Tight radio",
    blurb: "Radio calls go out almost at once. Kill a spotter instantly or not at all.",
    unlockLevel: 5,
    weight: 2,
    guardDelta: 0,
    beamScale: 1,
    speedScale: 1,
    radioScale: 0.4,
    lootDelta: 0,
    lootScale: 1.2,
  },
};

/**
 * There is no hide button, and a wall is not cover. You are hidden when the floor
 * under you is dark (no lamp reaches it, or a prop shades it) and no guard's
 * flashlight is on you. Each lamp lights a pool that fades toward its edge, so
 * the outer third of every pool is dark enough to stand in.
 */
export const SHADOW = {
  /** Light below this level counts as dark. */
  darkBelow: 0.2,
  /** How fast a lamp's light dies away: 1 is a straight line, higher keeps the middle bright and the edge dark. */
  falloff: 1.5,
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
 *   NW office      | north lobby  | NE server room (the gold)
 *   ---------------+==checkpoint==+---------------
 *   SW storeroom   | south lobby  | east control room
 *   west door (in  |              +---------------
 *   and out)       |              | SE workshop
 *
 * It is built for creeping. Rooms are joined by doorways just wide enough for
 * one body, so every doorway is a place to wait beside. The two lobbies are
 * linked by one narrow gap at the checkpoint, and the west and east wings
 * loop back on themselves, so there is always a second way round. Each room
 * has cover to break sight lines and a dark nook to hide in; the player starts
 * in through the west door; the gold case is in the server room, the far
 * corner of the building.
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

/**
 * Who is on duty. Roamers walk their loop forever, posts stand and watch. Most
 * of them are not looking for anyone: they only become dangerous once they
 * notice you. Tier 1 is on every difficulty, tier 3 only on hard.
 */
const GUARDS: Guard[] = [
  // Tier 1: enough to make the vault a real choice on easy.
  { defId: "grunt", tier: 1, route: [{ x: 1400, y: 240 }], watch: Math.PI },
  {
    defId: "grunt",
    tier: 1,
    route: [{ x: 620, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 380 }, { x: 620, y: 380 }],
  },
  {
    defId: "grunt",
    tier: 1,
    route: [{ x: 600, y: 780 }, { x: 900, y: 780 }, { x: 900, y: 500 }, { x: 600, y: 500 }],
  },
  { defId: "grunt", tier: 1, route: [{ x: 440, y: 120 }], watch: Math.PI * 0.75 },
  // Tier 2.
  {
    defId: "grunt",
    tier: 2,
    route: [{ x: 1100, y: 540 }, { x: 1420, y: 540 }, { x: 1420, y: 360 }, { x: 1100, y: 360 }],
  },
  { defId: "grunt", tier: 2, route: [{ x: 1400, y: 660 }], watch: Math.PI },
  { defId: "grunt", tier: 2, route: [{ x: 612, y: 500 }], watch: -Math.PI / 2 },
  // Tier 3: the whole building on its toes.
  { defId: "grunt", tier: 3, route: [{ x: 420, y: 520 }, { x: 420, y: 820 }, { x: 240, y: 840 }, { x: 240, y: 650 }] },
  { defId: "grunt", tier: 3, route: [{ x: 1150, y: 250 }, { x: 1400, y: 250 }] },
  { defId: "runner", tier: 3, route: [{ x: 420, y: 360 }, { x: 140, y: 380 }, { x: 140, y: 200 }, { x: 420, y: 200 }] },
];

const LOOT: LootSpot[] = [
  { id: "gold", label: "GOLD CASE", pos: { x: 1267, y: 130 }, value: 1000, main: true },
  { id: "watch", label: "Watch", pos: { x: 225, y: 170 }, value: 150, main: false },
  { id: "ledger", label: "Ledger", pos: { x: 1120, y: 470 }, value: 200, main: false },
  { id: "ingots", label: "Ingots", pos: { x: 1160, y: 790 }, value: 250, main: false },
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

export const ARENA: Arena = {
  width: 1500,
  height: 900,
  walls: WALLS,
  rooms: ROOMS,
  lights: LIGHTS,
  ambient: 0.04,
  corners: [
    ...cornerSpots(),
    // The locker nook, behind the storeroom shelves and in the server aisles.
    { x: 58, y: 288 },
    { x: 250, y: 838 },
    { x: 1155, y: 150 },
    { x: 1267, y: 150 },
  ],
  guards: GUARDS,
  loot: LOOT,
  // In through the west door and back out the same way: the gold is on the far side of the building.
  exit: { door: { x: 0, y: 520, w: SHELL, h: 120 }, zone: { x: SHELL, y: 520, w: 70, h: 120 } },
  playerSpawn: { x: 90, y: 580 },
};

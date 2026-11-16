import type { Arena, DifficultyDefinition, DifficultyId, EnemyDefinition, OperatorDefinition, WeaponDefinition } from "./types";

/**
 * All tuning lives here. The sim reads these tables and never names a weapon
 * or enemy, so a new one is a new row. Numbers are first guesses for feel.
 */

export const WEAPONS: Record<string, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Pistol",
    damage: 25,
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
    damage: 10,
    fireRate: 12,
    range: 460,
    projectileSpeed: 850,
    magazineSize: 30,
    reloadDuration: 1.6,
    spread: 0.14,
    pellets: 1,
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    damage: 12,
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
    moveSpeed: 190,
    radius: 14,
    startingWeapons: ["pistol", "smg", "shotgun"],
  },
};

export const ENEMIES: Record<string, EnemyDefinition> = {
  grunt: {
    id: "grunt",
    name: "Grunt",
    health: 60,
    moveSpeed: 95,
    radius: 14,
    detectionRange: 300,
    fieldOfView: 1.1,
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
    health: 35,
    moveSpeed: 210,
    radius: 12,
    detectionRange: 340,
    fieldOfView: 1.3,
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
  healthScalePerWave: 0.08,
  damageScalePerWave: 0.05,
  /** Stat scaling stops here, so late waves get more enemies, not sponges. */
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
  },
};

export const DEFAULT_DIFFICULTY: DifficultyId = "normal";

/**
 * What makes the player easy or hard to notice. An enemy that can see the
 * player fills its awareness meter at (multiplier / detectSeconds) per second;
 * the multipliers below shape that, and at 1 it has spotted them.
 */
export const STEALTH = {
  /** A ducked-in player is only in view this close. */
  hideRange: 80,
  /** Inside this an enemy checking the nook finds a hidden player fast. */
  hideCheckRange: 45,
  hideCheckFill: 1.2,
  /** Fill multiplier when hidden and not being checked up close. */
  hideFill: 0.3,
  /** Detection range multiplier with the flashlight off. */
  darkMultiplier: 0.5,
  /** Fill multiplier with the flashlight off. */
  darkFill: 0.7,
  /** Fill multiplier when not moving. */
  stillFill: 0.75,
  /** Fill multiplier up close, fading to farFill at the edge of an enemy's range. */
  closeFill: 1.6,
  farFill: 0.45,
  /** Anything this close is in view whatever the facing. */
  closeNotice: 90,
  /** A gunshot is heard this far, through walls. */
  hearRange: 420,
  /** Awareness a heard gunshot adds. It points the enemy at the sound, not at the player. */
  noiseAwareness: 0.4,
  /** How wide the guess at where a shot came from is. */
  noiseScatter: 80,
  /** A spotted enemy tells friends this close. */
  calloutRange: 320,
  calloutAwareness: 0.6,
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
  /** Nooks this near the spot an enemy lost the player are checked. */
  nookCheckRadius: 220,
  /** The player can duck into a nook from this far outside it. */
  hideZoneSlack: 12,
};

export const FLASHLIGHT = {
  range: 380,
  /** Half the beam width in radians. */
  halfAngle: 0.5,
  /** Everything this close is seen even outside the beam. */
  ambient: 62,
};

export function waveComposition(wave: number): { defId: string; count: number }[] {
  const grunts = Math.min(2 + wave, 10);
  const runners = wave >= 2 ? Math.min(wave - 1, 6) : 0;
  return runners > 0
    ? [
        { defId: "grunt", count: grunts },
        { defId: "runner", count: runners },
      ]
    : [{ defId: "grunt", count: grunts }];
}

/** A booth: three walls and a hide inside, open on one side. */
function booth(x: number, y: number, opens: "up" | "down"): { walls: Arena["walls"]; hide: Arena["hides"][number] } {
  const w = 130;
  const h = 100;
  const t = 24;
  if (opens === "down") {
    return {
      walls: [
        { x, y, w, h: t },
        { x, y, w: t, h },
        { x: x + w - t, y, w: t, h },
      ],
      hide: { x: x + t, y: y + t, w: w - 2 * t, h: h - t },
    };
  }
  return {
    walls: [
      { x, y: y + h - t, w, h: t },
      { x, y, w: t, h },
      { x: x + w - t, y, w: t, h },
    ],
    hide: { x: x + t, y, w: w - 2 * t, h: h - t },
  };
}

const BOOTHS = [booth(110, 100, "down"), booth(960, 100, "down"), booth(110, 600, "up"), booth(960, 600, "up")];

/** 1200x800 warehouse floor: four booths, cover in the middle, hides behind most of it. */
export const ARENA: Arena = {
  width: 1200,
  height: 800,
  walls: [
    // Outer shell, 32 thick. The doors are drawn on it; enemies step in just inside.
    { x: 0, y: 0, w: 1200, h: 32 },
    { x: 0, y: 768, w: 1200, h: 32 },
    { x: 0, y: 0, w: 32, h: 800 },
    { x: 1168, y: 0, w: 32, h: 800 },
    ...BOOTHS.flatMap((b) => b.walls),
    // Centre pillar.
    { x: 560, y: 360, w: 80, h: 80 },
    // Long walls.
    { x: 380, y: 250, w: 24, h: 140 },
    { x: 796, y: 410, w: 24, h: 140 },
    // Crates and bars.
    { x: 300, y: 520, w: 70, h: 70 },
    { x: 830, y: 210, w: 70, h: 70 },
    { x: 440, y: 590, w: 140, h: 24 },
    { x: 620, y: 186, w: 140, h: 24 },
  ],
  hides: [
    ...BOOTHS.map((b) => b.hide),
    // Dark ground behind the cover.
    { x: 300, y: 590, w: 70, h: 50 },
    { x: 830, y: 140, w: 70, h: 70 },
    { x: 440, y: 614, w: 140, h: 46 },
    { x: 620, y: 140, w: 140, h: 46 },
    { x: 332, y: 250, w: 48, h: 140 },
    { x: 820, y: 410, w: 48, h: 140 },
  ],
  patrol: [
    { x: 200, y: 330 },
    { x: 200, y: 470 },
    { x: 440, y: 130 },
    { x: 700, y: 120 },
    { x: 1000, y: 330 },
    { x: 1000, y: 470 },
    { x: 470, y: 450 },
    { x: 730, y: 340 },
    { x: 300, y: 700 },
    { x: 700, y: 690 },
    { x: 920, y: 700 },
    { x: 1100, y: 400 },
    { x: 620, y: 260 },
    { x: 640, y: 640 },
    { x: 430, y: 330 },
  ],
  // Beside the pillar: every door is 350+ away, so nobody steps in already looking at you.
  playerSpawn: { x: 520, y: 400 },
  entries: [
    { id: "north", label: "NORTH DOOR", door: { x: 540, y: 0, w: 120, h: 32 }, pos: { x: 600, y: 56 } },
    { id: "east", label: "EAST DOOR", door: { x: 1168, y: 340, w: 32, h: 120 }, pos: { x: 1144, y: 400 } },
    { id: "south", label: "SOUTH DOOR", door: { x: 540, y: 768, w: 120, h: 32 }, pos: { x: 600, y: 744 } },
    { id: "west", label: "WEST DOOR", door: { x: 0, y: 340, w: 32, h: 120 }, pos: { x: 56, y: 400 } },
  ],
};

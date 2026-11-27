import { LEVELING, PERK_VALUES, PERKS } from "./content";
import type { PerkDefinition, SimState } from "./types";

/**
 * The level-up cards. Everything a card does to the player is read from here,
 * so the sim asks for `playerStats` and never looks at a card by name.
 */

export interface PlayerStats {
  /** Multipliers: 1 is unchanged. */
  damage: number;
  fireRate: number;
  reload: number;
  speed: number;
  xp: number;
  drops: number;
  /** Health per second once nothing has bitten for a while. */
  regen: number;
  /** Health for every kill. */
  leech: number;
  /** Multiplier on how far away a pickup can be taken. */
  magnet: number;
  /** Multiplier on magazine size. */
  mags: number;
  /** How many extra zombies a bullet goes through. */
  pierce: number;
}

function stacks(state: Pick<SimState, "perks">, id: string): number {
  return state.perks[id] ?? 0;
}

export function playerStats(state: Pick<SimState, "perks" | "frenzyLeft">): PlayerStats {
  const frenzy = state.frenzyLeft > 0 ? 2 : 1;
  return {
    damage: 1 + PERK_VALUES.damage * stacks(state, "hollow-points"),
    fireRate: (1 + PERK_VALUES.fireRate * stacks(state, "hot-barrel")) * frenzy,
    // A reload takes this share of its normal time.
    reload: 1 / (1 + PERK_VALUES.reload * stacks(state, "quick-hands")),
    speed: 1 + PERK_VALUES.speed * stacks(state, "fast-feet"),
    xp: 1 + PERK_VALUES.xp * stacks(state, "scavenger"),
    drops: 1 + PERK_VALUES.drops * stacks(state, "big-drops"),
    regen: PERK_VALUES.regenPerSecond * stacks(state, "second-wind"),
    leech: PERK_VALUES.leechHeal * stacks(state, "leech"),
    magnet: 1 + PERK_VALUES.magnet * stacks(state, "magnet"),
    mags: 1 + PERK_VALUES.mags * stacks(state, "big-mags"),
    pierce: stacks(state, "piercing"),
  };
}

/** XP the next level takes, given the level just reached. */
export function xpNeeded(level: number): number {
  return LEVELING.base + LEVELING.step * (Math.max(1, level) - 1);
}

/** Cards that can still be taken this run, in a fixed order. */
export function eligiblePerks(state: Pick<SimState, "perks">): PerkDefinition[] {
  return Object.values(PERKS).filter((perk) => stacks(state, perk.id) < perk.max);
}

/**
 * Three different cards at random. The two chaos cards are half as likely as
 * the rest, so most hands are about building your character. `avoid` lists
 * cards to leave out when a redraw can manage without them.
 */
export function drawCards(state: Pick<SimState, "perks">, roll: () => number, avoid: readonly string[] = []): string[] {
  const all = eligiblePerks(state);
  let pool = all.filter((perk) => !avoid.includes(perk.id));
  if (pool.length < Math.min(3, all.length)) pool = all;
  const cards: string[] = [];
  while (cards.length < 3 && pool.length > 0) {
    const weights = pool.map((perk) => (perk.kind === "chaos" ? 0.5 : 1));
    let pick = roll() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < pool.length - 1 && pick >= weights[index]) {
      pick -= weights[index];
      index += 1;
    }
    cards.push(pool[index].id);
    pool = pool.filter((_, i) => i !== index);
  }
  return cards;
}

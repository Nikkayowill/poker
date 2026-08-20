/**
 * Player rank: the progression spine.
 *
 * Pure and closed-form on purpose. This lives in lib/ rather than beside the
 * component that draws the bar because vitest.config.ts collects only lib/ and
 * app/ -- the same reason lib/arcade/games.ts and lib/profile/daily-gold.ts are
 * where they are. Nothing here reads a clock, a database or a random number, so
 * the whole curve is reachable from `npm test`.
 *
 * The economics worth stating up front, because they constrain every constant
 * below. Gold is bought with real money and granted as progression; chips are
 * gameplay. A level-up reward is therefore a *faucet*, and there is no house
 * edge anywhere in this economy to weigh it against any more -- every staked
 * game left is winner-take-all PvP with no rake. So the constraint is more
 * direct than "stay under the house's cut": a faucet that hands out too much
 * undermines what a real-money Gold purchase is actually worth. The rewards
 * here are deliberately small in Gold and large in standing instead: rank
 * names, badges and milestone unlocks cost the economy nothing and are what
 * actually make a player feel like they have been somewhere.
 */

/**
 * Gold wagered per point of XP.
 *
 * Wagered, not won or lost: rewarding *volume* is what makes a losing session
 * still count for something, and it is the only measure a player cannot game by
 * choosing when to stop. Ten is the whole conversion -- a 250 Gold arcade round
 * is 25 XP, a 5,000 Gold one is 500.
 */
export const GOLD_PER_XP = 10;

/**
 * The gap between consecutive levels, in XP, before the linear ramp below.
 *
 * Levels get further apart by exactly this much each time, which makes the
 * cumulative curve a triangular number and its inverse a closed-form square
 * root rather than a loop over a table.
 */
export const XP_STEP = 250;

/**
 * Where the ladder stops.
 *
 * Capped rather than open-ended so `levelReward` is a finite, testable table
 * and so the top of the curve is a place to arrive at instead of an asymptote.
 */
export const MAX_LEVEL = 100;

/** XP earned by staking `gold`. Fractions are dropped; a stake never costs XP. */
export function xpForWager(gold: number): number {
  if (!Number.isFinite(gold) || gold <= 0) return 0;
  return Math.floor(gold / GOLD_PER_XP);
}

/**
 * Total XP needed to *reach* `level`. Level 1 is where everyone starts, so it
 * costs nothing; each level after that costs XP_STEP more than the one before.
 */
export function xpToReachLevel(level: number): number {
  const capped = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
  return (XP_STEP * (capped - 1) * capped) / 2;
}

/**
 * The level a given lifetime XP total buys.
 *
 * The square root inverts the triangular sum directly, but floating point at a
 * boundary is exactly the kind of thing that shows a player level 9 when they
 * have precisely the XP for 10. The correction below re-tests the candidate
 * against integer arithmetic, so the boundary is decided by the same expression
 * that defined it.
 */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  const estimate = Math.floor((1 + Math.sqrt(1 + (8 * xp) / XP_STEP)) / 2);
  let level = Math.min(Math.max(estimate, 1), MAX_LEVEL);
  while (level < MAX_LEVEL && xpToReachLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpToReachLevel(level) > xp) level -= 1;
  return level;
}

export interface RankProgress {
  level: number;
  xp: number;
  /** XP earned since this level began. Always 0 at MAX_LEVEL, which has no next. */
  intoLevel: number;
  /** XP this level spans. 0 at MAX_LEVEL, so a bar can render full rather than divide by it. */
  levelSpan: number;
  /** 0..1 for the progress bar. Exactly 1 at MAX_LEVEL. */
  ratio: number;
  title: string;
  /** The next title and the level that earns it, or null at the top of the ladder. */
  nextTitle: string | null;
  nextTitleLevel: number | null;
}

/**
 * The rank ladder.
 *
 * Bands rather than a name per level: a title that changes every time is not a
 * title. Each entry is the level at which its name starts, and the table is
 * ordered so a linear scan from the end finds the current band -- eight names
 * do not justify a binary search.
 *
 * Readonly tuple for the reason STAKES_TIERS is one in lib/game/tiers.ts: the
 * names are derived from the data instead of restated beside it, so a ninth
 * band cannot exist in one place and be missing from another.
 */
export const RANK_BANDS = [
  { from: 1, title: "Rail Bird" },
  { from: 5, title: "Grinder" },
  { from: 12, title: "Regular" },
  { from: 22, title: "Rounder" },
  { from: 35, title: "Shark" },
  { from: 50, title: "High Roller" },
  { from: 70, title: "Whale" },
  { from: 90, title: "Legend" },
] as const;

export type RankTitle = (typeof RANK_BANDS)[number]["title"];

export function rankTitle(level: number): RankTitle {
  let title: RankTitle = RANK_BANDS[0].title;
  for (const band of RANK_BANDS) {
    if (level >= band.from) title = band.title;
  }
  return title;
}

/** Everything a rank readout needs, derived from one number. */
export function rankProgress(xp: number): RankProgress {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = levelForXp(safeXp);
  const atCap = level >= MAX_LEVEL;
  const floor = xpToReachLevel(level);
  const levelSpan = atCap ? 0 : xpToReachLevel(level + 1) - floor;
  const intoLevel = atCap ? 0 : safeXp - floor;
  const upcoming = RANK_BANDS.find((band) => band.from > level) ?? null;

  return {
    level,
    xp: safeXp,
    intoLevel,
    levelSpan,
    ratio: atCap ? 1 : Math.min(1, intoLevel / levelSpan),
    title: rankTitle(level),
    nextTitle: upcoming ? upcoming.title : null,
    nextTitleLevel: upcoming ? upcoming.from : null,
  };
}

/**
 * How often a level pays Gold, and the size of that payment.
 *
 * Every fifth level only. A trickle on every level-up is both a bigger faucet
 * and a smaller event -- the point of a reward is that arriving at it is worth
 * noticing. MILESTONE_GOLD is per milestone *number*, so level 5 pays 500 and
 * level 50 pays 5,000: the ramp tracks the rising stakes a player at that level
 * is actually playing, without ever approaching the turnover it took to get
 * there (level 50 costs ~3M Gold wagered and has paid ~27,500 Gold back across
 * every milestone below it, well inside the house's edge on that turnover).
 */
export const MILESTONE_EVERY = 5;
export const MILESTONE_GOLD = 500;

export interface LevelReward {
  level: number;
  gold: number;
  /** True where the level also changes what the player is called. */
  newTitle: RankTitle | null;
}

/** What arriving at `level` is worth. Level 1 is the start, not an achievement. */
export function levelReward(level: number): LevelReward {
  const at = Math.floor(level);
  const band = RANK_BANDS.find((entry) => entry.from === at) ?? null;
  const gold = at > 1 && at % MILESTONE_EVERY === 0
    ? (at / MILESTONE_EVERY) * MILESTONE_GOLD
    : 0;
  return { level: at, gold, newTitle: band ? band.title : null };
}

/**
 * Every reward crossed by going from `fromLevel` to `toLevel`.
 *
 * Plural because a single big wager can cross several levels at once, and each
 * one has to pay: awarding only the level landed on would quietly swallow the
 * milestones jumped over. Returns an empty array when nothing was crossed, so
 * the caller can treat "no level-up" and "level-up worth nothing" the same way.
 */
export function rewardsBetween(fromLevel: number, toLevel: number): LevelReward[] {
  const rewards: LevelReward[] = [];
  for (let level = Math.floor(fromLevel) + 1; level <= Math.floor(toLevel); level += 1) {
    rewards.push(levelReward(level));
  }
  return rewards;
}

/** Total Gold owed for crossing from one level to another. */
export function goldForLevelUps(fromLevel: number, toLevel: number): number {
  return rewardsBetween(fromLevel, toLevel).reduce((sum, reward) => sum + reward.gold, 0);
}

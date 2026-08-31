/**
 * The Sovereign Mint's whole economy in one file: node tuning, the concurrent
 * cap, and the plot ladder. Everything staked or paid by the Mint traces back
 * to a number here, the same single-source rule STAKES_TIERS enforces for the
 * tables.
 *
 * Two deliberate shapes, both anti-money-printer (the Mint is a guaranteed
 * win, so the Ante Up lesson applies with no variance to soften it):
 *
 * - Payouts are flat net bonuses, not multipliers. Income cannot compound
 *   with bankroll size; a whale's Matrix node earns the same +2,500 a
 *   just-solvent player's does.
 * - MINT_CONCURRENT_NODE_CAP bounds how many nodes grow at once, so the
 *   maximum guaranteed daily income is a small constant (three Matrix nodes
 *   cycled daily is +7,500), in rewarded-ads territory rather than table
 *   stakes. Owning more plots is progression and layout, never more income.
 *
 * The payout is snapshotted onto the plot row at plant time and never re-read
 * here at harvest -- the same rule StoredWordStackRound.wagerLadder states: a
 * retune must not change what an already-planted node pays.
 */

export const MINT_NODE_TYPES = ["pulse", "core", "matrix"] as const;
export type MintNodeType = (typeof MINT_NODE_TYPES)[number];

export function isMintNodeType(value: string): value is MintNodeType {
  return (MINT_NODE_TYPES as readonly string[]).includes(value);
}

export interface MintNodeDef {
  /** Gold debited at plant. */
  stake: number;
  /** Wall-clock time until the node is harvestable. */
  durationMs: number;
  /** Gold credited at harvest: the stake back plus a flat net bonus. */
  payout: number;
}

/**
 * Keep the payout ceilings in supabase/migrations/*_mint_plots.sql's
 * mint_plots_enforce_node_shape() in step with this table when retuning.
 */
export const MINT_NODES: Readonly<Record<MintNodeType, MintNodeDef>> = {
  pulse: { stake: 1_000, durationMs: 15 * 60 * 1000, payout: 1_050 },
  core: { stake: 10_000, durationMs: 4 * 60 * 60 * 1000, payout: 10_600 },
  matrix: { stake: 50_000, durationMs: 24 * 60 * 60 * 1000, payout: 52_500 },
};

/**
 * How many nodes may be growing at once, across the whole grid. Mirrored by
 * a BEFORE trigger in the mint_plots migration (advisory-locked, so two
 * racing plants cannot squeeze past it).
 */
export const MINT_CONCURRENT_NODE_CAP = 3;

/** The grid is 4x4; plot indexes are 1-based to match plot_index's CHECK. */
export const MINT_GRID_PLOTS = 16;

/** The first four plots are free; the rest are a pure Gold sink. */
export const MINT_FREE_PLOTS = 4;

/**
 * What unlocking a plot costs. Doubles per tile from 2,500, so the last tile
 * is aspirational (5.12M) the way the top of the character ladder is. Sunk
 * Gold, never returned: plots are progression, not principal.
 */
export function mintPlotPrice(plotIndex: number): number | null {
  if (!Number.isInteger(plotIndex)) return null;
  if (plotIndex <= MINT_FREE_PLOTS || plotIndex > MINT_GRID_PLOTS) return null;
  return 2_500 * 2 ** (plotIndex - MINT_FREE_PLOTS - 1);
}

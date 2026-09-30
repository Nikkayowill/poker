import { STAKE_PRESSURE_LABELS } from "@/lib/arcade/stake-pressure";

/**
 * Solo earnings: what a player has won and lost on PVE and solo wagers, and the
 * rank that follows from it.
 *
 * Rank used to be Gold *staked*, so it climbed just by playing. It is now the
 * difficulty-weighted *net* of every settled solo wager: a win adds the Gold it
 * made over the stake, a loss takes the stake off, and both count for more the
 * harder the stake band. Pure and closed-form, like rank.ts, so the whole rule
 * is reachable from the unit tests.
 *
 * "Solo" here is every arcade wager that pays from the house rather than from
 * another player: Sudoku, Minesweeper, Nonogram, Blockudoku, Word Fill-In,
 * Memory Match, Word Stack, Connections and the brain games. PVP has its own
 * boards and does not move this rank.
 */

/** Gold of weighted net earnings per point of rank. Points place a player on the tier ladder in rank.ts. */
export const GOLD_PER_RANK_POINT = 20;

/** One stake band's running totals for a player. */
export interface BandTotals {
  /** Settled wagers that paid something. */
  wins: number;
  /** Settled wagers that paid nothing. */
  losses: number;
  /** Gold staked across all of them. */
  staked: number;
  /** Gold paid back across all of them. */
  paidOut: number;
}

export const EMPTY_BAND: BandTotals = { wins: 0, losses: 0, staked: 0, paidOut: 0 };

/** Totals keyed by stake band index (see stakePressure). A band with no play is simply absent. */
export type EarningsByBand = Readonly<Record<number, BandTotals>>;

/** What the top band counts for, against 1x for the bottom one. */
export const TOP_BAND_RANK_WEIGHT = 10;

/**
 * How much a band's Gold counts toward rank: Easy 1x, growing geometrically to
 * 10x at the top band, whatever the number of bands. Steep on purpose, so a
 * player who stays on the hard bands out-ranks one who grinds Easy for more
 * Gold. The same weight applies to a win and to a loss, so a big Expert stake
 * is a big move in both directions.
 */
export function bandRankWeight(band: number): number {
  const top = stakeBandIndexes().length - 1;
  if (top <= 0) return 1;
  const clamped = Math.min(top, Math.max(0, Math.floor(band)));
  return TOP_BAND_RANK_WEIGHT ** (clamped / top);
}

/** Gold made over the stake in one band. Negative when the band is down. */
export function bandNet(totals: BandTotals): number {
  return totals.paidOut - totals.staked;
}

/** The weighted net across every band, in Gold. */
export function weightedNet(byBand: EarningsByBand): number {
  let sum = 0;
  for (const [band, totals] of Object.entries(byBand)) sum += bandNet(totals) * bandRankWeight(Number(band));
  return sum;
}

/**
 * Rank points: the starting base plus the weighted net, never below zero.
 *
 * `base` carries a player over from the old wager-volume rank: it is the points
 * at the start of the level they held when this shipped, so they begin where
 * they were and move from there. Everyone else's base is 0.
 */
export function rankPointsFrom(base: number, byBand: EarningsByBand): number {
  const points = Math.floor(base + weightedNet(byBand) / GOLD_PER_RANK_POINT);
  return Math.max(0, points);
}

/**
 * The totals as they stood before one result was recorded: the inverse of what
 * the store adds. Lets the caller price a single settle in rank points from the
 * after-state alone, with no second read.
 */
export function withoutResult(byBand: EarningsByBand, band: number, wager: number, payout: number): EarningsByBand {
  const current = byBand[band] ?? EMPTY_BAND;
  const won = payout > 0;
  return {
    ...byBand,
    [band]: {
      wins: Math.max(0, current.wins - (won ? 1 : 0)),
      losses: Math.max(0, current.losses - (won ? 0 : 1)),
      staked: Math.max(0, current.staked - wager),
      paidOut: Math.max(0, current.paidOut - payout),
    },
  };
}

export interface BandShare {
  band: number;
  label: string;
  wins: number;
  losses: number;
  staked: number;
  paidOut: number;
  net: number;
  /** This band's share of all Gold paid out, 0..1. 0 for everyone when nothing has been paid. */
  share: number;
}

export interface DifficultyGauge {
  /** The paid-out-weighted average band, 0 (Easy) to bands-1 (the top band). Null with nothing paid yet. */
  average: number | null;
  /** `average` as 0..1 for a needle. Null with nothing paid yet. */
  needle: number | null;
  /** The label of the band nearest the average, or null with nothing paid yet. */
  label: string | null;
}

export interface SoloEarningsSummary {
  wins: number;
  losses: number;
  /** Gold staked across every settled solo wager. */
  totalStaked: number;
  /** Gold earned: everything solo wagers have paid back. */
  totalPaidOut: number;
  /** Paid out minus staked. Negative when the player is down. */
  net: number;
  bands: BandShare[];
  difficulty: DifficultyGauge;
}

/** The band indexes the app has, in order, read off the labels so a new band appears here by itself. */
export function stakeBandIndexes(): number[] {
  return Object.keys(STAKE_PRESSURE_LABELS)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Everything the earnings tracker and the difficulty gauge draw, from one set of totals. */
export function summarizeSoloEarnings(byBand: EarningsByBand): SoloEarningsSummary {
  const indexes = stakeBandIndexes();
  const labels = STAKE_PRESSURE_LABELS as Record<number, string>;
  const totalPaidOut = indexes.reduce((sum, band) => sum + (byBand[band]?.paidOut ?? 0), 0);

  const bands: BandShare[] = indexes.map((band) => {
    const totals = byBand[band] ?? EMPTY_BAND;
    return {
      band,
      label: labels[band],
      wins: totals.wins,
      losses: totals.losses,
      staked: totals.staked,
      paidOut: totals.paidOut,
      net: bandNet(totals),
      share: totalPaidOut > 0 ? totals.paidOut / totalPaidOut : 0,
    };
  });

  const top = indexes[indexes.length - 1] ?? 0;
  const average = totalPaidOut > 0 ? bands.reduce((sum, entry) => sum + entry.band * entry.share, 0) : null;
  const nearest = average === null ? null : bands.reduce((best, entry) => (Math.abs(entry.band - average) < Math.abs(best.band - average) ? entry : best));

  return {
    wins: bands.reduce((sum, entry) => sum + entry.wins, 0),
    losses: bands.reduce((sum, entry) => sum + entry.losses, 0),
    totalStaked: bands.reduce((sum, entry) => sum + entry.staked, 0),
    totalPaidOut,
    net: totalPaidOut - bands.reduce((sum, entry) => sum + entry.staked, 0),
    bands,
    difficulty: {
      average,
      needle: average === null ? null : top > 0 ? average / top : 0,
      label: nearest ? nearest.label : null,
    },
  };
}

/**
 * Crossbreeding Beds: a small planted grid where two adjacent, ripe rows of
 * different stock can mutate into a rare hybrid at harvest.
 *
 * A DELIBERATELY NEW GRID, NOT A REVIVAL OF `homestead_plots`. StackAcres
 * dropped its plot grid outright on 2026-09-03 (see ./world.ts's own header
 * and ./catalogue.ts's "THERE IS NO PLOT GRID ANY MORE") -- Kayo didn't want
 * visible plot patches, so a `homestead_units` row has no position at all any
 * more and nothing in the rest of the farm has neighbors. Crossbreeding is
 * the one place in StackAcres that genuinely needs 2D adjacency -- two rows
 * cannot cross unless they are standing next to each other -- so rather than
 * resurrecting the dead per-unit plot grid (which the game's own history
 * records as a deliberate, reasoned removal), this is its own small, fixed
 * grid that only a Crossbreeding Bed uses. It does not touch `stockZone`,
 * `growAreaBounds`, or any `homestead_units` row.
 *
 * PHASER-FREE AND CLOCK-FREE, same discipline as ./juice.ts and ./world.ts's
 * `growthStage`: a plot's `ready` flag is a boolean the caller has already
 * derived from its own clock (the same shape `growthStage(progress, ready)`
 * takes), not a timestamp this module reads `Date.now()` against. That is
 * what keeps `evaluateMutationChance` a pure function of its snapshot, and
 * what makes the whole engine trivially testable without faking time.
 *
 * THE STATE TREE, mapped explicitly rather than left implicit:
 *
 *   CrossbreedBedPlot
 *     .stock === null                 -- empty soil, nothing planted
 *     .stock !== null, !.ready        -- planted, still growing
 *     .stock !== null, .ready         -- ripe, harvestable
 *
 *   evaluateMutationChance(plotId, grid)
 *     plot not in grid                -- throws (a caller error: every real
 *                                         caller reads plotId out of the same
 *                                         snapshot it passes in)
 *     plot empty or not ripe          -- null (nothing to cross; harvesting
 *                                         nothing is not this module's job)
 *     no ripe, differently-stocked
 *       neighbor exists               -- null (a lone ripe row just harvests
 *                                         plain, see resolveCrossbreedHarvest)
 *     >=1 qualifying neighbor         -- the single best match (see "TIE-BREAK")
 *
 *   resolveCrossbreedHarvest(plotId, grid, random)
 *     evaluation null                 -- clears only the harvested plot
 *     evaluation rolls a miss         -- clears only the harvested plot; the
 *                                         neighbor it almost crossed with is
 *                                         untouched and keeps growing
 *     evaluation rolls a hit          -- clears BOTH the harvested plot and
 *                                         the neighbor it crossed with, and
 *                                         reports the one hybrid produced
 *
 * TIE-BREAK, when more than one neighbor qualifies (a ripe plot boxed in on
 * two or more sides by different, matchable stock): the pairing with the
 * strictly higher chance wins; a genuine tie in chance is broken by scan
 * order, north before south before east before west (NEIGHBOR_DIRECTIONS'
 * own order). This is arbitrary in the sense that any total order would do,
 * but it has to BE a total order and not "whichever the grid happened to list
 * first" -- the same reason `headingTo` in ./world.ts picks a fixed rule for
 * its own on-the-diagonal tie rather than leaving it to iteration order.
 *
 * "Self-pollination is not cross-breeding": a plot never matches itself
 * (guarded explicitly, belt-and-braces against a caller's grid ever
 * containing a duplicate id), and two neighbors of the IDENTICAL stock never
 * match each other -- CROSSBREED_MATRIX only ever pairs two DIFFERENT stock
 * kinds (crossbreedMatrixEntryFor short-circuits `a === b` before ever
 * consulting the table), so a field of all corn can never mutate on its own.
 */

import { isLivestock, type StackAcresStock } from "./catalogue";
import type { CrossbreedItem } from "./crossbreed-items";

/** A source of numbers in [0, 1). Injected so a test can make it boring --
 *  same contract every other seeded system in StackAcres uses (see
 *  ./contracts.ts and ./world.ts's own `Random`, each restated locally rather
 *  than imported, since neither module has any other reason to depend on
 *  this one). */
export type Random = () => number;

/** Fixed bed size: 16 plots, arranged 4x4. Not derived from anything else --
 *  a Crossbreeding Bed is its own small, bounded plot of ground, not scaled
 *  by capacity or tier the way `homestead_units`'s caps are. */
export const CROSSBREED_GRID_ROWS = 4;
export const CROSSBREED_GRID_COLS = 4;

export function isInCrossbreedGrid(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < CROSSBREED_GRID_ROWS &&
    col >= 0 &&
    col < CROSSBREED_GRID_COLS
  );
}

/** One bed plot as the engine needs to see it. A store row (see
 *  lib/server/stackacres-crossbreeding-store.ts) carries more than this --
 *  ids, timestamps, ownership -- this is the pure derivation's own narrow
 *  slice of it. */
export interface CrossbreedBedPlot {
  id: string;
  row: number;
  col: number;
  /** null means empty soil -- nothing planted here. */
  stock: StackAcresStock | null;
  /** Already derived by the caller's own clock; see this file's header for
   *  why this module never reads a timestamp itself. Meaningless (and
   *  ignored) when `stock` is null. */
  ready: boolean;
}

export type CrossbreedGridSnapshot = readonly CrossbreedBedPlot[];

type Direction = "north" | "south" | "east" | "west";

/** Row/col deltas for each compass direction, in the fixed order the
 *  tie-break above reads from. */
const NEIGHBOR_DIRECTIONS: ReadonlyArray<{ direction: Direction; dRow: number; dCol: number }> = [
  { direction: "north", dRow: -1, dCol: 0 },
  { direction: "south", dRow: 1, dCol: 0 },
  { direction: "east", dRow: 0, dCol: 1 },
  { direction: "west", dRow: 0, dCol: -1 },
];

/**
 * One entry in the mutation matrix: two different StackAcres stock kinds,
 * unordered (a Sprout row can cross a Cash Crop row from either side, and so
 * can the reverse), a chance in (0, 1], and the one hybrid item it yields.
 *
 * Every real pair either has exactly one entry here or none -- crossbreeding.
 * test.ts holds that there is never a second entry for the same unordered
 * pair, so `crossbreedMatrixEntryFor` never has to arbitrate between two
 * conflicting rules for the same two kinds.
 */
export interface CrossbreedMatrixEntry {
  a: StackAcresStock;
  b: StackAcresStock;
  hybrid: CrossbreedItem;
  /** Roll chance on a single qualifying adjacency, in (0, 1]. */
  chance: number;
}

/**
 * Every crossbreedable pair StackAcres actually grows. Deliberately real
 * StackAcres stock only (sprout, cash_crop, hen, pig, cattle -- see
 * ./catalogue.ts) -- there is no "tomato" in this farm, the same rule
 * ./juice.ts's own header states for its shard styling, and it applies just
 * as much to what two rows are allowed to cross.
 *
 * Chances are deliberately modest (5%-18%) and deliberately asymmetric across
 * pairs: two crops standing together is the easiest, most literal reading of
 * "cross-pollination" and gets the richest chance; two kinds of livestock
 * standing together is the most far-fetched pairing here and gets the
 * smallest. Nothing here pays Gold on its own -- see ./crossbreed-items.ts's
 * own header for why a hybrid is inventory, not a payout.
 */
export const CROSSBREED_MATRIX: readonly CrossbreedMatrixEntry[] = [
  { a: "sprout", b: "cash_crop", hybrid: "golden_maize", chance: 0.18 },
  { a: "sprout", b: "hen", hybrid: "sunroot_egg", chance: 0.1 },
  { a: "cash_crop", b: "pig", hybrid: "candied_husk", chance: 0.08 },
  { a: "hen", b: "pig", hybrid: "marbled_down", chance: 0.07 },
  { a: "pig", b: "cattle", hybrid: "tallow_wool", chance: 0.06 },
  { a: "cattle", b: "hen", hybrid: "custard_curd", chance: 0.05 },
];

/** How many of a hybrid item one successful cross yields. Flat across every
 *  pairing, same posture ./wheat-plot.ts's own `WHEAT_YIELD_QUANTITY` takes
 *  for a single-tier crop with nothing to scale the yield against -- a
 *  hybrid is meant to read as "one rare thing", not a quantity worth
 *  tuning per pair before there is any player feedback on the loop at all. */
export const CROSSBREED_YIELD_QUANTITY = 1;

/** The matrix entry for this unordered pair, or null if StackAcres has no
 *  cross defined for it (including, always, a pair of the same kind --
 *  "self-pollination is not cross-breeding", this file's own header). */
export function crossbreedMatrixEntryFor(
  stockA: StackAcresStock,
  stockB: StackAcresStock,
): CrossbreedMatrixEntry | null {
  if (stockA === stockB) return null;
  for (const entry of CROSSBREED_MATRIX) {
    if ((entry.a === stockA && entry.b === stockB) || (entry.a === stockB && entry.b === stockA)) {
      return entry;
    }
  }
  return null;
}

/** Every stock kind at least one matrix entry crosses -- used by
 *  crossbreeding.test.ts to assert the matrix does not silently drift away
 *  from ./catalogue.ts's own five kinds, and by anything that wants to know
 *  "can this row ever cross with something" without walking the whole
 *  matrix. */
export function crossbreedableStock(): readonly StackAcresStock[] {
  const seen = new Set<StackAcresStock>();
  for (const entry of CROSSBREED_MATRIX) {
    seen.add(entry.a);
    seen.add(entry.b);
  }
  return [...seen];
}

/** Whichever of a pair is livestock, if either is -- not used by the matrix
 *  itself (which only cares that the two kinds differ), but exported for a
 *  caller that wants to flavor a mutation's own FX by whether it crossed two
 *  crops, two animals, or one of each. Kept here rather than duplicated at
 *  the call site since ./catalogue.ts's `isLivestock` is the one source of
 *  truth for the crop/livestock split. */
export function crossedTrack(a: StackAcresStock, b: StackAcresStock): "crop" | "livestock" | "mixed" {
  const aLive = isLivestock(a);
  const bLive = isLivestock(b);
  if (aLive && bLive) return "livestock";
  if (!aLive && !bLive) return "crop";
  return "mixed";
}

function findPlotById(grid: CrossbreedGridSnapshot, id: string): CrossbreedBedPlot | undefined {
  return grid.find((plot) => plot.id === id);
}

/** The plot standing at this exact row/col, if any -- looked up by
 *  COORDINATE, never by array index or position in `grid`, since a real
 *  snapshot can list plots in any order (or omit empty ones outright; see
 *  this function's own null-safe callers). */
function findPlotAt(grid: CrossbreedGridSnapshot, row: number, col: number): CrossbreedBedPlot | undefined {
  return grid.find((plot) => plot.row === row && plot.col === col);
}

export interface CrossbreedMutationEvaluation {
  plotId: string;
  neighborPlotId: string;
  direction: Direction;
  hybrid: CrossbreedItem;
  chance: number;
}

/**
 * Scans this plot's four grid neighbors (north, south, east, west by
 * COORDINATE, not by array position -- see this file's header) for the best
 * qualifying cross, or null when there is none.
 *
 * Throws if `plotId` is not present in `gridSnapshot` at all: every real
 * caller reads the id it passes here out of the very same snapshot, so a
 * miss means the caller handed in a stale id from a different grid read --
 * a programmer error worth surfacing loudly, not a game state to fold into
 * "no mutation".
 */
export function evaluateMutationChance(
  plotId: string,
  gridSnapshot: CrossbreedGridSnapshot,
): CrossbreedMutationEvaluation | null {
  const plot = findPlotById(gridSnapshot, plotId);
  if (!plot) {
    throw new Error(`evaluateMutationChance: no plot ${plotId} in the given grid snapshot`);
  }
  if (plot.stock === null || !plot.ready) return null;

  let best: CrossbreedMutationEvaluation | null = null;
  for (const { direction, dRow, dCol } of NEIGHBOR_DIRECTIONS) {
    const neighborRow = plot.row + dRow;
    const neighborCol = plot.col + dCol;
    if (!isInCrossbreedGrid(neighborRow, neighborCol)) continue;

    const neighbor = findPlotAt(gridSnapshot, neighborRow, neighborCol);
    if (!neighbor || neighbor.id === plot.id) continue;
    if (neighbor.stock === null || !neighbor.ready) continue;

    const entry = crossbreedMatrixEntryFor(plot.stock, neighbor.stock);
    if (!entry) continue;

    // Strictly greater only: the first direction scanned at the current best
    // chance keeps its place, which is exactly NEIGHBOR_DIRECTIONS' own
    // north-south-east-west tie-break (this file's header, "TIE-BREAK").
    if (!best || entry.chance > best.chance) {
      best = {
        plotId: plot.id,
        neighborPlotId: neighbor.id,
        direction,
        hybrid: entry.hybrid,
        chance: entry.chance,
      };
    }
  }
  return best;
}

/** One roll against an evaluation's own chance. A null evaluation (nothing
 *  qualified) always misses -- there is no chance to roll against. */
export function rollCrossbreedMutation(
  evaluation: CrossbreedMutationEvaluation | null,
  random: Random,
): boolean {
  if (!evaluation) return false;
  return random() < evaluation.chance;
}

export interface CrossbreedHarvestResult {
  mutated: boolean;
  /** The one hybrid produced, or null on a plain harvest (no qualifying
   *  neighbor, or the roll missed). */
  hybrid: CrossbreedItem | null;
  /** Every bed plot this harvest clears. Always includes the harvested plot
   *  itself; a successful mutation also clears the neighbor it crossed with
   *  -- "the original rows are cleared out" is both of these, not just the
   *  one the player tapped. */
  clearedPlotIds: readonly string[];
}

/**
 * The whole decision for one harvest tap: evaluate, roll, and say exactly
 * which rows this settles. Pure end to end -- the caller (see
 * lib/server/stackacres-crossbreeding-store.ts) is the only place any of
 * this actually gets written, inside one atomic RPC that clears every id
 * `clearedPlotIds` names and credits `hybrid` in the same transaction.
 */
export function resolveCrossbreedHarvest(
  plotId: string,
  gridSnapshot: CrossbreedGridSnapshot,
  random: Random,
): CrossbreedHarvestResult {
  const evaluation = evaluateMutationChance(plotId, gridSnapshot);
  const mutated = rollCrossbreedMutation(evaluation, random);

  if (mutated && evaluation) {
    return {
      mutated: true,
      hybrid: evaluation.hybrid,
      clearedPlotIds: [plotId, evaluation.neighborPlotId],
    };
  }
  return { mutated: false, hybrid: null, clearedPlotIds: [plotId] };
}

/**
 * One planted Crossbreeding Bed cell as a store row actually holds it --
 * narrower than the full stored shape (see
 * lib/server/stackacres-crossbreeding-store.ts's `StoredCrossbreedPlot`),
 * just the fields `toCrossbreedBedPlot` needs to adapt a row into this
 * engine's own `CrossbreedBedPlot`.
 */
export interface StackAcresCrossbreedPlotRow {
  id: string;
  row: number;
  col: number;
  stock: StackAcresStock;
  readyAt: string;
}

/**
 * Whether a planted row has ripened by `atMs` -- a plain function of the
 * timestamp it was snapshotted with, same discipline as ./units.ts's own
 * `progressOf`: this module never reads a clock itself, so the server's own
 * authoritative `now` (never a client-supplied one) is the only thing that
 * can ever decide readiness for real.
 */
export function isCrossbreedPlotReady(row: Pick<StackAcresCrossbreedPlotRow, "readyAt">, atMs: number): boolean {
  const ready = Date.parse(row.readyAt);
  return Number.isFinite(ready) && atMs >= ready;
}

/** Adapts one stored row into the narrow shape `evaluateMutationChance` and
 *  `resolveCrossbreedHarvest` actually need. The caller builds a full
 *  `CrossbreedGridSnapshot` by mapping every row it read with this, same
 *  shape ./units.ts's own row-to-snapshot derivation takes. */
export function toCrossbreedBedPlot(row: StackAcresCrossbreedPlotRow, atMs: number): CrossbreedBedPlot {
  return {
    id: row.id,
    row: row.row,
    col: row.col,
    stock: row.stock,
    ready: isCrossbreedPlotReady(row, atMs),
  };
}

/** Mulberry32, the identical generator ./world.ts's own `seededRandom` uses
 *  (restated here rather than imported for the same reason `Random` is
 *  restated: this module has no other reason to depend on ./world.ts). A
 *  deterministic source keyed off the plot id, so a bed's own display can
 *  preview "would this cross" consistently without server round-trips, the
 *  same trick ./world.ts's `cropSpot` plays for a unit's fixed position. */
export function seededRandomForPlot(plotId: string): Random {
  let hash = 0x811c9dc5;
  for (let i = 0; i < plotId.length; i += 1) {
    hash ^= plotId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

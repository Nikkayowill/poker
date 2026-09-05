/**
 * Critical Harvest Cascade: when a tap crits, chain into other ready units
 * standing in the same district.
 *
 * THERE IS NO PLOT GRID (see world.ts's own header, and the 2026-09-03
 * CLAUDE.md entry it cites -- "districts hold stock, not plots"). A unit has
 * no position of its own to look up a neighbor from -- an animal wanders
 * freely inside its district's grow area and a crop's screen spot is a
 * deterministic hash of its own id (world.ts's `cropSpot`), neither of which
 * carries any game-state meaning. So "adjacent" here is not a grid
 * relationship at all: it is `stockZone(stock)` equality, the one grouping
 * StackAcres' data model still has. Two ready hens in the Farmstead are
 * "adjacent" for this feature's purposes; a ready hen and a ready pig never
 * are, no matter how close their wandered positions happen to land this
 * frame.
 *
 * BOUNDED ON PURPOSE. An uncapped cascade would turn a single tool-tier crit
 * roll (12%/25% -- see equipment.ts's `rollHarvestCrit`) into a free sweep of
 * an entire district, stacked on top of a mechanic that already pays a
 * multiplier. StackChips has already had to walk back exactly this shape
 * once, on Ante Up's uncapped multiplier tables (see CLAUDE.md's "Ante Up was
 * a money printer" entry) -- an unbounded per-play payout combined with
 * unlimited replay compounded into base-rate farming. The shapes are not
 * identical (a cascade is gated behind an already-priced-in crit chance, not
 * free replay), but the caution generalizes: an automatic bonus that scales
 * with however much matching stock a player happens to be holding wants a
 * hard ceiling stated up front, not one discovered from a support ticket.
 * `CASCADE_MAX_UNITS` is that ceiling.
 *
 * DEPTH ONE, NOT RECURSIVE. This module only ever answers "what would chain
 * from THIS crit" -- it has no opinion on whether a chained sweep's own crit
 * should chain again. That policy lives at the call site
 * (stackacres-farm.tsx's `triggerCascade`), which cascades at most once per
 * origin tap. See its own comment for why a length-1 cascade target list is
 * exactly the case that would otherwise recurse if that guard were dropped.
 *
 * PAYS THROUGH THE EXISTING SWEEP, NOT A NEW RPC, AND ALREADY ROW-LOCKED AND
 * SEQUENTIAL. A chained unit is collected by sending its id back through the
 * same `collect` action (app/api/stackacres/actions/route.ts) and the same
 * `harvestStackAcres` (lib/server/stackacres-service.ts) every other harvest
 * already goes through. This module never touches Gold, inventory, or a
 * database transaction at all -- it only answers which unit ids are eligible
 * to be asked for again -- and that is deliberate, not a shortcut: the write
 * it hands off to already satisfies both properties a hand-rolled cascade
 * write would otherwise need to reimplement.
 *
 * Concretely, `collectStackAcresUnit` (lib/server/stackacres-store.ts) settles
 * each unit with a single atomic `UPDATE ... WHERE id = ? AND version = ? AND
 * status = 'working' AND ready_at <= now()`, not a separate `SELECT ... FOR
 * UPDATE` followed by an `UPDATE`. Postgres row-locks whatever a single
 * UPDATE statement's WHERE clause matches for the statement's own duration,
 * and there is no separate read step in between for a second writer to widen
 * into -- the exact TOCTOU gap `FOR UPDATE` exists to close in a multi-
 * statement transaction is structurally absent here, which is a strictly
 * narrower race window than `FOR UPDATE` + a following `UPDATE` would leave.
 * A losing concurrent writer's version predicate simply matches zero rows and
 * gets null back (see stackacres-store.ts:490's own doc comment: "returns
 * null on a lost race, a stale version, or an early tap, and null must never
 * pay"), which is the row-level guard this constraint is asking for, stated
 * as a compare-and-swap rather than as a lock acquired and held.
 *
 * And `harvestStackAcres`'s own settlement loop (`for (const row of ready) {
 * ... await collectStackAcresUnit(...) ... }`) awaits each unit's guarded
 * write before moving to the next rather than firing them with `Promise.all`,
 * so "verify state deltas sequentially" already describes its control flow
 * exactly -- adding a cascade's ids to that same call does not change the
 * loop's shape, only how many ids it iterates.
 *
 * (An earlier brief for this feature named `adjust_homestead_inventory` as
 * the write path. That RPC is real, live, and the wrong one -- it belongs to
 * a decade-dead standalone inventory table with no relationship to
 * StackAcres. See lib/server/stackacres-store.ts's own header and
 * lib/stackacres/farmhand-machine.ts's near-identical warning: this exact
 * collision has nearly shipped before, and shipped once already as a wrong
 * brief on the Sunlight Forge feature.)
 */

import type { StackAcresUnitSnapshot } from "./units";
import { stockZone } from "./world";
import type { ZoneId } from "./zones";

/**
 * Most units one crit may pull into its cascade, beyond the one that
 * actually crit. See this module's own header for why this is a hard
 * ceiling rather than "however many are ready".
 */
export const CASCADE_MAX_UNITS = 3;

/**
 * Every OTHER ready unit standing in `originZone`, id-sorted so a test (and a
 * replay of the same round) gets the same answer every time rather than
 * whatever order the snapshot happened to arrive in.
 *
 * `excludeIds` is whatever is already spoken for in this sweep -- at minimum
 * the unit that just crit -- so a caller can never get back a target that
 * duplicates a unit it already asked about.
 */
export function findCascadeTargets(
  units: readonly StackAcresUnitSnapshot[],
  originZone: ZoneId,
  excludeIds: ReadonlySet<string>,
): string[] {
  return units
    .filter(
      (unit) =>
        unit.state === "ready" &&
        !excludeIds.has(unit.id) &&
        stockZone(unit.stock) === originZone,
    )
    .map((unit) => unit.id)
    .sort()
    .slice(0, CASCADE_MAX_UNITS);
}

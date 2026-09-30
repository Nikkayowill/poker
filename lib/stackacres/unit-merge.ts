import type { StackAcresUnitSnapshot } from "./units";

/**
 * Which unit ids an optimistic patch actually touched, against the snapshot
 * taken just before it applied -- see ./pending-guesses.ts on why the client
 * needs this. Reference equality on purpose: every
 * case in `predictStackAcresAction` (lib/stackacres/optimistic-actions.ts)
 * reuses the SAME object for a unit it left alone and only builds a new one
 * for a unit it changed or added (see e.g. its `water`/`feed` cases mapping
 * `ctx.units` with `u.id === target ? changed(u) : u`), so an id whose
 * object is unchanged from the snapshot was never part of this guess.
 */
export function touchedUnitIds(
  before: readonly StackAcresUnitSnapshot[],
  after: readonly StackAcresUnitSnapshot[],
): string[] {
  const beforeById = new Map(before.map((u) => [u.id, u]));
  const afterIds = new Set(after.map((u) => u.id));
  const touched: string[] = [];
  for (const u of after) {
    if (beforeById.get(u.id) !== u) touched.push(u.id);
  }
  // An id present in `before` but gone from `after` (`collect`'s one-cycle
  // harvest, `clear`, `retire`) is touched too -- a guessed REMOVAL is
  // exactly as much this action's own claim on that id as a guessed change
  // is, and a sibling answer that predates the removal must not bring the
  // unit back.
  for (const u of before) {
    if (!afterIds.has(u.id)) touched.push(u.id);
  }
  return touched;
}

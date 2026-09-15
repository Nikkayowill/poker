import type { StackAcresUnitSnapshot } from "./units";

/**
 * Which unit ids an optimistic patch actually touched, against the snapshot
 * taken just before it applied -- see `mergeIncomingStackAcresUnits`'s own
 * header on why the client needs this. Reference equality on purpose: every
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
  // is, and `mergeIncomingStackAcresUnits` needs it in the list to keep a
  // sibling response that predates the removal from bringing the unit back.
  for (const u of before) {
    if (!afterIds.has(u.id)) touched.push(u.id);
  }
  return touched;
}

/**
 * The overlay `stackacres-farm.tsx`'s `applyResponse` runs on every incoming
 * unit list, so a still-in-flight SIBLING action's own optimistic guess
 * survives a response that predates it.
 *
 * Every response this farm gets back is a full, authoritative unit list,
 * not a diff -- one action's own server-side read can only know about
 * writes that had already committed by the moment it ran. Two actions fired
 * close together (planting four crops in a burst is four separate
 * requests; two rapid taps on different tiles is two) race each other's
 * full-list responses: whichever lands first does not yet know about the
 * other's still-uncommitted write, so its `units` array is missing a
 * just-created crop, or still shows an old field a sibling tap already
 * painted watered/fed. A bare `setUnits(data.units)` would overwrite the
 * sibling's correct, still-pending optimistic guess with that stale truth
 * -- gone for a beat, then restored a moment later once the sibling's OWN
 * response lands. That round trip is the flicker.
 *
 * `pendingIds` is whatever unit ids some OTHER still-in-flight action has
 * claimed (see `stackacres-farm.tsx`'s `pendingOptimisticUnitIds`); any of
 * them found in `prev` overrides that same id in `incoming` (a sibling's
 * still-truer guess about a field this response predates), or is appended
 * if `incoming` does not know the id at all yet (a sibling's just-created
 * crop this response's own DB read ran before). A pending id NOT found in
 * `prev` is a sibling's guessed REMOVAL already reflected on screen (see
 * `touchedUnitIds`) -- so it is dropped from `incoming` too rather than
 * left to pass through untouched, or a response that predates that removal
 * would bring the unit right back.
 */
export function mergeIncomingStackAcresUnits(
  prev: readonly StackAcresUnitSnapshot[],
  incoming: readonly StackAcresUnitSnapshot[],
  pendingIds: Iterable<string>,
): StackAcresUnitSnapshot[] {
  const pending = new Set(pendingIds);
  if (pending.size === 0) return [...incoming];
  const overlay: StackAcresUnitSnapshot[] = [];
  const removed = new Set<string>();
  for (const id of pending) {
    const local = prev.find((u) => u.id === id);
    if (local) overlay.push(local);
    else removed.add(id);
  }
  const overlaid = new Set(overlay.map((u) => u.id));
  return [...incoming.filter((u) => !overlaid.has(u.id) && !removed.has(u.id)), ...overlay];
}

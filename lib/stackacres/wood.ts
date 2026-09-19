/**
 * Choppable trees: the farm's first "walk up and extract a raw material"
 * loop, as opposed to a bed you plant and a machine that runs on a timer.
 *
 * A tree is a FIXED WORLD NODE, not something a player buys or places --
 * ./tree-nodes.ts names a small, real subset of the trees already drawn in
 * the Homestead (see area.json's own `tag: "tree:<id>"` props). Chopping one
 * takes several swings (`WOOD_HITS_TO_FELL`); the last swing fells it and it
 * regrows after `WOOD_RESPAWN_MS`, the same "timer, not an inventory slot"
 * shape ./machines.ts and ./units.ts already use for a ready-at clock.
 *
 * Pure and renderer-free, same split every other StackAcres system keeps:
 * this file only knows a node's own state and `now`. The server's guarded
 * write (lib/server/stackacres-store.ts's `chopStackAcresWoodNode`) is the
 * only authority on whether a swing actually lands -- see that function's own
 * header for why a version-guarded update is what stops two rapid taps from
 * both felling (and both being paid for) the same tree.
 */

/** How many swings fell a tree from full health. Small on purpose -- this is
 *  a farm game, not a chore simulator, so felling one tree is a few seconds
 *  of real interaction, not a grind. */
export const WOOD_HITS_TO_FELL = 3;

/** How long a felled tree takes to regrow, in ms. Sits in the same rough
 *  band as a tier-2 crop's own grow time (see ./units.ts's stock defs) --
 *  long enough that clearing every tree on the farm at once is not a
 *  five-minute chore, short enough that Wood never becomes the farm's
 *  bottleneck resource. */
export const WOOD_RESPAWN_MS = 8 * 60 * 1000;

/** Wood one ordinary swing yields. */
export const WOOD_PER_HIT = 1;
/** Extra Wood a swing landed in the chop minigame's sweet zone yields, on
 *  top of `WOOD_PER_HIT`. */
export const WOOD_SWEET_HIT_BONUS = 1;
/** Extra Wood the swing that fells the tree yields, on top of whatever that
 *  swing's own timing already paid -- felling should read as the bigger
 *  moment, not just "one more swing". */
export const WOOD_FELL_BONUS = 2;

/** One tree node's persisted state, as much of it as the pure math needs.
 *  See lib/server/stackacres-store.ts's `StoredWoodNode` for the full
 *  row (id, profile id, version) this is read off of. */
export interface WoodNodeState {
  /** Swings left before this cycle's tree falls. Reset to
   *  `WOOD_HITS_TO_FELL` the moment a felled tree regrows. */
  readonly hitsRemaining: number;
  /** When this tree fell, or null while it is standing. */
  readonly felledAt: string | null;
}

/** A freshly-planted node, standing and unchopped. */
export function freshWoodNodeState(): WoodNodeState {
  return { hitsRemaining: WOOD_HITS_TO_FELL, felledAt: null };
}

/** Whether `state` is currently a stump rather than a standing tree. */
export function isWoodNodeFelled(state: WoodNodeState): boolean {
  return state.felledAt !== null;
}

/** The instant a felled node regrows, or null while it is still standing. */
export function woodNodeReadyAt(state: WoodNodeState): number | null {
  if (state.felledAt === null) return null;
  const felled = Date.parse(state.felledAt);
  return Number.isFinite(felled) ? felled + WOOD_RESPAWN_MS : null;
}

/** Whether a swing can land on this tree right now: standing, or felled and
 *  past its own regrowth clock. Pure function of the stored state and `now` --
 *  the server's own guarded write re-checks this at write time under the
 *  row's version, so a stale client read can only ever under-claim, never
 *  double-collect. */
export function isWoodNodeChoppable(state: WoodNodeState, now: Date): boolean {
  const readyAt = woodNodeReadyAt(state);
  return readyAt === null || readyAt <= now.getTime();
}

/** 0..1 while a stump is regrowing, 1 once it is choppable again, null for a
 *  standing tree that was never felled at all. */
export function woodNodeRespawnProgress(state: WoodNodeState, now: Date): number | null {
  if (state.felledAt === null) return null;
  const felled = Date.parse(state.felledAt);
  if (!Number.isFinite(felled)) return 1;
  const elapsed = now.getTime() - felled;
  return Math.min(1, Math.max(0, elapsed / WOOD_RESPAWN_MS));
}

/** What one swing on a choppable node does to its stored state.
 *
 *  `sweet` is the chop minigame's own verdict on the swing's timing (see
 *  ./chop.ts) -- it never changes whether the swing lands, only how much
 *  Wood it pays out, the same "client picks a quality flag, server still
 *  rolls/owns the real state" shape `catch-fish`'s `bait` boolean already
 *  takes in lib/server/stackacres-service.ts.
 *
 *  Returns null if `state` was not choppable at `now` at all -- the caller
 *  (the server route) treats that as a refusal, same as any other guarded
 *  write that finds nothing to do. */
export interface WoodSwingResult {
  readonly nextState: WoodNodeState;
  readonly woodGained: number;
  readonly felled: boolean;
}

export function swingAtWoodNode(
  state: WoodNodeState,
  now: Date,
  sweet: boolean,
): WoodSwingResult | null {
  if (!isWoodNodeChoppable(state, now)) return null;

  // A felled stump that has cleared its own regrowth clock swings fresh --
  // the respawn already happened, this swing is the first of a new cycle.
  const standing: WoodNodeState = isWoodNodeFelled(state) ? freshWoodNodeState() : state;

  const hitsRemaining = standing.hitsRemaining - 1;
  const felled = hitsRemaining <= 0;
  const woodGained =
    WOOD_PER_HIT + (sweet ? WOOD_SWEET_HIT_BONUS : 0) + (felled ? WOOD_FELL_BONUS : 0);

  const nextState: WoodNodeState = felled
    ? { hitsRemaining: 0, felledAt: now.toISOString() }
    : { hitsRemaining, felledAt: null };

  return { nextState, woodGained, felled };
}

/** What the client needs to render one node: whether it can be chopped right
 *  now, how many swings are left in the current cycle, and (while
 *  regrowing) how far along the respawn clock is. */
export interface WoodNodeSnapshot {
  readonly nodeId: string;
  readonly ready: boolean;
  readonly hitsRemaining: number;
  readonly respawnProgress: number | null;
}

export function woodNodeSnapshot(nodeId: string, state: WoodNodeState, now: Date): WoodNodeSnapshot {
  return {
    nodeId,
    ready: isWoodNodeChoppable(state, now),
    hitsRemaining: state.hitsRemaining,
    respawnProgress: woodNodeRespawnProgress(state, now),
  };
}

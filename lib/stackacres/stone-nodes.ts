/**
 * Stone mining nodes: the Mine's three tagged boulders
 * (public/stackacres-td/areas/mine/area.json's `p8_0`/`p9_0`/`p10_0`, tagged
 * `stone:mine-1`/`stone:mine-2`/`stone:mine-3`), tracked server-side the same
 * way a felled tree would be -- see lib/server/stone-node-store.ts for the
 * version-guarded row each one owns.
 *
 * PURE AND RENDERER-FREE, same split every other StackAcres model file
 * keeps: nothing here reads a clock on its own, calls the database, or
 * imports from components/. `now` always arrives as a parameter, so a test
 * can hand it a fixed instant instead of patching Date.now().
 *
 * A node takes `HITS_TO_BREAK` swings to break, one swing per player tap
 * (each swing pays out Stone immediately -- see `SWING_YIELD` -- rather than
 * banking it all for the felling blow, so an interrupted mining trip still
 * keeps whatever it already landed). A broken node regrows after
 * `REGROW_MS`: longer than an 8-minute tree regrow, because ore depleting
 * slower than a canopy regrowing is the intuitive read of the two materials,
 * and because Stone gates more "structural" spends (see ./machines.ts) that
 * should feel rarer than Wood's Mill/Loom framing.
 */

export const HITS_TO_BREAK = 4;

/** 18 minutes -- inside the 15-20 minute range a slower-than-wood regrow
 *  should sit at, and not a round multiple of wood's 8 minutes on purpose:
 *  the two materials should never feel like they refill in lockstep. */
export const REGROW_MS = 18 * 60 * 1000;

/** Plain swing vs a sweet-zone swing: the client's own timing grade changes
 *  how much Stone one swing yields, never whether the swing lands or the
 *  node's real hit count -- the server always decrements exactly one swing
 *  per accepted mine attempt regardless of `quality`. */
export type SwingQuality = "hit" | "sweet";

export const SWING_YIELD: Readonly<Record<SwingQuality, number>> = {
  hit: 1,
  sweet: 2,
};

export const STONE_NODE_IDS = ["stone:mine-1", "stone:mine-2", "stone:mine-3"] as const;
export type StoneNodeId = (typeof STONE_NODE_IDS)[number];

export function isStoneNodeId(value: string): value is StoneNodeId {
  return (STONE_NODE_IDS as readonly string[]).includes(value);
}

/** The durable half of a node: what a store round-trips. `hitsRemaining` is
 *  meaningless once `brokenAt` is set -- it is left at 0 rather than
 *  recomputed, and callers read the node through `effectiveNodeState` (which
 *  applies a regrow) rather than off this shape directly. */
export interface StoneNodeRow {
  readonly nodeId: StoneNodeId;
  readonly hitsRemaining: number;
  readonly brokenAt: string | null;
  readonly version: number;
}

/** A freshly-seeded node: full health, never broken. */
export function freshStoneNode(nodeId: StoneNodeId): StoneNodeRow {
  return { nodeId, hitsRemaining: HITS_TO_BREAK, brokenAt: null, version: 0 };
}

/** Whether a node has regrown by `now`: broken, and the regrow window has
 *  fully elapsed. A node that was never broken is never "regrown" -- it is
 *  simply standing. */
export function hasRegrown(node: StoneNodeRow, now: Date): boolean {
  if (!node.brokenAt) return false;
  return now.getTime() - Date.parse(node.brokenAt) >= REGROW_MS;
}

/** The node as a swing should see it right now: a broken node whose regrow
 *  window has elapsed reads back as fresh, without mutating the stored row
 *  -- the actual regrow write happens inside the same guarded update a swing
 *  performs, so two players racing a regrow cannot both "discover" it. */
export function effectiveNodeState(node: StoneNodeRow, now: Date): StoneNodeRow {
  if (hasRegrown(node, now)) return freshStoneNode(node.nodeId);
  return node;
}

/** Whether a swing can land on this node right now. */
export function isNodeMineable(node: StoneNodeRow, now: Date): boolean {
  const effective = effectiveNodeState(node, now);
  return effective.brokenAt === null && effective.hitsRemaining > 0;
}

export interface MiningSwingResult {
  readonly node: StoneNodeRow;
  /** Whether this swing was the one that broke the node. */
  readonly broke: boolean;
  /** How much Stone this swing pays out, per `quality`. Zero when the swing
   *  did not land (the node was already broken and has not yet regrown). */
  readonly yield: number;
}

/**
 * Applies one accepted swing against `node`, already known mineable
 * (`isNodeMineable`) -- callers that skip that check get a node returned
 * unchanged with a zero yield rather than a thrown error, the same
 * "refusal, not a throw, for an ordinary game state" posture
 * ./wildlife.ts's fence rolls take.
 */
export function applyMiningSwing(
  node: StoneNodeRow,
  quality: SwingQuality,
  now: Date,
): MiningSwingResult {
  const effective = effectiveNodeState(node, now);
  if (effective.brokenAt !== null || effective.hitsRemaining <= 0) {
    return { node: effective, broke: false, yield: 0 };
  }
  const hitsRemaining = effective.hitsRemaining - 1;
  const broke = hitsRemaining <= 0;
  return {
    node: {
      nodeId: effective.nodeId,
      hitsRemaining: broke ? 0 : hitsRemaining,
      brokenAt: broke ? now.toISOString() : null,
      version: effective.version + 1,
    },
    broke,
    yield: SWING_YIELD[quality],
  };
}

/** "any moment", "12m" -- how long until a broken node regrows, sharing
 *  ./tap-action.ts's own `timeLeftLabel` wording so the two never read
 *  differently for the same kind of wait. */
export function regrowLabel(node: StoneNodeRow, nowMs: number): string {
  if (!node.brokenAt) return "any moment";
  const ms = Date.parse(node.brokenAt) + REGROW_MS - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "any moment";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

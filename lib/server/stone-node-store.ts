import "server-only";
import {
  STONE_NODE_IDS,
  applyMiningSwing,
  effectiveNodeState,
  freshStoneNode,
  type StoneNodeId,
  type StoneNodeRow,
  type SwingQuality,
} from "@/lib/stackacres/stone-nodes";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the Mine's three Stone nodes -- GLOBAL rows, not one per
 * profile, the one respect in which this store differs from every other
 * StackAcres store in this file's own convention: a boulder is a fixture of
 * the world, so two players racing the same node's last swing must not both
 * be able to break it.
 *
 * Same two-branch shape as every other StackAcres store (see
 * lib/server/stackacres-blueprint-store.ts's own header for the convention):
 * a real Supabase project reaches `mine_stackacres_stone_node`, the
 * version-guarded compare-and-swap in the `stackacres_stone_nodes` migration;
 * an absent one falls back to an in-process Map, guarded the same way memory
 * mode guards every other "no real concurrency inside one process" store
 * here -- there is nothing to race within a single Node event loop turn, so
 * checking the effective state and writing the result back is equivalent to
 * the database's row lock.
 */

declare global {
  var __riverRoomStackAcresStoneNodes: Map<StoneNodeId, StoneNodeRow> | undefined;
}

function seedMemoryNodes(): Map<StoneNodeId, StoneNodeRow> {
  const map = new Map<StoneNodeId, StoneNodeRow>();
  for (const id of STONE_NODE_IDS) map.set(id, freshStoneNode(id));
  return map;
}

const memoryNodes = globalThis.__riverRoomStackAcresStoneNodes ?? seedMemoryNodes();
globalThis.__riverRoomStackAcresStoneNodes = memoryNodes;

/** Test-only reset: every node back to fresh. */
export function resetStoneNodeStoreForTests(): void {
  memoryNodes.clear();
  for (const id of STONE_NODE_IDS) memoryNodes.set(id, freshStoneNode(id));
}

function stoneNodeFromRow(row: {
  node_id: string;
  hits_remaining: number;
  broken_at: string | null;
  version: number;
}): StoneNodeRow {
  return {
    nodeId: row.node_id as StoneNodeId,
    hitsRemaining: row.hits_remaining,
    brokenAt: row.broken_at,
    version: row.version,
  };
}

/** The node as it stands right now, with a regrow already applied for
 *  reading purposes -- never mutates the stored row (see
 *  `effectiveNodeState`'s own header on why that write only ever happens
 *  inside the guarded swing itself). */
export async function readStoneNode(nodeId: StoneNodeId, now: Date): Promise<StoneNodeRow> {
  const supabase = adminClient();
  if (!supabase) {
    const row = memoryNodes.get(nodeId) ?? freshStoneNode(nodeId);
    return effectiveNodeState(row, now);
  }

  const { data, error } = await supabase
    .from("homestead_stone_nodes")
    .select("node_id, hits_remaining, broken_at, version")
    .eq("node_id", nodeId)
    .single();
  if (error) throw new Error(`Could not read that boulder: ${error.message}`);
  return effectiveNodeState(stoneNodeFromRow(data), now);
}

/** Every Stone node's current state, one read per `STONE_NODE_IDS` --
 *  same fixed, small-table shape `listStackAcresWoodNodeStates` reads for
 *  Wood, and cheap for the same reason: three rows, global rather than
 *  per-profile, read alongside the rest of `view()`'s own batch of reads
 *  rather than folded into `read_homestead_batch` (see that function's own
 *  header on why the small side-tables aren't). */
export async function readAllStoneNodes(now: Date): Promise<StoneNodeRow[]> {
  return Promise.all(STONE_NODE_IDS.map((nodeId) => readStoneNode(nodeId, now)));
}

export interface MineStoneNodeOutcome {
  /** False when the node was already broken and had not yet regrown -- the
   *  swing simply did not land, and nothing was spent or paid. */
  readonly landed: boolean;
  readonly broke: boolean;
  readonly yield: number;
  readonly node: StoneNodeRow;
}

/**
 * The one write that matters: one accepted swing against `nodeId`, applied
 * under the row's own version guard. `quality` only ever changes `yield` --
 * see ./stackacres/stone-nodes.ts's `applyMiningSwing` for the rule this
 * store just persists.
 */
export async function mineStoneNode(
  nodeId: StoneNodeId,
  quality: SwingQuality,
  now: Date,
): Promise<MineStoneNodeOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryNodes.get(nodeId) ?? freshStoneNode(nodeId);
    const effective = effectiveNodeState(current, now);
    const result = applyMiningSwing(effective, quality, now);
    if (result.yield === 0 && !result.broke) {
      // Persist the (possibly just-regrown-then-immediately-checked) state
      // even on a no-op swing, so a subsequent read sees the same effective
      // state rather than re-deriving it from a stale `brokenAt`.
      memoryNodes.set(nodeId, effective);
      return { landed: false, broke: false, yield: 0, node: effective };
    }
    memoryNodes.set(nodeId, result.node);
    return { landed: true, broke: result.broke, yield: result.yield, node: result.node };
  }

  const { data, error } = await supabase
    .rpc("mine_stackacres_stone_node", { p_node_id: nodeId, p_quality: quality, p_now: now.toISOString() })
    .single();
  if (error) throw new Error(`Could not swing at that boulder: ${error.message}`);
  const result = data as {
    landed: boolean;
    broke: boolean;
    yield_amount: number;
    node_id: string;
    hits_remaining: number;
    broken_at: string | null;
    version: number;
  };
  return {
    landed: result.landed,
    broke: result.broke,
    yield: result.yield_amount,
    node: stoneNodeFromRow(result),
  };
}

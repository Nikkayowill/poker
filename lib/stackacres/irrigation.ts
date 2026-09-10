/**
 * The irrigation pipe network.
 *
 * A player-built lattice of pipe tiles that carries water outward from a
 * well and keeps every crop it reaches watered without a tap. Pure: this
 * module owns the graph maths -- connector framing and fluid propagation --
 * and nothing else. No Phaser, no Supabase, no clock. The server feeds it a
 * `GridSnapshot` (every placed tile, plus where each working crop stands)
 * and applies the `NetworkGrid` it returns; the scene reads the same
 * `NetworkGrid` to pick each tile's texture frame.
 *
 * GRID SUBSTRATE. There is no plot grid any more (see world.ts's header --
 * `plotIndexAt` / `plotNeighbor` were deleted with it). The only integer
 * lattice left in true world space is the art tile, `STACKACRES_TILE` units
 * square. Pipes snap to it: a tile at (tx, ty) covers the world square
 * [tx*T .. (tx+1)*T) x [ty*T .. (ty+1)*T). That is the same floor-division
 * `meadowTileAt` does, and for the same reason -- a negative world
 * coordinate must floor, not truncate, or the tiles at x = -0.5 and
 * x = +0.5 collapse into one.
 *
 * DIAMOND NEIGHBOURS. On the 2:1 iso projection a tile's four edge-adjacent
 * diamonds are its four single-axis steps: (0,-1), (+1,0), (0,+1), (-1,0).
 * Their screen directions are the four diagonals, conventionally named for
 * the screen compass they point at -- N up-and-right, E down-and-right,
 * S down-and-left, W up-and-left. The connector bitmask uses that order:
 * bit 0 = N, bit 1 = E, bit 2 = S, bit 3 = W, so a value 0..15 indexes the
 * baked connector sheet directly (see components/arcade/stackacres/
 * art-irrigation.ts).
 *
 * WHAT THE DB STORES. Its own table, `homestead_pipes`, and its own RPCs --
 * NOT `homestead_inventory` / `adjust_homestead_inventory`, which are the
 * inert barn-era pair (see lib/server/stackacres-store.ts's inventory
 * header). The derived columns `mask` / `hydrated` / `distance` are written
 * back from this module's output by `sync_homestead_pipe_network` so a game
 * read stays write-free.
 */

import { STACKACRES_TILE } from "./world";

/** One art tile per pipe tile: pipes share world.ts's only integer lattice. */
export const PIPE_TILE = STACKACRES_TILE;

/**
 * Placing an irrigation tile spends Gold -- a construction sink, like a
 * Mill's placeCost, and never refunded when the tile is later removed.
 * HYDRATION ITSELF MOVES NO GOLD: a hydrated pipe watering a crop is free,
 * the same way tapping Water is free. So irrigation adds exactly one Gold
 * sink (place) and no new payer -- see the actions route's own header for
 * the count that has to stay true.
 *
 * Lives here, not in lib/server/stackacres-service.ts, for the same reason
 * lib/stackacres/prestige.ts's client-safe shapes live outside that
 * `import "server-only"` file: a client component (the placement ring) has
 * to show this price without pulling a server-only module into the browser
 * bundle. `placeStackAcresPipeTile` imports it back from here so there is
 * exactly one number either side reads.
 */
export const PIPE_PLACE_COST: Readonly<Record<PipeKind, number>> = {
  well: 400,
  pipe: 25,
};

/**
 * How far water travels, in pipe tiles, measured from a well (distance 0).
 * A pipe at BFS distance <= this is hydrated; nothing past it is.
 */
export const PIPE_MAX_REACH = 8;

/** Flow-animation frames baked per connector mask (art-irrigation.ts). */
export const PIPE_FLOW_FRAMES = 8;

/** Milliseconds for one full flow cycle. */
export const PIPE_FLOW_CYCLE_MS = 900;

export type PipeKind = "well" | "pipe";

/** A 4-bit connector index. Bit 0 N, bit 1 E, bit 2 S, bit 3 W. 0..15. */
export type PipeMask = number;

/**
 * Which way a LONE pipe tile points -- purely cosmetic (2026-09-09). One of
 * the four neighbour bits (N 1, E 2, S 4, W 8), or null for the default
 * two-arm stub. Honoured ONLY while the tile's real `mask` is 0: the moment
 * a neighbour lands, `mask` describes the real joins and this is ignored --
 * kept rather than cleared, so lifting that neighbour again leaves the stub
 * pointing where it did. Water never follows it: `hydrated`/`distance` and
 * the flow arms all come off `mask` alone, so an aim can never draw a join
 * that is not there. See `pipeBodyTextureKey`.
 */
export type PipeFacing = 1 | 2 | 4 | 8;

/** The four aims, in the same N/E/S/W bit order as `PIPE_NEIGHBORS`. */
export const PIPE_FACINGS: readonly PipeFacing[] = [1, 2, 4, 8];

export function isPipeFacing(value: unknown): value is PipeFacing {
  return value === 1 || value === 2 || value === 4 || value === 8;
}

export interface PipeCoord {
  readonly tx: number;
  readonly ty: number;
}

/** A tile exactly as the database stores it, before any recompute. */
export interface PlacedPipe extends PipeCoord {
  readonly kind: PipeKind;
  /** Optional so every `{ tx, ty, kind }` literal (most of them in tests
   *  about topology, which an aim never touches) stays valid. */
  readonly facing?: PipeFacing | null;
}

/**
 * A working crop and the world point it stands at. The server resolves the
 * point from `cropSpot(zone, unitId)` so this module never touches world.ts
 * geometry beyond the tile size.
 */
export interface IrrigableCrop {
  readonly unitId: string;
  readonly worldX: number;
  readonly worldY: number;
}

/** The immutable input to `recalculatePipeConnections`. */
export interface GridSnapshot {
  readonly tiles: readonly PlacedPipe[];
  readonly crops: readonly IrrigableCrop[];
}

/**
 * A well: a fluid source. Distance 0, always hydrated, rendered from its own
 * texture rather than a connector frame.
 */
export interface FluidSource extends PipeCoord {
  readonly kind: "well";
}

/**
 * One tile after the recompute: its connector frame, whether water has
 * reached it, and how far it is from the nearest well (the flow animation
 * offsets its wavefront by this so water visibly travels outward).
 */
export interface PipeNode extends PipeCoord {
  readonly kind: PipeKind;
  readonly mask: PipeMask;
  readonly hydrated: boolean;
  readonly distance: number | null;
  /** Carried straight through from the placed tile; always null for a well.
   *  Only `pipeBodyTextureKey` reads it, and only while `mask` is 0. */
  readonly facing: PipeFacing | null;
}

/** The recompute's whole output. */
export interface NetworkGrid {
  readonly nodes: readonly PipeNode[];
  readonly byKey: ReadonlyMap<string, PipeNode>;
  readonly sources: readonly FluidSource[];
  readonly irrigatedUnitIds: ReadonlySet<string>;
}

/** Stable string key for a tile coordinate. */
export function pipeKey(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

/** The tile a world point falls in. Floors -- see the module header. */
export function pipeTileAt(worldX: number, worldY: number): PipeCoord {
  return { tx: Math.floor(worldX / PIPE_TILE), ty: Math.floor(worldY / PIPE_TILE) };
}

/** The world-space centre of a tile -- where the scene projects its sprite. */
export function pipeTileCenter(tx: number, ty: number): { readonly x: number; readonly y: number } {
  return { x: (tx + 0.5) * PIPE_TILE, y: (ty + 0.5) * PIPE_TILE };
}

/**
 * The four diamond-edge neighbours, in bitmask order (N, E, S, W). A crop
 * is watered by a hydrated pipe on its own tile or one of these four, the
 * same 4-adjacency the connector scan uses -- so a crop is only ever fed
 * from a pipe it visibly touches.
 */
export const PIPE_NEIGHBORS: readonly (PipeCoord & { readonly bit: number })[] = [
  { tx: 0, ty: -1, bit: 0b0001 }, // N: tile step (0,-1) -> screen up-right
  { tx: 1, ty: 0, bit: 0b0010 }, // E: tile step (1, 0) -> screen down-right
  { tx: 0, ty: 1, bit: 0b0100 }, // S: tile step (0, 1) -> screen down-left
  { tx: -1, ty: 0, bit: 0b1000 }, // W: tile step (-1,0) -> screen up-left
];

/** The baked-texture key for a connector mask (art-irrigation.ts). */
export function pipeFrameKey(mask: PipeMask): string {
  return `irrigation:pipe:${mask & 0b1111}`;
}

/** The baked-texture key for an aimed lone stub (art-irrigation.ts): the
 *  exposed, above-ground look of `pipeFrameKey(0)`, pointed one way. */
export function pipeStubKey(facing: PipeFacing): string {
  return `irrigation:stub:${facing}`;
}

/** The well's own baked texture. */
export const WELL_TEXTURE_KEY = "irrigation:well";

/**
 * Which baked body a tile shows -- the ONE place the mask-vs-facing rule
 * lives, so the scene's spawn and restyle paths cannot disagree. A joined
 * tile (`mask` != 0) always shows its real connector, buried; a lone one
 * shows an exposed stub, aimed if the player aimed it.
 */
export function pipeBodyTextureKey(node: Pick<PipeNode, "kind" | "mask" | "facing">): string {
  if (node.kind === "well") return WELL_TEXTURE_KEY;
  if (node.mask !== 0) return pipeFrameKey(node.mask);
  return node.facing ? pipeStubKey(node.facing) : pipeFrameKey(0);
}

const NO_UNITS: ReadonlySet<string> = new Set<string>();

/**
 * Recomputes the whole network from a snapshot: every tile's connector
 * frame, which tiles water has reached, and which working crops a hydrated
 * pipe now waters.
 *
 * Pure and total -- no clock, no I/O, safe to run on the client for a
 * preview and on the server for the authoritative write. O(tiles + crops).
 *
 * Fluid propagation is a breadth-first flood from every well at once
 * (multi-source BFS), stepping only through placed pipe tiles, one tile per
 * step, stopping at `PIPE_MAX_REACH` steps. A well seeds the queue at
 * distance 0 and hydrates itself; the flood never re-enters a well.
 */
export function recalculatePipeConnections(gridSnapshot: GridSnapshot): NetworkGrid {
  // 1. Index the placed tiles. The DB's unique(profile_id, tx, ty) makes a
  //    duplicate coordinate impossible, but a pure function does not get to
  //    assume its caller -- last write wins.
  const placed = new Map<string, PlacedPipe>();
  for (const tile of gridSnapshot.tiles) {
    placed.set(pipeKey(tile.tx, tile.ty), tile);
  }

  // 2. Every well is a source.
  const sources: FluidSource[] = [];
  for (const tile of placed.values()) {
    if (tile.kind === "well") {
      sources.push({ tx: tile.tx, ty: tile.ty, kind: "well" });
    }
  }

  // 3. Multi-source BFS out through the pipe tiles. `queue` is walked with a
  //    moving head index rather than shift() so the whole flood is O(n).
  const distance = new Map<string, number>();
  const queue: PipeCoord[] = [];
  for (const source of sources) {
    const key = pipeKey(source.tx, source.ty);
    if (!distance.has(key)) {
      distance.set(key, 0);
      queue.push({ tx: source.tx, ty: source.ty });
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const step = distance.get(pipeKey(current.tx, current.ty));
    if (step === undefined || step >= PIPE_MAX_REACH) {
      continue;
    }
    for (const offset of PIPE_NEIGHBORS) {
      const nx = current.tx + offset.tx;
      const ny = current.ty + offset.ty;
      const nkey = pipeKey(nx, ny);
      if (distance.has(nkey)) {
        continue;
      }
      const neighbour = placed.get(nkey);
      if (neighbour === undefined || neighbour.kind !== "pipe") {
        // Water travels through pipe only. A second well is already a source
        // at distance 0; empty ground stops the flood.
        continue;
      }
      distance.set(nkey, step + 1);
      queue.push({ tx: nx, ty: ny });
    }
  }

  // 4. Build each node: connector mask from raw tile occupancy (a dry pipe
  //    still joins its neighbours), hydration + distance from the BFS.
  const nodes: PipeNode[] = [];
  const byKey = new Map<string, PipeNode>();
  for (const tile of placed.values()) {
    const key = pipeKey(tile.tx, tile.ty);
    let mask = 0;
    for (const offset of PIPE_NEIGHBORS) {
      if (placed.has(pipeKey(tile.tx + offset.tx, tile.ty + offset.ty))) {
        mask |= offset.bit;
      }
    }
    const reached = distance.get(key);
    const node: PipeNode = {
      tx: tile.tx,
      ty: tile.ty,
      kind: tile.kind,
      mask,
      hydrated: reached !== undefined,
      distance: reached ?? null,
      facing: tile.kind === "pipe" ? (tile.facing ?? null) : null,
    };
    nodes.push(node);
    byKey.set(key, node);
  }

  // 5. Which working crops a hydrated pipe now waters.
  const irrigated = new Set<string>();
  for (const crop of gridSnapshot.crops) {
    const tile = pipeTileAt(crop.worldX, crop.worldY);
    if (hydratedPipeAt(byKey, tile.tx, tile.ty)) {
      irrigated.add(crop.unitId);
      continue;
    }
    for (const offset of PIPE_NEIGHBORS) {
      if (hydratedPipeAt(byKey, tile.tx + offset.tx, tile.ty + offset.ty)) {
        irrigated.add(crop.unitId);
        break;
      }
    }
  }

  return {
    nodes,
    byKey,
    sources,
    irrigatedUnitIds: irrigated.size === 0 ? NO_UNITS : irrigated,
  };
}

/**
 * A hydrated *pipe* tile (not a well -- a well sources the network but
 * waters nothing on its own square) sits at (tx, ty)?
 */
function hydratedPipeAt(
  byKey: ReadonlyMap<string, PipeNode>,
  tx: number,
  ty: number,
): boolean {
  const node = byKey.get(pipeKey(tx, ty));
  return node !== undefined && node.hydrated && node.kind === "pipe";
}

/**
 * Which flow frame a hydrated tile shows at time `tMs`. The wavefront is
 * offset by the tile's BFS distance so water reads as travelling outward
 * from the well one tile at a time rather than every pipe pulsing in
 * lockstep. Returns null for a tile with no flow (dry, or a well).
 */
export function pipeFlowFrame(node: PipeNode, tMs: number): number | null {
  if (!node.hydrated || node.distance === null || node.kind !== "pipe") {
    return null;
  }
  const phase = tMs / PIPE_FLOW_CYCLE_MS + node.distance / PIPE_FLOW_FRAMES;
  const frame = Math.floor(phase * PIPE_FLOW_FRAMES) % PIPE_FLOW_FRAMES;
  return frame < 0 ? frame + PIPE_FLOW_FRAMES : frame;
}

export interface PipeGridDiff {
  readonly added: readonly PipeNode[];
  readonly changed: readonly PipeNode[];
  readonly removed: readonly string[];
}

/** The minimum a diff needs: the node list and a keyed index of it.
 *  `NetworkGrid` is one; `indexPipeNodes` builds one from a bare list (what
 *  the client gets back over the wire). */
export type PipeIndex = Pick<NetworkGrid, "nodes" | "byKey">;

/** Keys a bare node list for lookup -- the client side of `diffPipeGrid`,
 *  which only ships `PipeNode[]`, not the whole `NetworkGrid`. */
export function indexPipeNodes(nodes: readonly PipeNode[]): PipeIndex {
  const byKey = new Map<string, PipeNode>();
  for (const node of nodes) byKey.set(pipeKey(node.tx, node.ty), node);
  return { nodes, byKey };
}

/**
 * What changed between two recomputes, keyed by tile. The scene creates a
 * sprite for each `added`, calls `setTexture` for each `changed` (its mask,
 * hydration, distance or aim moved), and destroys each `removed`.
 */
export function diffPipeGrid(previous: PipeIndex | null, next: PipeIndex): PipeGridDiff {
  const added: PipeNode[] = [];
  const changed: PipeNode[] = [];
  const removed: string[] = [];
  const before = previous?.byKey ?? new Map<string, PipeNode>();

  for (const node of next.nodes) {
    const key = pipeKey(node.tx, node.ty);
    const was = before.get(key);
    if (was === undefined) {
      added.push(node);
    } else if (
      was.mask !== node.mask ||
      was.hydrated !== node.hydrated ||
      was.kind !== node.kind ||
      was.distance !== node.distance ||
      was.facing !== node.facing
    ) {
      changed.push(node);
    }
  }
  for (const key of before.keys()) {
    if (!next.byKey.has(key)) {
      removed.push(key);
    }
  }
  return { added, changed, removed };
}

/**
 * The `p_nodes` payload for `sync_homestead_pipe_network`: the derived
 * state of every tile, flat, ready for `jsonb_to_recordset`.
 */
export interface PipeSyncRow {
  readonly tx: number;
  readonly ty: number;
  readonly mask: number;
  readonly hydrated: boolean;
  readonly distance: number | null;
}

export function pipeSyncPayload(grid: NetworkGrid): PipeSyncRow[] {
  return grid.nodes.map((node) => ({
    tx: node.tx,
    ty: node.ty,
    mask: node.mask,
    hydrated: node.hydrated,
    distance: node.distance,
  }));
}

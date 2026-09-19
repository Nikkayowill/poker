/** Which trees and boulders are spent (stump, rubble), when they grow back, and the pixels left behind. */

import { REGROW_MS as STONE_REGROW_MS, type StoneNodeSnapshot } from "@/lib/stackacres/stone-nodes";
import { WOOD_RESPAWN_MS, type WoodNodeSnapshot } from "@/lib/stackacres/wood";

export type GatherKind = "tree" | "stone";

/** A spent node, named by its map tag (`tree:homestead-1`, `stone:mine-1`). */
export interface SpentNode {
  tag: string;
  /** Epoch ms it stands again. */
  regrowAt: number;
}

interface NodeSnapshot {
  readonly nodeId: string;
  readonly ready: boolean;
  readonly respawnProgress: number | null;
}

function spent(nodes: readonly NodeSnapshot[], nowMs: number, regrowMs: number, tagOf: (nodeId: string) => string): SpentNode[] {
  const out: SpentNode[] = [];
  for (const node of nodes) {
    if (node.ready) continue;
    const progress = Math.min(1, Math.max(0, node.respawnProgress ?? 0));
    out.push({ tag: tagOf(node.nodeId), regrowAt: nowMs + (1 - progress) * regrowMs });
  }
  return out;
}

/** Every tree that can't be chopped yet is a stump. `nowMs` is when the snapshot was read. */
export function spentTrees(nodes: readonly WoodNodeSnapshot[], nowMs: number): SpentNode[] {
  return spent(nodes, nowMs, WOOD_RESPAWN_MS, (id) => `tree:${id}`);
}

/** Every boulder that can't be mined yet is rubble. Stone ids already carry their `stone:` prefix. */
export function spentStones(nodes: readonly StoneNodeSnapshot[], nowMs: number): SpentNode[] {
  return spent(nodes, nowMs, STONE_REGROW_MS, (id) => id);
}

/** What a prop tag names on the map, or null for any other tag. */
export function gatherKindOfTag(tag: string | undefined): GatherKind | null {
  if (tag?.startsWith("tree:") && tag.length > "tree:".length) return "tree";
  if (tag?.startsWith("stone:") && tag.length > "stone:".length) return "stone";
  return null;
}

export interface NodeArt {
  /** Texture key the scene draws it under. */
  texture: string;
  colors: Readonly<Record<string, string>>;
  /** Rows of pixels; `.` is empty. The bottom middle sits on the node's base point. */
  rows: readonly string[];
}

/** Colours taken from the Homestead tree trunk. */
export const STUMP_ART: NodeArt = {
  texture: "stump",
  colors: { O: "#1c0c11", c: "#c9b58a", r: "#c79553", l: "#ae6b33", m: "#7f3c26", d: "#4e1c1c" },
  rows: [
    "....OOOOOO....",
    "..OOccccccOO..",
    ".OcccrrrrcccO.",
    ".OcccrrrrcccO.",
    "..OOccccccOO..",
    "..OlllmmmmddO.",
    "..OlllmmmmddO.",
    ".OllllmmmmdddO",
    ".OllllmmmmdddO",
    ".OOOOOOOOOOOO.",
  ],
};

/** Colours taken from the Mine boulder. */
export const RUBBLE_ART: NodeArt = {
  texture: "rubble",
  colors: { O: "#19181b", h: "#9b96a7", m: "#514e5c", d: "#3f3d47" },
  rows: [
    "....OOO.......",
    "...OhhmOOOO...",
    ".OOOmmdOhmdO..",
    "OhmmmddOmmddO.",
    "OmmdddddmdddOO",
    ".OOOOOOOOOOOO.",
  ],
};

export const NODE_ART: Readonly<Record<GatherKind, NodeArt>> = { tree: STUMP_ART, stone: RUBBLE_ART };

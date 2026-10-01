/**
 * The fixed catalogue of choppable trees.
 *
 * Four of the Homestead's own broadleaf trees (already drawn, decorative,
 * along the yard's treeline -- see public/stackacres-td/areas/homestead/
 * area.json's `tag: "tree:<id>"` props) become real nodes here. Every other
 * tree on every area stays exactly what it always was: scenery.
 *
 * This is intentionally a short, hand-picked list rather than "every prop
 * with a sway part is a tree" -- the same "a real, curated set" posture
 * ./secrets.ts's three `HIDDEN_ZONES` and ./map-places.ts's own places list
 * already take, rather than deriving tappable spots from art metadata that
 * was never meant to carry gameplay meaning.
 */

export const WOOD_NODE_IDS = [
  "homestead-1",
  "homestead-2",
  "homestead-3",
  "homestead-4",
] as const;

export type WoodNodeId = (typeof WOOD_NODE_IDS)[number];

export function isWoodNodeId(value: string): value is WoodNodeId {
  return (WOOD_NODE_IDS as readonly string[]).includes(value);
}

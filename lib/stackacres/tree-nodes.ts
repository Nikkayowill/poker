import homesteadArea from "@/public/stackacres-td/areas/homestead/area.json";

/** Every natural Homestead tree is a profile-owned wood node. */
const LEGACY_TREE_IDS = new Map<string, string>([
  ["360:168:p30_0", "homestead-2"],
  ["566:170:p31_0", "homestead-3"],
  ["268:196:p29_0", "homestead-1"],
  ["740:236:p32_0", "homestead-4"],
]);

type TreeProp = { x: number; y: number; frame: string; h: number; sway?: unknown; tag?: string };

const treeProps = (homesteadArea.props as TreeProp[]).filter((prop) => prop.sway !== undefined && prop.h >= 30);

function propKey(prop: Pick<TreeProp, "x" | "y" | "frame">): string {
  return `${prop.x}:${prop.y}:${prop.frame}`;
}

// Ids are saved per player, so they come from where the tree stands, not its
// place in area.json. Adding or reordering props must not rename anyone's trees.
function idForProp(prop: TreeProp): string {
  return LEGACY_TREE_IDS.get(propKey(prop)) ?? `homestead-tree-${prop.x}-${prop.y}`;
}

const TREE_ID_BY_KEY = new Map(treeProps.map((prop) => [propKey(prop), idForProp(prop)]));

/** Every natural tree on the Homestead, including the original four ids. */
export const WOOD_NODE_IDS: readonly string[] = [...TREE_ID_BY_KEY.values()];

export type WoodNodeId = string;

/** Gets the persisted node id for a map prop, or null for non-tree scenery. */
export function treeNodeIdForProp(prop: Pick<TreeProp, "x" | "y" | "frame">): string | null {
  return TREE_ID_BY_KEY.get(propKey(prop)) ?? null;
}

const WOOD_NODE_ID_SET = new Set<string>(WOOD_NODE_IDS);

export function isWoodNodeId(value: string): value is WoodNodeId {
  return WOOD_NODE_ID_SET.has(value);
}

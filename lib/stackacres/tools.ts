/**
 * StackAcres's old held-tool enum.
 *
 * The tool belt replaced it (lib/stackacres/toolbelt.ts): what is in hand is a
 * `BeltTool` now, and the belt's own defs carry the labels and hints the farm
 * actually shows. This survives for one reason only: the world contract still
 * declares a `tool` prop the top-down map ignores.
 *
 * Nothing sets anything but `inspect` any more. Do not add to it; add a belt
 * slot instead, and only once the map can draw what the slot does.
 */

export const STACKACRES_TOOLS = ["inspect", "scythe", "pipe", "soil", "water", "feed", "harvest"] as const;

export type StackAcresTool = (typeof STACKACRES_TOOLS)[number];

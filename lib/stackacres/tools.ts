/**
 * StackAcres's old held-tool enum.
 *
 * The tool belt replaced it (lib/stackacres/toolbelt.ts): what is in hand is a
 * `BeltTool` now, and the belt's own defs carry the labels and hints the farm
 * actually shows. This survives for two reasons and no others -- the world
 * contract still declares a `tool` prop the top-down map ignores, and the defs
 * below are still the source of a couple of icon names.
 *
 * Nothing sets anything but `inspect` any more. Do not add to it; add a belt
 * slot instead, and only once the map can draw what the slot does.
 */

export const STACKACRES_TOOLS = ["inspect", "scythe", "pipe", "soil", "water", "feed", "harvest"] as const;

export type StackAcresTool = (typeof STACKACRES_TOOLS)[number];

export interface StackAcresToolDef {
  /** What the button says, and what a screen reader announces. */
  label: string;
  /** One line under the dock saying what the tool does. */
  hint: string;
  /**
   * Name of a vector painter in components/arcade/stackacres/stackacres-art.ts
   * (its `PainterName` union). Kept as a plain string here rather than that
   * type so this file stays free of a components/ import; the toolbelt casts
   * it back to `PainterName` when it hands the name to `<StackAcresIcon>`.
   */
  icon: string;
}

export const STACKACRES_TOOL_DEFS: Readonly<Record<StackAcresTool, StackAcresToolDef>> = {
  inspect: {
    label: "Look",
    hint: "Tap anywhere to walk there. Tap something to use it.",
    icon: "ico-look",
  },
  scythe: {
    label: "Scythe",
    hint: "Drag across the Long Meadow to cut a swathe.",
    icon: "ico-scythe",
  },
  pipe: {
    label: "Pipe",
    hint: "Lay a run of pipe, or pull one up, one tile at a time from the ring.",
    icon: "ico-pipe",
  },
  soil: {
    label: "Soil",
    hint: "Till a bed, or lift one already down, one tile at a time from the ring.",
    icon: "ico-plant",
  },
  water: {
    label: "Water",
    hint: "Tap or drag over a dry crop or trough to water it.",
    icon: "ico-water",
  },
  feed: {
    label: "Feed",
    hint: "Tap or drag over a hungry animal to feed it.",
    icon: "ico-feed",
  },
  harvest: {
    label: "Harvest",
    hint: "Tap or drag a ready unit to collect it, or a mucked one to clear it.",
    icon: "ico-harvest",
  },
};

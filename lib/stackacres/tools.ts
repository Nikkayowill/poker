/**
 * StackAcres's tools: which one is held.
 *
 * `inspect` has no button. It is the resting state every session starts in
 * and falls back to. A tap always acts on whatever it lands on, whichever
 * tool is held: a tile lights up and offers its ring, and a dry crop, a
 * hungry pen or a ready unit offers its own drag tool (see
 * stackacres-scene.ts's `dispatchTap`).
 *
 * `scythe`, `pipe` and `soil` are the only three with a button
 * (`StackAcresGroundTools`), because they are the only three still held for
 * a drag with no single-tile version: mowing the Long Meadow, or laying or
 * lifting a whole run of pipe or beds. One tile of pipe or soil is also on
 * the tap ring with nothing held. A plain tap with one of these held still
 * opens the ring; only a drag does anything different.
 *
 * `water`, `feed` and `harvest` have no button. They stay tool values, and
 * keep their defs below for the icons and copy, but nothing ever holds one.
 *
 * Every ground tool shares one drag mechanism, acting on every tile a stroke
 * crosses past `TAP_SLOP` (see `bindInput`'s `pipeLaySegment`,
 * `soilLaySegment` and the scythe's `mowSegment`). A stroke that never leaves
 * the slop radius is a tap and goes through `dispatchTap`.
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
    hint: "Tap any square to select it and choose what to do there.",
    icon: "ico-look",
  },
  scythe: {
    label: "Scythe",
    hint: "Drag across the Long Meadow to cut a swathe.",
    icon: "ico-scythe",
  },
  pipe: {
    label: "Pipe",
    hint: "Drag across the ground to lay a run of pipe, or over pipe already down to lift it. Tap one square instead to choose it from the ring, angle included.",
    icon: "ico-pipe",
  },
  soil: {
    label: "Soil",
    hint: "Drag across the Crop Fields to till a run of beds, or over beds already down to lift them. Tap one square instead to choose it from the ring.",
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

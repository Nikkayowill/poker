/**
 * StackAcres's tools: which one is held.
 *
 * `inspect` has no button. It is the resting state every session starts in
 * and falls back to. A tap always acts on whatever it lands on, whichever
 * tool is held: a tile lights up and offers its ring, and a dry crop, a
 * hungry pen or a ready unit offers its own drag tool (see
 * stackacres-scene.ts's `dispatchTap`).
 *
 * `scythe` is the only one with a button (`StackAcresGroundTools`), because
 * cutting the Long Meadow has no single-tile version -- a drag has to be
 * armed by something. The cutter in hand (Scythe or Mower) is a separate
 * pick layered on top of this one, see lib/stackacres/cutters.ts.
 *
 * `pipe` and `soil` used to have their own held-and-dragged keys too, laying
 * or lifting a whole run of tiles in one stroke. That gesture is gone
 * (2026-09-10): laying a single pipe tile or bed is now reached entirely
 * through the tap ring/dock, one tile at a time, so nothing ever holds
 * either value any more. They keep their defs below purely for the icon and
 * copy the dock still reads off `STACKACRES_TOOL_DEFS.pipe`/`.soil`, the
 * same reuse `water`/`feed`/`harvest` -- also never held -- already relied
 * on.
 *
 * A stroke past `TAP_SLOP` with the scythe held cuts (`bindInput`'s
 * `mowSegment`); a stroke that never leaves the slop radius is a tap and
 * goes through `dispatchTap` regardless of what's held.
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

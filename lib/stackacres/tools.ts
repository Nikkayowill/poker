/**
 * StackAcres's toolbelt: which tool is held. Down to two entries now that
 * districts hold stock instead of plots -- see 2026-09-03's CLAUDE.md entry.
 *
 * The old design was tool-first because the whole surface was a grid of
 * identical-looking cells and a held tool was how the grid told you what a
 * tap would do -- hold Plant, every plantable plot lights up. There is no
 * grid any more: every unit you own is already a labelled row in the
 * district sidebar (./district-panel.ts), with its own button. Plant,
 * Harvest, Feed and Clear are gone from here entirely, not renamed.
 *
 * What survives is the scythe, because mowing the Long Meadow was never a
 * plot action -- its target is the GROUND, not a unit, and it still wants a
 * held-tool gesture (drag across the field to cut a swathe). `inspect` stays
 * as the resting state alongside it, the same as it always was.
 */

export const STACKACRES_TOOLS = ["inspect", "scythe"] as const;

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
    hint: "Pan and zoom around the farm.",
    icon: "ico-look",
  },
  scythe: {
    label: "Scythe",
    hint: "Drag across the Long Meadow to cut a swathe.",
    icon: "ico-scythe",
  },
};

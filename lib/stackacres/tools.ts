/**
 * StackAcres's toolbelt: which tool is held. Down to two entries for a while
 * now that districts hold stock instead of plots -- see 2026-09-03's
 * CLAUDE.md entry.
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
 *
 * `pipe` is the newest entry, added once laying a multi-tile irrigation run
 * (lib/stackacres/irrigation.ts) turned out to feel like work through the
 * ground-tap radial menu alone: one tap to open the ring, one to pick "Lay
 * Pipe", per tile, with the round trip blocking the next tile. Its target is
 * also the GROUND rather than a unit, the same case the scythe already made
 * for a held tool -- so it gets the identical drag gesture, just laying (or,
 * dragged over pipe already down, lifting) a tile per square crossed instead
 * of cutting grass. A well stays a single, deliberate, radial-only purchase
 * (see stackacres-farm.tsx's `pipeExtraActions`) -- it is one per farm and
 * costly enough that a drag should never place one by accident.
 *
 * `soil` is `pipe`'s own twin for the Crop Fields, added once a bed shrank
 * to one tile (lib/stackacres/soil.ts's `SOIL_TILE`): the same "one request
 * per tile crossed, no round trip blocking the next" case applies, so it
 * gets the identical drag gesture. `"place"` always plants the DEFAULT tier
 * -- Enriched and Hydro stay a deliberate, one-tile-at-a-time radial choice
 * (stackacres-farm.tsx's `soilExtraActions`), the same split a well takes
 * from `pipe`, so a drag can never silently drain a costlier bag.
 */

export const STACKACRES_TOOLS = ["inspect", "scythe", "pipe", "soil"] as const;

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
  pipe: {
    label: "Pipe",
    hint: "Drag across the ground to lay pipe, or over pipe already down to lift it. A well is still dug from the ring menu.",
    icon: "ico-pipe",
  },
  soil: {
    label: "Soil",
    hint: "Drag across the Crop Fields to till beds, or over beds already down to lift them. Enriched and Hydro are still bought from the ring menu.",
    icon: "ico-plant",
  },
};

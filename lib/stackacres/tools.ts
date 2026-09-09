/**
 * StackAcres's toolbelt: which tool is held.
 *
 * `inspect`/`scythe`/`pipe`/`soil` target the GROUND, not a unit, and each
 * wants a held-tool drag gesture across it (mow a swathe, lay or lift a run
 * of pipe, till or lift a bed). `water`/`feed`/`harvest` target a UNIT
 * instead -- collecting, feeding, watering and clearing muck used to be a
 * free tap anywhere on the canvas regardless of which tool (if any) was
 * held, back when districts were spread out enough that "whatever's under
 * the finger" never landed on the wrong thing by accident. Once pens sat
 * close together with different jobs (a hen's egg a tap away from a cow's
 * trough a tap away from a bed of soil), a bare tap doing whatever a unit
 * happened to afford stopped feeling like a farm and started feeling like a
 * minefield -- see stackacres-scene.ts's `dispatchTap` for the gate this
 * toolbelt now feeds. The fix is "right tool, right target": holding Water
 * and tapping (or dragging across) a dry crop or trough waters it; holding
 * anything else and tapping the same unit does nothing at all.
 *
 * `harvest` is dual-mode the same way `pipe` is place-or-erase: a press on a
 * ready unit collects it, a press on a mucked one clears it instead, decided
 * once per gesture by what's under the finger -- one basket, two outcomes,
 * so this stays a 7-tool belt rather than 8.
 *
 * Every ground- and unit-targeted tool shares the identical drag mechanism
 * (lay/act on every tile or unit a stroke crosses, and a plain tap replays
 * as a zero-length stroke) -- see `bindInput`'s `pipeLaySegment`/
 * `soilLaySegment` and their water/feed/harvest twins.
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

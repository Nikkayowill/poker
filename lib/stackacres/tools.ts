/**
 * StackAcres's toolbelt: which tool is held.
 *
 * `inspect` is not a button any more (2026-09-09) -- it is the resting state
 * every session starts in and falls back to, not a choice. A tap always
 * selects whatever it lands on (a tile lights up blue and offers a ring of
 * things to do there) regardless of which tool below is held; that used to
 * be `inspect`'s own exclusive behaviour, and is now simply what a plain tap
 * does everywhere, all the time -- see stackacres-scene.ts's `dispatchTap`.
 * `scythe`/`pipe`/`soil` are still held for their DRAG gesture (mow a
 * swathe, lay or lift a run of pipe, till or lift a run of beds); a plain
 * tap with one of them held no longer acts instantly -- it falls through to
 * the same select-and-choose ring as a tap with nothing held, so the only
 * thing holding Pipe or Soil changes any more is what a drag does.
 * `water`/`feed`/`harvest` target a UNIT instead -- collecting, feeding,
 * watering and clearing muck used to be a free tap anywhere on the canvas
 * regardless of which tool (if any) was held, back when districts were
 * spread out enough that "whatever's under the finger" never landed on the
 * wrong thing by accident. Once pens sat close together with different jobs
 * (a hen's egg a tap away from a cow's trough a tap away from a bed of
 * soil), a bare tap doing whatever a unit happened to afford stopped
 * feeling like a farm and started feeling like a minefield. The fix is
 * "right tool, right target": holding Water and tapping (or dragging
 * across) a dry crop or trough waters it; holding anything else and tapping
 * the same unit does nothing at all.
 *
 * `harvest` is dual-mode the same way `pipe` is place-or-erase: a press on a
 * ready unit collects it, a press on a mucked one clears it instead, decided
 * once per gesture by what's under the finger -- one basket, two outcomes,
 * so this stays a 7-tool belt rather than 8.
 *
 * Every ground- and unit-targeted tool shares the identical drag mechanism
 * (lay/act on every tile or unit a stroke crosses past `TAP_SLOP`) -- see
 * `bindInput`'s `pipeLaySegment`/`soilLaySegment` and their water/feed/
 * harvest twins. Only a drag uses it now; a stroke that never leaves the
 * slop radius is a tap and goes through `dispatchTap` instead, whichever
 * tool is held.
 */

export const STACKACRES_TOOLS = ["inspect", "scythe", "pipe", "soil", "water", "feed", "harvest"] as const;

export type StackAcresTool = (typeof STACKACRES_TOOLS)[number];

/**
 * Every tool that can have a button -- all of `STACKACRES_TOOLS` except
 * `inspect`, which has none any more (see this file's own header) but stays
 * in the full list above because it is still a real `StackAcresTool` value:
 * the default a session starts in and the one every tool button toggles back
 * to on a second press (`StackAcresToolbelt`'s own `onPick`).
 *
 * Which of these the dock draws at any moment is a narrower question, and
 * ./dock.ts answers it: the dock follows the selection now and shows only the
 * keys that can act on whatever was last tapped. This stays the full set of
 * what is drawable, which is what ./dock.test.ts holds its output against.
 */
export const STACKACRES_SELECTABLE_TOOLS = STACKACRES_TOOLS.filter(
  (id): id is Exclude<StackAcresTool, "inspect"> => id !== "inspect",
);

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

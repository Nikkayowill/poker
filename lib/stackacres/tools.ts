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
 * `water`/`feed`/`harvest` are not "held" at all any more (2026-09-10). They
 * target a UNIT rather than ground, and holding one used to make a tap or a
 * drag on the canvas itself act -- but whether that drag acted at all was
 * decided at the exact pixel the finger first pressed, so missing a unit's
 * hitbox by a hair silently turned the same gesture into a camera pan
 * instead, with nothing telling the player why nothing happened. These
 * three are pick-up-and-drop from the dock now, the way FarmVille's own
 * watering can works: press the icon, drag it, release it ON the unit --
 * see stackacres-toolbelt.tsx's own header. The hit-test only runs once, at
 * the drop, which is what makes it predictable where the old one wasn't.
 *
 * `harvest` is dual-mode the same way `pipe` is place-or-erase: a drop on a
 * ready unit collects it, a drop on a mucked one clears it instead, decided
 * by what the drop landed on -- one basket, two outcomes, so this stays a
 * 7-tool belt rather than 8.
 *
 * `pipe`/`soil` still share the identical ground-targeted drag mechanism
 * (lay/act on every tile a stroke crosses past `TAP_SLOP`) -- see
 * `bindInput`'s `pipeLaySegment`/`soilLaySegment`. A stroke that never
 * leaves the slop radius is a tap and goes through `dispatchTap` instead.
 */

export const STACKACRES_TOOLS = ["inspect", "scythe", "pipe", "soil", "water", "feed", "harvest"] as const;

export type StackAcresTool = (typeof STACKACRES_TOOLS)[number];

/**
 * The tools the dock actually draws a button for -- every one of
 * `STACKACRES_TOOLS` except `inspect`, which has no button any more (see
 * this file's own header) but stays in the full list above because it is
 * still a real `StackAcresTool` value: the default a session starts in and
 * the one every tool button toggles back to on a second press
 * (`StackAcresToolbelt`'s own `onPick`).
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
    hint: "Drag onto a dry crop or trough to water it.",
    icon: "ico-water",
  },
  feed: {
    label: "Feed",
    hint: "Drag onto a hungry animal to feed it.",
    icon: "ico-feed",
  },
  harvest: {
    label: "Harvest",
    hint: "Drag onto a ready unit to collect it, or a mucked one to clear it.",
    icon: "ico-harvest",
  },
};

/**
 * Which character art to draw at a racetrack seat, and where.
 *
 * The dealer always faces the camera dead-on, so `table-dealer.ts` needs
 * only the one plate. A player doesn't: the five opponent seats sit at five
 * different angles off dead centre (see `seatAnglesDeg` in
 * `table-anchors.ts`), so a character here is a bucket of turned plates
 * (`art/seats/<id>/<angle>.png`, built by `scripts/prepare-seat-art.py`),
 * and this module's job is picking which one a given seat draws and which
 * way it has to face. See `pickSeatArt` for how that pick is capped; it's
 * not simply "nearest angle."
 *
 * One bucket serves both sides of the table, mirrored. Every angle plate is
 * shot turning the same way, toward screen-left, the convention the build
 * script's docstring pins down, so it's correct as-is for a seat that
 * should look screen-left (toward the pot from the right of the dealer) and
 * has to be flipped for a seat that should look screen-right (toward the
 * pot from the left). Shooting a mirrored second set of plates would double
 * the art to draw a reflection CSS already does for free.
 */

import { SEAT_ART_CHARACTERS, type SeatArtCharacter } from "./seat-art.generated";

export type { SeatArtCharacter };
export { SEAT_ART_CHARACTERS };

export function seatArtCharacter(id: string): SeatArtCharacter | null {
  return SEAT_ART_CHARACTERS.find((c) => c.id === id) ?? null;
}

/**
 * A stable 32-bit hash of a table id, so different tables do not all seat the
 * same lineup. FNV-1a, kept local rather than shared, matching how this app
 * already keeps that boilerplate (`lib/game/engine.ts`, the arcade puzzle
 * generators) beside each caller.
 */
function hashTableId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Which roster character sits in a given opponent seat.
 *
 * Five characters, five opponent seats (`SEAT_COUNT - 1` at a 6-max table),
 * so `hashTableId(tableId) + cast + slot`, taken mod the roster size, is a
 * full permutation for any one table/cast: every opponent seat gets a
 * different character, not the same one five times over. Growing the
 * roster past five needs no change here; some seats would just start
 * repeating less often as it grows.
 *
 * Turns over every `HANDS_PER_CAST` hands. That cadence used to belong to
 * the dealer, changing when the dealer's down did, with the constant living
 * beside the rotation that drove it. There is one dealer now and she never
 * leaves, so the number moved here, to the only rotation left. Pure over
 * `tableId`/`handNumber`/`slot`, all three server-authoritative and already
 * in every snapshot, so every client at the table agrees without a byte
 * crossing the wire for it.
 *
 * This is still a per-seat pick, not a per-player one: it doesn't know or
 * care who is actually sitting there, only which chair. Tying it to the
 * actual occupant (their own chosen cosmetic, stable across reseats) is a
 * real follow-up and a `Seat`/cosmetics question.
 *
 * Never offers a character missing a slot's own forced angle. Seat 1 forces
 * its widest plate (see `SEAT_ART_OVERRIDES`/`DESKTOP_SEAT_ART_OVERRIDES`
 * below); a character shot at 0deg only has no such plate, and would land
 * there facing the camera dead-on at the one seat that most needs to look
 * turned toward the pot, wrong in a way `pickSeatArt`'s own fallback can't
 * fix after the fact, since by then the character is already picked. Cut
 * down to whichever characters actually have every angle either
 * breakpoint's override could force for this slot *before* hashing, not
 * after, falling back to the full roster only if that would leave nothing
 * to pick from.
 */
/**
 * How many hands the opponent seats hold their cast before it turns over.
 *
 * A whole number of hands rather than a duration so the swap can only ever
 * happen between hands: a seat whose occupant changes face mid-hand reads
 * as a glitch, and a clock-based rotation can't promise it won't.
 */
export const HANDS_PER_CAST = 8;

function forcedAnglesForSlot(slot: number): readonly number[] {
  const angles = new Set<number>();
  const mobile = SEAT_ART_OVERRIDES[slot]?.angle;
  const desktop = DESKTOP_SEAT_ART_OVERRIDES[slot]?.angle;
  if (mobile !== undefined) angles.add(mobile);
  if (desktop !== undefined) angles.add(desktop);
  return [...angles];
}

export function seatArtCharacterForSlot(tableId: string, handNumber: number, slot: number): SeatArtCharacter | null {
  if (SEAT_ART_CHARACTERS.length === 0) return null;
  const required = forcedAnglesForSlot(slot);
  const eligible = required.length === 0
    ? SEAT_ART_CHARACTERS
    : SEAT_ART_CHARACTERS.filter((character) => required.every((angle) => character.angles.includes(angle)));
  const pool = eligible.length > 0 ? eligible : SEAT_ART_CHARACTERS;
  const hand = Number.isFinite(handNumber) ? Math.max(0, Math.floor(handNumber)) : 0;
  const cast = Math.floor(hand / HANDS_PER_CAST);
  const index = (hashTableId(tableId) + cast + slot) % pool.length;
  return pool[index];
}

export function seatArtSrc(characterId: string, angle: number): string {
  return `/table2d5/seats/${characterId}/${angle}.webp`;
}

/**
 * A seat's art box, in terms the camera can answer: the sibling of
 * `DEALER_SLOT` in `table-dealer.ts`, but not the same shape.
 *
 * The dealer has exactly one place at the table, so `DEALER_SLOT.height`
 * could just be a ratio tuned by eye against that one position and never
 * need to be right anywhere else. Five seats at five different distances
 * from the camera don't have that luxury: a single ratio applied to each
 * seat's own `shoulderPx` was the first cut of this, and it read as "some
 * characters floating, some touching the table, for no visible reason,"
 * because shoulder room and camera distance don't scale together. The same
 * ratio needed a different actual height at every seat to make the hands
 * land on the rail, and one number can't be several different numbers.
 *
 * Sized from two projected anchors instead of one ratio. Every seat has a
 * crown (`seatHead`) and a place its hands belong (`seatTrayAnchor`, the
 * chip tray on the rail, exactly where a player's hands read as resting).
 * Projecting both and measuring the pixel gap between them gives the exact
 * height that makes this seat's hands land on this seat's rail, camera
 * distance and all: at `scale: 1` every seat's hands touch down by
 * construction, not by having found the right ratio for it. `scale` is
 * then a pure artistic knob on top of that (bigger or smaller than the
 * exact fit) rather than the thing standing between a character and the
 * table.
 */
export const SEAT_ART_SLOT = {
  /**
   * Multiplier on the exact crown-to-hands fit. 1 means the art's hands
   * land precisely on the seat's own tray anchor; this is the only number
   * that should ever need retuning by eye, and it does the same job at
   * every seat because the fit itself is already per-seat correct.
   */
  scale: 1,
  /**
   * How far the crown sits above the seat's own head anchor, as a fraction
   * of the drawn height. Same role as `DEALER_SLOT.crown`.
   */
  crown: 0.02,
} as const;

export interface SeatArtOverride {
  /** Overrides `SEAT_ART_SLOT.scale` for this seat only. */
  scale?: number;
  /** Overrides `SEAT_ART_SLOT.crown` for this seat only. */
  crown?: number;
  /**
   * Nudge in screen-space CSS pixels, applied on top of the anchor-based
   * fit. Positive X is always rightward on screen and positive Y is always
   * downward, regardless of which side of the table the seat mirrors onto.
   */
  offsetX?: number;
  offsetY?: number;
  /**
   * Forces a specific angle plate for this seat, bypassing `pickSeatArt`'s
   * own magnitude-based pick entirely: not a bias on it, a replacement. An
   * exception to the shared rule rather than a routine knob: `pickSeatArt`'s
   * default already caps every seat at the character's second angle
   * (typically 20deg), so this only matters for reaching a third, wider
   * plate (e.g. 40deg), and the roster is meant to stop at two turns, 0 and
   * 20, seat 1 included. No seat currently sets this; leave it that way
   * unless a wider turn is wanted again. Must be one of the character's own
   * `angles`.
   */
  angle?: number;
}

/**
 * Per-seat hand-tuning for mobile screens (the default fallback).
 */
export const SEAT_ART_OVERRIDES: Partial<Record<number, SeatArtOverride>> = {
  1: { scale: 1.2, offsetX: 10, offsetY: 20 },
  2: { scale: 1.1, offsetX: 10, offsetY: 0 },
  5: { scale: 1.1, offsetX: 30, offsetY: 10 },
};

/**
 * Per-seat hand-tuning for desktop screens (1024px width and up). Adjust
 * these values to fix the layout on big monitors.
 */
export const DESKTOP_SEAT_ART_OVERRIDES: Partial<Record<number, SeatArtOverride>> = {
  1: { scale: 1.3, offsetX: 10, offsetY: 20 },
  2: { scale: 1.1, offsetX: 10, offsetY: 0 },
  5: { scale: 1.1, offsetX: 30, offsetY: 10 },
};

export const DESKTOP_BREAKPOINT_PX = 1024;

/**
 * Which table applies, mobile or desktop.
 *
 * `isDesktop` is the frame actually being drawn: pass it whenever the
 * caller knows that (the debug page does, for both canvases it renders).
 * Without it this falls back to the live browser viewport via
 * `matchMedia`, which is only correct when there's exactly one canvas on
 * screen and it fills the window. `/dev/table-layout` breaks that
 * assumption (it renders the 1600px and 844px frames side by side, in the
 * same window, to compare them), and checking the window there can't tell
 * which canvas is asking, so both would silently get the same answer
 * regardless of which frame they were actually drawing. Always pass
 * `isDesktop` from a known frame width when one is available; the viewport
 * fallback exists for a real single-table page, not this one.
 */
function getActiveOverrides(isDesktop?: boolean): Partial<Record<number, SeatArtOverride>> {
  const desktop = isDesktop ?? (typeof window !== "undefined" && window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`).matches);
  return desktop ? DESKTOP_SEAT_ART_OVERRIDES : SEAT_ART_OVERRIDES;
}

/** `SEAT_ART_SLOT` plus this seat's own override, matching desktop or mobile.
 *  See `getActiveOverrides` for what `isDesktop` means and when to pass it. */
export function seatArtSlotFor(slot: number, isDesktop?: boolean): { scale: number; crown: number; offsetX: number; offsetY: number } {
  const override = getActiveOverrides(isDesktop)[slot];
  return {
    scale: override?.scale ?? SEAT_ART_SLOT.scale,
    crown: override?.crown ?? SEAT_ART_SLOT.crown,
    offsetX: override?.offsetX ?? 0,
    offsetY: override?.offsetY ?? 0,
  };
}

export interface SeatArtBox {
  left: number;
  top: number;
  width: number;
  height: number;
  mirror: boolean;
}

/**
 * A seat's art box in real screen pixels, from its own projected crown and
 * hands anchors: the DOM sibling of `table-anchors-debug.tsx`'s canvas math
 * (`drawSeatArt`), and it has to reproduce that exactly rather than "look
 * about right." The debug page is where every number in
 * `SEAT_ART_OVERRIDES` was judged, so a different formula here would make
 * those numbers wrong again the moment they hit a real seat.
 *
 * Anchored at the hands, not the head. `slot.scale` exists to draw a seat
 * bigger than its natural head-to-hands fit: a bigger box has to grow
 * from somewhere, and growing it from the bottom pushes the hands (and
 * whatever's resting in them) down past the felt/rail line by
 * `fit * (scale - 1)`, which is real screen pixels, not a rounding error:
 * a character whose plate has no transparent margin below their hand (built
 * flush to the crop edge, same as any other plate; see
 * prepare-seat-art.py) visibly sinks an arm into the table the moment scale
 * departs from 1. Pinning the bottom at `hands` and growing the box upward
 * instead keeps every character's hands on the felt at any scale; only
 * their head/hair reaches higher. `offsetY` stays a plain screen-space
 * nudge on top of that anchor, same as it always was; it no longer has to
 * fight a scale-proportional drift to do its job. Verified against seat 1's
 * own override (2026-08-22, when it still forced the character's 40deg
 * plate; see `SeatArtOverride.angle`'s own note for why that's gone now;
 * seat 1's scale/offsetY push is unchanged and was still the hardest case
 * on the roster): two characters since renumbered/deleted used to submerge
 * their hand into the rail there; neither does after this change.
 *
 * Mirroring happens after positioning, not by moving the box. The box below
 * is placed at its un-mirrored position (`left`); the caller applies
 * `transform: scaleX(-1)` to the image when `mirror` is true, which flips
 * the art's content in place around the box's own centre without moving
 * the box itself. That only reproduces the canvas version because the box
 * is symmetric about the crown when `offsetX` is 0. Don't "simplify" this
 * by mirroring `left` instead, which moves the box rather than the picture
 * inside it.
 */
export function seatArtBox(
  head: { x: number; y: number },
  hands: { x: number; y: number },
  aspect: number,
  mirror: boolean,
  slot: { scale: number; crown: number; offsetX: number; offsetY: number },
): SeatArtBox | null {
  const fit = hands.y - head.y;
  if (fit <= 0) return null;
  const height = (fit / (1 - slot.crown)) * slot.scale;
  const width = height * aspect;
  const bottom = hands.y + slot.offsetY;
  return {
    left: head.x - width / 2 + slot.offsetX,
    top: bottom - height,
    width,
    height,
    mirror,
  };
}

export interface SeatArtPick {
  src: string;
  /** Aspect ratio of the art, width / height, for sizing the drawn box. */
  aspect: number;
  /** CSS transform to apply on top of positioning; empty string when the
   *  plate already faces the right way. */
  mirror: boolean;
}

/**
 * The plate to draw at a seat, and whether it needs flipping.
 *
 * `offsetDeg` is signed distance from the dealer's own angle (dead centre):
 * negative is a seat to the dealer's left, positive to the dealer's right
 * (the same sign `seatAngleDeg(slot) - DEALER_ANGLE_DEG` gives). A seat to
 * the dealer's right should look screen-left toward the pot, which is what
 * every plate already does un-mirrored; a seat to the left needs the flip.
 *
 * Capped at the character's second angle by default, however many wider
 * plates exist. Judged against a real render: a seat right beside the
 * dealer reads best nearly square-on, and every seat further out than that
 * reads better on the same mild turn rather than turning more with
 * distance, so the default is two tiers, not nearest-of-N. The seat(s) at
 * the character's own smallest non-zero angle get the flattest plate, and
 * everything past that gets the next one up and stops there.
 *
 * `forceAngle` overrides that pick entirely for one seat; see
 * `SeatArtOverride.angle` for why this is a named exception rather than a
 * third tier in the rule above. Prefer `pickSeatArtForSlot` at a real call
 * site; it reads `forceAngle` out of `SEAT_ART_OVERRIDES` for you.
 *
 * Ignored if the character doesn't have that plate. Some characters are
 * shot at 0deg only, awaiting their 20/40 turns; `forceAngle` is tuned
 * against characters with a full bucket, and a seat override is a fixed
 * per-seat number that has no idea which character the hash rotation is
 * about to seat there, so it can land on either. Falling back to the
 * normal pick rather than requesting a plate that was never built is what
 * keeps that pairing from a broken image instead of a bug.
 */
export function pickSeatArt(character: SeatArtCharacter, offsetDeg: number, forceAngle?: number): SeatArtPick {
  const magnitude = Math.abs(offsetDeg);
  const sorted = [...character.angles].sort((a, b) => a - b);
  const flattest = sorted[0] ?? 0;
  const turned = sorted[1] ?? flattest;
  const angle = forceAngle !== undefined && character.angles.includes(forceAngle) ? forceAngle : (magnitude <= turned ? flattest : turned);
  return {
    src: seatArtSrc(character.id, angle),
    aspect: character.box.width / character.box.height,
    mirror: offsetDeg < 0,
  };
}

/** `pickSeatArt` wrapped with this seat's own angle override, if it has one.
 *  See `getActiveOverrides` for what `isDesktop` means and when to pass it. */
export function pickSeatArtForSlot(character: SeatArtCharacter, slot: number, offsetDeg: number, isDesktop?: boolean): SeatArtPick {
  return pickSeatArt(character, offsetDeg, getActiveOverrides(isDesktop)[slot]?.angle);
}

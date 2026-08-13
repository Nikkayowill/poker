/**
 * Which character art to draw at a racetrack seat, and where.
 *
 * A dealer always faces the camera dead-on, so `dealer-roster.ts` only ever
 * has one plate per dealer. A PLAYER doesn't -- the five opponent seats sit
 * at five different angles off dead centre (see `seatAnglesDeg` in
 * `table-anchors.ts`), so a character here is a BUCKET of turned plates
 * (`art/seats/<id>/<angle>.png`, built by `scripts/prepare-seat-art.py`) and
 * this module's job is picking the nearest one for a given seat and
 * deciding which way it has to face.
 *
 * ONE BUCKET SERVES BOTH SIDES OF THE TABLE, MIRRORED. Every angle plate is
 * shot turning the same way -- toward screen-left, the convention the build
 * script's docstring pins down -- so it's correct as-is for a seat that
 * should look screen-left (toward the pot from the RIGHT of the dealer) and
 * has to be flipped for a seat that should look screen-right (toward the pot
 * from the LEFT). Shooting a mirrored second set of plates would be doubling
 * the art to draw a reflection CSS already does for free.
 */

import { SEAT_ART_CHARACTERS, type SeatArtCharacter } from "./seat-art.generated";

export type { SeatArtCharacter };
export { SEAT_ART_CHARACTERS };

export function seatArtCharacter(id: string): SeatArtCharacter | null {
  return SEAT_ART_CHARACTERS.find((c) => c.id === id) ?? null;
}

export function seatArtSrc(characterId: string, angle: number): string {
  return `/table2d5/seats/${characterId}/${angle}.webp`;
}

export interface SeatArtPick {
  src: string;
  /** Aspect ratio of the art, width / height -- for sizing the drawn box. */
  aspect: number;
  /** CSS transform to apply on top of positioning; empty string when the
   *  plate already faces the right way. */
  mirror: boolean;
}

/**
 * The plate to draw at a seat, and whether it needs flipping.
 *
 * `offsetDeg` is signed distance from the dealer's own angle (dead centre) --
 * negative is a seat to the dealer's LEFT, positive to the dealer's RIGHT
 * (the same sign `seatAngleDeg(slot) - DEALER_ANGLE_DEG` gives). A seat to
 * the dealer's right should look screen-left toward the pot, which is what
 * every plate already does un-mirrored; a seat to the left needs the flip.
 *
 * Nearest angle, not interpolated -- same "the artwork carries the angle"
 * rule the 3D room's own sprite turnaround uses. A character missing the
 * exact angle a far seat wants (this first bucket has 0/20/40 but the
 * outermost seat sits at 60) falls back to its widest plate rather than
 * inventing a rotation nobody drew.
 */
export function pickSeatArt(character: SeatArtCharacter, offsetDeg: number): SeatArtPick {
  const magnitude = Math.abs(offsetDeg);
  let nearest = character.angles[0];
  let best = Infinity;
  for (const angle of character.angles) {
    const distance = Math.abs(angle - magnitude);
    if (distance < best) {
      best = distance;
      nearest = angle;
    }
  }
  return {
    src: seatArtSrc(character.id, nearest),
    aspect: character.box.width / character.box.height,
    mirror: offsetDeg < 0,
  };
}

import { seatArtCharacter, seatArtSrc } from "@/lib/scene/seat-art";

/**
 * The sign-in centerpiece: three characters peeking up from behind the form.
 *
 * The two flanks reuse the real seat-art roster/plates the racetrack table
 * already draws (`public/table2d5/seats/<id>/<angle>.webp`) -- no separate
 * asset to source, crop or keep in sync. Named by Kayo's own pick rather
 * than randomly rolled: character14/28 are "Adelaide Sinclair"/"Wren
 * Callahan" in the store catalog (`lib/cosmetics/catalog.ts`), chosen by
 * name, not id -- resolve a character by name against that catalog, not by
 * number, if this ever needs to change again (see
 * reference_stackchips_seat_sheet_slicing's note on the roster's own id
 * renumbering history for why numbers alone aren't a stable way to talk
 * about a character).
 *
 * The centre is Kayo's own supplied art, deliberately NOT added to
 * `SEAT_ART_CHARACTERS`/`lib/cosmetics/catalog.ts`: every roster member is
 * also a real, priced Collection/store entry (`characterAvatarOffers`
 * throws if one is missing), and turning this into a purchasable character
 * with a real Gold price is Kayo's call, not an inference from "use this
 * for the sign-in." Kept out of the shared roster/store, this is a
 * sign-in-only asset -- still built with the real
 * `scripts/prepare-seat-art.py` pipeline for the cutout/normalisation (ran
 * against a throwaway one-character `art/seats/` input, output kept, source
 * removed so a future roster regen doesn't resurrect it), just referenced
 * directly by path rather than through `seatArtCharacter`/`seatArtSrc`. If
 * this ever should become a real roster member, add the catalog entry and
 * switch CENTER_SRC back to a `characterId` through `CastMember` like the
 * flanks.
 */
const CENTER_SRC = "/table2d5/seats/character32/0.webp";
const LEFT_CHARACTER_ID = "character28"; // Wren Callahan
const RIGHT_CHARACTER_ID = "character14"; // Adelaide Sinclair

/**
 * The angle plate to use for a flanking character, and which way to face it.
 *
 * Every plate is shot turning the same way, toward screen-left (see
 * `lib/scene/seat-art.ts`'s own doc comment) -- correct as-is for the right
 * side (looking in, toward the centre) and mirrored via `scaleX(-1)` for the
 * left side, exactly the rule the racetrack table already applies per seat
 * (`mirror: offsetDeg < 0`). Reusing that convention here rather than
 * inventing a sign-in-specific one keeps every character in the roster
 * correct at this spot with zero extra art, now or as the roster grows.
 */
const FLANK_ANGLE = 20;

function CastMember({
  characterId,
  angle,
  mirror,
  className,
}: {
  characterId: string;
  angle: number;
  mirror: boolean;
  className: string;
}) {
  // Only used to confirm the character/plate actually exists; the box's own
  // aspect ratio is deliberately NOT read into a style here (see the CSS's
  // own note on .entry-hero-center/.entry-hero-side) -- the roster's boxes
  // vary in proportion per character, and sizing each plate off its own box
  // is what put the three at visibly uneven widths the first time around.
  if (!seatArtCharacter(characterId)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={seatArtSrc(characterId, angle)}
      alt=""
      draggable={false}
      style={{ transform: mirror ? "scaleX(-1)" : undefined }}
    />
  );
}

export function EntryHero() {
  return (
    <div className="entry-hero" aria-hidden="true">
      <div className="entry-hero-glow" />
      <div className="entry-hero-cast">
        <CastMember
          characterId={LEFT_CHARACTER_ID}
          angle={FLANK_ANGLE}
          mirror
          className="entry-hero-side entry-hero-side-left"
        />
        {/* Wrapped, not a bare <img> like the flanks: the sway animation
            lives on this wrapper so the glints below share the exact same
            motion as the character rather than swaying independently of
            him -- see the glints' own note in the CSS for why they're
            positioned here and not masked like the portrait is. */}
        <div className="entry-hero-center">
          {/* A plain <img>, not next/image: one small already-sized file
              with no build-time box to give the optimiser, same call the
              flanks (via CastMember) and the dealer/table seat art already
              make. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="entry-hero-center-img" src={CENTER_SRC} alt="" draggable={false} />
          <span className="entry-hero-glint entry-hero-glint-1" />
          <span className="entry-hero-glint entry-hero-glint-2" />
          <span className="entry-hero-glint entry-hero-glint-3" />
          <span className="entry-hero-glint entry-hero-glint-4" />
        </div>
        <CastMember
          characterId={RIGHT_CHARACTER_ID}
          angle={FLANK_ANGLE}
          mirror={false}
          className="entry-hero-side entry-hero-side-right"
        />
      </div>
    </div>
  );
}

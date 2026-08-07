import clsx from "clsx";
import { DEALER_DOGS } from "@/lib/arcade/dealer";

/**
 * Loki and Finn as a face crop: the pair drawn flat, at any size.
 *
 * ITS ONE CALLER TODAY is the felt's dealer layer
 * (components/arcade/dealer-stage.tsx), which renders it enlarged as the
 * placeholder until the painted dealers land. It used to also sit at 34px
 * beside the dealer's hand, and that call was deliberately removed: with the
 * pair now IN the room above their own cards, a second drawing of them forty
 * pixels below was the duplication that made the old stage read as a
 * television rather than a table.
 *
 * It is still built to survive 34px, and that constraint is what shapes every
 * decision below -- see the note on ears. Judge any change here against a real
 * small render, never against the 64-unit viewBox.
 *
 * The colours are read from lib/arcade/dealer.ts rather than typed in here.
 * Two drawings of the same two dogs that disagree about what colour they are
 * is the exact drift that makes a mascot look like clip art, and a hex value
 * repeated in two files always drifts eventually.
 *
 * Framed as a FACE CROP, not two figures -- the lesson the previous dealer
 * cost to learn. Every player avatar beside it is avatarFace(), a head filling
 * the disc, and the first version of that dealer drew a whole croupier inside
 * the circle: at the size it actually renders, the head was eleven pixels and
 * the hat a bar across it. Two heads fill this frame edge to edge, and every
 * dog carries five marks at most. Judge any change here against a real 34px
 * render, never against the 64-unit viewBox.
 *
 * THE UNIFORM IS A SHIRT COLLAR AND A BLACK BOW TIE, and it used to be a green
 * croupier's visor and a gold one. Neither visor nor gold exists in the real
 * portraits (public/dealer/), and the mismatch survived a long time precisely
 * because this drawing is Blackjack's PLACEHOLDER -- it stops rendering there
 * the moment real art lands, so the drift was invisible on the one page anyone
 * was looking at while being live on the five other arcade games that still
 * draw it. If this file and the photographs disagree again, that is the bug.
 *
 * BOTH DOGS ARE DROP-EARED NOW. They used to be told apart by ear style -- one
 * flop, one prick -- which stopped being true when the pair were corrected
 * against the owner's own reference: they are two doodles with hanging, curly
 * ears. So COLOUR is the only thing carrying the difference, and it has to
 * carry it alone: an apricot dog in front and a black dog behind is about as
 * far apart as two coats get. dealer.test.ts pins that separation numerically,
 * because "these two are distinguishable" stopped being something the shapes
 * guarantee.
 *
 * DRAWING A BLACK DOG is its own problem and the rim light is the answer to
 * it. Finn sits on a dark green disc on an almost-black page; a black coat
 * with black features inside a dark frame is a hole in the picture, not an
 * animal. So his coat is a very dark warm grey rather than #000 (see the note
 * on `base` in dealer.ts), his curls are picked out lighter still, and a soft
 * cream rim runs over his crown and ear tops to cut him out of the background.
 * Remove that rim and the pair becomes one apricot dog beside a smudge.
 *
 * Renders on the server -- no "use client", no hooks, no state.
 */

const [LOKI, FINN] = DEALER_DOGS;

export function DealerAvatar({ className }: { className?: string }) {
  return (
    <span
      className={clsx("dealer-avatar", className)}
      role="img"
      aria-label={`${LOKI.name} and ${FINN.name}, the house dealers`}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        {/* Felt disc, so the pair occupies the same circular footprint a
            player's .profile-avatar does. */}
        <circle cx="32" cy="32" r="32" fill="#123527" />

        {/* ---- Finn: the black one, behind and to the right. Drawn first so
                Loki overlaps him, which is what puts the two of them at
                different depths in a picture with no perspective in it. ---- */}
        <g>
          {/* Drop ears.
           *
           * LOW AND LONG, hanging past the jaw, and this is the single most
           * load-bearing decision in the drawing. A first cut put both dogs'
           * ears as round lobes level with the eyes and outside the skull --
           * which is a BEAR. An ear that starts above the eye and hangs to
           * below the muzzle is what says "dog", and on a doodle it is most of
           * the silhouette. */}
          <ellipse cx="34.4" cy="31.6" rx="4.4" ry="10.2" fill={FINN.coat.base} transform="rotate(-9 34.4 31.6)" />
          <ellipse cx="55.6" cy="31.6" rx="4.4" ry="10.2" fill={FINN.coat.base} transform="rotate(9 55.6 31.6)" />
          {/* The rim: light catching the top of a curly coat. Low opacity, so
              it reads as a highlight rather than a drawn outline. Without it a
              black dog on this dark disc has no silhouette at all. */}
          <ellipse cx="34.4" cy="27" rx="4" ry="4.4" fill={FINN.coat.cream} fillOpacity=".2" />
          <ellipse cx="55.6" cy="27" rx="4" ry="4.4" fill={FINN.coat.cream} fillOpacity=".2" />

          {/* Skull, lit from the upper left. */}
          <ellipse cx="45" cy="27.6" rx="11.6" ry="11.2" fill={FINN.coat.base} />
          <ellipse cx="41.4" cy="23.6" rx="8.4" ry="7" fill={FINN.coat.cream} fillOpacity=".14" />

          {/* Curls over the crown, picked out in LIGHT rather than in shadow.
           *
           * THIS IS WHERE THE VISOR USED TO SIT, and removing it exposed a
           * drawing that only worked underneath one. The crown was a dark
           * saddle ellipse with a cream sliver above it, which top-to-bottom
           * is: light band, dark band, lighter skull -- a hat, a hatband, and a
           * brim, the dark ellipse's lower arc reading as the brim's edge.
           * With a visor over it that was hair; without one it is a BOWLER HAT
           * on a dog.
           *
           * Shadow cannot fix it, which is the part worth remembering. Finn's
           * coat is a very dark warm grey chosen to sit just off black, so
           * there is no darker value left to shade WITH -- any dark mass laid
           * on that skull stops being shading and becomes an object. Light is
           * the only axis he has, and it is the same trick the ear rim above
           * already uses for the same reason. Lobes follow the skull's curve so
           * there is no horizontal edge anywhere for an eye to read as a brim.
           *
           * Loki's equivalent below is a dark fringe and is fine: apricot has
           * somewhere darker to go, so his reads as curl. Do not "make these
           * consistent" -- the asymmetry is the whole point. */}
          <ellipse cx="40" cy="21.4" rx="4" ry="3.6" fill={FINN.coat.cream} fillOpacity=".12" transform="rotate(-18 40 21.4)" />
          <ellipse cx="45" cy="20.4" rx="4.8" ry="3.6" fill={FINN.coat.cream} fillOpacity=".15" />
          <ellipse cx="50" cy="21.4" rx="4" ry="3.6" fill={FINN.coat.cream} fillOpacity=".12" transform="rotate(18 50 21.4)" />

          {/* Eyes. A lighter iris than the coat plus a hard white glint -- on a
              black dog the glint is doing most of the work. */}
          <ellipse cx="39.8" cy="29" rx="2.2" ry="2.5" fill={FINN.coat.eye} />
          <ellipse cx="50.2" cy="29" rx="2.2" ry="2.5" fill={FINN.coat.eye} />
          <circle cx="39.8" cy="29.2" r="1.15" fill="#0d0b0c" />
          <circle cx="50.2" cy="29.2" r="1.15" fill="#0d0b0c" />
          <circle cx="40.6" cy="28.1" r=".9" fill="#fff" fillOpacity=".97" />
          <circle cx="51" cy="28.1" r=".9" fill="#fff" fillOpacity=".97" />

          {/* Muzzle. Black on black, so it is cut out by a highlight above and
              a shadow below rather than by its own fill. */}
          <ellipse cx="45" cy="35.8" rx="5" ry="4.6" fill={FINN.coat.base} />
          <ellipse cx="45" cy="34" rx="4.6" ry="2.4" fill={FINN.coat.cream} fillOpacity=".13" />
          <ellipse cx="45" cy="38.6" rx="4.4" ry="2.6" fill={FINN.coat.saddle} fillOpacity=".85" />
          <ellipse cx="45" cy="36.4" rx="2.4" ry="1.8" fill={FINN.coat.nose} />
        </g>

        {/* ---- Loki: the apricot one, in front and to the left. Same
                silhouette as Finn by design; the coat is the whole read. ---- */}
        <g>
          {/* Drop ears -- longer and shaggier, since he is the fluffier of the
              two (see `fluff` in dealer.ts). Same low hang as Finn's. */}
          <ellipse cx="8.2" cy="38" rx="5.2" ry="12" fill={LOKI.coat.saddle} transform="rotate(-8 8.2 38)" />
          <ellipse cx="33.8" cy="38" rx="5.2" ry="12" fill={LOKI.coat.saddle} transform="rotate(8 33.8 38)" />
          {/* Feathering at the ear tips, which is what a doodle's ear does and
              a spaniel's does not. */}
          <ellipse cx="8.2" cy="47.4" rx="4.6" ry="3.4" fill={LOKI.coat.saddle} />
          <ellipse cx="33.8" cy="47.4" rx="4.6" ry="3.4" fill={LOKI.coat.saddle} />

          {/* Skull. */}
          <ellipse cx="21" cy="33.4" rx="13" ry="12.6" fill={LOKI.coat.base} />

          {/* Fringe of curls over the forehead.
           *
           * KEPT INSIDE THE SKULL'S OUTLINE, which it was not before: it sat at
           * cy 23.4 with ry 5.4, so its top reached y 18 against a skull that
           * starts at 20.8, and it was 11 wide where the skull is 10.2. That
           * put a darker arc OUTSIDE the head silhouette -- a shape sitting on
           * top of a dog rather than growing out of it, which is a beret. It
           * went unnoticed for the same reason Finn's did: a visor was drawn
           * over exactly that band, so the protrusion was never visible.
           *
           * Unlike Finn's above, this one stays a SHADOW. Apricot has somewhere
           * darker to go, so a dark fringe on Loki reads as curl the moment it
           * is inside his outline; the fix here is geometry, not value. */}
          <ellipse cx="21" cy="25.6" rx="9.8" ry="4.6" fill={LOKI.coat.saddle} fillOpacity=".55" />
          <ellipse cx="15.4" cy="26.4" rx="3.9" ry="3.2" fill={LOKI.coat.saddle} fillOpacity=".4" />
          <ellipse cx="26.6" cy="26.4" rx="3.9" ry="3.2" fill={LOKI.coat.saddle} fillOpacity=".4" />

          {/* Eyes. */}
          <ellipse cx="15.2" cy="34.4" rx="2.5" ry="2.8" fill={LOKI.coat.eye} />
          <ellipse cx="26.8" cy="34.4" rx="2.5" ry="2.8" fill={LOKI.coat.eye} />
          <circle cx="15.2" cy="34.6" r="1.25" fill="#181008" />
          <circle cx="26.8" cy="34.6" r="1.25" fill="#181008" />
          <circle cx="16.1" cy="33.4" r=".9" fill="#fff" fillOpacity=".97" />
          <circle cx="27.7" cy="33.4" r=".9" fill="#fff" fillOpacity=".97" />

          {/* Short muzzle, light against the coat. Kept small: an earlier cut
              gave him a cream muzzle two-thirds the width of his own head,
              which reads as a snout on a teddy bear. */}
          <ellipse cx="21" cy="42.6" rx="5.6" ry="4.8" fill={LOKI.coat.cream} />
          <ellipse cx="21" cy="44.6" rx="2.7" ry="2.05" fill={LOKI.coat.nose} />
          {/* Tongue, because one of them always has it out. */}
          <path d="M18.5 47.4h5v3.2c0 1.4-1.1 2.3-2.5 2.3s-2.5-.9-2.5-2.3Z" fill={LOKI.coat.tongue} />

          {/* One collar and one black bow tie, clipped by the disc. Enough
           *  uniform to read as staff without drawing a body neither dog has
           *  room for.
           *
           *  THE COLLAR IS LOAD-BEARING, not trim. The tie used to be gold and
           *  could sit straight on the felt disc and still be seen; the real
           *  uniform's tie is #14100c against a #123527 disc, which is a black
           *  shape on a dark green one -- invisible at 34px and not much better
           *  at 200. The art solves it with an ivory shirt behind the tie, so
           *  this does too, which is also why `shirt` is a field on DogUniform
           *  rather than a colour hard-coded here.
           *
           *  TWO NUMBERS HERE ARE THE DISC, not taste. It sits at cy 58 rather
           *  than the old 60.8 because the circle narrows fast down there: at
           *  y 60.8 it spans x 18-46, so a bow under Loki's chin lost its whole
           *  left wing, while at 58 it spans 13.4-50.7 and the bow survives.
           *  And it is centred on x 22 rather than Loki's own 21 because HE is
           *  off-centre in a disc centred on 32 -- a shape centred on him gets
           *  clipped hard on the left and not at all on the right, which reads
           *  as a collar worn crooked rather than one that is merely cropped.
           *  A one-unit nudge is invisible under the chin and squares it up.
           *
           *  Clipping is fine and intended; losing half the only uniform in the
           *  picture, or wearing it askew, is not. */}
          <path d="M14.4 64v-4c0-3 2.2-5.2 5.2-5.7l2.4-.4 2.4.4c3 .5 5.2 2.7 5.2 5.7V64Z" fill={LOKI.uniform.shirt} />
          <path d="M17.4 58l4.2-2.2v4.4Zm9.2 0-4.2-2.2v4.4Z" fill={LOKI.uniform.tie} />
          <circle cx="22" cy="58" r="1.3" fill={LOKI.uniform.tie} />
        </g>
      </svg>
    </span>
  );
}

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
 * the visor a green bar across it. Two heads fill this frame edge to edge, and
 * every dog carries five marks at most. Judge any change here against a real
 * 34px render, never against the 64-unit viewBox.
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

          {/* The fringe of curls over the forehead, which the visor sits on. */}
          <ellipse cx="45" cy="18.4" rx="9.4" ry="4.6" fill={FINN.coat.saddle} />
          <ellipse cx="45" cy="17.4" rx="9" ry="3.4" fill={FINN.coat.cream} fillOpacity=".13" />

          {/* Visor, ON THE FOREHEAD and clear of the eyes.
           *
           * The eyes below sit at cy 29; the panel stops at 25. An earlier cut
           * had the translucent panel crossing the pupils, which tints the one
           * feature carrying the whole expression -- the same mistake the 3D
           * pair made twice, once with a peak wider than the dog. */}
          <path d="M33.6 19.4c3.2-2.4 7.2-3.7 11.4-3.7s8.2 1.3 11.4 3.7l.4 2.4c-3.6-1.9-7.6-2.8-11.8-2.8s-8.2.9-11.8 2.8Z" fill={FINN.uniform.visorBrim} />
          <path d="M34.2 21.8c3.4-1.6 7.1-2.4 10.8-2.4s7.4.8 10.8 2.4c-.5 1.9-1.5 2.9-2.9 2.9-5.5-1.5-10.3-1.5-15.8 0-1.4 0-2.4-1-2.9-2.9Z" fill={FINN.uniform.visorPanel} fillOpacity=".55" />

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

          {/* Fringe of curls over the forehead. */}
          <ellipse cx="21" cy="23.4" rx="11" ry="5.4" fill={LOKI.coat.saddle} fillOpacity=".62" />
          <ellipse cx="14.4" cy="24.4" rx="4.6" ry="3.8" fill={LOKI.coat.saddle} fillOpacity=".45" />
          <ellipse cx="27.6" cy="24.4" rx="4.6" ry="3.8" fill={LOKI.coat.saddle} fillOpacity=".45" />

          {/* Visor, on the forehead. Eyes at cy 34 are well clear of the
              panel, which stops at 29. */}
          <path d="M8.4 24.6c3.6-2.7 8.1-4.2 13-4.2s9.4 1.5 13 4.2l.5 2.7c-4-2.1-8.5-3.1-13.5-3.1s-9.5 1-13.5 3.1Z" fill={LOKI.uniform.visorBrim} />
          <path d="M9 27.3c3.8-1.9 8-2.8 12.4-2.8s8.6.9 12.4 2.8c-.5 2.1-1.7 3.3-3.2 3.3-6.2-1.7-12-1.7-18.2 0-1.5 0-2.7-1.2-3.2-3.3Z" fill={LOKI.uniform.visorPanel} fillOpacity=".55" />

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

          {/* One gold bow tie, clipped by the disc. Enough uniform to read as
              staff without drawing a body neither dog has room for. */}
          <path d="M15.2 60.8l4.6-2.6v5.2Zm11.6 0-4.6-2.6v5.2Z" fill={LOKI.uniform.tie} />
          <circle cx="21" cy="60.8" r="1.5" fill={LOKI.uniform.tie} />
        </g>
      </svg>
    </span>
  );
}

import type { ReactNode } from "react";
import { DEALER_DOGS } from "@/lib/arcade/dealer";
import {
  SCENE_ART,
  dogArt,
  dogArtReady,
  feltPrint,
  type DealerExpression,
} from "@/lib/arcade/dealer-scene";
import { DealerAvatar } from "@/components/arcade/dealer-avatar";

/**
 * The Blackjack room: casino, table, dealers -- as separate 2D layers.
 *
 * WHAT THIS REPLACED, because the failure is worth not repeating. This used to
 * be a three.js scene that built Loki and Finn out of spheres, capsules and
 * cones and painted them into a 560px rounded box dropped into the top of the
 * felt. Two things were wrong with it and only one was fixable by tuning. The
 * dogs read as balloon animals, which is what primitives look like and not
 * something a number in a rig can change. And the box was a PICTURE OF A ROOM
 * hung on the wall of another room: it had its own gradient backdrop, its own
 * counter, and its own decorative chips and cards painted on that counter --
 * a still life of blackjack sitting directly above the blackjack you were
 * actually playing, in a different coordinate system, while a second flat
 * drawing of the same two dogs sat forty pixels below it labelled "Loki &
 * Finn". The player's own description was that it looked like they could climb
 * through the television to reach them.
 *
 * So there is one room now, and the game is inside it.
 *
 * THIS RENDERS NO BOX OF ITS OWN. It returns a fragment of layers that are
 * placed by `.bj-felt`'s grid (app/styles/23-blackjack.css), which is the
 * single authority on where the table's rail sits: row one is the dealers'
 * airspace, row two is the playing surface, and the boundary between them IS
 * the rail. That is deliberately not a shared percentage constant -- a magic
 * number in CSS and a matching one in JS is exactly the drift that put the
 * old speech-bubble tails half a bubble-width beside the bubble.
 *
 * DEPTH, back to front: room, dealers, surface, play. The dealers sit BELOW
 * the surface, so the cloth crosses them at the rail, and the live cards sit
 * above everything because they are nearest the player.
 *
 * That order is a correction, and the reason is worth keeping. The dealers used
 * to sit ABOVE the surface so their paws draped over the rail -- which was fine
 * while they were a flat CSS crop and wrong the moment real art landed. Two
 * full-colour cut-outs painted on top of a table read as exactly that: nothing
 * in the room ever passes in front of them, and an object no other object
 * occludes has no depth, whatever else you do to it. The layers are ordered for
 * occlusion now, and 27-dealer-stage.css does the rest -- the lower body fades
 * out through the band above the rail so the pair dissolve into the room's dark
 * air instead of stopping at an edge.
 *
 * NO WEBGL, no canvas, no renderer, no GPU context, no `next/dynamic`, no
 * cleanup, no fallback path -- and no three.js, which left the dependency tree
 * entirely with the old scene (~536KB, and this route was its only importer).
 * There is nothing here that can fail to acquire a context, so unlike its
 * predecessor there is no state in which this component shows an empty room.
 *
 * EVERY LAYER IS OPTIONAL. lib/arcade/dealer-scene.ts holds each asset path as
 * `string | null`, and null means "not sourced yet" rather than "broken" --
 * the MENU_MUSIC_TRACK convention. Any layer without a file is painted in CSS
 * instead, so the page is complete and correct before a single PNG exists and
 * each asset can land independently.
 */

export function DealerStage({
  expression,
  bubble,
}: {
  /** Which face the pair are wearing. See dealerExpression(). */
  expression: DealerExpression;
  /**
   * The speech bubble, rendered by the table because it owns the tipping
   * state. Passed in rather than built here so this component stays free of
   * hooks and can render on the server.
   */
  bubble?: ReactNode;
}) {
  const roomArt = SCENE_ART.room;
  const tableArt = SCENE_ART.table;
  const dogsDrawn = dogArtReady();

  return (
    <>
      {/* ---- The casino behind the table. Full bleed, and the only layer
              allowed to be soft: it is the one thing in the picture nobody
              looks at, and a sharp background competes with the cards. ---- */}
      <div className="bj-room" data-art={roomArt ? "photo" : "painted"} aria-hidden="true">
        {roomArt && (
          /* A full-bleed decorative backdrop with no intrinsic layout size.
             next/image's fill mode buys nothing here and adds a wrapper
             element this grid does not want between the layer and its box. */
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bj-room-art" src={roomArt} alt="" />
        )}
      </div>

      {/* ---- The table. Its top edge is the rail, so it is placed in the
              grid's second row and reaches a little above the boundary so the
              rail's lip crosses the dogs' chests -- it is the nearer layer, and
              that overlap is a real occlusion rather than a seam. ---- */}
      <div className="bj-surface" data-art={tableArt ? "photo" : "painted"}>
        {tableArt && (
          /* See the note on .bj-room-art above. */
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bj-surface-art" src={tableArt} alt="" aria-hidden="true" />
        )}

        {/*
         * The printed layout, as DOM TEXT derived from the engine's own
         * constants -- never baked into the artwork.
         *
         * The reference art for this table arrived with "INSURANCE PAYS 2 TO 1"
         * and "DEALER MUST HIT SOFT 17" painted across the cloth. There is no
         * insurance in lib/arcade/blackjack.ts and the dealer stands on soft
         * 17, so the felt would have promised two rules the game does not have
         * -- one of them the exact opposite of the rule it does have -- six
         * inches below a header stating it correctly. Nothing in this repo can
         * read a PNG, so nothing could have caught it. Computed text can be
         * tested, and is: see dealer-scene.test.ts.
         */}
        <p className="bj-felt-print">
          {feltPrint().map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </div>

      {/* ---- Loki and Finn, sat behind the rail. ---- */}
      <div
        className="bj-dealers"
        data-expression={expression}
        data-art={dogsDrawn ? "photo" : "painted"}
      >
        {dogsDrawn
          ? (
            <span
              className="bj-dealer-pair"
              role="img"
              aria-label={`${DEALER_DOGS[0].name} and ${DEALER_DOGS[1].name}, the house dealers`}
            >
              {DEALER_DOGS.map((dog) => (
                /* See the note on .bj-room-art above. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={dog.id}
                  className={`bj-dealer bj-dealer-${dog.id}`}
                  // Non-null because dogArtReady() is derived from exactly this
                  // call over exactly this pair, so the two cannot disagree.
                  src={dogArt(dog.id, expression) as string}
                  alt=""
                  aria-hidden="true"
                />
              ))}
            </span>
          )
          : (
            /*
             * The placeholder, and it is the real drawing rather than a grey
             * box: the same flat crop that sits beside the dealer's hand,
             * enlarged. Two dogs in visors is the correct picture at any
             * fidelity, so the page reads as finished-but-plain while the art
             * is outstanding rather than reading as broken.
             */
            <span className="bj-dealer-pair bj-dealer-placeholder">
              <DealerAvatar />
            </span>
          )}

        {bubble}

        {/* Named, so two unexplained dogs in visors have an explanation
            attached rather than being a non-sequitur on a gambling table. */}
        <p className="bj-dealer-names">
          {DEALER_DOGS.map((dog) => (
            <span key={dog.id} className="bj-dealer-name">
              <strong>{dog.name}</strong>
              <small>{dog.breed}</small>
            </span>
          ))}
        </p>
      </div>
    </>
  );
}

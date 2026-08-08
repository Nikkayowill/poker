"use client";

/**
 * The community board as DOM cards floating over the canvas, anchored by
 * the same pure projection the nameplates use (camera-framing.ts).
 *
 * WHY DOM AND NOT A TEXTURE. The in-scene card plates were measured, not
 * guessed at: on a 390x844 portrait phone the camera has to pull back far
 * enough to fit the whole table, which left each board card ~18 CSS px
 * wide — the five cards every decision depends on were physically too
 * small to read, and no texture resolution fixes an 18px card. DOM text
 * and SVG suits are resolution-independent, so the board is pixel-crisp at
 * every DPI, and its size can be solved per viewport instead of being
 * whatever the camera distance leaves over. Same trade the nameplates and
 * action HUD already made, for the same reason.
 *
 * The suits come from SuitGlyph — the exact vector art the 2D table's
 * PlayingCard renders — so the board cannot drift from the deck the rest
 * of the app draws.
 */

import { useMemo } from "react";
import type { Card } from "@/lib/game/types";
import { boardAnchor, boardCardWidth } from "@/lib/game3d/board-anchor";
import { CardFace } from "./card-face";
import styles from "../game3d.module.css";

export function BoardCards({
  cards,
  width,
  height,
}: {
  cards: Card[];
  /** The stage's layout box (clientWidth/Height — unscaled by any CSS transform). */
  width: number;
  height: number;
}) {
  // Both of these are pure and live in lib/game3d/board-anchor.ts, where
  // `npm test` can reach them — see that file for why the upright board sits
  // in the backdrop above the room rather than on the felt.
  const anchor = useMemo(() => boardAnchor(width, height), [width, height]);
  const cardW = boardCardWidth(width, height);

  if (!anchor || cards.length === 0) return null;

  return (
    <div
      className={styles.boardLayer}
      style={
        {
          left: `${anchor.left}%`,
          top: `${anchor.top}%`,
          "--card-w": `${cardW}px`,
        } as React.CSSProperties
      }
    >
      {cards.map((card, i) => (
        // Staggered only among cards mounting together (a flop); a turn or
        // river card mounts alone and keeps its own later beat.
        <CardFace key={`${card.rank}-${card.suit}`} card={card} animationDelay={i * 70} />
      ))}
    </div>
  );
}

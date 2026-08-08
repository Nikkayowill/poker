"use client";

/**
 * <CardFace> — one crisp DOM card, the shared markup board-cards.tsx and
 * own-hole-cards.tsx both render. Extracted rather than duplicated: the two
 * callers disagree on nothing but the size (each sets its own --card-w on
 * an ancestor — see game3d.module.css) and where they anchor the result,
 * not on what a card looks like. See board-cards.tsx's own header for why
 * DOM beats an in-scene texture here at all.
 */

import type { Card } from "@/lib/game/types";
import { SuitGlyph } from "@/components/table/playing-card";
import styles from "../game3d.module.css";

const RED_SUITS = new Set<Card["suit"]>(["hearts", "diamonds"]);

export function CardFace({
  card,
  animationDelay = 0,
}: {
  card: Card;
  /** Stagger a group mounting together (a flop); a lone card mounts at 0. */
  animationDelay?: number;
}) {
  return (
    <div
      className={
        RED_SUITS.has(card.suit)
          ? `${styles.cardFace} ${styles.cardFaceRed}`
          : styles.cardFace
      }
      style={{ animationDelay: `${animationDelay}ms` }}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className={styles.cardIndex}>
        <span className={styles.cardRank}>{card.rank}</span>
        <span className={styles.cardIndexSuit}>
          <SuitGlyph suit={card.suit} />
        </span>
      </span>
      <span className={styles.cardPip}>
        <SuitGlyph suit={card.suit} />
      </span>
    </div>
  );
}

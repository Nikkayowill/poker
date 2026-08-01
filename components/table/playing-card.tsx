"use client";

import clsx from "clsx";
import type { Card } from "@/lib/game/types";
import { CardBackFor } from "@/components/card-back-art";

const suitPaths: Record<Exclude<Card["suit"], "clubs">, string> = {
  hearts:
    "M16 28.5C16 28.5 3 19.6 3 11.2C3 6.2 6.8 3 11 3C13.6 3 15.6 4.4 16 6.6C16.4 4.4 18.4 3 21 3C25.2 3 29 6.2 29 11.2C29 19.6 16 28.5 16 28.5Z",
  diamonds: "M16 2L29 16L16 30L3 16Z",
  spades:
    "M16 3C16 3 29 13.4 29 20.4C29 24.6 25.6 27 22.2 27C19.9 27 17.9 25.8 17 24C17.4 26.6 18.8 28.6 21 30H11C13.2 28.6 14.6 26.6 15 24C14.1 25.8 12.1 27 9.8 27C6.4 27 3 24.6 3 20.4C3 13.4 16 3 16 3Z",
};

export function SuitGlyph({ suit }: { suit: Card["suit"] }) {
  if (suit === "clubs") {
    return (
      <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
        <circle cx="16" cy="10.5" r="6.6" />
        <circle cx="9.8" cy="19" r="6.6" />
        <circle cx="22.2" cy="19" r="6.6" />
        <path d="M13.6 20.5H18.4L21 29.5H11Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d={suitPaths[suit]} />
    </svg>
  );
}

const spokenRanks: Record<Card["rank"], string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  "10": "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

export function PlayingCard({
  card,
  small = false,
  large = false,
  ghost = false,
  back,
}: {
  card: Card | null;
  small?: boolean;
  large?: boolean;
  ghost?: boolean;
  /**
   * Which card back to draw, as a cosmetic id. Undefined resolves to the
   * house deck, so every existing caller keeps working and a card is never
   * drawn blank while a seat is missing its cosmetic.
   */
  back?: string | null;
}) {
  const sizeClass = large ? "card-large" : small ? "card-small" : null;
  if (ghost) return <div className={clsx("playing-card card-ghost", sizeClass)} />;
  if (!card) {
    // Seven backs were in the catalog, purchasable, equippable and previewed
    // in the collection, and the table drew the same hardcoded green for all
    // of them -- so the one item the store describes as "seen by the whole
    // table" was the one thing a player could never see.
    return (
      <div className={clsx("playing-card card-back", sizeClass)} aria-label="Hidden card">
        <CardBackFor id={back} className="card-back-art" />
      </div>
    );
  }
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div
      className={clsx("playing-card", sizeClass, red && "card-red")}
      aria-label={`${spokenRanks[card.rank]} of ${card.suit}`}
    >
      <span className="card-index card-index-top">
        <span className="card-index-rank">{card.rank}</span>
        <span className="card-index-glyph"><SuitGlyph suit={card.suit} /></span>
      </span>
      <span className="card-suit-large"><SuitGlyph suit={card.suit} /></span>
      <span className="card-index card-index-bottom">
        <span className="card-index-rank">{card.rank}</span>
        <span className="card-index-glyph"><SuitGlyph suit={card.suit} /></span>
      </span>
    </div>
  );
}

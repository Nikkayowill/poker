"use client";

import { memo, useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import type { PublicSeat } from "@/lib/game/types";
import { avatarFigure } from "@/lib/cosmetics/catalog";
import { missingArtwork } from "@/components/artwork-cache";
import { PlayingCard } from "./playing-card";

/**
 * A player at the table, drawn as the whole cut-out figure rather than a disc.
 *
 * This is what the artwork is for: half-body, hands on a rail. A circular crop
 * throws away the posture and the hands and leaves a headshot that could
 * belong to any product. Sitting the figure at the seat, with the table's own
 * rail crossing it at the elbows, is the entire difference between a board
 * game with portraits on it and a room with people in it.
 */
export function SeatFigure({ seat, active }: { seat: PublicSeat; active: boolean }) {
  const [, forceRerender] = useState(0);
  const declared = seat.avatarCosmetic ? avatarFigure(seat.avatarCosmetic) : null;
  const artwork = declared && !missingArtwork.has(declared) ? declared : null;

  return (
    <div className={clsx("seat-figure", active && "seat-figure-active")}>
      {/* An uploaded photo has no cut-out to stand up, so it stays a disc
          where the head would be rather than being stretched into a body. */}
      {seat.avatarUrl
        ? (
          <span
            className="seat-figure-photo"
            style={{ backgroundImage: `url("${seat.avatarUrl}")` }}
            role="img"
            aria-label={`${seat.name}'s avatar`}
          />
        )
        : (
          <>
            {/* The monogram sits underneath and the figure lays over it, so a
                file that is missing or still loading never leaves a hole where
                a player should be. */}
            <span className="seat-figure-fallback" aria-hidden={artwork ? "true" : undefined}>
              {seat.initials}
            </span>
            {artwork && (
              <Image
                src={artwork}
                alt=""
                fill
                sizes="180px"
                className="seat-figure-art"
                onError={() => {
                  missingArtwork.add(artwork);
                  forceRerender((n) => n + 1);
                }}
              />
            )}
          </>
        )}
    </div>
  );
}

export const PlayerSeat = memo(function PlayerSeat({
  seat,
  placement,
  handNumber,
  secondsRemaining,
  winAmount,
  elementRef,
  seatStyle,
}: {
  seat: PublicSeat;
  placement: string;
  handNumber: number;
  secondsRemaining: number;
  winAmount?: number;
  elementRef?: (el: HTMLElement | null) => void;
  /** Computed ellipse position, perspective scale and stacking order. */
  seatStyle?: React.CSSProperties;
}) {
  const folded = seat.status === "folded" || seat.status === "out";
  const isWinner = winAmount !== undefined;
  const seatNear = Number((seatStyle as Record<string, string | number> | undefined)?.["--seat-near"] ?? 1);
  const isFarSeat = placement === "seat-ring" && Number.isFinite(seatNear) && seatNear < 0.38;
  return (
    <article
      ref={elementRef}
      className={clsx(
        "player-seat",
        placement,
        seat.isCurrent && "seat-current",
        seat.isSmallBlind && "seat-small-blind",
        seat.isBigBlind && "seat-big-blind",
        folded && "seat-muted",
        isWinner && "seat-winner",
        isFarSeat && "seat-far",
      )}
      style={{ "--seat-accent": seat.accent, ...seatStyle } as React.CSSProperties}
    >
      {isWinner && (
        <span className="winner-badge" aria-label={`${seat.name} won the hand`}>
          <span aria-hidden="true">♛</span> Winner
        </span>
      )}
      <div className={clsx("seat-cards", seat.isMine && "own-cards", isWinner && "winning-cards")}>
        {/* Once folded, this seat's cards live only in the transient
            MuckDrift overlay (see PokerTable) -- not here -- so they read as
            having actually left the table instead of sitting dimmed at the
            seat for the rest of the hand. */}
        {!folded && seat.holeCards.map((card, index) => (
          <span
            className="dealt-card-shell"
            key={`${handNumber}-${index}`}
            style={{ animationDelay: `${160 + seat.position * 115 + index * 460}ms` }}
          >
            <PlayingCard card={card} small={!seat.isMine} large={seat.isMine} />
          </span>
        ))}
      </div>
      <SeatFigure seat={seat} active={seat.isCurrent} />
      {/* Name over stack on one flat plate, tucked under the figure's hands --
          the nameplate every poker client uses, because it is read at a glance
          and nothing about it should compete with the felt. */}
      <div className="seat-plate">
        <div className="seat-name-row">
          <strong>{seat.name}</strong>
          {!seat.isHuman && <span className="ai-badge">AI</span>}
          {seat.isMine && <span className="you-chip">You</span>}
          {seat.isSmallBlind && <span className="blind-label">SB</span>}
          {seat.isBigBlind && <span className="blind-label">BB</span>}
        </div>
        <span
          className={clsx("seat-stack", isWinner && "seat-stack-win")}
          aria-label={`${seat.stack.toLocaleString()} chips`}
        >
          <span className="chip-dot" />
          <strong>{seat.stack.toLocaleString()}</strong>
        </span>
      </div>
      {/* Below the plate, not inside it: what you are holding is a different
          kind of fact from who you are and what you have left. */}
      {seat.isMine && seat.handLabel && (
        <span className="hand-strength" aria-live="polite">
          {seat.handLabel}
        </span>
      )}
      {seat.lastAction && <span className="action-pill">{seat.lastAction}</span>}
      {seat.status === "folded" && <span className="status-pill">Folded</span>}
      {seat.status === "all-in" && <span className="status-pill all-in">All in</span>}
      {seat.streetBet > 0 && <span className="table-bet">{seat.streetBet}</span>}
      {isWinner && <span className="win-amount-float">+{winAmount.toLocaleString()}</span>}
      {seat.isCurrent && (
        <div className="seat-turn-status" aria-live="polite">
          <span>{seat.isMine ? "YOUR TURN" : seat.isHuman ? "THINKING" : "AI THINKING"}</span>
          <strong>{secondsRemaining}s</strong>
        </div>
      )}
    </article>
  );
}, (previous, next) => (
  previous.seat === next.seat
  && previous.placement === next.placement
  && previous.handNumber === next.handNumber
  && previous.secondsRemaining === next.secondsRemaining
  && previous.winAmount === next.winAmount
  && previous.seatStyle === next.seatStyle
));

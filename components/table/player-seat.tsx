"use client";

import { memo, useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import type { PublicSeat } from "@/lib/game/types";
import { avatarFigure } from "@/lib/cosmetics/catalog";
import { missingArtwork } from "@/components/artwork-cache";
import { PlayingCard } from "./playing-card";
import { SeatTimer } from "./seat-timer";

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

function SeatCards({
  seat,
  handNumber,
  folded,
  isWinner,
}: {
  seat: PublicSeat;
  handNumber: number;
  folded: boolean;
  isWinner: boolean;
}) {
  return (
    <div className={clsx("seat-cards", seat.isMine && "own-cards", isWinner && "winning-cards")}>
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
  );
}

function SeatNameplate({
  seat,
  isWinner,
  smallBlind,
  bigBlind,
  turnStartedAt,
  turnDeadlineAt,
}: {
  seat: PublicSeat;
  isWinner: boolean;
  smallBlind: number;
  bigBlind: number;
  turnStartedAt: string | null;
  turnDeadlineAt: string | null;
}) {
  const blind = seat.isSmallBlind
    ? { abbreviation: "SB", name: "Small Blind", amount: smallBlind }
    : seat.isBigBlind
      ? { abbreviation: "BB", name: "Big Blind", amount: bigBlind }
      : null;
  return (
    <div className="seat-plate">
      <div className="seat-name-row">
        <strong>{seat.name}</strong>
        {!seat.isHuman && <span className="ai-badge">AI</span>}
        {seat.isMine && <span className="you-chip">You</span>}
        {blind && (
          <span
            className="blind-label"
            aria-label={`${blind.name}, ${blind.amount.toLocaleString()} chips`}
            title={`${blind.name}: ${blind.amount.toLocaleString()} chips`}
          >
            <b>{blind.abbreviation}</b>
            <span>{blind.amount.toLocaleString()}</span>
          </span>
        )}
      </div>
      <div className="seat-stack-row">
        <span
          className={clsx("seat-stack", isWinner && "seat-stack-win")}
          aria-label={`${seat.stack.toLocaleString()} chips`}
        >
          <span className="chip-dot" />
          <strong>{seat.stack.toLocaleString()}</strong>
        </span>
        {/* Only the seat on the clock carries one, so it doubles as the
            "whose turn is it" cue and there is never more than one burning. */}
        {seat.isCurrent && (
          <SeatTimer startedAt={turnStartedAt} deadlineAt={turnDeadlineAt} large={seat.isMine} />
        )}
      </div>
    </div>
  );
}

export const PlayerSeat = memo(function PlayerSeat({
  seat,
  placement,
  handNumber,
  winAmount,
  smallBlind,
  bigBlind,
  turnStartedAt,
  turnDeadlineAt,
  elementRef,
  seatStyle,
}: {
  seat: PublicSeat;
  placement: string;
  handNumber: number;
  winAmount?: number;
  smallBlind: number;
  bigBlind: number;
  /** ISO strings, so they are stable props and the memo below still holds. */
  turnStartedAt: string | null;
  turnDeadlineAt: string | null;
  elementRef?: (el: HTMLElement | null) => void;
  /** Computed position and stacking order around the tilted table plane. */
  seatStyle?: React.CSSProperties;
}) {
  const folded = seat.status === "folded" || seat.status === "out";
  const isWinner = winAmount !== undefined;
  const seatNear = Number((seatStyle as Record<string, string | number> | undefined)?.["--seat-near"] ?? 1);
  const isFarSeat = placement === "seat-ring" && Number.isFinite(seatNear) && seatNear < 0.38;
  const cards = (
    <SeatCards
      seat={seat}
      handNumber={handNumber}
      folded={folded}
      isWinner={isWinner}
    />
  );
  const figure = <SeatFigure seat={seat} active={seat.isCurrent} />;
  const nameplate = (
    <SeatNameplate
      seat={seat}
      isWinner={isWinner}
      smallBlind={smallBlind}
      bigBlind={bigBlind}
      turnStartedAt={turnStartedAt}
      turnDeadlineAt={turnDeadlineAt}
    />
  );
  const handStrength = seat.isMine && seat.handLabel
    ? <span className="hand-strength" aria-live="polite">{seat.handLabel}</span>
    : null;
  const status = folded
    ? { label: "Folded", className: "status-pill" }
    : seat.status === "all-in"
      ? { label: "All in", className: "status-pill all-in" }
      : seat.lastAction
        ? { label: seat.lastAction, className: "action-pill" }
        : null;

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
      {seat.isMine
        ? (
          <div className="local-seat-layout">
            <div className="local-avatar-slot">{figure}</div>
            <div className="local-hand-column">
              {cards}
              <div className="local-status-area">{handStrength}</div>
              {nameplate}
            </div>
          </div>
        )
        : (
          <>
            {figure}
            {cards}
            {nameplate}
          </>
        )}
      {status && <span className={status.className}>{status.label}</span>}
      {seat.streetBet > 0 && <span className="table-bet">{seat.streetBet}</span>}
      {isWinner && <span className="win-amount-float">+{winAmount.toLocaleString()}</span>}
    </article>
  );
}, (previous, next) => (
  previous.seat === next.seat
  && previous.placement === next.placement
  && previous.handNumber === next.handNumber
  && previous.winAmount === next.winAmount
  && previous.smallBlind === next.smallBlind
  && previous.bigBlind === next.bigBlind
  && previous.turnStartedAt === next.turnStartedAt
  && previous.turnDeadlineAt === next.turnDeadlineAt
  && previous.seatStyle === next.seatStyle
));

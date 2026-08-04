"use client";

import { memo, useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import type { PublicSeat } from "@/lib/game/types";
import { avatarFigure } from "@/lib/cosmetics/catalog";
import { dealDelayMs } from "@/lib/game/deal-choreography";
import { isWinningCard } from "@/lib/game/winning-cards";
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
  dealSlot,
  dealSeatCount,
  dealVector,
  winningKeys,
}: {
  seat: PublicSeat;
  handNumber: number;
  folded: boolean;
  isWinner: boolean;
  dealSlot: number;
  dealSeatCount: number;
  dealVector: { dx: number; dy: number } | null;
  winningKeys: string | null;
}) {
  return (
    <div
      className={clsx("seat-cards", seat.isMine && "own-cards", isWinner && "winning-cards")}
      // Left unset until the table has been measured, so 08-seat.css's
      // fallback applies for that first paint rather than a zero vector
      // freezing the cards in place. A hand dealt before the first
      // measurement lands still animates -- just from below the seat, the
      // way it always used to.
      style={dealVector
        ? ({ "--deal-x": `${dealVector.dx}px`, "--deal-y": `${dealVector.dy}px` } as React.CSSProperties)
        : undefined}
    >
      {!folded && seat.holeCards.map((card, index) => (
        <span
          className={clsx(
            "dealt-card-shell",
            // Only the winner's own cards are marked. A losing contender's
            // cards are face up at a showdown too, and dimming those would
            // say "these lost" about a card that may well be the same rank
            // as one that won.
            isWinner && winningKeys && (isWinningCard(winningKeys, card)
              ? "dealt-card-winning"
              : "dealt-card-spent"),
          )}
          key={`${handNumber}-${index}`}
          style={{ animationDelay: `${dealDelayMs(dealSlot, index, dealSeatCount)}ms` }}
        >
          {/* This seat's own back, not the table's. Your opponents' hidden
              cards are where a card back is actually seen, which is the
              entire proposition the store sells them on. */}
          <PlayingCard
            card={card}
            small={!seat.isMine}
            large={seat.isMine}
            back={seat.cardBackCosmetic}
          />
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
  dealSlot,
  dealSeatCount,
  dealVector,
  winningKeys,
}: {
  seat: PublicSeat;
  placement: string;
  handNumber: number;
  winAmount?: number;
  smallBlind: number;
  bigBlind: number;
  /** Position on the ring as drawn, 0 being the local player's near edge. */
  dealSlot: number;
  dealSeatCount: number;
  /** Offset from this seat to the deck, measured; null until that has happened. */
  dealVector: { dx: number; dy: number } | null;
  /** Cards that made the winning hand, as one comparable string. */
  winningKeys: string | null;
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
      dealSlot={dealSlot}
      dealSeatCount={dealSeatCount}
      dealVector={dealVector}
      winningKeys={winningKeys}
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
  // No status pill under the seat any more. It printed a variable-length
  // string ("Fenwick raises to 2400") into a fixed, absolutely-positioned
  // slot, so the long end of that range ran out from under the seat and
  // under the table container. The table feed carries the same events, in
  // one place, at a size that can be read -- see .table-feed in
  // 06-table.css. What the seat still says for itself, it says without
  // prose: folded seats are dimmed via .seat-muted, the winner gets its
  // badge, and the turn clock burns around whoever is on it.

  return (
    <article
      ref={elementRef}
      className={clsx(
        "player-seat",
        placement,
        seat.isMine && "seat-mine",
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
      {/* One tree for every seat, including yours.
          There used to be a second, two-column layout for the local player,
          who was drawn below the felt rather than at it: portrait in one
          column, cards and plate in the other. Sitting on the ring means the
          same figure, cards and nameplate as everyone else -- what is
          different about your seat is only that your cards are face up,
          bigger, and set to one side, and that is CSS on .seat-mine rather
          than a separate arrangement of elements. */}
      {figure}
      {cards}
      {handStrength}
      {nameplate}
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
  && previous.dealSlot === next.dealSlot
  && previous.dealSeatCount === next.dealSeatCount
  // By value, not identity. The vector arrives from a measurement that runs
  // on every observed resize; comparing the object would re-render all six
  // seats whenever the table was measured again to the same numbers. Leaving
  // it out of the comparator entirely is the other trap -- a seat would keep
  // the vector it was first rendered with and deal from the wrong place for
  // the rest of the session, which is how the turn timer nearly shipped
  // never mounting at all.
  && previous.dealVector?.dx === next.dealVector?.dx
  && previous.dealVector?.dy === next.dealVector?.dy
  // A plain === because it is a string; see winning-cards.ts for why it is
  // one rather than the Set it wants to be.
  && previous.winningKeys === next.winningKeys
));

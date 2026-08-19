"use client";

import { memo, useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import type { PublicSeat } from "@/lib/game/types";
import { avatarFace } from "@/lib/cosmetics/catalog";
import { dealDelayMs } from "@/lib/game/deal-choreography";
import { isBotAway } from "@/lib/game/seat-presence";
import { isWinningCard } from "@/lib/game/winning-cards";
import { reactionLabel } from "@/lib/game/reaction-channel";
import type { SeatReaction } from "@/lib/game/use-table-reactions";
import { missingArtwork } from "@/components/artwork-cache";
import { PlayingCard } from "./playing-card";
import { SeatTimer } from "./seat-timer";
import { ReactionEmote } from "./table-reactions";

/**
 * A compact player marker for the classic 2D HUD. The room renderer owns the
 * full character figures; the 2D table needs a contained face crop so the
 * avatar does not consume the cards' and nameplate's working space.
 */
export function SeatFigure({
  seat,
  active,
  turnStartedAt,
  turnDeadlineAt,
  reaction,
}: {
  seat: PublicSeat;
  active: boolean;
  turnStartedAt: string | null;
  turnDeadlineAt: string | null;
  reaction?: SeatReaction | null;
}) {
  const [, forceRerender] = useState(0);
  const declared = seat.avatarCosmetic ? avatarFace(seat.avatarCosmetic) : null;
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
      {/* Opponents' turn clock rings their own portrait rather than sitting as
          a separate badge down in the nameplate -- a fuse that laps the face
          it is timing, not a second circle competing with the stack number
          for the same row. The local player keeps the nameplate clock (see
          SeatNameplate below): their own figure is hidden on desktop
          entirely (16-first-person.css), so there is no portrait here left
          to ring. */}
      {active && !seat.isMine && (
        <SeatTimer startedAt={turnStartedAt} deadlineAt={turnDeadlineAt} />
      )}
      {reaction && (
        <span
          key={reaction.key}
          className={`seat-reaction-emote reaction-emote-${reaction.reactionId}`}
          role="status"
          aria-label={`${seat.name} reacted: ${reactionLabel(reaction.reactionId)}`}
        >
          <ReactionEmote reactionId={reaction.reactionId} />
        </span>
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
  opponentHud,
}: {
  seat: PublicSeat;
  isWinner: boolean;
  smallBlind: number;
  bigBlind: number;
  turnStartedAt: string | null;
  turnDeadlineAt: string | null;
  opponentHud: boolean;
}) {
  const blind = seat.isSmallBlind
    ? { abbreviation: "SB", name: "Small Blind", amount: smallBlind }
    : seat.isBigBlind
      ? { abbreviation: "BB", name: "Big Blind", amount: bigBlind }
      : null;
  const away = isBotAway(seat);
  if (!seat.isMine && opponentHud) {
    const action = seat.lastAction
      && !/^(small blind|big blind)/i.test(seat.lastAction)
      ? (seat.lastAction.startsWith("Timed out")
        ? seat.lastAction.split(" · ").at(-1)
        : seat.lastAction.split(" · ")[0].replace(/^Raise to$/, "Raise"))
      : null;
    const statusLabel = action ? action.toUpperCase() : seat.name;
    const started = Date.parse(turnStartedAt ?? "");
    const deadline = Date.parse(turnDeadlineAt ?? "");
    const hasTurnTimer = Number.isFinite(started) && Number.isFinite(deadline) && deadline > started;

    return (
      <div className="seat-plate seat-opponent-hud">
        {seat.isCurrent && hasTurnTimer ? (
          <SeatTimer
            startedAt={turnStartedAt}
            deadlineAt={turnDeadlineAt}
            pill
          >
            <strong className="seat-status-label">{statusLabel}</strong>
          </SeatTimer>
        ) : (
          <span className="seat-status-idle">{statusLabel}</span>
        )}
        {!away && (
          <span className="seat-status-stack" aria-label={`${seat.stack.toLocaleString()} chips`}>
            {seat.stack.toLocaleString()}
          </span>
        )}
      </div>
    );
  }

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
        {/* A departed bot's stack is 0 -- printing that as a chip count would
            read as busted rather than away. A short, fixed-length label in
            the same slot the chip count normally sits in, not a floating
            pill: table-feed.spec.ts asserts no seat prints one of those any
            more, and this can't reproduce that clipping bug because it never
            varies in length or escapes .seat-plate's own box. */}
        {away
          ? <span className="seat-away-badge">Sitting out</span>
          : (
            <span
              className={clsx("seat-stack", isWinner && "seat-stack-win")}
              aria-label={`${seat.stack.toLocaleString()} chips`}
            >
              <span className="chip-dot" />
              <strong>{seat.stack.toLocaleString()}</strong>
            </span>
          )}
        {/* Only the seat on the clock carries one, so it doubles as the
            "whose turn is it" cue and there is never more than one burning.
            Opponents' clocks moved onto their own portrait -- see SeatFigure
            above -- so this is the local player's alone now: their figure is
            hidden on desktop, so the nameplate is the only place left for it
            to burn. */}
        {seat.isCurrent && seat.isMine && (
          <SeatTimer startedAt={turnStartedAt} deadlineAt={turnDeadlineAt} large />
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
  reaction,
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
  /** This seat's current reaction bubble, if it has one -- see use-table-reactions.ts. */
  reaction?: SeatReaction | null;
}) {
  const folded = seat.status === "folded" || seat.status === "out";
  const away = isBotAway(seat);
  const isWinner = winAmount !== undefined;
  const seatNear = Number((seatStyle as Record<string, string | number> | undefined)?.["--seat-near"] ?? 1);
  /* Both ring placements report `--seat-near` on the same 0..1 scale (0 at
     the far rail), so the far-seat treatment applies to either. The racetrack
     needs it more, not less: its whole crowd sits on the far arc. */
  const onTableRing = placement === "seat-ring" || placement === "seat-racetrack";
  const isFarSeat = onTableRing && Number.isFinite(seatNear) && seatNear < 0.38;
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
  const figure = (
    <SeatFigure
      seat={seat}
      active={seat.isCurrent}
      turnStartedAt={turnStartedAt}
      turnDeadlineAt={turnDeadlineAt}
      reaction={reaction}
    />
  );
  const nameplate = (
    <SeatNameplate
      seat={seat}
      isWinner={isWinner}
      smallBlind={smallBlind}
      bigBlind={bigBlind}
      turnStartedAt={turnStartedAt}
      turnDeadlineAt={turnDeadlineAt}
      opponentHud={placement === "seat-ring"}
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
  // prose: folded seats are dimmed via .seat-muted, a departed bot goes
  // further via .seat-away (see isBotAway above) with a fixed short label
  // in the stack row rather than a floating pill, the winner gets its
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
        away && "seat-away",
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
      {seat.streetBet > 0 && <span className="table-bet">${seat.streetBet}</span>}
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
  && previous.reaction?.key === next.reaction?.key
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

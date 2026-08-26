"use client";

import { memo, useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import type { PublicSeat } from "@/lib/game/types";
import { avatarFace } from "@/lib/cosmetics/catalog";
import { dealDelayMs } from "@/lib/game/deal-choreography";
import { isBotAway, isChallengeableSeat } from "@/lib/game/seat-presence";
import { isWinningCard } from "@/lib/game/winning-cards";
import { reactionLabel } from "@/lib/game/reaction-channel";
import type { SeatReaction } from "@/lib/game/use-table-reactions";
import type { SeatArtBox } from "@/lib/scene/seat-art";
import { missingArtwork } from "@/components/artwork-cache";
import { ChallengeSeatControl } from "./challenge-seat-control";
import { PlayingCard } from "./playing-card";
import { SeatTimer } from "./seat-timer";
import { ReactionEmote } from "./table-reactions";

/**
 * A seat's compact circular avatar. Two jobs today, not the classic-2D-vs-
 * room-renderer split this docstring used to describe: it is the only
 * portrait the local player's own seat ever gets, on mobile -- hidden past
 * 901px, where local-player-hud.tsx's corner HUD takes over instead, see
 * 16-first-person.css -- and it is what an opponent seat shows before the
 * racetrack scene is lit. Once `.scene-room-racetrack` is live,
 * 42-racetrack-table.css hides this outright for every opponent seat in
 * favor of the racetrack's own full-height character portrait
 * (`racetrackArt`/`racetrackArtEl` below).
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
          a separate badge down in the nameplate: a fuse that laps the face
          it is timing, not a second circle competing with the stack number
          for the same row. The local player keeps the nameplate clock (see
          SeatNameplate below), since their own figure is hidden on desktop
          entirely (16-first-person.css), so there's no portrait here left
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
      // measurement lands still animates, just from below the seat.
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
              cards are where a card back is actually seen, which is what
              the store sells them on. */}
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
  // Rendered once, regardless of which plate shape below is used: both
  // are a <div className="seat-plate ..."> and 08-seat.css anchors the
  // trigger to that shared wrapper.
  const challenge = isChallengeableSeat(seat) && seat.profileId
    ? <ChallengeSeatControl profileId={seat.profileId} displayName={seat.name} />
    : null;
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
        {challenge}
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
      {challenge}
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
        {/* A departed bot's stack is 0, and printing that as a chip count
            would read as busted rather than away. A short, fixed-length
            label sits in the same slot the chip count normally occupies,
            not a floating pill: table-feed.spec.ts asserts no seat prints
            one of those, and this can't reproduce that clipping bug since
            it never varies in length or escapes .seat-plate's own box. */}
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
            Opponents' clocks moved onto their own portrait (see SeatFigure
            above), so this is the local player's alone now: their figure is
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
  racetrackArt,
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
  /** This seat's current reaction bubble, if it has one; see use-table-reactions.ts. */
  reaction?: SeatReaction | null;
  /** The racetrack table's own full-height character portrait, drawn as this
   *  seat's own child rather than as a page-space sibling; see
   *  `racetrackArtBySeat` (poker-table.tsx) for why it has to live here for
   *  the cards to be able to draw behind it and the nameplate in front. Only
   *  ever set for an opponent seat on the racetrack table. */
  racetrackArt?: { src: string; mirror: boolean; box: SeatArtBox } | null;
}) {
  const folded = seat.status === "folded" || seat.status === "out";
  const away = isBotAway(seat);
  const isWinner = winAmount !== undefined;
  const seatNear = Number((seatStyle as Record<string, string | number> | undefined)?.["--seat-near"] ?? 1);
  /* `--seat-near` is on a 0..1 scale (0 at the far rail) for every seat this
     component ever places -- the racetrack needs the far-seat treatment
     most, since its whole crowd sits on the far arc. */
  const isFarSeat = Number.isFinite(seatNear) && seatNear < 0.38;
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
  // `left`/`top` are not set here; both resolve from the same
  // `--seat-art-dx`/`--seat-art-crown-dy` custom properties `seatStyle`
  // already carries for the nameplate and hole cards (poker-table.tsx),
  // inherited straight from this article's own inline style. `left: 50%`
  // on an absolutely-positioned child of this seat lands exactly on the
  // projected crown, since the seat's own box is centred on it by
  // construction (`.seat-racetrack`'s negative margin-left,
  // 42-racetrack-table.css). Adding the delta and pulling back by the
  // image's own half-width (`translateX(-50%)`) reproduces the art's real
  // left edge without this component needing to know the seat's pixel
  // width at all.
  const racetrackArtEl = racetrackArt ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="racetrack-seat-art"
      src={racetrackArt.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{
        width: `${racetrackArt.box.width.toFixed(1)}px`,
        height: `${racetrackArt.box.height.toFixed(1)}px`,
        transform: racetrackArt.mirror ? "translateX(-50%) scaleX(-1)" : "translateX(-50%)",
      }}
    />
  ) : null;
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
  // one place, at a size that can be read; see .table-feed in
  // 06-table.css. What the seat still says for itself, it says without
  // prose: folded seats are dimmed via .seat-muted, a departed bot goes
  // further via .seat-away (see isBotAway above) with a fixed short label
  // in the stack row rather than a floating pill, and the turn clock burns
  // around whoever is on it. A winner is marked by their own cards/stack
  // glowing gold (.seat-winner, 08-seat.css) plus the floating win amount
  // below, no separate badge. The racetrack table also lights up the
  // character's own aura behind them (42-racetrack-table.css).

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
      {/* One tree for every seat, including yours.
          There used to be a second, two-column layout for the local player,
          who was drawn below the felt rather than at it: portrait in one
          column, cards and plate in the other. Sitting on the ring means the
          same figure, cards and nameplate as everyone else; what is
          different about your seat is only that your cards are face up,
          bigger, and set to one side, and that is CSS on .seat-mine rather
          than a separate arrangement of elements. */}
      {figure}
      {cards}
      {racetrackArtEl}
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
  // seats whenever the table was measured again to the same numbers. The
  // other trap is leaving it out of the comparator entirely: a seat would
  // then keep the vector it was first rendered with and deal from the wrong
  // place for the rest of the session.
  && previous.dealVector?.dx === next.dealVector?.dx
  && previous.dealVector?.dy === next.dealVector?.dy
  // A plain === because it is a string; see winning-cards.ts for why it is
  // one rather than the Set it wants to be.
  && previous.winningKeys === next.winningKeys
  // By value, same reasoning as dealVector: racetrackArtBySeat (poker-table.tsx)
  // hands back a fresh object on every recompute even when nothing about this
  // seat's own portrait actually changed. src/mirror is enough of a fingerprint,
  // since the box's own pixel values only move together with `seatStyle` (both
  // come from the same camera fit), which is already compared above.
  && previous.racetrackArt?.src === next.racetrackArt?.src
  && previous.racetrackArt?.mirror === next.racetrackArt?.mirror
));

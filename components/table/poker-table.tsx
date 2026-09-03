"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  Coins, Copy, Divide, DoorOpen, History, HelpCircle, Layers, LogIn, LogOut, Settings2, Sparkles, TimerReset, Trophy, UserPlus, Volume2, VolumeX, X,
} from "lucide-react";
import type { Card, GameSnapshot, PlayerAction } from "@/lib/game/types";
import { betStyleLabel, type BetAnimationStyle } from "@/lib/scene/bet-style";
import { betFlightKind, type BetFlight } from "@/lib/scene/chips/bet-flight";
import type { ChipMoveKind } from "@/lib/scene/chips/chip-motion";
import { chipBreakdown, columnCount, columnHeights, MAX_POT_CHIPS, MAX_POT_COLUMNS } from "@/lib/scene/chips/chip-stack";
import { MAX_RADIUS_PX, MAX_WALL_PX } from "@/lib/scene/chips/chip-spec";
import { DEALER_ART_SRC, dealerSlotBox } from "@/lib/scene/table-dealer";
import { DEALER_BOX } from "@/lib/scene/dealer-art.generated";
import {
  BOARD_CARD_FLOP_OVERLAP_FRACTION,
  BOARD_CARD_REVEAL_GAP_FRACTION,
  DEALER_ANGLE_DEG,
  SEAT_COUNT,
  seatAngleDeg,
} from "@/lib/scene/table-anchors";
import { clampBoardCardWidth } from "@/lib/scene/board-clearance";
import {
  pickSeatArtForSlot,
  seatArtBox,
  seatArtCharacter,
  seatArtCharacterForSlot,
  seatArtSlotFor,
  type SeatArtBox,
} from "@/lib/scene/seat-art";
import { resolveTableRenderer } from "@/lib/scene/table-renderer";
import { useDesktopViewport } from "@/components/use-desktop-viewport";
import { useClipboardCopy } from "@/components/use-clipboard-copy";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  radiiForTable,
  seatGeometry,
  seatZ,
} from "@/lib/game/table-geometry";
import { Menu, type MenuItem } from "@/components/nav/menu";
import { DonateButton } from "@/components/nav/donate-button";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { tapSound } from "@/lib/audio/ui-sounds";
import type { ReactionId } from "@/lib/game/reaction-channel";
import type { SeatReaction } from "@/lib/game/use-table-reactions";
import { ReactionButton } from "./table-reactions";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { FriendsDrawer } from "@/components/social/friends-drawer";
import { LeaveGameConfirmModal } from "@/components/leave-game-confirm-modal";
import { ActionBar } from "./action-bar";
import { MuckDrift } from "./table-effects";
import { HandHistoryDrawer } from "./hand-history-drawer";
import { PlayerSeat } from "./player-seat";
import { LocalPlayerHud } from "./local-player-hud";
import { TableLoadingSplash } from "./table-loading-splash";
import { PlayingCard } from "./playing-card";
import { isWinningCard, winningCardKeys } from "@/lib/game/winning-cards";
import { MAX_MISSED_TURNS } from "@/lib/game/engine";

/**
 * A seat's width, as a fraction of the table's width and of its height.
 * Everything about a seat is measured from this: the figure, where its cards
 * sit at the hands, how far a bet travels, so the whole ring scales with the
 * table instead of each piece needing its own breakpoint.
 *
 * Both bounds are needed. A figure is square, so on a landscape phone, where
 * the table is squeezed to 740x247, sizing off width alone gave each seat 64%
 * of the table's height and the ring closed over the board.
 */
/** How the table reports its live connection, shown in the header. */
export type ConnectionState = "connected" | "reconnecting" | "offline";

/* Trimmed from 0.17/0.3. A figure that was 30% of the table's height could not
   ring the table without lying across it, half of every player ended up on
   the cloth. Smaller figures plus the rail inset in 06-table.css put them
   around the perimeter instead of on the board. */
/* Raised twice, for two different reasons.
   .155 -> .175 when the nameplates lost their boxes: six bordered panels were
   most of what made the ring feel crowded, so the figures had to stay small
   to leave room between them.
   .175 -> .21 for phones specifically. A desktop table is bound by the height
   term (1082x588 gives min(227, 156) = 156), so raising the width fraction
   moves nothing there; a portrait phone is bound by width, which is exactly
   where the figures were too small to read. The height fraction rises with it
   so a short landscape table does not suddenly become the binding case. */
/**
 * The racetrack room. `ssr: false` because it paints to a real `<canvas>`
 * and measures the DOM to fit its camera -- there is no server-renderable
 * version of it.
 */
import type { RacetrackLayout } from "./scene/racetrack-scene";

const RacetrackScene = dynamic(
  () => import("./scene/racetrack-scene").then((module) => module.RacetrackScene),
  { ssr: false },
);

export const SEAT_WIDTH_RATIO = 0.26;
export const SEAT_HEIGHT_RATIO = 0.30;

/**
 * How much a seat shrinks per extra place at the table.
 *
 * A ring of eight puts its seats 45 degrees apart where six puts them 60, so
 * the gap between adjacent boxes closes by a quarter without the boxes
 * themselves changing. On a desktop plate there is room to absorb that; on the
 * narrow plate the measured clearance between neighbours falls to about 4px,
 * which is touching. Scaling the box by the ratio of the two spacings keeps
 * the same clearance at any count, and leaves six-max, which is what ships
 * today, at exactly the size it has always been.
 */
/**
 * The racetrack's own seat width bounds, in CSS pixels.
 *
 * Its seats are sized per chair from the projected elbow room between
 * neighbours rather than once from the table's width, so unlike
 * `seatWidthFor` there is no plate to keep them sane: a tight far arc on a
 * small landscape phone can project a shoulder budget of a few dozen pixels,
 * which is narrower than a nameplate can be and still be read.
 *
 * The floor is the nameplate's own minimum: `lib/game/table-geometry.ts`
 * measured it at 86px while solving the landscape ring, and a seat narrower
 * than its plate simply overflows. The ceiling is roughly what a desktop
 * plate gave the old orthographic room, so a near flank cannot balloon past
 * the seats it sits beside.
 */
const RACETRACK_SEAT_MIN_PX = 86;
const RACETRACK_SEAT_MAX_PX = 132;

/**
 * The board's own bounds, in CSS pixels, same reasoning as the seat pair
 * above, applied to a card instead of a chair.
 *
 * `BOARD_CARD_WIDTH_M` run through the live camera is the real 63mm card at
 * whatever distance the board happens to sit. The floor matters far more
 * than the ceiling: `12-responsive.css`'s own `.playing-card { width:
 * clamp(44px, ...) }` is this app's proven-shipped legibility floor for a
 * bare card, so 44 is not a stylistic guess here either. The ceiling is set
 * well under the old orthographic room's own 76px desktop clamp (this camera
 * used to inherit that rule unmodified): it reads big on the cloth like a
 * real dealt hand instead of flattened UI chrome, sized off the camera
 * instead of a breakpoint. Between the two, `clampBoardCardWidth`
 * (lib/scene/board-clearance.ts) shrinks further still, every frame, until
 * the row actually clears the pot; see its own header for why a static
 * clamp alone can't guarantee that. */
const RACETRACK_BOARD_CARD_MIN_PX = 44;
const RACETRACK_BOARD_CARD_MAX_PX = 72;

/**
 * Place the dealer's artwork in the slot the scene projected for it.
 *
 * One place, one dealer, and no numbers about her here: the art is
 * normalised onto a known box before it ever gets here, so a redraw changes
 * nothing in this file. `lib/scene/table-dealer.ts` owns the slot.
 *
 * Absolute pixels rather than CSS `calc()`, because the box is solved from the
 * live camera and the numbers behind it live in that module, not in a
 * stylesheet.
 */
function dealerStyle(dealer: { x: number; y: number; shoulderPx: number }): React.CSSProperties {
  const box = dealerSlotBox(dealer);
  return {
    left: `${box.left.toFixed(1)}px`,
    top: `${box.top.toFixed(1)}px`,
    width: `${box.width.toFixed(1)}px`,
  };
}

/**
 * Which real six-max anchor slot a heads-up match's one opponent sits in.
 *
 * Deliberately NOT a bespoke 2-seat geometry: the ring itself never resizes
 * (see racetrack-scene.tsx's own `slots` prop), so the opponent always
 * lands on one of the five already-tuned six-max opponent positions
 * (1 through 5) -- picked at random rather than a fixed one, so a heads-up
 * match doesn't always seat its one opponent in the same chair. Hashed off
 * `gameId` alone, not `handNumber`: the seat has to hold still for the
 * whole match, or the opponent would visibly teleport between hands.
 */
function headsUpOpponentSlot(gameId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < gameId.length; i += 1) {
    hash ^= gameId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 1 + ((hash >>> 0) % 5);
}

export function seatWidthFor(table: { width: number; height: number }, count = 6): number {
  const base = Math.min(table.width * SEAT_WIDTH_RATIO, table.height * SEAT_HEIGHT_RATIO);
  const spacingScale = count <= 6 ? 1 : Math.sin(Math.PI / count) / Math.sin(Math.PI / 6);
  return Math.round(base * spacingScale);
}

export function PokerTable({
  game,
  pending,
  error,
  onAction,
  onLeave,
  onLeaveSeat,
  profile,
  onClaimBackstop,
  onCustomize,
  connectionState,
  soundEnabled,
  onToggleSound,
  betStyle,
  onCycleBetStyle,
  stackInBigBlinds,
  onToggleStackInBigBlinds,
  tableRendererSettled,
  landscape,
  tightLandscape,
  onSignIn,
  onSignOut,
  reactions,
  onSendReaction,
  reactionCooldown,
}: {
  game: GameSnapshot;
  pending: boolean;
  error: string | null;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  onLeaveSeat: () => void;
  profile: PlayerProfile | null;
  /** The broke-player recovery top-up; see components/table/action-bar.tsx. */
  onClaimBackstop: () => void;
  onCustomize: () => void;
  connectionState: ConnectionState;
  soundEnabled: boolean;
  onToggleSound: () => void;
  betStyle: BetAnimationStyle;
  onCycleBetStyle: () => void;
  /** Whether a stack reads in raw chips or in big blinds; see lib/scene/stack-display.ts. */
  stackInBigBlinds: boolean;
  onToggleStackInBigBlinds: () => void;
  /** Has the stored renderer choice arrived? See the render gate below. */
  tableRendererSettled: boolean;
  /** Is the viewport wider than it is tall? The 2.5D table is landscape-only. */
  landscape: boolean;
  /** The tight mobile-landscape tier (see use-tight-landscape.ts) -- the live
   *  feed moves into the header at this tier instead of overlaying the felt. */
  tightLandscape: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  /** This hand's active reactions, keyed by seat id; see use-table-reactions.ts. */
  reactions: Record<string, SeatReaction>;
  onSendReaction: (reactionId: ReactionId) => void;
  reactionCooldown: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const activeRenderer = resolveTableRenderer();
  // Which of lib/scene/seat-art.ts's two hand-tuned tables applies to seat
  // art on the racetrack table; see useDesktopViewport's own note for why
  // this has to be a real subscription and not a `window.matchMedia` read
  // buried inside the picker functions themselves.
  const isDesktopViewport = useDesktopViewport();
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);
  // A seat is sized off the table, not the window. The table is capped by the
  // height left over as well as by width, so a short landscape phone can shrink
  // it to a third of its desktop width while the viewport is still wide.
  // Seats measured against the viewport stayed huge and buried the board.
  const [tableSize, setTableSize] = useState({ width: 850, height: 494 });
  // --foreground-drop is gone with the foreground seat that consumed it. It
  // existed to hang the local player a measured distance below the felt; on
  // the ring they are placed by the same ellipse as everyone else, and the
  // only thing still measured here is the table's own box.
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  // The window, alongside the table's own box. The plate is still what sizes
  // the seats; this answers the one question the plate stopped being able to
  // answer once the landscape rules made the wrap fill its area, which is
  // whether this is the landscape plate (see LANDSCAPE_MAX_HEIGHT_PX in
  // lib/game/table-geometry.ts). Null until mounted so the server render and
  // the first commit agree, both falling back to the plate-derived ellipse.
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      setTableSize({ width: rect.width, height: rect.height });
      // Measured on the same triggers as the box, for the reason the two
      // seat vectors are: two listeners could disagree about the layout
      // after a resize, and the ring reads both in one expression.
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("resize", measure);
    // A phone rotating between the landscape and portrait plates is exactly
    // the transition this ring switches on, and Safari fires this without
    // always firing `resize`.
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // No clock state here any more.
  //
  // A `clockNow` used to advance every 250ms for the whole of every turn, so
  // the action bar could be handed a remaining fraction. It sat at the root
  // of the table, so each tick re-rendered every seat, every card and every
  // plate, four times a second for the whole turn, to move one bar. Both
  // fuses now take the server's two timestamps and animate in CSS
  // (components/table/use-fuse.ts), so this component only re-renders when
  // the game state actually changes.
  const mySeatIndex = game.seats.findIndex((seat) => seat.isMine);
  // The deck the board is dealt from, drawn as your own back.
  //
  // Every other face-down card at this table belongs to a seat and carries
  // that seat's back. The board belongs to the room, so it needs an answer of
  // its own, and yours is the right one, because it is otherwise the single
  // thing a buyer never gets to look at. Your hole cards are face up to you;
  // your back is shown to everyone except you. Half a second of it on each
  // board card is the only time you see what you paid for.
  const myCardBack = mySeatIndex >= 0 ? game.seats[mySeatIndex].cardBackCosmetic : undefined;
  // Memoized because five other useMemos below key off this array's identity
  // (slotOf, racetrackArtBySeat, seatStyles, sceneStreetBets, centerPotAmount);
  // without this, every one of them recomputes on any re-render, not just
  // the ones where game.seats actually changed.
  const orderedSeats = useMemo(
    () => (mySeatIndex <= 0
      ? game.seats
      : game.seats.map((_, index) => game.seats[(mySeatIndex + index) % game.seats.length])),
    [game.seats, mySeatIndex],
  );
  // Which real racetrack anchor each entry of orderedSeats draws at. Identity
  // for an ordinary table (always all six, in order); a heads-up table's
  // single opponent (orderedSeats[1], since [0] is always the hero -- see
  // orderedSeats' own comment) instead lands on one randomly-chosen six-max
  // slot, so it reuses the ring's existing tuned positions rather than a
  // bespoke 2-seat geometry. See headsUpOpponentSlot and
  // racetrack-scene.tsx's own `slots` prop.
  const seatSlots = useMemo(
    () => (game.tournament
      ? orderedSeats.map((_, index) => (index === 0 ? 0 : headsUpOpponentSlot(game.id)))
      : orderedSeats.map((_, index) => index)),
    [game.tournament, game.id, orderedSeats],
  );
  const potRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Record<string, HTMLElement | null>>({});
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const racetrackForegroundRef = useRef<HTMLDivElement | null>(null);
  const showFunnel = game.status === "complete" && game.winners.length > 0;
  // What beat you, stated in as many words. handLabel is only non-null once
  // a hand is revealed (won, or shown at a real showdown; see
  // seatCardsWereShown in engine.ts), so a truthy value here already means
  // "I did not fold and this was a genuine comparison," not just "I lost."
  // An uncontested win reaches nobody's handLabel but the winner's, so this
  // is silent for exactly the hands where "what beat you" has no answer.
  const mySeat = mySeatIndex !== -1 ? game.seats[mySeatIndex] : null;
  // Chips already moved out of stack into this hand's pot: vacateSeat cashes
  // out only what's left in stack, so this amount is what leaving right now
  // would forfeit. Zero between hands (committed resets at setupHand), so a
  // leave with nothing at risk skips the confirmation entirely.
  const committedThisHand = mySeat?.committed ?? 0;
  const requestLeave = useCallback((action: () => void) => {
    if (committedThisHand > 0) {
      setPendingLeave(() => action);
    } else {
      action();
    }
  }, [committedThisHand]);
  const myShowdownLoss = showFunnel && mySeat?.handLabel
    && !game.winners.some((winner) => winner.seatId === mySeat.id)
    ? mySeat.handLabel
    : null;
  // Null unless the hand reached a genuine showdown: an uncontested pot has no
  // bestFive to point at, because nobody saw the cards that won it.
  const winningKeys = useMemo(
    () => (showFunnel ? winningCardKeys(game.winners) : null),
    [showFunnel, game.winners],
  );

  const dealerSeatId = game.seats.find((seat) => seat.isDealer)?.id ?? null;
  const [dealerVector, setDealerVector] = useState<{ dx: number; dy: number } | null>(null);
  const dealerMeasuredOnceRef = useRef(false);
  const [dealerAnimated, setDealerAnimated] = useState(false);
  const measureDealer = useCallback(() => {
    const wrapEl = tableWrapRef.current;
    const seatEl = dealerSeatId ? seatRefs.current[dealerSeatId] : null;
    if (!wrapEl || !seatEl) return;
    const wrapRect = wrapEl.getBoundingClientRect();
    const seatRect = seatEl.getBoundingClientRect();
    // The seat's own toward-pot unit vector (--seat-dx/-dy, set inline by
    // ringGeometry) reused rather than re-derived, same source .table-bet's
    // reach already trusts. A flat pull inward off the seat's own centre,
    // not all the way to the pot, so the button lands on visible felt
    // beside the player instead of stamped on their avatar.
    const seatStyle = getComputedStyle(seatEl);
    const towardX = Number.parseFloat(seatStyle.getPropertyValue("--seat-dx")) || 0;
    const towardY = Number.parseFloat(seatStyle.getPropertyValue("--seat-dy")) || 0;
    // A flat 46px pull inward cleared a desktop-sized avatar by only a few
    // pixels, and stamped the puck across it outright the moment a seat
    // rendered smaller than that, which a short-but-wide viewport does
    // (--table-height-cap in 06-table.css shrinks the whole table, seats
    // included, well before it shrinks the puck's own fixed offset). Mirrors
    // .seat-figure's own clamp(40px, 72%, 78px) (08-seat.css) instead of a
    // second, disagreeing guess at the avatar's size, so the puck's radius
    // tracks the actual circle it has to clear at every seat size rather
    // than just the one desktop width it was measured against.
    const AVATAR_MIN_PX = 40;
    const AVATAR_MAX_PX = 78;
    const AVATAR_WIDTH_RATIO = 0.72;
    const DEALER_PUCK_RADIUS = 12; // half of .dealer-puck's own 24px (08-seat.css)
    // 8px used to leave the puck sitting in the rail's own padded cushion for
    // any seat close to the felt's edge, worst on the seat across from the
    // viewer, whose whole avatar already overhangs .poker-rail's inset (see
    // the comment on .poker-rail in 06-table.css). 24px pulls it far enough
    // inward that it clears the cushion and reads as sitting on the felt.
    const DEALER_PUCK_GAP = 24;
    const avatarDiameter = Math.min(
      AVATAR_MAX_PX,
      Math.max(AVATAR_MIN_PX, seatRect.width * AVATAR_WIDTH_RATIO),
    );
    const DEALER_PUCK_INSET = avatarDiameter / 2 + DEALER_PUCK_RADIUS + DEALER_PUCK_GAP;
    const targetX = seatRect.left + seatRect.width / 2 + towardX * DEALER_PUCK_INSET;
    const targetY = seatRect.top + seatRect.height / 2 + towardY * DEALER_PUCK_INSET;
    // The offset is now an absolute pixel delta off the wrap's own top-left
    // corner, not a delta off .pot-anchor added to a `left:50%; top:19%`
    // guess (08-seat.css's old rule). That guess was a flat percentage of
    // .poker-table-wrap, while .pot-anchor sits inset and re-tilted inside
    // .poker-rail's own perspective transform: two coordinate spaces that
    // were never actually the same point, which is why the puck used to
    // settle somewhere in the middle of the felt instead of by any seat.
    // Anchoring the CSS side at the wrap's literal (0, 0) removes the second
    // coordinate space entirely: this delta is the only number the puck's
    // position depends on.
    setDealerVector({
      dx: targetX - wrapRect.left,
      dy: targetY - wrapRect.top,
    });
    if (!dealerMeasuredOnceRef.current) {
      dealerMeasuredOnceRef.current = true;
      // Skip the glide transition for this first placement (mount, refresh,
      // reconnect); only actual dealer-seat changes between hands should
      // animate. Arming on the next frame keeps this snap-into-place paint
      // free of a transition rather than racing the style application.
      window.requestAnimationFrame(() => setDealerAnimated(true));
    }
  }, [dealerSeatId]);

  // Where each seat's cards come from: the deck, which is the same point on
  // the felt that every chip flies to. Measured against .pot-anchor rather
  // than derived from the seat ellipse, for two reasons. The ellipse is in
  // percentages of the table box and knows nothing about how far .seat-cards
  // hangs below a seat's anchor, and the local player is not on the ellipse
  // at all: they are in the foreground at a distance that is itself
  // measured (foregroundDrop). One measurement covers both, at every
  // breakpoint, with no arithmetic to keep in step with the stylesheets.
  //
  // The old value was a flat --deal-y: 120px on .seat-ring, so every card
  // rose from directly beneath its own seat, and the local player, whose
  // .seat-first-person never declared the variables at all, got an
  // invalid transform and no movement whatsoever.
  const [dealVectors, setDealVectors] = useState<Record<string, { dx: number; dy: number }>>({});
  const measureDealVectors = useCallback(() => {
    const anchorEl = potRef.current;
    if (!anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    const anchorX = anchor.left + anchor.width / 2;
    const anchorY = anchor.top + anchor.height / 2;
    setDealVectors((previous) => {
      const next: Record<string, { dx: number; dy: number }> = {};
      let changed = false;
      for (const [seatId, element] of Object.entries(seatRefs.current)) {
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        // Deck minus seat: the offset the card starts at, relative to where
        // it will come to rest.
        const dx = Math.round(anchorX - (rect.left + rect.width / 2));
        const dy = Math.round(anchorY - (rect.top + rect.height / 2));
        next[seatId] = { dx, dy };
        if (previous[seatId]?.dx !== dx || previous[seatId]?.dy !== dy) changed = true;
      }
      // Bail out on an unchanged measurement. This runs from a ResizeObserver,
      // and returning a fresh object every time would re-render every seat on
      // any observed resize for no reason.
      if (!changed && Object.keys(next).length === Object.keys(previous).length) {
        return previous;
      }
      return next;
    });
  }, []);

  // Every seat rings the table on the CSS ellipse, the local player
  // included: slot 0 is the near edge, nearest the viewer, which is exactly
  // where the person holding it is sitting. The ellipse is the one layout
  // authority; the canvas room fits its painted table inside this ring
  // rather than projecting a competing one back onto it.
  const ringGeometry = useMemo(
    () => orderedSeats.map((_, index) => {
      const geometry = seatGeometry(
        index,
        orderedSeats.length,
        radiiForTable(tableSize, viewport ?? undefined),
      );
      return {
        left: `${geometry.x}%`,
        top: `${geometry.y}%`,
        // Avatars remain one consistent size. Depth now comes from the tilted
        // table plane, overlap order and rail occlusion rather than shrinking
        // or blurring people around the table.
        "--seat-near": geometry.depth.toFixed(3),
        // Depth order for the figure; the plate derives a much higher one from
        // it so no nameplate is ever hidden behind a neighbour's shoulder.
        "--seat-z": seatZ(geometry.depth),
        // The direction from this seat toward the pot, as a bare unit vector.
        // Anything that hangs off a seat picks its own distance in CSS and
        // multiplies (bets travel inward, the turn timer outward), which
        // keeps the per-breakpoint distances alongside every other breakpoint
        // rule rather than stranded in here.
        "--seat-dx": geometry.towardPot.x.toFixed(3),
        "--seat-dy": geometry.towardPot.y.toFixed(3),
        // Compact 2D markers sit just outside the rail, not at the centre of
        // the old full-figure seat box.
        "--seat-out-x": (-geometry.towardPot.x).toFixed(3),
        "--seat-out-y": (-geometry.towardPot.y).toFixed(3),
      } as React.CSSProperties;
    }),
    // The measured box decides the plate's shape: the same viewport can
    // hold a wide plate or a tall one depending on how much room the header
    // and action bar left behind, and only the box knows which. The window is
    // here for the one thing the box cannot report, which is whether this is
    // the landscape band at all; see radiiForTable.
    [orderedSeats, tableSize, viewport],
  );

  /* The racetrack room reports where its camera put everything; until it
     does, there is nothing to position from. Null until the first fit, which
     is also why the seat styles below fall back to the ellipse rather than to
     zeros: a seat at (0, 0) for one frame is a visible jump. */
  const isRacetrack = activeRenderer === "racetrack_2d5";
  const [racetrackLayout, setRacetrackLayout] = useState<RacetrackLayout | null>(null);
  const onRacetrackLayout = useCallback((layout: RacetrackLayout) => {
    setRacetrackLayout(layout);
  }, []);
  /* Not cleared when the renderer changes. A stale layout is inert: every
     rule that reads it is scoped to `.scene-room-racetrack`, and the two
     consumers below both gate on `isRacetrack` as well, so the only thing
     keeping it buys is one less state write on a preference toggle. */

  /**
   * Character art for each opponent seat on the racetrack table, the
   * dealer's own sibling and one step further settled now that the avatar
   * catalog and the seat-art roster are the same id space: a seat draws the
   * character its own occupant actually bought/equipped (`avatarCosmetic`,
   * already on every `PublicSeat`; humans via their equipped avatar, bots
   * via `botAvatarFor`), a real per-PLAYER pick rather than the old
   * per-SEAT hash. `seatArtCharacterForSlot`'s hash pick survives as the
   * fallback for a seat whose `avatarCosmetic` doesn't resolve to a roster
   * character (a stale/legacy id); everyone at the table still agrees,
   * since `avatarCosmetic` is already part of the snapshot every client has.
   *
   * Keyed by seat rather than a flat list, and rendered as each seat's own
   * child (see `<PlayerSeat racetrackArt=...>`) rather than as siblings of
   * `.poker-table-wrap`, which is where this used to render. It has to be:
   * `.poker-table-wrap` carries `isolation: isolate` (for the dealer's own
   * z-index escape, see that rule's own long comment), which makes the whole
   * wrap one atomic layer from the outside. A sibling image can be ordered
   * in front of or behind that entire layer, never in between two of its
   * descendants, so cards drawn behind this art and a nameplate drawn in
   * front of it could never both be true while the art lived outside the
   * wrap. Nested inside the seat itself, the three are ordinary siblings in
   * one stacking context and a plain `z-index` finally does what it says.
   *
   * Absent for the hero's own seat (no figure is drawn there on any table)
   * and for a seat the layout hasn't reported a fit for.
   */
  const racetrackArtBySeat = useMemo(() => {
    const map = new Map<string, { src: string; mirror: boolean; box: SeatArtBox }>();
    if (!isRacetrack || !racetrackLayout) return map;
    orderedSeats.forEach((seat, index) => {
      if (seat.isMine) return;
      const placed = racetrackLayout.seats[index];
      if (!placed) return;
      const character = seatArtCharacter(seat.avatarCosmetic)
        ?? seatArtCharacterForSlot(game.id, game.handNumber, placed.slot);
      if (!character) return;
      // placed.slot is always a real six-max ring position (0-5), regardless
      // of how many seats this table actually has -- see seatSlots' own
      // comment and racetrack-scene.tsx's `slots` prop. SEAT_COUNT is the
      // ring this angle is measured against, not this table's own headcount.
      const offset = seatAngleDeg(placed.slot, SEAT_COUNT) - DEALER_ANGLE_DEG;
      const pick = pickSeatArtForSlot(character, placed.slot, offset, isDesktopViewport);
      const slot = seatArtSlotFor(placed.slot, isDesktopViewport);
      const box = seatArtBox(placed, placed.hands, pick.aspect, pick.mirror, slot);
      if (!box) return;
      map.set(seat.id, { src: pick.src, mirror: pick.mirror, box });
    });
    return map;
  }, [isRacetrack, racetrackLayout, orderedSeats, isDesktopViewport, game.id, game.handNumber]);

  /**
   * Where each seat actually goes.
   *
   * The CSS ellipse (`ringGeometry`) for the racetrack before its camera has
   * produced a layout on the first frame; the projected anchors once it has.
   * Same shape of answer either way -- a style object per seat -- so nothing
   * downstream branches on which one is live.
   */
  const seatStyles = useMemo(() => {
    if (!isRacetrack || !racetrackLayout) return ringGeometry;
    return orderedSeats.map((seat, index) => {
      const placed = racetrackLayout.seats[index];
      if (!placed) return ringGeometry[index];
      /* Where this seat's PORTRAIT ended up, as three offsets from the seat
         box's own origin (the projected crown).

         The seat box is centred on that anchor; the drawn character is not.
         `seatArtBox` shifts it by the slot's hand-tuned `offsetX`, hangs its
         bottom edge at the hands anchor plus `offsetY`, and grows it upward
         from there by `scale`, so at a scaled seat the art's real crown is
         several pixels above the anchor and its hands several below. Anything
         that has to line up with the PERSON rather than with the anchor (the
         nameplate, the hole cards) needs the box, not the anchor.

         Read off the same `seatArtBox` result the `<img>` is positioned from
         rather than recomputed from the slot: one formula, so the two cannot
         drift apart. Absent for a seat whose character doesn't resolve (no
         portrait is drawn there at all), where the offsets collapse to zero
         and everything falls back to the anchor it always used. */
      const artBox = racetrackArtBySeat.get(seat.id)?.box;
      return {
        "--seat-x": `${placed.x.toFixed(1)}px`,
        "--seat-y": `${placed.y.toFixed(1)}px`,
        "--seat-art-dx": `${(artBox ? artBox.left + artBox.width / 2 - placed.x : 0).toFixed(1)}px`,
        "--seat-art-crown-dy": `${(artBox ? artBox.top - placed.y : 0).toFixed(1)}px`,
        "--seat-art-hands-dy": `${(artBox ? artBox.top + artBox.height - placed.y : 0).toFixed(1)}px`,
        // The portrait's own rendered size, for effects that have to sit
        // behind it and scale with it (the winner aura glow below) rather
        // than with the seat's own small `--seat-width` box, since the art is
        // drawn many times that size (seatArtBox), so a percentage of the
        // seat box would not track the character at all.
        "--seat-art-w": `${(artBox ? artBox.width : 0).toFixed(1)}px`,
        "--seat-art-h": `${(artBox ? artBox.height : 0).toFixed(1)}px`,
        /* Per seat here, where the old orthographic room set one width on
           the wrap for all of them. It has to be: the crowd is clustered on
           the far arc, so a near flank has visibly more elbow room than a
           chair beside the dealer, and one width for both either overlaps
           the middle of the arc or wastes the ends. Clamped to the same
           floor and ceiling that room's own seat sizing used, so a very
           tight arc still leaves a legible nameplate. */
        "--seat-width": `${Math.round(Math.min(RACETRACK_SEAT_MAX_PX, Math.max(RACETRACK_SEAT_MIN_PX, placed.shoulderPx)))}px`,
        "--seat-near": placed.near.toFixed(3),
        "--seat-z": seatZ(placed.near),
        "--seat-dx": placed.toward.x.toFixed(3),
        "--seat-dy": placed.toward.y.toFixed(3),
        "--seat-out-x": (-placed.toward.x).toFixed(3),
        "--seat-out-y": (-placed.toward.y).toFixed(3),
        // Where the bet-amount label belongs, as an offset from this seat's
        // own crown, not a reach constant. `.table-bet` (08-seat.css) is
        // positioned relative to the seat's own box, so a page-space point
        // has to arrive as a delta from that box's origin (the crown) rather
        // than as `left`/`top` directly. See 42-racetrack-table.css.
        "--bet-dx-px": `${(placed.bet.x - placed.x).toFixed(1)}px`,
        "--bet-dy-px": `${(placed.bet.y - placed.y).toFixed(1)}px`,
        // The same bet position, but relative to the STAGE rather than this
        // seat's own crown, for `.seat-mine` alone, whose box is not on the
        // projection at all (anchored to the stage's bottom edge instead, see
        // 42-racetrack-table.css). Only that one override reads these.
        "--bet-x-rel-px": `${(placed.bet.x - racetrackLayout.width / 2).toFixed(1)}px`,
        "--bet-y-rel-px": `${(placed.bet.y - racetrackLayout.height).toFixed(1)}px`,
      } as React.CSSProperties;
    });
  }, [isRacetrack, racetrackLayout, orderedSeats, ringGeometry, racetrackArtBySeat]);

  const seatOrderKey = orderedSeats.map((seat) => seat.id).join(",");
  // Both vectors answer the same question (where is this seat, relative to
  // the middle of the table), so they are measured together and on exactly
  // the same triggers. Splitting them would mean two sets of observers that
  // could disagree about the layout after a resize.
  const measureTableVectors = useCallback(() => {
    measureDealVectors();
    measureDealer();
  }, [measureDealVectors, measureDealer]);
  useEffect(() => {
    measureTableVectors();
  }, [measureTableVectors, seatOrderKey, historyOpen]);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => measureTableVectors());
    observer.observe(wrap);
    window.addEventListener("orientationchange", measureTableVectors);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measureTableVectors);
    };
  }, [measureTableVectors]);

  // Chips fly from a seat to the pot only for an authoritative *increase* in
  // that seat's committed-this-street amount versus the last snapshot on the
  // same hand/street. Comparing against an empty baseline whenever the hand
  // or street changes (rather than the stale prior-street value) means a
  // street reset never reads as a contribution, while a freshly posted
  // blind still does. A null baseline, true on mount and forced on any
  // disconnect, skips flight generation entirely for that one snapshot,
  // so neither initial hydration nor a reconnect ever replays history.
  const streetBetsRef = useRef<{ handNumber: number; street: string; bets: Record<string, number> } | null>(null);
  const [chipFlights, setChipFlights] = useState<
    Array<{ id: string; seatId: string; amount: number; kind: ChipMoveKind }>
  >([]);
  useEffect(() => {
    if (connectionState !== "connected") {
      streetBetsRef.current = null;
    }
  }, [connectionState]);
  useEffect(() => {
    const prev = streetBetsRef.current;
    const sameStreet = prev !== null && prev.handNumber === game.handNumber && prev.street === game.street;
    const baseline = sameStreet ? prev!.bets : {};
    if (prev !== null) {
      // What the table was already facing when these chips left. Read off the
      // same baseline the arrivals are, so it is the state *before* the action
      // rather than after it: comparing a raise against its own new high bet
      // would classify every aggression as a call.
      const previousHighBet = game.seats.reduce(
        (high, seat) => Math.max(high, baseline[seat.id] ?? 0),
        0,
      );
      const arrivals = game.seats
        .filter((seat) => seat.streetBet > (baseline[seat.id] ?? 0))
        .map((seat) => ({
          id: `${game.handNumber}-${game.street}-${seat.id}-${seat.streetBet}`,
          seatId: seat.id,
          // The spray is this number as chips: what this seat just put in,
          // not its whole street. A raise to 200 from a seat that already
          // had 50 committed flies the 150, exactly as a dealer cuts it out.
          amount: seat.streetBet - (baseline[seat.id] ?? 0),
          // Which gesture this is, and therefore how fast the chips move: a
          // call is the quickest thing at the table and a shove is allowed to
          // be a moment. See `betFlightKind`.
          kind: betFlightKind({
            allIn: seat.status === "all-in",
            previousHighBet,
            streetBet: seat.streetBet,
          }),
        }));
      if (arrivals.length) {
        setChipFlights((current) => [...current, ...arrivals]);
      }
    }
    streetBetsRef.current = {
      handNumber: game.handNumber,
      street: game.street,
      bets: Object.fromEntries(game.seats.map((seat) => [seat.id, seat.streetBet])),
    };
  }, [game.seats, game.handNumber, game.street]);
  /**
   * The list is a queue of *events*, not of nodes any more.
   *
   * Each flight used to be a React component that measured its own
   * trajectory and removed itself through `onDone` when its CSS animation
   * ended. The chips are meshes now and the scene owns their motion, so all
   * this has to do is hand each new bet across exactly once and then stop
   * growing. `ChipScene` dedupes by id, so clearing the whole list at once
   * cannot replay anything. The timer restarts whenever another bet arrives,
   * which is why a whole street of betting still only sweeps up once.
   */
  useEffect(() => {
    if (chipFlights.length === 0) return;
    const timer = window.setTimeout(() => setChipFlights([]), 900);
    return () => window.clearTimeout(timer);
  }, [chipFlights]);

  /**
   * The scene reports whether it actually got a context. Until it says yes,
   * the DOM felt and rail keep painting themselves (see `.scene-lit` in
   * app/styles/99-scene.css). Assuming success would leave a device without
   * a working canvas looking at an unpainted table.
   *
   * RacetrackScene's own onReady fires the instant its canvas exists -- there
   * is no staggered/async child to wait on, so this is plain render-time
   * state with no token/identity machinery needed to tell one room's mount
   * apart from another's.
   */
  const [canvas2DMounted, setCanvas2DMounted] = useState(false);
  const sceneReady = canvas2DMounted;

  // Ring slots, not engine seat positions. The scene rings its table from the
  // local player's chair exactly as the DOM does, so a bet has to be handed
  // over as "slot 2" rather than "seat abc" or it flies in from the wrong
  // side of the table for everyone who is not in seat 1. This is seatSlots'
  // own real ring position, not the seat's plain array index -- for a
  // heads-up table those two differ (the opponent's true slot is randomly
  // chosen, see seatSlots), and a chip animating to array-index 1 instead of
  // the actual assigned slot would land beside the wrong chair.
  const slotOf = useMemo(() => {
    const slots = new Map<string, number>();
    orderedSeats.forEach((seat, index) => slots.set(seat.id, seatSlots[index]));
    return slots;
  }, [orderedSeats, seatSlots]);
  const betFlights = useMemo<BetFlight[]>(
    () => chipFlights
      .map((flight) => ({
        id: flight.id,
        slot: slotOf.get(flight.seatId) ?? -1,
        amount: flight.amount,
        kind: flight.kind,
      }))
      .filter((flight) => flight.slot >= 0),
    [chipFlights, slotOf],
  );
  // Standing street bets by ring slot, for the scene: what each seat has
  // committed this street rests in front of them as chips until the street
  // closes. Slots, not seat ids, for the same reason betFlights uses them --
  // and slotOf's actual assigned slot, not the seat's array index, for the
  // same reason betFlights uses slotOf too: a heads-up table's opponent sits
  // at a randomly-chosen ring slot (see seatSlots/headsUpOpponentSlot), so
  // array index 1 is not necessarily their real slot.
  const sceneStreetBets = useMemo(
    () => orderedSeats
      .map((seat) => ({ slot: slotOf.get(seat.id) ?? -1, amount: seat.streetBet }))
      .filter((bet) => bet.slot >= 0 && bet.amount > 0),
    [orderedSeats, slotOf],
  );
  // What the centre pile is actually showing (pot minus whatever is still
  // standing at a seat), so its label agrees with the chips the scene draws
  // there by construction rather than restating the pot number the standing
  // bets haven't reached yet. See RacetrackScene's own identical subtraction
  // (components/table/scene/racetrack-scene.tsx) for the invariant this mirrors.
  const centerPotAmount = useMemo(
    () => Math.max(0, game.pot - orderedSeats.reduce((sum, seat) => sum + seat.streetBet, 0)),
    [game.pot, orderedSeats],
  );
  // How tall the mound RacetrackScene is about to draw for this pot actually
  // gets, in CSS pixels -- so the "Pot" pill can clear its peak instead of
  // guessing a flat offset that overlaps a real pile once it grows past a
  // couple of chips. Mirrors the same chip-count math the scene itself runs
  // (chip-scene.ts's syncPile) rather than measuring the canvas, which this
  // component never touches. MAX_RADIUS_PX/MAX_WALL_PX are chip-spec.ts's own
  // hard ceilings on a single chip's drawn size -- using them (rather than the
  // camera's actual, narrower scale at the pot) means this is always tall
  // enough, never a pixel short.
  const potMoundClearancePx = useMemo(() => {
    const chipCount = chipBreakdown(centerPotAmount, game.bigBlind, MAX_POT_CHIPS).length;
    if (chipCount === 0) return 0;
    const columns = columnCount(chipCount, MAX_POT_COLUMNS);
    const tallestColumn = Math.max(...columnHeights(chipCount, columns));
    return (tallestColumn - 1) * MAX_WALL_PX + MAX_WALL_PX + MAX_RADIUS_PX * 2;
  }, [centerPotAmount, game.bigBlind]);
  const sceneWinners = useMemo(
    () => (showFunnel
      ? game.winners
        .map((winner) => ({ slot: slotOf.get(winner.seatId) ?? -1, amount: winner.amount }))
        .filter((winner) => winner.slot >= 0)
      : []),
    [showFunnel, game.winners, slotOf],
  );

  // Same shape of guard as the chip-flight tracker above: a null baseline
  // (mount, or forced on any non-connected state) skips detection for that
  // snapshot, so a fresh hand's seats resetting to "active" is never misread
  // as an un-fold, and nothing replays after a refresh or reconnect.
  const foldStatusRef = useRef<Record<string, boolean> | null>(null);
  const [muckDrifts, setMuckDrifts] = useState<
    Array<{ id: string; seatId: string; cards: Array<Card | null>; isMine: boolean }>
  >([]);
  useEffect(() => {
    if (connectionState !== "connected") {
      foldStatusRef.current = null;
    }
  }, [connectionState]);
  useEffect(() => {
    const prev = foldStatusRef.current;
    if (prev !== null) {
      const newlyFolded = game.seats.filter((seat) => seat.status === "folded" && !prev[seat.id]);
      if (newlyFolded.length) {
        setMuckDrifts((current) => [
          ...current,
          ...newlyFolded.map((seat) => ({
            id: `${game.handNumber}-${seat.id}-muck`,
            seatId: seat.id,
            cards: seat.holeCards,
            isMine: seat.isMine,
          })),
        ]);
      }
    }
    foldStatusRef.current = Object.fromEntries(game.seats.map((seat) => [seat.id, seat.status === "folded"]));
  }, [game.seats, game.handNumber]);
  const removeMuckDrift = useCallback((id: string) => {
    setMuckDrifts((current) => current.filter((drift) => drift.id !== id));
  }, []);

  // A silent auto-fold/check is easy to miss on a first turn; call it out
  // explicitly instead of only leaving a trace in the activity log. Derived
  // during render (React's "adjusting state" pattern) rather than in an
  // effect, since it only needs to react to game.log changing, not to
  // synchronize with anything external.
  const [timeoutFlash, setTimeoutFlash] = useState<string | null>(null);
  const [lastSeenLogId, setLastSeenLogId] = useState<string | null>(null);
  const latestLogId = game.log[0]?.id ?? null;
  if (latestLogId !== lastSeenLogId) {
    const previouslyObserved = lastSeenLogId !== null;
    setLastSeenLogId(latestLogId);
    const entry = game.log[0];
    const mySeat = game.seats.find((seat) => seat.isMine);
    if (previouslyObserved && entry && mySeat && entry.text.startsWith(`${mySeat.name} ran out of time`)) {
      // What happened, and what happens next. A player who has just missed a
      // turn is the one person who needs to know a seat can be lost this way,
      // and the activity log is not where they are looking.
      const auto = mySeat.lastAction === "Timed out · Check"
        ? "you checked automatically"
        : "you folded automatically";
      const remaining = MAX_MISSED_TURNS - mySeat.missedTurns;
      setTimeoutFlash(
        remaining <= 0
          ? "You’ve been away too long — your seat goes back to the table."
          : `Time’s up — ${auto}. ${remaining} more and you lose the seat.`,
      );
    }
  }
  useEffect(() => {
    if (!timeoutFlash) return;
    const timer = window.setTimeout(() => setTimeoutFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [timeoutFlash]);

  const { copiedValue: copiedRoomCode, copy: copyToClipboard } = useClipboardCopy();
  const roomCodeCopied = game.roomCode !== null && copiedRoomCode === game.roomCode;
  const copyRoomCode = useCallback(() => {
    if (game.roomCode) void copyToClipboard(game.roomCode);
  }, [game.roomCode, copyToClipboard]);

  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [
      {
        kind: "action",
        label: soundEnabled ? "Mute sound" : "Enable sound",
        onSelect: onToggleSound,
        icon: soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />,
      },
      {
        kind: "action",
        label: betStyleLabel(betStyle),
        onSelect: onCycleBetStyle,
        icon: <Sparkles size={15} />,
      },
      {
        kind: "action",
        label: stackInBigBlinds ? "Show stack in chips" : "Show stack in big blinds",
        onSelect: onToggleStackInBigBlinds,
        icon: <Divide size={15} />,
      },
      {
        kind: "action",
        label: "Hand history",
        onSelect: () => setHistoryOpen(true),
        icon: <History size={15} />,
      },
      // The only way to reach the rules page once actually seated -- the
      // lobby footer links to it, but nothing does once a player has left
      // the lobby. Always present, seated or not, same as Hand history above.
      { kind: "link", label: "How to Play", href: "/how-to-play", icon: <HelpCircle size={15} /> },
    ];
    if (game.isPrivate && game.roomCode) {
      items.push({
        kind: "action",
        label: roomCodeCopied ? "Room code copied" : `Room code · ${game.roomCode}`,
        onSelect: () => void copyRoomCode(),
        icon: <Copy size={15} />,
      });
    }
    // Seated and registered, not private-table-only: the drawer's table-invite
    // pill is still gated to a room with a code (see inviteGameId below), but
    // adding a seated stranger as a friend or challenging one to a duel needs
    // no room code at all. Registered, because a request is addressed to a
    // profile id and a guest's dies with their cookie.
    if (game.isSeated && profile?.isRegistered) {
      items.push({
        kind: "action",
        label: "Friends",
        onSelect: () => setFriendsOpen(true),
        icon: <UserPlus size={15} />,
      });
    }
    items.push(
      { kind: "separator" },
      { kind: "link", label: "Collection", href: "/collection", icon: <Layers size={15} /> },
      // Was missing here entirely: the lobby's hub tile says "Buy Gold" but
      // this in-game menu only offered "Support StackChips", so a player who
      // opened it mid-session saw a donate link where they expected the
      // store. Donating now lives in the header instead (DonateButton).
      { kind: "link", label: "Buy Gold", href: `/store/gold?table=${game.id}`, icon: <Coins size={15} /> },
      { kind: "link", label: "Leaderboard", href: "/leaderboard", icon: <Trophy size={15} /> },
      { kind: "separator" },
    );
    if (profile) {
      items.push({ kind: "action", label: "Edit profile", onSelect: onCustomize, icon: <Settings2 size={15} /> });
    }
    items.push(
      profile?.isRegistered
        ? { kind: "action", label: "Sign out", onSelect: onSignOut, icon: <LogOut size={15} /> }
        : { kind: "action", label: "Sign in", onSelect: onSignIn, icon: <LogIn size={15} /> },
    );
    if (game.isSeated) {
      items.push({
        kind: "action",
        label: "Give up seat",
        onSelect: () => requestLeave(onLeaveSeat),
        icon: <DoorOpen size={15} />,
        tone: "danger",
      });
    }
    return items;
  }, [
    soundEnabled, onToggleSound, betStyle, onCycleBetStyle,
    stackInBigBlinds, onToggleStackInBigBlinds,
    game.isPrivate, game.roomCode,
    game.id, game.isSeated, roomCodeCopied, copyRoomCode, profile, onCustomize, onSignIn,
    onSignOut, onLeaveSeat, requestLeave,
  ]);

  /* Render gate: nothing paints until the renderer choice is genuinely
     known. The stored preference arrives a tick after the first commit (the
     deferred set in use-stored-preference.ts), so without this a player
     whose stored choice hasn't loaded yet would briefly mount whatever
     DEFAULT_TABLE_RENDERER is, acquire a canvas context, paint, and get torn
     down again the very next commit once the real preference arrives. A
     blank hold is cheaper than a discarded room and reads as a load rather
     than as a glitch.

     This sits below the hooks, not at the top of the component, and that is
     not a stylistic choice. Returning before the ~30 hooks above would give
     this component two different hook sequences depending on a boolean that
     flips on the second commit, which is precisely what React's rules of
     hooks forbid; it would throw on the transition rather than fix a
     flicker. The hooks all run, find their refs null, and no layout node is
     created, which is what was actually asked for.

     100dvh, not 100vh: on mobile browsers `vh` is the tallest the viewport
     ever gets, chrome included, so a 100vh hold is visibly taller than the
     table that replaces it and the whole page shifts on the swap. The rest
     of this codebase uses dvh for the same reason. The colour is the Neon
     Marquee ground (01-tokens.css's own html/body literal, #150a2b, stated
     the same way there for the same reason), so the hold is indistinguishable
     from the shell that follows it rather than a flash between two darks. */
  if (!tableRendererSettled) {
    return <div style={{ width: "100vw", height: "100dvh", backgroundColor: "#150a2b" }} />;
  }

  if (!landscape) {
    return (
      <main className="game-shell orientation-gate-shell">
        <div className="orientation-gate" role="status" aria-live="polite">
          <span className="orientation-gate-mark"><StackChipsMark size={44} /></span>
          <h1>Turn your phone sideways</h1>
          <p>StackChips tables are available in landscape mode.</p>
          <small>Rotate your device to continue playing.</small>
        </div>
      </main>
    );
  }

  return (
    <main className="game-shell">
      {/* Gameplay only. The spec puts three things in the table HUD (logo,
          Leave Table, avatar), so everything that is not one of those moved
          into the avatar's menu. Leave Table stays a first-class button
          rather than a menu entry: it is the one control a player may want
          in a hurry, and burying it two taps deep to satisfy a rule about
          tidiness would be the wrong trade. The donate heart is the one
          addition to that rule, same reasoning as the lobby header's own
          copy of it (components/poker-app.tsx): a single persistent icon,
          not a menu row, so it costs nothing to keep visible. */}
      <header className="game-header">
        {/* Mark only, matching the lobby header. The button already carries
            its own accessible name, so the mark stays aria-hidden here rather
            than announcing the brand a second time inside it. */}
        <button className="wordmark wordmark-mark-only" onClick={() => { tapSound(); requestLeave(onLeave); }} aria-label="Leave table">
          <span className="wordmark-mark"><StackChipsMark size={32} /></span>
        </button>
        {/* At the tight mobile-landscape tier there's no room left over the
            felt for the feed (see .table-hud's own note, 06-table.css) --
            it moves in here instead, beside the logo, into the header's
            otherwise-empty middle column. Same element, same aria-live
            region, one render site rather than two: everywhere else it
            stays down on the felt, at .table-hud-left below. */}
        {tightLandscape && (
          <ul className="table-feed game-header-feed" aria-live="polite">
            {game.log.slice(0, 3).map((entry) => (
              <li key={entry.id} className={`table-feed-${entry.kind}`}>{entry.text}</li>
            ))}
          </ul>
        )}
        {/* No pot readout here any more: the felt already carries it
            (.center-pot-amount, in .board-stack below) directly over the
            chips it counts, which is a strictly better answer to "how much
            is in the pot" than a second number in the chrome above the
            table. This header used to run three columns so MAIN POT could
            sit on the viewport's true centre; with nothing left for that
            middle column to hold, the header goes back to two (see
            05-game-header.css). */}
        <div className="game-header-actions">
          <button className="leave-button" onClick={() => { tapSound(); requestLeave(onLeave); }}>Leave table</button>
          <DonateButton gameId={game.id} />
          <Menu
            label="Open player menu"
            trigger={
              profile
                ? <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
                : <span className="app-menu-fallback"><Settings2 size={16} /></span>
            }
            items={menuItems}
          />
        </div>
      </header>


      <section className="game-content">
        <div
          className={clsx(
            "table-area",
            // Only once the room is genuinely there to replace them: this
            // class stops the DOM felt and rail painting. The canvas does
            // NOT seat its own figures the way the deleted WebGL room used
            // to, so the DOM cut-outs stay -- they are the only players at
            // this table.
            sceneReady && "scene-lit",
            sceneReady && isRacetrack && "scene-room-racetrack",
          )}
        >
          {/* The room, underneath everything. First child so it is first in
              paint order as well as lowest in z-index; the HUD over it is
              ordinary DOM and needed no z-index changes to land on top. */}
          <RacetrackScene
            seats={orderedSeats}
            slots={seatSlots}
            pot={game.pot}
            bigBlind={game.bigBlind}
            streetBets={sceneStreetBets}
            street={game.street}
            paying={showFunnel}
            winners={sceneWinners}
            handNumber={game.handNumber}
            betFlights={betFlights}
            betStyle={betStyle}
            onReady={setCanvas2DMounted}
            onLayout={onRacetrackLayout}
            foregroundHostRef={racetrackForegroundRef}
          />
          <TableLoadingSplash active={!sceneReady} />
          {/* Shown at every width on the racetrack; see
              42-racetrack-table.css's own note on why that table needs the
              corner HUD on mobile too (its local seat has no figure to fall
              back on at any width). */}
          {mySeat && (
            <LocalPlayerHud
              name={mySeat.name}
              stack={mySeat.stack}
              bigBlind={game.bigBlind}
              stackInBigBlinds={stackInBigBlinds}
              profile={profile}
              handLabel={mySeat.handLabel}
              onSendReaction={onSendReaction}
              reactionCooldown={reactionCooldown}
              activeReaction={reactions[mySeat.id]?.reactionId ?? null}
            />
          )}
          {/* The pot and the stakes, in the black space around the table
              rather than on the cloth. On the felt they had to be small
              enough not to fight the board, and at 1440x900 the blinds line
              was drawn straight across the top of the community card row.
              Out here there is room to read them.

              A sibling of .poker-table-wrap and absolutely positioned, so it
              takes part in no layout the table depends on: the wrap's size
              still comes from --table-height-cap alone, which keeps this
              geometry separate from the dealing work. */}
          <div className="table-hud">
            {/* The table talking, in the black space that was doing nothing.
                Who just folded, who raised and by how much: the activity
                drawer has always held this, two taps away, which is not
                where anyone looks mid-hand.

                Sized to be read rather than glanced at, on every viewport,
                because the per-seat status pills that used to repeat this
                are about to stop existing. See .table-feed in 06-table.css
                and its two overrides in 12-responsive.css.

                Left and right margins only, now that the pot has moved to the
                header. The middle of this band is where the top seat's head
                is; anything drawn there collides with it, which is why this
                grows downward on the left rather than making the band
                taller. */}
            {/* Grouped with the feed instead of a fourth child of .table-hud's
                space-between row, which was tuned for two or three children
                and would reflow if a bare sibling landed here. Puts the
                trigger right beside the social corner the desktop spec asks
                for, and opts back into pointer-events since .table-hud is
                click-through decoration. */}
            <div className="table-hud-left">
              {/* Moved into the header at the tight mobile-landscape tier
                  instead (game-header, above) -- see the note there. */}
              {!tightLandscape && (
                <ul className="table-feed" aria-live="polite">
                  {game.log.slice(0, 3).map((entry) => (
                    <li key={entry.id} className={`table-feed-${entry.kind}`}>{entry.text}</li>
                  ))}
                </ul>
              )}
              {game.isSeated && !isRacetrack && (
                <ReactionButton onSend={onSendReaction} disabled={reactionCooldown} />
              )}
            </div>
            {/* The result, where the eye already is. The same sentence has
                always been in the action bar, but that is the busiest strip
                on the screen and it is at the far end of it from the cards
                the hand was decided by. Keyed on the hand so it re-enters
                for each one rather than sitting through the next deal. */}
            {showFunnel && (
              <div className="hand-result" key={game.handNumber} role="status" aria-live="polite">
                {game.winners.map((winner) => (
                  <span className="hand-result-line" key={winner.seatId}>
                    <b>{winner.name}</b>
                    <span className="hand-result-amount">+{winner.amount.toLocaleString()}</span>
                    <i>{winner.hand}</i>
                  </span>
                ))}
                {/* The comparison a loss actually needs: the winner's line
                    above already says what beat you, this says what you lost
                    with. Both are on screen already (this seat's own cards,
                    the winner's revealed ones); this just states the
                    losing half in the same sentence shape as the winning
                    one, instead of leaving it to be pieced together from two
                    different corners of the felt. */}
                {myShowdownLoss && (
                  <span className="hand-result-line hand-result-mine">
                    <b>You had</b>
                    <i>{myShowdownLoss}</i>
                  </span>
                )}
              </div>
            )}
            <span
              className="blind-structure"
              title={`Small Blind ${game.smallBlind.toLocaleString()} · Big Blind ${game.bigBlind.toLocaleString()}`}
            >
              <b>SB</b> {game.smallBlind.toLocaleString()}
              <i aria-hidden="true">/</i>
              <b>BB</b> {game.bigBlind.toLocaleString()}
            </span>
          </div>
          {/* The dealer, at far centre, over the cloth rather than behind the
              rail: her art puts her hands ON the table, and painting them
              under it would take exactly that away. Behind every seat (z-index
              3, below the seats' own 4-and-up) because she is the furthest
              thing at the table, and behind the board for the same reason. */}
          {isRacetrack && racetrackLayout && (
            <>
              {/* A plain <img>, not next/image: the box is solved per frame from
                 the live camera, so there is no build-time width or height for
                 the optimiser to work from, and this is one small already-sized
                 file rather than user content needing a CDN. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="racetrack-dealer"
                src={DEALER_ART_SRC}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={dealerStyle(racetrackLayout.dealer)}
              />
              {(() => {
                const box = dealerSlotBox(racetrackLayout.dealer);
                const height = box.width * (DEALER_BOX.height / DEALER_BOX.width);
                const labelOffset = Math.max(32, height * 0.15); // Responsive offset based on dealer size
                // Clamp the label's top so it never goes above the visible stage. On tight
                // landscape mobile, the dealer's crown sits near the frame edge; the label
                // must not vanish above it.
                const topPosition = Math.max(4, box.top - labelOffset);
                return (
                  <div
                    className="dealer-label"
                    style={{
                      left: `${box.left + box.width / 2}px`,
                      top: `${topPosition}px`,
                    } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    Dealer
                  </div>
                );
              })()}
            </>
          )}
          {/* Opponent portraits used to render here, as siblings of
              `.poker-table-wrap` below. They moved to be each seat's own
              child instead (`<PlayerSeat racetrackArt=...>`); see
              `racetrackArtBySeat`'s own comment for why the isolated wrap
              made that the only place cards could ever draw behind this
              art while the nameplate stayed in front of it. */}
          <div
            className="poker-table-wrap"
            ref={tableWrapRef}
            style={{
              "--seat-width": `${seatWidthFor(tableSize, orderedSeats.length)}px`,
              /* The board and the pot, where the racetrack's camera put them.
                 Absent on every other table, where 06-table.css's own
                 percentages are correct and these fall back to them. */
              ...(isRacetrack && racetrackLayout
                ? {
                  "--board-x": `${racetrackLayout.board.x.toFixed(1)}px`,
                  "--board-y": `${racetrackLayout.board.y.toFixed(1)}px`,
                  // The real 63mm-card projection, clamped to this table's
                  // own [min, max] and then shrunk further, if it must,
                  // until the row's rendered footprint actually clears the
                  // pot at THIS frame's camera fit; see
                  // RACETRACK_BOARD_CARD_MIN/MAX_PX and board-clearance.ts.
                  "--board-card-width": `${Math.round(clampBoardCardWidth(
                    racetrackLayout.board.cardWidthPx,
                    racetrackLayout.board,
                    racetrackLayout.pot,
                    {
                      min: RACETRACK_BOARD_CARD_MIN_PX,
                      max: RACETRACK_BOARD_CARD_MAX_PX,
                      revealGapFraction: BOARD_CARD_REVEAL_GAP_FRACTION,
                      flopOverlapFraction: BOARD_CARD_FLOP_OVERLAP_FRACTION,
                    },
                  ))}px`,
                  // Mirrored into CSS so 42-racetrack-table.css's gap/margin
                  // rules read the same numbers this clamp used, instead of
                  // carrying their own hardcoded copies.
                  "--board-card-reveal-gap-fraction": BOARD_CARD_REVEAL_GAP_FRACTION,
                  "--board-card-flop-overlap-fraction": BOARD_CARD_FLOP_OVERLAP_FRACTION,
                  "--pot-x": `${racetrackLayout.pot.x.toFixed(1)}px`,
                  "--pot-y": `${racetrackLayout.pot.y.toFixed(1)}px`,
                  // The pot's projected position, as a signed delta from
                  // .board-stack's own centre (--board-y) rather than from
                  // any edge of it: `.board-stack` only ever exposes its
                  // centre by construction (`transform: translate(-50%,
                  // -50%)`), and measuring from an edge instead is what
                  // previously put the label a stack's-height too high (see
                  // 42-racetrack-table.css's own note on this). Negative
                  // here means "toward the dealer, above the board".
                  "--pot-y-delta-px": `${(racetrackLayout.pot.y - racetrackLayout.board.y).toFixed(1)}px`,
                  // How far above the pot anchor the mound itself actually
                  // reaches, so the "Pot" pill can clear its peak instead of
                  // a flat clearance that overlaps a real pile. See
                  // potMoundClearancePx above.
                  "--pot-mound-clearance-px": `${potMoundClearancePx.toFixed(1)}px`,
                }
                : {}),
            } as React.CSSProperties}
          >
            <div className="racetrack-chip-foreground" ref={racetrackForegroundRef} aria-hidden="true" />
            <div className="poker-rail">
              <div className="poker-felt">
                {/* Where the chips go, now that the number that counts them
                    lives outside the table. Three separate effects measure
                    this element's centre (chips flying in from a seat, the
                    pot funnelling out to the winners, and folded cards
                    drifting to the muck), and all three have to converge on
                    the cloth, not on a readout in the margin. Sized to the
                    box .pot-display used to occupy here (45x35 at every
                    breakpoint, because its two font sizes are fixed), so the
                    target has not moved by a pixel. */}
                {/* Empty now, and still load-bearing. The pile that used to
                    be drawn in here is a stack of meshes on the felt; what
                    this box still is, is the point three separate DOM
                    measurements agree on: folded cards drift here, every
                    hole card is dealt from here, and an e2e test asserts its
                    45x35 never moves. Removing it would drag both remaining
                    trajectories with it and nothing would visibly break. */}
                <div className="pot-anchor" ref={potRef} aria-hidden="true" />
                {/* Above the board: the only pot figure left anywhere on
                    screen now that the header doesn't print a second one,
                    directly answering "how much is that stack of chips in
                    front of me." Paired with the community cards in one
                    .board-stack column, sharing that single centred
                    coordinate, rather than the amount sitting off on its own.
                    It used to be a flat 30px beside .pot-anchor, which put
                    real distance between the number and the pile it was
                    counting on anything wider than a phone. Hidden at zero
                    rather than printing "$0" over an empty spot on the felt:
                    there is nothing standing centre-table until the first
                    street closes and bets sweep in. */}
                <div className="board-stack">
                  {centerPotAmount > 0 && (
                    <div className="center-pot-amount" aria-hidden="true">
                      <span>Pot</span>
                      <strong>${centerPotAmount.toLocaleString()}</strong>
                    </div>
                  )}
                  <div className="community-cards">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <span
                        className={clsx(
                          "community-card-shell",
                          game.community[index] && "community-card-revealed",
                          // Only ever both-or-neither: once there is a winning
                          // hand to point at, every board card is either part of
                          // it or explicitly not, so the five that won read as
                          // chosen rather than merely lit.
                          winningKeys && (isWinningCard(winningKeys, game.community[index])
                            ? "community-card-winning"
                            : "community-card-spent"),
                        )}
                        key={`${game.handNumber}-${index}`}
                        style={{
                          "--community-delay": `${index < 3 ? index * 110 : 0}ms`,
                        } as React.CSSProperties}
                      >
                        {game.community[index]
                          ? (
                            <span className="community-card-flipper">
                              <span className="community-card-backface" aria-hidden="true">
                                <PlayingCard card={null} back={myCardBack} />
                              </span>
                              <span className="community-card-face">
                                <PlayingCard card={game.community[index]} />
                              </span>
                            </span>
                          )
                          : <PlayingCard card={null} ghost />}
                      </span>
                    ))}
                  </div>
                  {/* Racetrack only: the street and the blinds, read as one
                      caption directly under the board instead of the street
                      sitting alone at a fixed felt percentage (tuned for the
                      classic ellipse, not this camera's board position) and
                      the blinds sitting in the black space above the table.
                      Replaces .street-label/.blind-structure for this room;
                      see their display:none in 42-racetrack-table.css. */}
                  {isRacetrack && (
                    <div className="board-caption" aria-hidden="true">
                      <span className="board-caption-street">{game.street}</span>
                      <span className="board-caption-blinds">
                        <b>SB</b> {game.smallBlind.toLocaleString()}
                        <i>/</i>
                        <b>BB</b> {game.bigBlind.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
                {!isRacetrack && <span className="street-label">{game.street}</span>}
              </div>
            </div>
            {dealerSeatId && (
              <div
                className={clsx(
                  "dealer-puck",
                  dealerVector && "dealer-puck-visible",
                  dealerAnimated && "dealer-puck-animated",
                )}
                style={{
                  "--puck-dx": `${dealerVector?.dx ?? 0}px`,
                  "--puck-dy": `${dealerVector?.dy ?? 0}px`,
                } as React.CSSProperties}
                aria-hidden="true"
              >
                <span>D</span>
              </div>
            )}
            {muckDrifts.map((drift) => (
              <MuckDrift
                key={drift.id}
                id={drift.id}
                seatId={drift.seatId}
                cards={drift.cards}
                isMine={drift.isMine}
                tableWrapRef={tableWrapRef}
                potRef={potRef}
                seatRefs={seatRefs}
                onDone={removeMuckDrift}
              />
            ))}
            {orderedSeats.map((seat, index) => (
              <PlayerSeat
                key={seat.id}
                seat={seat}
                // The local player leaves the ring and becomes the
                // foreground. Still a PlayerSeat, so its seat ref stays
                // registered and chip flights, the muck drift and the dealer
                // puck keep measuring the right spot.
                // Slot 0 of the ellipse is the near edge, and it has always
                // been where the local player sits; it was simply left
                // empty while they were drawn separately below the felt.
                placement={isRacetrack ? "seat-racetrack" : "seat-ring"}
                seatStyle={seatStyles[index]}
                // table-anchors.ts's ring slot 1 is the fixed "far left"
                // anchor; its nameplate sits nearest the table feed in the
                // top-left corner (see .seat-far-left, 08-seat.css).
                isFarLeftSeat={isRacetrack && seatSlots[index] === 1}
                racetrackArt={racetrackArtBySeat.get(seat.id) ?? null}
                // The ring slot, not the engine's seat position: dealing runs
                // round the table as it looks from this chair, which puts the
                // local player first. See lib/game/deal-choreography.ts.
                dealSlot={index}
                dealSeatCount={orderedSeats.length}
                dealVector={dealVectors[seat.id] ?? null}
                winningKeys={winningKeys}
                handNumber={game.handNumber}
                smallBlind={game.smallBlind}
                bigBlind={game.bigBlind}
                stackInBigBlinds={stackInBigBlinds}
                turnStartedAt={game.turnStartedAt}
                turnDeadlineAt={game.turnDeadlineAt}
                winAmount={showFunnel ? game.winners.find((winner) => winner.seatId === seat.id)?.amount : undefined}
                elementRef={(el) => { seatRefs.current[seat.id] = el; }}
                reaction={reactions[seat.id] ?? null}
              />
            ))}
          </div>
        </div>

        <div className="action-layer" ref={actionLayerRef}>
          {error && <div className="table-toast"><X size={15} /> {error}</div>}
          {!error && timeoutFlash && (
            <div className="timeout-toast"><TimerReset size={14} /> {timeoutFlash}</div>
          )}
          <ActionBar
            key={game.version}
            game={game}
            pending={pending || connectionState !== "connected"}
            onAction={onAction}
            onLeave={onLeave}
            profile={profile}
            onClaimBackstop={onClaimBackstop}
          />
        </div>
      </section>

      {connectionState !== "connected" && (
        <div className="connection-overlay" role="status" aria-live="assertive">
          <span className="waiting-dot" />
          <strong>
            {connectionState === "offline"
              ? "You’re offline — gameplay is paused"
              : "Reconnecting to the table…"}
          </strong>
          <small>Your controls will unlock after the latest server state arrives.</small>
        </div>
      )}

      {historyOpen && (
        <HandHistoryDrawer log={game.log} handNumber={game.handNumber} onClose={closeHistory} />
      )}

      {/* No onJoinedTable: this player is already at a table, so the drawer
          offers no Join. Opened from here it is the *sending* surface: each
          friend row gains an Invite for this room, and the current seats
          surface an "Add friend" row for whoever else is sitting here. */}
      {friendsOpen && (
        <FriendsDrawer
          inviteGameId={game.isPrivate && game.roomCode ? game.id : undefined}
          tableSeats={game.seats}
          onClose={() => setFriendsOpen(false)}
        />
      )}

      {pendingLeave && (
        <LeaveGameConfirmModal
          body={
            game.tournament
              // There's no cashing out mid-tournament (see forfeitTournamentSeat
              // in engine.ts) -- leaving here forfeits the whole seat, not just
              // what's already in this hand's pot.
              ? `Leaving now forfeits your seat${
                game.tournament.format === "heads_up" ? " and the match" : ""
              } — there's no cashing out mid-tournament.`
              : `You have ${committedThisHand.toLocaleString()} chips already in this hand's pot. Leaving now cashes out your remaining stack, but those chips stay in the pot — you won't get them back.`
          }
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => {
            const action = pendingLeave;
            setPendingLeave(null);
            action();
          }}
        />
      )}
    </main>
  );
}

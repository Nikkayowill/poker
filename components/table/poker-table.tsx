"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  Box, Coins, Copy, DoorOpen, History, Layers, LogIn, LogOut, Settings2, Sparkles, TimerReset, Trophy, UserPlus, Volume2, VolumeX, X,
} from "lucide-react";
import type { Card, GameSnapshot, PlayerAction } from "@/lib/game/types";
import { betStyleLabel, type BetAnimationStyle } from "@/lib/scene/bet-style";
import {
  resolveTableRenderer,
  tableRendererLabel,
  type TableRenderer,
} from "@/lib/scene/table-renderer";
import { useWebglSupport } from "./use-webgl-support";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  radiiForTable,
  seatGeometry,
  seatZ,
} from "@/lib/game/table-geometry";
import { Menu, type MenuItem } from "@/components/nav/menu";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { FriendsDrawer } from "@/components/social/friends-drawer";
import { ActionBar } from "./action-bar";
import { MuckDrift } from "./table-effects";
import { HandHistoryDrawer } from "./hand-history-drawer";
import { RebuyCheckout } from "./rebuy-checkout";
import { PlayerSeat } from "./player-seat";
import { PlayingCard } from "./playing-card";
import { isWinningCard, winningCardKeys } from "@/lib/game/winning-cards";
import { MAX_MISSED_TURNS } from "@/lib/game/engine";

/**
 * A seat's width, as a fraction of the table's width and of its height.
 * Everything about a seat is measured from this -- the figure, where its cards
 * sit at the hands, how far a bet travels -- so the whole ring scales with the
 * table instead of each piece needing its own breakpoint.
 *
 * Both bounds are needed. A figure is square, so on a landscape phone, where
 * the table is squeezed to 740x247, sizing off width alone gave each seat 64%
 * of the table's height and the ring closed over the board.
 */
/** How the table reports its live connection, shown in the header. */
export type ConnectionState = "connected" | "reconnecting" | "offline";

/* Trimmed from 0.17/0.3. A figure that was 30% of the table's height could not
   ring the table without lying across it -- half of every player ended up on
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
 * The WebGL room, split out of the main bundle.
 *
 * `three` is around 350KB gzipped -- comfortably the largest thing this app
 * ships -- and none of it is needed until somebody actually sits at a table.
 * Imported statically it lands in the same chunk as the lobby, the store and
 * the landing page, all of which would then pay for a renderer they never
 * construct. This is the difference between a mobile PWA that opens quickly
 * and one that does not.
 *
 * `ssr: false` because the whole module is a canvas and a GPU context: there
 * is nothing for the server to render, and importing `three` into the server
 * bundle would slow every table request down for output that is thrown away.
 *
 * No loading placeholder, deliberately. The DOM table is complete on its own
 * -- the felt and rail keep painting until `onReady` says the room exists --
 * so the scene arriving a moment later is a table that gets lit, not a table
 * with a hole in it.
 */
const TableScene = dynamic(
  () => import("./scene/table-scene").then((module) => module.TableScene),
  { ssr: false },
);

/**
 * The WebGL room, split out the same way and for the same reasons — more so.
 * `three` plus the R3F/drei surface is by a distance the largest thing this
 * app can ship, and a player who never chooses this renderer must never
 * download it. Kept as a second dynamic import rather than a branch inside
 * one module so that stays true: a static import here would put three.js in
 * the table chunk for everybody.
 */
const TableScene3D = dynamic(
  () => import("./scene3d/table-scene-3d").then((module) => module.TableScene3D),
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
 * the same clearance at any count -- and leaves six-max, which is what ships
 * today, at exactly the size it has always been.
 */
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
  onCustomize,
  connectionState,
  soundEnabled,
  onToggleSound,
  betStyle,
  onCycleBetStyle,
  tableRenderer,
  onCycleTableRenderer,
  onSignIn,
  onSignOut,
}: {
  game: GameSnapshot;
  pending: boolean;
  error: string | null;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  onLeaveSeat: () => void;
  profile: PlayerProfile | null;
  onCustomize: () => void;
  connectionState: ConnectionState;
  soundEnabled: boolean;
  onToggleSound: () => void;
  betStyle: BetAnimationStyle;
  onCycleBetStyle: () => void;
  tableRenderer: TableRenderer;
  onCycleTableRenderer: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  // False on the server and on the first client paint, so a player who prefers
  // the 3D room sees the classic table for one frame rather than a canvas that
  // might not work. See use-webgl-support.ts for why this is not an effect.
  const webglAvailable = useWebglSupport();
  const activeRenderer = resolveTableRenderer(tableRenderer, webglAvailable);
  // Owned here rather than in ActionBar because ActionBar is keyed on
  // game.version: a bump would otherwise unmount an open checkout and buy a
  // second Stripe session when it came back.
  const [showCheckout, setShowCheckout] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);
  // A seat is sized off the table, not the window. The table is capped by the
  // height left over as well as by width, so a short landscape phone can shrink
  // it to a third of its desktop width while the viewport is still wide --
  // seats measured against the viewport stayed huge and buried the board.
  const [tableSize, setTableSize] = useState({ width: 850, height: 494 });
  // --foreground-drop is gone with the foreground seat that consumed it. It
  // existed to hang the local player a measured distance below the felt; on
  // the ring they are placed by the same ellipse as everyone else, and the
  // only thing still measured here is the table's own box.
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      setTableSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // No clock state here any more, deliberately.
  //
  // There used to be a `clockNow` that a 250ms interval advanced for the whole
  // of every turn, purely so the action bar could be handed a remaining
  // fraction. It sat at the root of the table, so each of those ticks
  // re-rendered every seat, every card and every plate -- four times a second,
  // all turn, to move one bar. Both fuses now take the server's two timestamps
  // and animate in CSS (components/table/use-fuse.ts), which leaves this
  // component re-rendering only when the game state actually changes.
  const mySeatIndex = game.seats.findIndex((seat) => seat.isMine);
  // The deck the board is dealt from, drawn as your own back.
  //
  // Every other face-down card at this table belongs to a seat and carries
  // that seat's back. The board belongs to the room, so it needs an answer of
  // its own -- and yours is the right one, because it is otherwise the single
  // thing a buyer never gets to look at. Your hole cards are face up to you;
  // your back is shown to everyone except you. Half a second of it on each
  // board card is the only time you see what you paid for.
  const myCardBack = mySeatIndex >= 0 ? game.seats[mySeatIndex].cardBackCosmetic : undefined;
  const orderedSeats = mySeatIndex <= 0
    ? game.seats
    : game.seats.map((_, index) => game.seats[(mySeatIndex + index) % game.seats.length]);
  const potRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Record<string, HTMLElement | null>>({});
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const showFunnel = game.status === "complete" && game.winners.length > 0;
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
    const anchorEl = potRef.current;
    const seatEl = dealerSeatId ? seatRefs.current[dealerSeatId] : null;
    if (!anchorEl || !seatEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const seatRect = seatEl.getBoundingClientRect();
    setDealerVector({
      dx: seatRect.left + seatRect.width / 2 - (anchorRect.left + anchorRect.width / 2),
      dy: seatRect.top + seatRect.height / 2 - (anchorRect.top + anchorRect.height / 2),
    });
    if (!dealerMeasuredOnceRef.current) {
      dealerMeasuredOnceRef.current = true;
      // Skip the glide transition for this first placement (mount, refresh,
      // reconnect) -- only actual dealer-seat changes between hands should
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
  // at all -- they are in the foreground at a distance that is itself
  // measured (foregroundDrop). One measurement covers both, at every
  // breakpoint, with no arithmetic to keep in step with the stylesheets.
  //
  // The old value was a flat --deal-y: 120px on .seat-ring, so every card
  // rose from directly beneath its own seat, and the local player -- whose
  // .seat-first-person never declared the variables at all -- got an
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
  // authority -- the canvas room fits its painted table inside this ring
  // rather than projecting a competing one back onto it.
  const ringGeometry = useMemo(
    () => orderedSeats.map((_, index) => {
      const geometry = seatGeometry(index, orderedSeats.length, radiiForTable(tableSize));
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
        // multiplies -- bets travel inward, the turn timer outward -- which
        // keeps the per-breakpoint distances alongside every other breakpoint
        // rule rather than stranded in here.
        "--seat-dx": geometry.towardPot.x.toFixed(3),
        "--seat-dy": geometry.towardPot.y.toFixed(3),
      } as React.CSSProperties;
    }),
    // Depends on the measured box rather than the window: the same viewport
    // can hold a wide plate or a tall one depending on how much room the
    // header and action bar left behind, and only the box knows which.
    [orderedSeats, tableSize],
  );

  const seatOrderKey = orderedSeats.map((seat) => seat.id).join(",");
  // Both vectors answer the same question -- where is this seat, relative to
  // the middle of the table -- so they are measured together and on exactly
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
  // blind still does. A null baseline -- true on mount and forced on any
  // disconnect -- skips flight generation entirely for that one snapshot,
  // so neither initial hydration nor a reconnect ever replays history.
  const streetBetsRef = useRef<{ handNumber: number; street: string; bets: Record<string, number> } | null>(null);
  const [chipFlights, setChipFlights] = useState<Array<{ id: string; seatId: string; amount: number }>>([]);
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
      const arrivals = game.seats
        .filter((seat) => seat.streetBet > (baseline[seat.id] ?? 0))
        .map((seat) => ({
          id: `${game.handNumber}-${game.street}-${seat.id}-${seat.streetBet}`,
          seatId: seat.id,
          // The spray is this number as chips: what this seat just put in,
          // not its whole street -- a raise to 200 from a seat that already
          // had 50 committed flies the 150, exactly as a dealer cuts it out.
          amount: seat.streetBet - (baseline[seat.id] ?? 0),
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
   * growing -- `TableScene` dedupes by id, so clearing the whole list at once
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
   * the DOM felt and rail keep painting themselves -- see `.scene-lit` in
   * app/styles/99-scene.css. Assuming success would leave a device without
   * a working canvas looking at an unpainted table.
   */
  const [sceneReady, setSceneReady] = useState(false);

  // Ring slots, not engine seat positions. The scene rings its table from the
  // local player's chair exactly as the DOM does, so a bet has to be handed
  // over as "slot 2" rather than "seat abc" or it flies in from the wrong
  // side of the table for everyone who is not in seat 1.
  const slotOf = useMemo(() => {
    const slots = new Map<string, number>();
    orderedSeats.forEach((seat, index) => slots.set(seat.id, index));
    return slots;
  }, [orderedSeats]);
  const betFlights = useMemo(
    () => chipFlights
      .map((flight) => ({ id: flight.id, slot: slotOf.get(flight.seatId) ?? -1, amount: flight.amount }))
      .filter((flight) => flight.slot >= 0),
    [chipFlights, slotOf],
  );
  // Standing street bets by ring slot, for the scene: what each seat has
  // committed this street rests in front of them as chips until the street
  // closes. Slots, not seat ids, for the same reason betFlights uses them.
  const sceneStreetBets = useMemo(
    () => orderedSeats
      .map((seat, slot) => ({ slot, amount: seat.streetBet }))
      .filter((bet) => bet.amount > 0),
    [orderedSeats],
  );
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

  const [roomCodeCopied, setRoomCodeCopied] = useState(false);
  const copyRoomCode = useCallback(async () => {
    if (!game.roomCode) return;
    try {
      await navigator.clipboard.writeText(game.roomCode);
      setRoomCodeCopied(true);
      window.setTimeout(() => setRoomCodeCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by policy; the code is still readable
      // in the menu, so there is nothing useful to recover here.
    }
  }, [game.roomCode]);

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
      // Hidden entirely where WebGL is unavailable rather than shown
      // disabled: an option that cannot do anything on this device is worse
      // than no option, and the same menu offers nothing to explain it. The
      // preference itself is untouched, so a player who chose the 3D room on
      // one device still gets it on another that can render it.
      ...(webglAvailable
        ? [
            {
              kind: "action" as const,
              label: tableRendererLabel(activeRenderer),
              onSelect: onCycleTableRenderer,
              icon: <Box size={15} />,
            },
          ]
        : []),
      {
        kind: "action",
        label: "Hand history",
        onSelect: () => setHistoryOpen(true),
        icon: <History size={15} />,
      },
    ];
    if (game.isPrivate && game.roomCode) {
      items.push({
        kind: "action",
        label: roomCodeCopied ? "Room code copied" : `Room code · ${game.roomCode}`,
        onSelect: () => void copyRoomCode(),
        icon: <Copy size={15} />,
      });
      // Invites are private-table-only because table_invites.room_code is not
      // null and a public table has no code -- a schema fact, not a policy.
      // Seated, because the route enforces exactly that and an entry that
      // always 403s is worse than no entry. Registered, because an invite is
      // addressed to a profile id and a guest's dies with their cookie.
      if (game.isSeated && profile?.isRegistered) {
        items.push({
          kind: "action",
          label: "Invite a friend",
          onSelect: () => setFriendsOpen(true),
          icon: <UserPlus size={15} />,
        });
      }
    }
    items.push(
      { kind: "separator" },
      { kind: "link", label: "Collection", href: "/collection", icon: <Layers size={15} /> },
      { kind: "link", label: "Buy Gold", href: `/store?table=${game.id}`, icon: <Coins size={15} /> },
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
        onSelect: onLeaveSeat,
        icon: <DoorOpen size={15} />,
        tone: "danger",
      });
    }
    return items;
  }, [
    soundEnabled, onToggleSound, betStyle, onCycleBetStyle,
    activeRenderer, onCycleTableRenderer, webglAvailable, game.isPrivate, game.roomCode,
    game.id, game.isSeated, roomCodeCopied, copyRoomCode, profile, onCustomize, onSignIn,
    onSignOut, onLeaveSeat,
  ]);
  return (
    <main className="game-shell">
      {/* Gameplay only. The spec puts three things in the table HUD -- logo,
          Leave Table, avatar -- so everything that is not one of those moved
          into the avatar's menu. Leave Table stays a first-class button
          rather than a menu entry: it is the one control a player may want
          in a hurry, and burying it two taps deep to satisfy a rule about
          tidiness would be the wrong trade. */}
      <header className="game-header">
        {/* Mark only, matching the lobby header. The button already carries
            its own accessible name, so the mark stays aria-hidden here rather
            than announcing the brand a second time inside it. */}
        <button className="wordmark wordmark-mark-only" onClick={onLeave} aria-label="Leave table">
          <span className="wordmark-mark"><StackChipsMark size={32} /></span>
        </button>
        {/* The pot, in the one strip of the screen no seat can ever reach.
            It spent its last two milestones in .table-hud, pinned to the top
            of .table-area -- which was correct while there were 70 clear
            pixels there. The Slot 0 refactor spent most of them on a bigger
            table, and the ring's top seat now overhangs the felt far enough
            up that the pot was drawn across its head: 20px of overlap at
            1440x900, 10px on a 390px phone, measured. The header is chrome,
            laid out above .game-content entirely, so nothing on the table can
            grow into it no matter what the geometry does next. It also sits
            on the same centre line as the pot on the cloth, directly above
            the chips it is counting. */}
        <div className={clsx("pot-display", showFunnel && "pot-display-paid")}>
          <span>MAIN POT</span>
          <strong><span className="chip-stack-icon" />{game.pot.toLocaleString()}</strong>
        </div>
        <div className="game-header-actions">
          <button className="leave-button" onClick={onLeave}>Leave table</button>
          <Menu
            label="Open player menu"
            trigger={
              profile
                ? <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />
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
            // class stops the DOM felt and rail painting.
            sceneReady && "scene-lit",
            // The 3D room seats its own figures in its own chairs, so the DOM
            // cut-outs would be a second set of players at the same table --
            // the mistake the Blackjack stage made with Loki and Finn. Gated
            // on sceneReady too: if the room never arrives, the cut-outs are
            // the only players there are.
            sceneReady && activeRenderer === "webgl_3d" && "scene-room-3d",
          )}
        >
          {/* The room, underneath everything. First child so it is first in
              paint order as well as lowest in z-index -- the HUD over it is
              ordinary DOM and needed no z-index changes to land on top. */}
          {activeRenderer === "webgl_3d" ? (
            <TableScene3D game={game} onReady={setSceneReady} />
          ) : (
            <TableScene
              seats={orderedSeats}
              pot={game.pot}
              bigBlind={game.bigBlind}
              streetBets={sceneStreetBets}
              street={game.street}
              paying={showFunnel}
              winners={sceneWinners}
              handNumber={game.handNumber}
              betFlights={betFlights}
              betStyle={betStyle}
              onReady={setSceneReady}
            />
          )}
          {/* The pot and the stakes, in the black space around the table
              rather than on the cloth. On the felt they had to be small
              enough not to fight the board, and at 1440x900 the blinds line
              was drawn straight across the top of the community card row.
              Out here there is room to read them.

              A sibling of .poker-table-wrap and absolutely positioned, so it
              takes part in no layout the table depends on: the wrap's size
              still comes from --table-height-cap alone, which is what keeps
              this milestone's geometry separate from the dealing work. */}
          <div className="table-hud">
            {/* The table talking, in the black space that was doing nothing.
                Who just folded, who raised and by how much -- the activity
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
            <ul className="table-feed" aria-live="polite">
              {game.log.slice(0, 3).map((entry) => (
                <li key={entry.id} className={`table-feed-${entry.kind}`}>{entry.text}</li>
              ))}
            </ul>
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
          <div
            className="poker-table-wrap"
            ref={tableWrapRef}
            style={{ "--seat-width": `${seatWidthFor(tableSize, orderedSeats.length)}px` } as React.CSSProperties}
          >
            <div className="poker-rail">
              <div className="poker-felt">
                {/* Where the chips go, now that the number that counts them
                    lives outside the table. Three separate effects measure
                    this element's centre -- chips flying in from a seat, the
                    pot funnelling out to the winners, and folded cards
                    drifting to the muck -- and all three have to converge on
                    the cloth, not on a readout in the margin. Sized to the
                    box .pot-display used to occupy here (45x35 at every
                    breakpoint, because its two font sizes are fixed), so the
                    target has not moved by a pixel. */}
                {/* Empty now, and still load-bearing. The pile that used to
                    be drawn in here is a stack of meshes on the felt; what
                    this box still is, is the point three separate DOM
                    measurements agree on -- folded cards drift here, every
                    hole card is dealt from here, and an e2e test asserts its
                    45x35 never moves. Removing it would drag both remaining
                    trajectories with it and nothing would visibly break. */}
                <div className="pot-anchor" ref={potRef} aria-hidden="true" />
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
                <span className="street-label">{game.street}</span>
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
                // been where the local player sits -- it was simply left
                // empty while they were drawn separately below the felt.
                placement="seat-ring"
                seatStyle={ringGeometry[index]}
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
                turnStartedAt={game.turnStartedAt}
                turnDeadlineAt={game.turnDeadlineAt}
                winAmount={showFunnel ? game.winners.find((winner) => winner.seatId === seat.id)?.amount : undefined}
                elementRef={(el) => { seatRefs.current[seat.id] = el; }}
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
            onOpenCheckout={() => setShowCheckout(true)}
          />
        </div>
      </section>

      {/* Deliberately outside the `key={game.version}` subtree above.
          Mounting RebuyCheckout posts for a Stripe Checkout Session, so a
          remount is a second purchase -- and the key changes on every table
          version, which is every action any player takes. */}
      {showCheckout && (
        <RebuyCheckout gameId={game.id} onClose={() => setShowCheckout(false)} />
      )}

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
          offers no Join. Opened from here it is the *sending* surface -- each
          friend row gains an Invite for this room. */}
      {friendsOpen && (
        <FriendsDrawer inviteGameId={game.id} onClose={() => setFriendsOpen(false)} />
      )}
    </main>
  );
}

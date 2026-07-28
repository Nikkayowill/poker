"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { History, TimerReset, Volume2, VolumeX, X } from "lucide-react";
import type { Card, GameSnapshot, PlayerAction } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  atmosphere,
  radiiForWidth,
  seatGeometry,
  seatZ,
} from "@/lib/game/table-geometry";
import { AuthButton } from "@/components/profile/auth-button";
import { GoldBadge } from "@/components/profile/gold-badge";
import { ProfileTrigger } from "@/components/profile/profile-avatar";
import { ActionBar } from "./action-bar";
import { ChipFlight, MuckDrift, PotFunnel } from "./table-effects";
import { HandHistoryDrawer } from "./hand-history-drawer";
import { PlayerSeat } from "./player-seat";
import { PlayingCard } from "./playing-card";
import { RoomCodeChip } from "./room-code-chip";

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

export const SEAT_WIDTH_RATIO = 0.17;
export const SEAT_HEIGHT_RATIO = 0.3;

export function seatWidthFor(table: { width: number; height: number }): number {
  return Math.round(Math.min(table.width * SEAT_WIDTH_RATIO, table.height * SEAT_HEIGHT_RATIO));
}

export function PokerTable({
  game,
  persistence,
  pending,
  error,
  onAction,
  onLeave,
  onLeaveSeat,
  profile,
  onCustomize,
  onProfileChange,
  connectionState,
  soundEnabled,
  onToggleSound,
  onPurchaseRebuy,
  onSignIn,
  onSignOut,
}: {
  game: GameSnapshot;
  persistence: string;
  pending: boolean;
  error: string | null;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  onLeaveSeat: () => void;
  profile: PlayerProfile | null;
  onCustomize: () => void;
  onProfileChange: (profile: PlayerProfile) => void;
  connectionState: ConnectionState;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onPurchaseRebuy: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showOrientationHint, setShowOrientationHint] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);
  // The ring's horizontal radius depends on how much width there is to
  // spend, so the geometry has to recompute when the window changes.
  const [viewportWidth, setViewportWidth] = useState(1280);
  useEffect(() => {
    const measure = () => setViewportWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // A seat is sized off the table, not the window. The table is capped by the
  // height left over as well as by width, so a short landscape phone can shrink
  // it to a third of its desktop width while the viewport is still wide --
  // seats measured against the viewport stayed huge and buried the board.
  const [tableSize, setTableSize] = useState({ width: 850, height: 494 });
  // How far the foreground player hangs below the felt.
  //
  // This cannot be a constant. The gap between the bottom of the table and the
  // top of the action bar is not proportional to anything: the table is capped
  // by width on a desktop and by leftover height on a short one, so the same
  // overhang that looks right on a desktop (118px of room) slides your own
  // nameplate under the buttons on a tablet (53px). Measured, it is right
  // everywhere and needs no breakpoint.
  const [foregroundDrop, setForegroundDrop] = useState(44);
  const actionLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    const bar = actionLayerRef.current;
    if (!wrap || !bar) return;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      setTableSize({ width: rect.width, height: rect.height });
      const barTop = bar.getBoundingClientRect().top;
      setForegroundDrop(Math.max(0, Math.round(barTop - rect.bottom - 6)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const portraitPhone = window.matchMedia("(max-width: 600px) and (orientation: portrait)");
    const updateHint = () => setShowOrientationHint(portraitPhone.matches);
    updateHint();
    portraitPhone.addEventListener("change", updateHint);
    const timer = window.setTimeout(() => setShowOrientationHint(false), 6500);
    return () => {
      portraitPhone.removeEventListener("change", updateHint);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!game.turnDeadlineAt || game.currentPlayer === null) return;
    const initialTick = window.setTimeout(() => setClockNow(Date.now()), 0);
    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(interval);
    };
  }, [game.turnDeadlineAt, game.currentPlayer]);
  const deadline = Date.parse(game.turnDeadlineAt ?? "");
  const startedAt = Date.parse(game.turnStartedAt ?? "");
  const secondsRemaining = Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - clockNow) / 1000))
    : 0;
  const turnDurationMs = Number.isFinite(deadline) && Number.isFinite(startedAt) ? deadline - startedAt : 0;
  const remainingFraction = turnDurationMs > 0
    ? Math.max(0, Math.min(1, (deadline - clockNow) / turnDurationMs))
    : 0;
  const mySeatIndex = game.seats.findIndex((seat) => seat.isMine);
  const orderedSeats = mySeatIndex <= 0
    ? game.seats
    : game.seats.map((_, index) => game.seats[(mySeatIndex + index) % game.seats.length]);
  const potRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Record<string, HTMLElement | null>>({});
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const showFunnel = game.status === "complete" && game.winners.length > 0;

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
  // Opponents ring the table on a projected ellipse. Slot 0 is the near edge
  // where the local player sits; they are drawn in the foreground instead, so
  // the ring geometry for slot 0 is simply unused.
  const ringGeometry = useMemo(
    () => orderedSeats.map((_, index) => {
      const geometry = seatGeometry(index, orderedSeats.length, radiiForWidth(viewportWidth));
      const haze = atmosphere(geometry.depth);
      return {
        left: `${geometry.x}%`,
        top: `${geometry.y}%`,
        "--seat-depth": geometry.scale,
        "--seat-haze": `brightness(${haze.brightness.toFixed(3)}) saturate(${haze.saturate.toFixed(3)}) blur(${haze.blur.toFixed(2)}px)`,
        // 0 at the far rail, 1 nearest. Everything that should fall off with
        // distance but is not the figure itself derives from this.
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
    [orderedSeats, viewportWidth],
  );

  // Your own portrait, sized off the one geometric fact that does apply to a
  // player sitting at the camera: it has to out-scale the nearest seat on the
  // ring. Deliberately not --seat-depth, which scales the whole seat box --
  // your cards are already sized by hand and must not move.
  const firstPersonStyle = useMemo(
    () => ({ "--seat-z": 5 }) as React.CSSProperties,
    [],
  );

  const seatOrderKey = orderedSeats.map((seat) => seat.id).join(",");
  useEffect(() => {
    measureDealer();
  }, [measureDealer, seatOrderKey, historyOpen]);
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => measureDealer());
    observer.observe(wrap);
    window.addEventListener("orientationchange", measureDealer);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", measureDealer);
    };
  }, [measureDealer]);

  // Chips fly from a seat to the pot only for an authoritative *increase* in
  // that seat's committed-this-street amount versus the last snapshot on the
  // same hand/street. Comparing against an empty baseline whenever the hand
  // or street changes (rather than the stale prior-street value) means a
  // street reset never reads as a contribution, while a freshly posted
  // blind still does. A null baseline -- true on mount and forced on any
  // disconnect -- skips flight generation entirely for that one snapshot,
  // so neither initial hydration nor a reconnect ever replays history.
  const streetBetsRef = useRef<{ handNumber: number; street: string; bets: Record<string, number> } | null>(null);
  const [chipFlights, setChipFlights] = useState<Array<{ id: string; seatId: string }>>([]);
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
        .map((seat) => ({ id: `${game.handNumber}-${game.street}-${seat.id}-${seat.streetBet}`, seatId: seat.id }));
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
  const removeChipFlight = useCallback((id: string) => {
    setChipFlights((current) => current.filter((flight) => flight.id !== id));
  }, []);

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
      setTimeoutFlash(
        mySeat.lastAction === "Timed out · Check"
          ? "Time's up — you checked automatically."
          : "Time's up — you folded automatically.",
      );
    }
  }
  useEffect(() => {
    if (!timeoutFlash) return;
    const timer = window.setTimeout(() => setTimeoutFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [timeoutFlash]);
  return (
    <main className="game-shell">
      <header className="game-header">
        <button className="wordmark" onClick={onLeave} aria-label="Leave table">
          <span className="mark">R</span>
          <span>River Room<small>NO LIMIT HOLD’EM</small></span>
        </button>
        <div className="table-meta">
          <span>
            <span className={clsx(
              "live-dot",
              persistence === "memory" && "demo-dot",
              connectionState !== "connected" && "connection-dot-warning",
            )} />
            {connectionState === "offline"
              ? "Offline"
              : connectionState === "reconnecting"
                ? "Reconnecting"
                : persistence === "supabase" ? "Realtime" : "Demo table"}
          </span>
          {game.isPrivate && game.roomCode
            ? <RoomCodeChip code={game.roomCode} />
            : <span>Table {game.id.slice(0, 6).toUpperCase()}</span>}
          <span>Blinds {game.smallBlind}/{game.bigBlind}</span>
        </div>
        <div className="game-header-actions">
          {profile && <GoldBadge profile={profile} onClaimed={onProfileChange} />}
          <AuthButton profile={profile} onSignIn={onSignIn} onSignOut={onSignOut} />
          {profile && <ProfileTrigger profile={profile} onClick={onCustomize} compact />}
          <button
            ref={historyButtonRef}
            className="history-toggle"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open hand history"
            aria-haspopup="dialog"
          >
            <History size={15} /> <span>History</span>
          </button>
          <button
            type="button"
            className="sound-toggle"
            onClick={onToggleSound}
            aria-label={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
            title={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          {game.isSeated && (
            <button className="give-up-seat-button" onClick={onLeaveSeat} title="Give up your seat; a bot takes over">
              Give up seat
            </button>
          )}
          <button className="leave-button" onClick={onLeave}>Leave table</button>
        </div>
      </header>

      {showOrientationHint && (
        <button
          type="button"
          className="orientation-hint"
          onClick={() => setShowOrientationHint(false)}
          aria-label="Dismiss landscape orientation suggestion"
        >
          <span aria-hidden="true">↻</span>
          Rotate for a wider table
          <small>Portrait still works</small>
        </button>
      )}

      <section className="game-content">
        <div className="table-area">
          <div
            className="poker-table-wrap"
            ref={tableWrapRef}
            style={{
              "--seat-width": `${seatWidthFor(tableSize)}px`,
              "--foreground-drop": `${foregroundDrop}px`,
            } as React.CSSProperties}
          >
            <div className="poker-rail">
              <div className="poker-felt">
                <div className="felt-texture" />
                <div className={clsx("pot-display", showFunnel && "pot-display-paid")} ref={potRef}>
                  <span>MAIN POT</span>
                  <strong><span className="chip-stack-icon" />{game.pot.toLocaleString()}</strong>
                </div>
                {showFunnel && <PotFunnel key={game.handNumber} winners={game.winners} potRef={potRef} seatRefs={seatRefs} />}
                <div className="community-cards">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <span
                      className={clsx("community-card-shell", game.community[index] && "community-card-revealed")}
                      key={`${game.handNumber}-${index}`}
                      style={{
                        "--community-delay": `${index < 3 ? index * 110 : 0}ms`,
                      } as React.CSSProperties}
                    >
                      {game.community[index]
                        ? (
                          <span className="community-card-flipper">
                            <span className="community-card-backface" aria-hidden="true">
                              <PlayingCard card={null} />
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
            {chipFlights.map((flight) => (
              <ChipFlight
                key={flight.id}
                id={flight.id}
                seatId={flight.seatId}
                tableWrapRef={tableWrapRef}
                potRef={potRef}
                seatRefs={seatRefs}
                onDone={removeChipFlight}
              />
            ))}
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
                placement={seat.isMine ? "seat-first-person" : "seat-ring"}
                seatStyle={seat.isMine ? firstPersonStyle : ringGeometry[index]}
                handNumber={game.handNumber}
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
            secondsRemaining={secondsRemaining}
            remainingFraction={remainingFraction}
            profile={profile}
            onPurchaseRebuy={onPurchaseRebuy}
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
    </main>
  );
}

"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, FoldVertical, RotateCcw, TimerReset } from "lucide-react";
import type { GameSnapshot, PlayerAction } from "@/lib/game/types";
import { TIER_CONFIG } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import { BuyInModal } from "@/components/lobby/buy-in-modal";

export function TurnProgressBar({ remainingFraction }: { remainingFraction: number }) {
  return (
    <div className="turn-progress-track">
      <div
        className={clsx("turn-progress-fill", remainingFraction <= 0.25 && "progress-critical")}
        style={{ transform: `scaleX(${remainingFraction})` }}
      />
    </div>
  );
}

export function ActionBar({
  game,
  pending,
  onAction,
  onLeave,
  secondsRemaining,
  remainingFraction,
  profile,
  onPurchaseRebuy,
}: {
  game: GameSnapshot;
  pending: boolean;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  secondsRemaining: number;
  remainingFraction: number;
  profile: PlayerProfile | null;
  onPurchaseRebuy: () => void;
}) {
  const legal = game.legalActions;
  const currentSeat = game.seats.find((seat) => seat.isCurrent);
  const mySeat = game.seats.find((seat) => seat.isMine);
  const [showRebuyModal, setShowRebuyModal] = useState(false);
  const [raiseTo, setRaiseTo] = useState(legal?.minRaiseTo ?? 0);
  const potPreset = (fraction: number) => {
    if (!legal) return 0;
    const target = Math.round(game.pot * fraction);
    return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, target));
  };
  // Purely a visual beat -- the real action always dispatches synchronously,
  // right here, on click. This only guarantees the pressed look is visible
  // for a minimum stretch so a fast round trip doesn't make the button feel
  // like it never registered the tap.
  const [pressedAction, setPressedAction] = useState<PlayerAction["type"] | null>(null);
  const dispatch = (action: PlayerAction) => {
    onAction(action);
    setPressedAction(action.type);
    window.setTimeout(() => setPressedAction((current) => (current === action.type ? null : current)), 150);
  };

  if (game.status === "complete") {
    if (!game.isSeated) {
      return (
        <div className="action-bar hand-complete busted-player">
          <div>
            <span className="action-kicker">Seat closed</span>
            <strong>You’re out of chips. Start a fresh table when you’re ready.</strong>
          </div>
          <button className="primary-action" onClick={onLeave}>
            Return to lobby
          </button>
        </div>
      );
    }
    if (mySeat?.stack === 0) {
      return (
        <div className="action-bar hand-complete busted-player">
          <div>
            <span className="action-kicker">Stack exhausted</span>
            <strong>You’re out of chips. Rebuy to keep playing, or close your seat.</strong>
          </div>
          <div className="busted-actions">
            <button
              className="secondary-action"
              disabled={pending}
              onClick={() => onAction({ type: "next-hand" })}
            >
              Close seat
            </button>
            <button
              className="primary-action"
              disabled={pending}
              onClick={() => setShowRebuyModal(true)}
            >
              Rebuy
            </button>
          </div>
          {showRebuyModal && (
            <BuyInModal
              title="Rebuy"
              description={`Buy back in at this table's ${TIER_CONFIG[game.tier].label} stakes.`}
              goldBalance={profile?.goldBalance ?? 0}
              unlimitedGold={profile?.unlimitedGold ?? false}
              lockedTier={game.tier}
              confirmLabel="Rebuy"
              pending={pending}
              onClose={() => setShowRebuyModal(false)}
              onBuyGold={onPurchaseRebuy}
              onConfirm={(_tier, buyIn) => onAction({ type: "rebuy", amount: buyIn })}
            />
          )}
        </div>
      );
    }
    return (
      <div className="action-bar hand-complete">
        <div>
          <span className="action-kicker">Hand complete</span>
          <strong>{game.message}</strong>
        </div>
        <button className="primary-action" disabled={pending} onClick={() => onAction({ type: "next-hand" })}>
          <RotateCcw size={16} /> Deal next hand
        </button>
      </div>
    );
  }

  if (!legal) {
    return (
      <div className="action-bar waiting-bar">
        <span className="waiting-dot" />
        <span className="waiting-copy">
          <strong>{currentSeat ? `${currentSeat.name} is thinking` : "Waiting for the next hand"}</strong>
          <small>{currentSeat?.isHuman ? "Player decision" : "AI decision is being made server-side"}</small>
        </span>
        {currentSeat && <span className="waiting-countdown">{secondsRemaining}s</span>}
        {currentSeat && <TurnProgressBar remainingFraction={remainingFraction} />}
      </div>
    );
  }

  return (
    <div className="action-bar action-bar-your-turn">
      <TurnProgressBar remainingFraction={remainingFraction} />
      <div className="turn-tools">
        <div className={clsx("action-countdown", secondsRemaining <= 5 && "countdown-critical")}>
          <span>Your turn</span>
          <strong>{secondsRemaining}</strong>
          <small>seconds</small>
        </div>
        <button
          type="button"
          className="time-card-button"
          disabled={pending || !mySeat || mySeat.timeCardsRemaining <= 0}
          onClick={() => onAction({ type: "use-time-card" })}
          title="Add 20 seconds to this turn"
        >
          <TimerReset size={16} />
          <span>+20s</span>
          <span className="time-card-stack" aria-label={`${mySeat?.timeCardsRemaining ?? 0} time cards remaining`}>
            {[0, 1, 2].map((index) => (
              <i key={index} className={index < (mySeat?.timeCardsRemaining ?? 0) ? "available" : ""} />
            ))}
          </span>
        </button>
      </div>
      <div className="basic-actions">
        {legal.canFold && (
          <button
            className={clsx("action-button-fold", pressedAction === "fold" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "fold" })}
            aria-label="Fold"
          >
            <FoldVertical size={16} /> Fold
          </button>
        )}
        {legal.canCheck && (
          <button
            className={clsx("action-button-check", pressedAction === "check" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "check" })}
            aria-label="Check"
          >
            <Check size={17} /> Check
          </button>
        )}
        {legal.canCall && (
          <button
            className={clsx("action-button-call", pressedAction === "call" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "call" })}
            aria-label={`Call ${legal.callAmount} chips`}
          >
            Call <strong>{legal.callAmount}</strong>
          </button>
        )}
      </div>
      {legal.canRaise && (
        <div className="raise-control">
          <div className="range-row">
            <span>Raise to</span>
            <strong>{raiseTo}</strong>
          </div>
          <input
            aria-label="Raise amount"
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={game.bigBlind}
            value={raiseTo}
            onChange={(event) => setRaiseTo(Number(event.target.value))}
          />
          <div className="raise-buttons">
            <button type="button" onClick={() => setRaiseTo(legal.minRaiseTo)}>Min</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(0.5))}>½ Pot</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(2 / 3))}>⅔ Pot</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(1))}>Pot</button>
            <button type="button" className="allin-preset" onClick={() => setRaiseTo(legal.maxRaiseTo)}>All-in</button>
          </div>
        </div>
      )}
      <div className="commit-actions">
        {legal.canRaise && (
          <button
            className={clsx("primary-action", "action-button-raise", pressedAction === "raise" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "raise", amount: raiseTo })}
            aria-label={`Raise to ${raiseTo} chips`}
          >
            Raise to <span>{raiseTo}</span>
          </button>
        )}
        {legal.canAllIn && (
          <button
            className={clsx("allin-action", pressedAction === "all-in" && "action-pressed")}
            disabled={pending}
            onClick={() => dispatch({ type: "all-in" })}
            aria-label="Go all in"
          >
            All in
          </button>
        )}
      </div>
    </div>
  );
}

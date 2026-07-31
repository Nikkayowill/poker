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

/**
 * The controls, in one shape that never changes.
 *
 * What this replaces: every button was conditionally rendered, so the bar was
 * a different arrangement on almost every turn. Facing a bet you got
 * Fold/Call; checked to, you got Fold/Check -- and Call and Check occupied the
 * same spot on screen. Whichever one you had learned to reach for, the other
 * was under your thumb half the time. That is the opposite of muscle memory,
 * and on a phone it is how you fold a hand you meant to call.
 *
 * So the three decisions now own three permanent slots -- fold, the passive
 * action, the aggressive one -- and an unavailable action is disabled in
 * place rather than removed. Check and Call share a slot because they are
 * mutually exclusive by the rules: you are never offered both.
 *
 * The raise controls open *over* the felt rather than inside the bar. Adding
 * a row would push the three buttons down exactly when a player is mid-
 * decision, which is the one moment movement is least forgivable -- and it
 * would change the bar's height, which the table's own sizing now depends on.
 */
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
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTo, setRaiseTo] = useState(legal?.minRaiseTo ?? 0);
  const [pressedAction, setPressedAction] = useState<PlayerAction["type"] | null>(null);

  // No reset effect: poker-table.tsx keys this component on game.version, so
  // every turn already remounts it and both useState initialisers re-seed.
  // Nobody else can act while it is your turn, so the drawer cannot be pulled
  // out from under you mid-decision either.

  const potPreset = (fraction: number) => {
    if (!legal) return 0;
    const target = Math.round(game.pot * fraction);
    return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, target));
  };

  // Purely a visual beat -- the real action always dispatches synchronously,
  // right here, on click. This only guarantees the pressed look is visible
  // for a minimum stretch so a fast round trip doesn't make the button feel
  // like it never registered the tap.
  const dispatch = (action: PlayerAction) => {
    onAction(action);
    setRaiseOpen(false);
    setPressedAction(action.type);
    window.setTimeout(() => setPressedAction((current) => (current === action.type ? null : current)), 150);
  };

  if (game.status === "complete") {
    const busted = game.isSeated && mySeat?.stack === 0;
    return (
      <div className="action-bar">
        <div className="action-slot-status">
          <span className="action-kicker">
            {!game.isSeated ? "Seat closed" : busted ? "Stack exhausted" : "Hand complete"}
          </span>
          <strong>
            {!game.isSeated
              ? "You’re out of chips. Start a fresh table when you’re ready."
              : busted ? "Rebuy to keep playing, or close your seat." : game.message}
          </strong>
        </div>
        <div className="action-slot-controls">
          {!game.isSeated && (
            <button className="primary-action action-slot-wide" onClick={onLeave}>Return to lobby</button>
          )}
          {game.isSeated && busted && (
            <>
              <button
                className="action-button-fold"
                disabled={pending}
                onClick={() => onAction({ type: "next-hand" })}
              >
                Close seat
              </button>
              <button
                className="primary-action action-slot-wide"
                disabled={pending}
                onClick={() => setShowRebuyModal(true)}
              >
                Rebuy
              </button>
            </>
          )}
          {game.isSeated && !busted && (
            <button
              className="primary-action action-slot-wide"
              disabled={pending}
              onClick={() => onAction({ type: "next-hand" })}
            >
              <RotateCcw size={16} /> Deal next hand
            </button>
          )}
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

  const myTurn = Boolean(legal);
  const passiveIsCall = Boolean(legal?.canCall);

  return (
    <div className={clsx("action-bar", myTurn && "action-bar-your-turn")}>
      <TurnProgressBar remainingFraction={myTurn ? remainingFraction : 0} />

      <div className="action-slot-tools">
        <div className={clsx("action-countdown", myTurn && secondsRemaining <= 5 && "countdown-critical")}>
          <span>{myTurn ? "Your turn" : "Waiting"}</span>
          <strong>{currentSeat ? secondsRemaining : "—"}</strong>
        </div>
        <button
          type="button"
          className="time-card-button"
          disabled={!myTurn || pending || !mySeat || mySeat.timeCardsRemaining <= 0}
          onClick={() => onAction({ type: "use-time-card" })}
          title="Add 20 seconds to this turn"
        >
          <TimerReset size={16} />
          <span className="time-card-stack" aria-label={`${mySeat?.timeCardsRemaining ?? 0} time gems remaining`}>
            {[0, 1, 2].map((index) => (
              <i key={index} className={index < (mySeat?.timeCardsRemaining ?? 0) ? "available" : ""} />
            ))}
          </span>
        </button>
      </div>

      {/* Three permanent slots. An action you cannot take is disabled, never
          absent, so nothing to its right slides across to fill the gap. */}
      <div className="action-slot-controls">
        <button
          className={clsx("action-button-fold", pressedAction === "fold" && "action-pressed")}
          disabled={!legal?.canFold || pending}
          onClick={() => dispatch({ type: "fold" })}
        >
          <FoldVertical size={16} /> Fold
        </button>

        <button
          className={clsx(
            passiveIsCall ? "action-button-call" : "action-button-check",
            (pressedAction === "call" || pressedAction === "check") && "action-pressed",
          )}
          disabled={!(legal?.canCheck || legal?.canCall) || pending}
          onClick={() => dispatch({ type: passiveIsCall ? "call" : "check" })}
        >
          {passiveIsCall
            ? <>Call <strong>{legal?.callAmount?.toLocaleString()}</strong></>
            : <><Check size={17} /> Check</>}
        </button>

        <button
          className={clsx("action-button-raise", raiseOpen && "action-open")}
          disabled={!(legal?.canRaise || legal?.canAllIn) || pending}
          aria-expanded={raiseOpen}
          onClick={() => setRaiseOpen((open) => !open)}
        >
          {/* Open, this is the way back out, not a second confirm. The commit
              lives in the drawer, once, so there are never two gold buttons
              both reading "Raise to 20" and only one of them spending chips.
              Shoving also used to fire the instant this was touched when
              raising was unavailable -- the largest decision in poker, on a
              single tap, with nothing between. */}
          {raiseOpen ? "Cancel" : legal?.canRaise ? "Bet / Raise" : "All in"}
        </button>
      </div>

      {raiseOpen && legal && (
        <div className="raise-drawer" role="group" aria-label="Choose a raise amount">
          {!legal.canRaise && (
            <div className="raise-drawer-row">
              <span className="raise-drawer-label">All in for</span>
              <strong className="raise-drawer-amount">{legal.maxRaiseTo.toLocaleString()}</strong>
              <button
                type="button"
                className="primary-action raise-drawer-confirm"
                disabled={pending}
                onClick={() => dispatch({ type: "all-in" })}
              >
                Confirm all in
              </button>
            </div>
          )}
          {legal.canRaise && (
          <div className="raise-drawer-row">
            <span className="raise-drawer-label">Raise to</span>
            <strong className="raise-drawer-amount">{raiseTo.toLocaleString()}</strong>
            {/* The drawer covers your own nameplate, and your stack is the one
                number you actually need while sizing a bet, so it comes with. */}
            <span className="raise-drawer-behind">
              Behind <b>{Math.max(0, (mySeat?.stack ?? 0) - (raiseTo - (mySeat?.streetBet ?? 0))).toLocaleString()}</b>
            </span>
            <input
              aria-label="Raise amount"
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={game.bigBlind}
              value={raiseTo}
              onChange={(event) => setRaiseTo(Number(event.target.value))}
            />
          </div>
          )}
          {legal.canRaise && (
          <div className="raise-drawer-presets">
            <button type="button" onClick={() => setRaiseTo(legal.minRaiseTo)}>Min</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(0.5))}>½ Pot</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(0.75))}>¾ Pot</button>
            <button type="button" onClick={() => setRaiseTo(potPreset(1))}>Pot</button>
            <button type="button" className="allin-preset" onClick={() => setRaiseTo(legal.maxRaiseTo)}>All in</button>
            <button
              type="button"
              className="primary-action raise-drawer-confirm"
              disabled={pending}
              onClick={() => dispatch({ type: "raise", amount: raiseTo })}
            >
              Raise to {raiseTo.toLocaleString()}
            </button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

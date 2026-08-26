"use client";

import { useState } from "react";
import { useFuse, useFuseDigit } from "./use-fuse";
import clsx from "clsx";
import { Check, FoldVertical } from "lucide-react";
import type { GameSnapshot, PlayerAction } from "@/lib/game/types";
import { isSeatRebuyEligible } from "@/lib/game/rebuy";
import { TIER_CONFIG } from "@/lib/game/tiers";
import { backstopState } from "@/lib/profile/backstop";
import type { PlayerProfile } from "@/lib/profile/types";
import { BuyInModal } from "@/components/lobby/buy-in-modal";

/**
 * The bar under the controls, burning down on the same clock as the seat ring.
 *
 * Used to take a `remainingFraction` number, which sounds harmless and was
 * not: nothing on this table can compute that fraction without a ticking
 * clock, so the state that produced it lived in PokerTable, the root of the
 * whole table tree, and updated four times a second for the length of every
 * turn. Every seat, card and plate re-rendered with it, to move one bar.
 * Taking the two timestamps instead moves the animation into CSS and takes
 * that state out of the tree entirely.
 *
 * scaleX rather than width, unchanged: transform is the one property here that
 * the compositor can animate without laying the bar out again on every frame.
 */
export function TurnProgressBar({
  startedAt,
  deadlineAt,
}: {
  startedAt: string | null;
  deadlineAt: string | null;
}) {
  const fuseRef = useFuse(startedAt, deadlineAt);
  return (
    <div className="turn-progress-track" ref={fuseRef as React.RefObject<HTMLDivElement>}>
      <div className="turn-progress-fill" />
    </div>
  );
}

/**
 * Live seconds until `deadlineAt`, ticking in the kicker line.
 *
 * Between-hand pauses (the normal 2.8s beat, the 20s bust-rebuy grace) used
 * to render as a static label with no clock on it, indistinguishable from
 * a stall since nothing on screen said the wait was bounded or moving.
 * Reuses useFuseDigit rather than a second timer: it already ticks off
 * rAF (so it stops in a backgrounded tab and resyncs on return, instead of
 * drifting), the same behavior this needed.
 */
function NextHandCountdown({ deadlineAt }: { deadlineAt: string }) {
  const ref = useFuseDigit(null, deadlineAt);
  return <span ref={ref as React.RefObject<HTMLSpanElement>} aria-hidden />;
}

/**
 * The controls, in one shape that never changes.
 *
 * Every button used to be conditionally rendered, so the bar was a different
 * arrangement on almost every turn. Facing a bet you got Fold/Call; checked
 * to, you got Fold/Check, and Call and Check occupied the same spot on
 * screen. Whichever one you had learned to reach for, the other was under
 * your thumb half the time. That is the opposite of muscle memory, and on a
 * phone it is how you fold a hand you meant to call.
 *
 * So the three decisions now own three permanent slots (fold, the passive
 * action, the aggressive one), and an unavailable action is disabled in
 * place rather than removed. Check and Call share a slot because they are
 * mutually exclusive by the rules: you are never offered both.
 *
 * The raise controls open *over* the felt rather than inside the bar. Adding
 * a row would push the three buttons down exactly when a player is
 * mid-decision, the one moment movement is least forgivable, and it would
 * change the bar's height, which the table's own sizing now depends on.
 */
export function ActionBar({
  game,
  pending,
  onAction,
  onLeave,
  profile,
  onClaimBackstop,
  variant = "flat",
}: {
  game: GameSnapshot;
  pending: boolean;
  onAction: (action: PlayerAction) => void;
  onLeave: () => void;
  profile: PlayerProfile | null;
  /**
   * The broke-player recovery top-up (lib/profile/backstop.ts), owned by
   * PokerApp rather than by this component: the same function the lobby's
   * own "Claim a top-up" banner calls. There is no purchase path back into a
   * busted seat any more; this and "Return to lobby" (below) are the two
   * ways out.
   */
  onClaimBackstop: () => void;
  /** The 3D room keeps the same server intents but presents its own control console. */
  variant?: "flat" | "3d";
}) {
  const legal = game.legalActions;
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

  // Purely a visual beat: the real action always dispatches synchronously,
  // right here, on click. This only guarantees the pressed look is visible
  // for a minimum stretch so a fast round trip doesn't make the button feel
  // like it never registered the tap.
  const dispatch = (action: PlayerAction) => {
    onAction(action);
    setRaiseOpen(false);
    setPressedAction(action.type);
    window.setTimeout(() => setPressedAction((current) => (current === action.type ? null : current)), 150);
  };

  // Stack at zero, still seated. Checked ahead of everything else below,
  // because it no longer keys off `game.status`: there is no grace period
  // any more, so a bust just leaves this seat sitting out, exactly like any
  // other unfunded seat, through as many hands as it takes until they rebuy
  // or leave. This can be true while the table reads "playing" (someone
  // else's hand is running) just as easily as "complete" (between hands);
  // it never delays either one.
  //
  // But a zero stack does not mean this seat is done with its OWN hand --
  // going all-in reads status "all-in", not "out", until the hand it was in
  // finishes deciding it. isSeatRebuyEligible is the same predicate the
  // server enforces, and this used to be the one place that didn't check
  // it: the Rebuy button showed the instant `stack` hit zero, the server
  // rejected it with a 409 until that hand resolved, and nothing retried --
  // "have to perfectly time it." bustedWaiting is that gap, shown instead
  // of a button that would just bounce.
  const zeroStack = game.isSeated && mySeat?.stack === 0;
  const rebuyEligible = !mySeat || isSeatRebuyEligible(game.status, mySeat.status);
  const busted = zeroStack && rebuyEligible;
  const bustedWaiting = zeroStack && !rebuyEligible;

  if (bustedWaiting) {
    return (
      <div className={clsx("action-bar", variant === "3d" && "action-bar-3d")}>
        <div className="action-slot-status">
          <span className="action-kicker">All in</span>
          <strong>Your last chips are in -- the hand plays out before you can rebuy.</strong>
        </div>
      </div>
    );
  }

  if (busted) {
    // Whether a rebuy is reachable right now. Unlimited Gold always is;
    // otherwise it takes this table's minimum buy-in.
    const canRebuyWithGold = Boolean(profile?.unlimitedGold)
      || (profile?.goldBalance ?? 0) >= TIER_CONFIG[game.tier].minBuyIn;
    // There is no purchase escape valve any more. The backstop grant
    // (lib/profile/backstop.ts, same mechanism the lobby's own "Claim a
    // top-up" banner uses) is the fast path when it's eligible; otherwise
    // the lobby (where every faucet lives: backstop, daily Gold, rewarded
    // ads) is the only way back in.
    const backstop = backstopState(profile, new Date(), TIER_CONFIG[game.tier].minBuyIn);
    return (
      <div className={clsx("action-bar", variant === "3d" && "action-bar-3d")}>
        <div className="action-slot-status">
          <span className="action-kicker">Stack exhausted</span>
          <strong>
            {backstop === "ready"
              ? "You’re sat out until you rebuy. Claim a top-up to get right back in."
              : "You’re sat out until you rebuy. The table plays on without you -- take your time."}
          </strong>
        </div>
        <div className="action-slot-controls">
          {/* No "close seat" control here: the header's Leave table button
              already calls leave-seat for a seated player (see leaveTable
              in poker-app.tsx), which is the one exit a busted player needs,
              so a second, seat-scoped exit button would be redundant.
              Rebuy is the only slot-controls action while busted, so
              it is already the full-width gold primary-action rather than
              sharing the row with a fold-styled sibling. Three cases now
              instead of two: enough Gold opens the rebuy modal as always;
              short of it but backstop-eligible claims the same top-up the
              lobby's own banner offers, inline, so a bust doesn't force a
              trip back; otherwise every faucet (backstop's cooldown, daily
              Gold, rewarded ads) lives in the lobby, so that's the exit. */}
          {canRebuyWithGold ? (
            <button
              className="primary-action action-slot-wide"
              disabled={pending}
              onClick={() => setShowRebuyModal(true)}
            >
              Rebuy
            </button>
          ) : backstop === "ready" ? (
            <button
              className="primary-action action-slot-wide"
              disabled={pending}
              onClick={onClaimBackstop}
            >
              Claim a top-up
            </button>
          ) : (
            <button className="primary-action action-slot-wide" onClick={onLeave}>Return to lobby</button>
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
            onConfirm={(_tier, buyIn) => onAction({ type: "rebuy", amount: buyIn })}
          />
        )}
      </div>
    );
  }

  if (game.status === "complete") {
    // Someone else at the table busted, not me. Their seat just sits out,
    // same as any other unfunded seat, and the table was never actually
    // waiting on them, but a bare "Hand complete" reads exactly like it's
    // blocked on them. Named here so it visibly isn't.
    const otherBustedSeat = game.seats.find((seat) => seat.isHuman && !seat.isMine && seat.stack === 0) ?? null;
    // A finished hand carries a deadline for the next one unless the table
    // cannot deal another (fewer than two seats with chips left). The Deal
    // button used to be the way out of that; with the deal automatic there is
    // no button, so without this the controls are simply empty and the only
    // exit is the header. Reading the deadline rather than counting stacks
    // keeps this agreeing with scheduleNextHand by construction.
    const tableIsDone = game.isSeated && !game.nextHandAt;
    return (
      <div className={clsx("action-bar", variant === "3d" && "action-bar-3d")}>
        <div className="action-slot-status">
          <span className="action-kicker">
            {!game.isSeated ? "Seat closed" : tableIsDone ? "Table finished" : "Hand complete"}
            {/* The clock itself: absent once the table is genuinely done
                dealing (tableIsDone), present otherwise so the ordinary beat
                between every hand never sits with no visible sign it's
                moving on its own. Always the same beat, bust or no bust. */}
            {game.isSeated && !tableIsDone && game.nextHandAt && (
              <> · <NextHandCountdown deadlineAt={game.nextHandAt} />s</>
            )}
          </span>
          <strong>
            {!game.isSeated
              ? "You’re out of chips. Start a fresh table when you’re ready."
              : otherBustedSeat
                ? `${otherBustedSeat.name} is sat out — the table deals on without them.`
                : game.message}
          </strong>
        </div>
        <div className="action-slot-controls">
          {(!game.isSeated || tableIsDone) && (
            <button className="primary-action action-slot-wide" onClick={onLeave}>Return to lobby</button>
          )}
        </div>
      </div>
    );
  }

  // A seat can be claimed mid-hand: the new occupant sits out the hand
  // already in progress (see claimSeat in lib/game/engine.ts) rather than
  // inheriting whatever the bot she replaced was holding. Busted is handled
  // above and always returns first, so a seat reading "out" here is always
  // funded and simply waiting for the next deal, never someone who needs to
  // rebuy.
  if (game.isSeated && mySeat?.status === "out") {
    return (
      <div className={clsx("action-bar", variant === "3d" && "action-bar-3d")}>
        <div className="action-slot-status">
          <span className="action-kicker">Sat out</span>
          <strong>You’re in for the next hand -- sit tight while this one finishes.</strong>
        </div>
      </div>
    );
  }

  const myTurn = Boolean(legal);
  const passiveIsCall = Boolean(legal?.canCall);

  return (
    <div className={clsx(
      "action-bar",
      variant === "3d" && "action-bar-3d",
      myTurn && "action-bar-your-turn",
    )}>
      {/* Only your own turn burns the bar. Passing nulls otherwise leaves the
          fuse properties unset, which is what makes the track sit empty
          rather than animating somebody else's clock under your controls. */}
      <TurnProgressBar
        startedAt={myTurn ? game.turnStartedAt : null}
        deadlineAt={myTurn ? game.turnDeadlineAt : null}
      />

      {/* No countdown here any more: the fuse burning around the seat on the
          clock carries it, right where the player is already looking. There
          used to be a time-card column here too (+20s, three per seat),
          gone along with the rest of the file's time-bank plumbing, since
          nothing in this app has real money on the line and the column was
          costing width the three decisions could use instead. */}

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
              raising was unavailable: the largest decision in poker, on a
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

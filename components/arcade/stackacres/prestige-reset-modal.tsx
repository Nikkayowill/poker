"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { AlertTriangle, Flame, Lock, RotateCcw, Sparkles } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
  type StackAcresPrestigeResetResult,
  type StackAcresPrestigeView,
} from "@/lib/stackacres/prestige";

/**
 * The Prestige Reset Valve's confirmation sheet.
 *
 * ------------------------------------------------------------------------
 * WHY TWO STEPS, AND WHY A COOLDOWN INSIDE THE SECOND ONE
 *
 * Every other StackAcres sheet (TownContractsModal, the supply store, land
 * clearing) settles on its first and only confirming tap, because every
 * other action here is either free to retry (buying a second slot is just
 * another purchase) or bounded by a guard that makes a duplicate harmless
 * (a version column, an intent key). A prestige reset has neither: it wipes
 * `homestead_units`/wheat plots/inventory/feed/upkeep/any open contract in
 * one irreversible server call (see prestigeResetStackAcres's own header,
 * lib/server/stackacres-service.ts), and there is no row anywhere to hand
 * back what was there a moment before. The one thing this component can
 * still do is make sure the tap that starts it was never an accident:
 *
 *   1. REVIEW shows the standing and asks once, with a button whose label
 *      names what happens next rather than doing it.
 *   2. CONFIRM restates exactly what is lost and what is gained, in the
 *      same numbers the server itself will act on, behind a second button
 *      that is DISABLED for a short beat after this step opens
 *      (CONFIRM_COOLDOWN_MS) -- long enough that the two taps cannot land
 *      as one fast double-click carried over from dismissing something
 *      else, short enough that a player who has genuinely decided is never
 *      kept waiting.
 *
 * Backing out of step 2 (Cancel, Escape, the backdrop) costs nothing and
 * reaches back to step 1 rather than closing outright -- the standing there
 * is exactly what it was, since nothing has been sent yet. Only the request
 * itself (`resetting`) blocks dismissal, the same rule `settling` follows in
 * TownContractsModal: a player must not lose track of an outcome that may
 * already be on its way to the server.
 *
 * ------------------------------------------------------------------------
 * WHY THE SERVER'S OWN NUMBERS, NEVER RECOMPUTED HERE
 *
 * `eligible`/`goldToNextPrestige` and the exact multiplier a reset would buy
 * are read straight off `prestige` (this profile's own StackAcresPrestigeView,
 * refreshed by the parent after every farm-view read) -- never recomputed
 * client-side from lib/stackacres/prestige.ts's own formula. That formula is
 * exported for tests and for the server's own use, not so a client can
 * predict a result the server alone is authoritative for; see
 * reset_stackacres_prestige's own migration comment for why gross production
 * (not net Gold) is what it reads, a distinction this component has no
 * business re-deriving.
 *
 * ------------------------------------------------------------------------
 * POINTER CONTAINMENT
 *
 * Same contract as TownContractsModal.tsx's own header: the StackAcres scene
 * reads raw pointer events off its host element with Phaser input off
 * entirely, so every handler here is wrapped in `contain`, stopping
 * propagation before this sheet's own press could reach the map underneath.
 */

/** How long the final confirm button stays disabled once step 2 opens. */
const CONFIRM_COOLDOWN_MS = 1200;

export type StackAcresPrestigeActionResult =
  | { readonly ok: true; readonly result: StackAcresPrestigeResetResult }
  | { readonly ok: false; readonly message: string };

export interface StackAcresPrestigeResetModalProps {
  /** This profile's own standing, straight off the last server response. */
  prestige: StackAcresPrestigeView;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `prestige-reset`. Resolves once this browser knows the outcome. */
  onReset: () => Promise<StackAcresPrestigeActionResult>;
  onClose: () => void;
}

type Step = "review" | "confirm";

/** A message the sheet is showing about its own last action. Reuses
 *  TownContractsModal's own tone contract (`is-paid`/`is-refused` CSS), so
 *  the two sheets read as one family rather than two different vocabularies
 *  for the same idea. */
type Note = { readonly tone: "paid" | "refused"; readonly text: string };

/** Wraps a handler so the press is consumed here rather than travelling on
 *  to the scene underneath. See TownContractsModal.tsx's own header for why
 *  this exists per-file rather than as a shared import. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

/** "1.4472x" -- four places, always, so the ladder never drops a trailing
 *  zero and reads as a different kind of number from one tap to the next. */
function formatMultiplier(value: number): string {
  return `${value.toFixed(4)}x`;
}

export function StackAcresPrestigeResetModal({
  prestige,
  busy,
  onReset,
  onClose,
}: StackAcresPrestigeResetModalProps) {
  const [step, setStep] = useState<Step>("review");
  const [resetting, setResetting] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  // Starts locked (false) on the very first render of step 2 -- set directly
  // by openConfirm below, a user-event handler, not by this effect. The
  // effect's own job is only ever to unlock it once CONFIRM_COOLDOWN_MS has
  // genuinely elapsed, which is a callback firing in response to real time
  // passing, not a synchronous setState in the effect body.
  const [confirmUnlocked, setConfirmUnlocked] = useState(false);

  const eligible = prestige.goldToNextPrestige <= 0;
  // Display only -- a labelled constant from lib/stackacres/prestige.ts, not
  // a recomputation of the eligibility check itself, which stays entirely
  // server-side (see this file's own header).
  const progress = Math.max(
    0,
    Math.min(1, 1 - prestige.goldToNextPrestige / STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS),
  );

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !resetting);

  // Re-arms every time step becomes "confirm" -- including a return trip
  // through "review" and back, which is a new decision and gets its own
  // fresh cooldown, not a continuation of the last one. Cleanup clears a
  // stale timer so a step the player has already left cannot unlock a
  // button that is no longer showing.
  useEffect(() => {
    if (step !== "confirm") return;
    const timer = setTimeout(() => setConfirmUnlocked(true), CONFIRM_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const openConfirm = useCallback(() => {
    if (!eligible) return;
    setNote(null);
    setConfirmUnlocked(false);
    setStep("confirm");
  }, [eligible]);

  const backToReview = useCallback(() => {
    setStep("review");
  }, []);

  /**
   * Fires the request. Nothing here is optimistic -- unlike a Gold spend,
   * there is no smaller, reversible client-side model of "the farm minus
   * everything" worth drawing for the half-second before the server
   * answers, so the sheet simply waits and then trusts the response.
   */
  const handleConfirm = useCallback(async (): Promise<void> => {
    if (busy || resetting || !confirmUnlocked || !eligible) return;
    setNote(null);
    setResetting(true);
    try {
      const outcome = await onReset();
      if (!outcome.ok) {
        setNote({ tone: "refused", text: outcome.message });
        setStep("review");
        return;
      }
      setNote({
        tone: "paid",
        text: `Reset complete. Permanent multiplier is now ${formatMultiplier(outcome.result.multiplier)} (+${formatMultiplier(outcome.result.gainedMultiplier)}).`,
      });
      setStep("review");
    } catch {
      setNote({ tone: "refused", text: "That did not go through. Nothing was reset." });
      setStep("review");
    } finally {
      setResetting(false);
    }
  }, [busy, resetting, confirmUnlocked, eligible, onReset]);

  const working = busy || resetting;

  return (
    <div
      className="sa-sheet-scrim"
      role="presentation"
      onMouseDown={contain(onBackdropMouseDown)}
      onPointerDown={contain()}
      onPointerUp={contain()}
      onPointerMove={contain()}
      onTouchStart={contain()}
      onTouchMove={contain()}
      onClick={contain()}
      onWheel={contain()}
    >
      <section
        className="sa-sheet sa-prestige"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-prestige-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <RotateCcw size={13} aria-hidden="true" /> Prestige Reset Valve
            </p>
            <h2 id="sa-prestige-title">
              {step === "review" ? "Trade the farm for permanent power" : "This cannot be undone"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="sa-sheet-close"
            disabled={resetting}
            onClick={contain(closeAll)}
          >
            Done
          </button>
        </header>

        {note && (
          <p
            className={clsx("sa-contracts-note", `is-${note.tone}`)}
            role={note.tone === "refused" ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        {step === "review" ? (
          <>
            <p className="sa-sheet-note">
              Pulling the valve wipes every unit, wheat plot, inventory line, feed serving and
              today&apos;s Land Maintenance for a <strong>permanent</strong> boost to every future
              harvest. Land cleared, purchased capacity, placed machines, Synergy Tree perks,
              Ray&apos;s Museum finds and Town Influence all carry over untouched.
            </p>

            <p className="sa-contracts-standing">
              <Sparkles size={15} aria-hidden="true" />
              <strong>{formatMultiplier(prestige.multiplier)}</strong>
              <span>current permanent multiplier{prestige.prestigeCount > 0 ? ` · reset ${prestige.prestigeCount.toLocaleString()}×` : ""}</span>
            </p>

            {!eligible && (
              <div className="sa-prestige-progress">
                <span className="sa-contract-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
                <span className="sa-prestige-progress-label">
                  <Lock size={12} aria-hidden="true" /> Gross {prestige.goldToNextPrestige.toLocaleString()}{" "}
                  more Gold worth of farming since the last reset to unlock the valve.
                </span>
              </div>
            )}

            <button
              type="button"
              className="sa-cta"
              disabled={working || !eligible}
              onClick={contain(openConfirm)}
              title={eligible ? undefined : "Keep farming -- the valve is not ready yet."}
            >
              {eligible ? "Review the reset" : "Not ready yet"}
            </button>
          </>
        ) : (
          <>
            <div className="sa-prestige-warning">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <p className="sa-clear-promise">
                  Every unit, wheat plot, inventory line, feed serving, today&apos;s Land
                  Maintenance and any open Town Contract will be gone the instant you confirm.
                </p>
                <p className="sa-stock-terms">
                  In exchange, the permanent multiplier rises from{" "}
                  <strong>{formatMultiplier(prestige.multiplier)}</strong> — every harvest from
                  here on is worth more, forever.
                </p>
              </div>
            </div>

            <div className="sa-prestige-confirm-row">
              <button
                type="button"
                className="sa-sheet-close sa-prestige-cancel"
                disabled={resetting}
                onClick={contain(backToReview)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sa-cta is-danger"
                disabled={working || !confirmUnlocked}
                onClick={contain(() => void handleConfirm())}
              >
                <Flame size={16} aria-hidden="true" />
                {resetting ? "Resetting…" : !confirmUnlocked ? "Wait a moment…" : "Yes — reset my farm"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

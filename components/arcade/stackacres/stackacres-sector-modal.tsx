"use client";

import { Axe, Check, Lock, X } from "lucide-react";
import clsx from "clsx";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  STACKACRES_SECTORS,
  sectorClearCheck,
  sectorLabel,
  type SectorId,
} from "@/lib/stackacres/sectors";
import { STACKACRES_ZONES } from "@/lib/stackacres/zones";
import { landClearingLine } from "@/lib/stackacres/land-clearing";

/**
 * What a tap on wild ground opens: what this land would become, what clearing
 * it costs, and what is still standing between the player and it.
 *
 * It exists because nothing else on the map can say any of that. The whole
 * point of drawing locked land as trees rather than as a greyed-out pen is
 * that a wood carries no price tag, no padlock and no progress bar -- so the
 * tap has to carry all three, and this is where they live.
 *
 * THE CHECKLIST IS NOT WRITTEN HERE. Every line comes from
 * `sectorClearCheck`, so the sheet and the server can never word the same
 * requirement two different ways.
 *
 * NO PRICE AND NO BUTTON, since land stopped being for sale
 * (lib/stackacres/land-clearing.ts). Clearing happens out on the land itself,
 * one swing at a time, so all this sheet owes the player is what the ground
 * will become and how far the work has got.
 */

export interface StackAcresSectorModalProps {
  sector: SectorId;
  /** Land already cleared, for the "clear X first" line. */
  unlocked: readonly SectorId[];
  /** Crops and animals going, for the "keep N going" line. */
  unitCount: number;
  /** Gold still owed on the land already held, shown as a job to do like
   *  any other requirement. */
  upkeepOutstanding: number;
  /** For a wild area: the traveler whose arrival opens its gate, and what
   *  the player still has to do first (null once nothing is missing). */
  opener: { name: string; hint: string | null } | null;
  /** How far the clearing has got (lib/stackacres/land-clearing.ts). */
  progress: { cleared: number; total: number };
  onClose: () => void;
}

export function StackAcresSectorModal({
  sector,
  unlocked,
  unitCount,
  upkeepOutstanding,
  opener,
  progress,
  onClose,
}: StackAcresSectorModalProps) {
  // Escape and a backdrop tap close this, same as every other sheet. Without
  // it the only way out was the small X, and a gate sheet often has no button
  // at all.
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose, true);
  const def = STACKACRES_SECTORS[sector];
  const check = sectorClearCheck(sector, { unlocked, unitCount });
  // The land fee is a requirement like any other, and shown as one rather
  // than as an error after the fact.
  const requirements = [
    ...check.requirements,
    ...(upkeepOutstanding > 0
      ? [
          {
            label: `Settle ${upkeepOutstanding.toLocaleString()} Gold of land maintenance`,
            met: false,
          },
        ]
      : []),
  ];
  // A wild area is never sold: its gate opens when its traveler arrives, so
  // this says who that is and what to do next. No price, no button.
  if (check.wild) {
    return (
      <div
        className="sa-sheet-scrim"
        role="dialog"
        aria-modal="true"
        aria-label={sectorLabel(sector)}
        onMouseDown={onBackdropMouseDown}
      >
        <div className="sa-sheet sa-clear-sheet">
          <header className="sa-sheet-head">
            <div>
              <p className="sa-clear-kicker">
                <Lock size={13} aria-hidden="true" /> Gate closed
              </p>
              <h2>{sectorLabel(sector)}</h2>
            </div>
            <button ref={closeButtonRef} type="button" className="sa-sheet-close" aria-label="Leave it" onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <p className="sa-clear-blurb">{STACKACRES_ZONES[sector].blurb}</p>
          <p className="sa-clear-promise">{def.promise}</p>
          {opener && (
            <p className="sa-sheet-note">
              This gate opens when {opener.name} arrives.
              {opener.hint && <> Next step: {opener.hint}.</>}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="sa-sheet-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Clear ${sectorLabel(sector)}`}
      onMouseDown={onBackdropMouseDown}
    >
      <div className="sa-sheet sa-clear-sheet">
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Lock size={13} aria-hidden="true" /> Uncleared land
            </p>
            <h2>{sectorLabel(sector)}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="sa-sheet-close" aria-label="Leave it" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <p className="sa-clear-blurb">{STACKACRES_ZONES[sector].blurb}</p>
        <p className="sa-clear-promise">{def.promise}</p>

        <p className="sa-clear-price">
          <Axe size={18} aria-hidden="true" />
          <strong>{landClearingLine(progress)}</strong>
          <span>Nobody sells this land. Walk on and cut down what is standing.</span>
        </p>

        {requirements.length > 0 && (
          <ul className="sa-clear-reqs">
            {requirements.map((requirement) => (
              <li
                key={requirement.label}
                className={clsx("sa-clear-req", { "is-met": requirement.met })}
              >
                <span className="sa-clear-req-mark" aria-hidden="true">
                  {requirement.met ? <Check size={13} /> : <Lock size={12} />}
                </span>
                <span>{requirement.label}</span>
                <span className="sa-sr">{requirement.met ? " — done" : " — not yet"}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="sa-sheet-note">
          Every tree and boulder you break pays into the barn. Anything you would rather not swing
          at can be blown instead, for Gold. The land is yours when the last of it is down.
        </p>
      </div>
    </div>
  );
}

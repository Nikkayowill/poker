"use client";

import { Check, Coins, Lock, X } from "lucide-react";
import clsx from "clsx";
import { cropFieldsUnlockCheck, CROP_FIELDS_PROMISE } from "@/lib/stackacres/crop-fields";

/**
 * `StackAcresSectorModal`'s own twin for the Crop Fields -- what a tap on the
 * field's own wild growth opens, since the 2026-09-08 district merge folded
 * that ground into the Farmstead and left it with no `SectorId` for that
 * modal to key off any more (see ./zones.ts's own header, and
 * lib/stackacres/crop-fields.ts's).
 *
 * Same posture as `StackAcresSectorModal` in every way that still applies:
 * the checklist is not written here, it comes straight from
 * `cropFieldsUnlockCheck` (the same pure function
 * lib/server/stackacres-service.ts's `unlockStackAcresCropFields` calls
 * before a piece of Gold moves), and Gold affordability is deliberately not
 * checked -- the button stays live and the server's own refusal is what
 * tells a player they are short. There is no `wild`-ground branch: unlike a
 * reserved district, the Crop Fields always have a real system under them.
 */

export interface StackAcresCropFieldsModalProps {
  unlocked: boolean;
  /** Crops and animals going, for the "keep N going" line. */
  unitCount: number;
  /** Null while the profile has not loaded; the price still shows. */
  goldBalance: number | null;
  unlimitedGold: boolean;
  /** Bushels still owed on the land already held. Non-zero blocks the sale,
   *  the same rule the server applies -- you settle up before you buy more. */
  upkeepOutstanding: number;
  busy: boolean;
  onUnlock: () => void;
  onClose: () => void;
}

export function StackAcresCropFieldsModal({
  unlocked,
  unitCount,
  goldBalance,
  unlimitedGold,
  upkeepOutstanding,
  busy,
  onUnlock,
  onClose,
}: StackAcresCropFieldsModalProps) {
  const check = cropFieldsUnlockCheck({ unlocked, unitCount });
  // The land fee is a requirement like any other, and shown as one rather
  // than as an error after the fact -- a player who taps Clear and is told
  // about a bill they were never shown has been ambushed by their own farm.
  const requirements = [
    ...check.requirements,
    ...(upkeepOutstanding > 0
      ? [
          {
            label: `Settle ${upkeepOutstanding.toLocaleString()} Bushels of land maintenance`,
            met: false,
          },
        ]
      : []),
  ];
  const ready = check.ok && upkeepOutstanding <= 0;

  return (
    <div className="sa-sheet-scrim" role="dialog" aria-modal="true" aria-label="Unlock the Crop Fields">
      <div className="sa-sheet sa-clear-sheet">
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Lock size={13} aria-hidden="true" /> Uncleared land
            </p>
            <h2>The Crop Fields</h2>
          </div>
          <button type="button" className="sa-sheet-close" aria-label="Leave it" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <p className="sa-clear-blurb">The great open field, and every bed you have tilled in it.</p>
        <p className="sa-clear-promise">{CROP_FIELDS_PROMISE}</p>

        <p className="sa-clear-price">
          <Coins size={18} aria-hidden="true" />
          <strong>{check.cost.toLocaleString()}</strong>
          <span>
            Gold to unlock it, once
            {goldBalance !== null && !unlimitedGold && (
              <> · you have {goldBalance.toLocaleString()}</>
            )}
          </span>
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

        <button
          type="button"
          className="sa-cta sa-clear-cta"
          disabled={busy || !ready}
          onClick={onUnlock}
        >
          {ready ? `Unlock the Crop Fields · ${check.cost.toLocaleString()} Gold` : "Not yet"}
        </button>
        <p className="sa-sheet-note">
          Unlocking is permanent and is not refunded. What it buys is the ground itself — the beds
          on it are still bought one at a time.
        </p>
      </div>
    </div>
  );
}

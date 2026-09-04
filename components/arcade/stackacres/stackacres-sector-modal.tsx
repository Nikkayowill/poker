"use client";

import { Check, Coins, Lock, X } from "lucide-react";
import clsx from "clsx";
import {
  STACKACRES_SECTORS,
  sectorClearCheck,
  sectorLabel,
  type SectorId,
} from "@/lib/stackacres/sectors";
import { STACKACRES_ZONES } from "@/lib/stackacres/zones";

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
 * `sectorClearCheck`, which the server calls before a piece of Gold moves --
 * see `clearStackAcresSector`. A modal that promised something the route then
 * refused is the failure this arrangement exists to make impossible, and it
 * is why the wording lives on the requirement rather than in either caller.
 *
 * Gold affordability is deliberately NOT checked, the same posture every
 * other Gold spend in this app takes (see lib/stackacres/district-panel.ts's
 * header): the button stays live and the server's refusal is what tells a
 * player they are short. The balance is shown beside the price so it is
 * rarely a surprise.
 */

export interface StackAcresSectorModalProps {
  sector: SectorId;
  /** Land already cleared, for the "clear X first" line. */
  unlocked: readonly SectorId[];
  /** Crops and animals going, for the "keep N going" line. */
  unitCount: number;
  /** Null while the profile has not loaded; the price still shows. */
  goldBalance: number | null;
  unlimitedGold: boolean;
  /** Bushels still owed on the land already held. Non-zero blocks the sale,
   *  the same rule the server applies -- you settle up before you buy more. */
  upkeepOutstanding: number;
  busy: boolean;
  onClear: (sector: SectorId) => void;
  onClose: () => void;
}

export function StackAcresSectorModal({
  sector,
  unlocked,
  unitCount,
  goldBalance,
  unlimitedGold,
  upkeepOutstanding,
  busy,
  onClear,
  onClose,
}: StackAcresSectorModalProps) {
  const def = STACKACRES_SECTORS[sector];
  const check = sectorClearCheck(sector, { unlocked, unitCount });
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
    <div
      className="sa-sheet-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Clear ${sectorLabel(sector)}`}
    >
      <div className="sa-sheet sa-clear-sheet">
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Lock size={13} aria-hidden="true" /> Uncleared land
            </p>
            <h2>{sectorLabel(sector)}</h2>
          </div>
          <button type="button" className="sa-sheet-close" aria-label="Leave it" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <p className="sa-clear-blurb">{STACKACRES_ZONES[sector].blurb}</p>
        <p className="sa-clear-promise">{def.promise}</p>

        <p className="sa-clear-price">
          <Coins size={18} aria-hidden="true" />
          <strong>{def.clearCost.toLocaleString()}</strong>
          <span>
            Gold to clear it, once
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
          onClick={() => onClear(sector)}
        >
          {ready ? `Clear the land · ${def.clearCost.toLocaleString()} Gold` : "Not yet"}
        </button>
        <p className="sa-sheet-note">
          Clearing is permanent and is not refunded. What it buys is the ground itself — the pens
          and fields on it are still bought one at a time.
        </p>
      </div>
    </div>
  );
}

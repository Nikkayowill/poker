"use client";

import { Lock, X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { CROP_FIELDS_PROMISE } from "@/lib/stackacres/crop-fields";

/**
 * What a player sees when they walk up to the gate before the Crop Fields are
 * theirs.
 *
 * NOT A SHOP ANY MORE. The land used to cost 15,000 Gold against a 2,000 Gold
 * start, which a new farm cannot see past, so it stopped being for sale: Ray
 * hands it over when his "A Full Basket" quest is turned in (see
 * `opensCropFields` in lib/stackacres/story/quests.ts). This sheet only says
 * what is out there and who opens it. Every later piece of land still costs
 * Gold.
 */

export interface StackAcresCropFieldsModalProps {
  onClose: () => void;
}

export function StackAcresCropFieldsModal({ onClose }: StackAcresCropFieldsModalProps) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div
      className="sa-sheet-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="The Crop Fields"
      onMouseDown={onBackdropMouseDown}
    >
      <div className="sa-sheet sa-clear-sheet">
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Lock size={13} aria-hidden="true" /> Gate closed
            </p>
            <h2>The Crop Fields</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="sa-sheet-close" aria-label="Leave it" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <p className="sa-clear-blurb">The great open field, up the lane past the barn.</p>
        <p className="sa-clear-promise">{CROP_FIELDS_PROMISE}</p>

        <p className="sa-sheet-note">
          These were Ray&apos;s fields, and they are not for sale. Work the beds by the house and
          bring him a full basket, and he will walk you out here himself.
        </p>
      </div>
    </div>
  );
}

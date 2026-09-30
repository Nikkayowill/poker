"use client";

import { X } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * What the locked StackAcres row opens. Info only: there is no checkout behind
 * it yet, so it names no price and takes no payment.
 */
export function PremiumExpansionModal({ onClose }: { onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="premium-expansion-title">
        <header className="profile-modal-header">
          <div>
            <span>PREMIUM EXPANSION</span>
            <h2 id="premium-expansion-title">StackAcres</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={() => { tapSound(); onClose(); }} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">
          <p>
            StackAcres is a farm you build and run: raise crops and livestock, cook what they
            make, and sell it in town.
          </p>
          <p>
            It will be a premium expansion, a one-time purchase that unlocks it for good. The
            price will be announced at launch.
          </p>
          <p><strong>Coming soon.</strong></p>
          <button type="button" className="floor-play" onClick={() => { tapSound(); onClose(); }}>Close</button>
        </div>
      </section>
    </div>
  );
}

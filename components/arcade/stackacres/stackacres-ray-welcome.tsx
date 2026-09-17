"use client";

import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * The one-time welcome a new player gets from Ray, the first
 * time they ever open StackAcres. Reuses the same `.profile-overlay` /
 * `.profile-modal` shell as HowToPlayModal (see that file) rather than a
 * fifth bespoke modal chrome; the only new class is `.sa-ray-welcome-portrait`.
 *
 * Shown/dismissed by the caller (`stackacres-farm.tsx`), gated on a plain
 * localStorage flag -- there is no server-side "seen it" state for this,
 * on purpose: it is a one-time hello, not a fact about the player's farm.
 */
export function StackAcresRayWelcome({ onClose }: { onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal htp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ray-welcome-title"
      >
        <header className="profile-modal-header">
          <div>
            <span>STACKACRES</span>
            <h2 id="ray-welcome-title">Ray</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">
          <img
            src="/stackacres-td/portraits/ray-happy.png"
            alt=""
            className="sa-ray-welcome-portrait"
          />
          <p>
            &ldquo;Well now, come on in. Name&rsquo;s Ray, and this land&rsquo;s been in the family a
            long while. Tap the ground to walk, and tap whatever you&rsquo;re standing by to use it.&rdquo;
          </p>
          <p>
            &ldquo;The barn is my supply store. The Workshop next door grows wheat, and a Mill there
            grinds it into flour. The signpost takes orders from town. Come find me when you&rsquo;re ready to
            help out.&rdquo;
          </p>
          <button type="button" className="sa-cta" onClick={onClose}>
            Thanks, Ray
          </button>
        </div>
      </section>
    </div>
  );
}

"use client";

import { X } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * The one-time welcome a new player gets from Grandfather Ray, the first
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
            <h2 id="ray-welcome-title">Grandfather Ray</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={() => { tapSound(); onClose(); }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">
          <img
            src="/stackacres/sprites/grandfather-ray-portrait.png"
            alt=""
            className="sa-ray-welcome-portrait"
          />
          <p>
            &ldquo;Well now, come on in. Name&rsquo;s Ray — this land&rsquo;s been in the family a long
            while, and I keep an eye on it. Walk yourself out to whichever district takes your fancy
            and the panel beside you will show what&rsquo;s standing there and what you can buy — the
            supply store&rsquo;s mine too, so holler if you need feed or want to sell.&rdquo;
          </p>
          <p>&ldquo;Go on and get your hands dirty. I&rsquo;ll be right here.&rdquo;</p>
          <button type="button" className="sa-cta" onClick={() => { tapSound(); onClose(); }}>
            Thanks, Ray
          </button>
        </div>
      </section>
    </div>
  );
}

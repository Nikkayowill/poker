"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * The rules overlay every Ante Up game (and the arcade floor's own generic
 * explainer) opens from its header. Reuses the same `.profile-overlay` /
 * `.profile-modal` / `.profile-modal-header` / `.modal-close` shell
 * buy-in-modal.tsx and rewarded-ad-modal.tsx already use, rather than a
 * fourth bespoke modal chrome -- see those two files for the pattern this
 * copies. `useModalDismiss` gives it the same focus/Escape/backdrop-click
 * behaviour rewarded-ad-modal.tsx has, with nothing that needs `canDismiss`
 * gated off (there's no in-flight request here to protect).
 *
 * Body content is plain prose, not another data-driven form: each caller
 * writes its own accurate copy as children (`.htp-body` styles bare
 * `<p>`/`<ul>`/`<ol>`, see 22-arcade.css), so this file only supplies the
 * frame.
 */
export function HowToPlayModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="htp-modal-title">
        <header className="profile-modal-header">
          <div>
            <span>HOW TO PLAY</span>
            <h2 id="htp-modal-title">{title}</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={() => { tapSound(); onClose(); }} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">{children}</div>
      </section>
    </div>
  );
}

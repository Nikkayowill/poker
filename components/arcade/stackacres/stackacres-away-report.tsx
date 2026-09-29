"use client";

import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { awayDurationLabel, type AwayReport } from "@/lib/stackacres/away-report";

/**
 * What the farm did while the player was gone. Same overlay shell as Ray's
 * welcome. Shown once per return by `stackacres-farm.tsx`; nothing here is
 * saved or paid, it only reads the farm back to the player.
 */
export function StackAcresAwayReport({ report, onClose }: { report: AwayReport; onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="away-report-title">
        <header className="profile-modal-header">
          <div>
            <span>STACKACRES</span>
            <h2 id="away-report-title">While you were away</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">
          <p>You were gone about {awayDurationLabel(report.awayMs)}. Here is what happened on the farm.</p>
          <ul className="sa-away-lines">
            {report.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button type="button" className="sa-cta" onClick={onClose}>
            Back to work
          </button>
        </div>
      </section>
    </div>
  );
}

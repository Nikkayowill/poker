"use client";

import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * Shared "leave while Gold is on the line" confirmation — used by
 * FloorBackLink (every arcade/duel/cribbage/blackjack header) and by
 * poker-table.tsx's own leave controls, which don't route through that link.
 *
 * Deliberately not built on the fuller .profile-modal-header chrome
 * (RestoreConflictModal's eyebrow + serif headline + circular close button):
 * that fits a real account decision, but this fires mid-game and should ask
 * one plain question, not stage it. Default focus lands on Cancel, and
 * backdrop/Escape dismiss resolves the same way, for the same reason
 * RestoreConflictModal keeps that rule: an accidental dismiss must never
 * silently pick the destructive option.
 */
export function LeaveGameConfirmModal({
  body,
  onConfirm,
  onCancel,
  confirmLabel = "Leave anyway",
  cancelLabel = "Stay",
}: {
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onCancel);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal leave-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-game-confirm-title"
        aria-describedby="leave-game-confirm-body"
      >
        <h2 id="leave-game-confirm-title">Leave now?</h2>
        <p id="leave-game-confirm-body">{body}</p>
        <div className="room-created-actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="secondary-action"
            onClick={() => { tapSound(); onCancel(); }}
          >
            {cancelLabel}
          </button>
          <button type="button" className="primary-action" onClick={() => { selectSound(); onConfirm(); }}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

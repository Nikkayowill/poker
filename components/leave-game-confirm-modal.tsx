"use client";

import { X } from "lucide-react";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * Shared "leave while Gold is on the line" confirmation — used by
 * FloorBackLink (every arcade/duel/cribbage/blackjack header) and by
 * poker-table.tsx's own leave controls, which don't route through that link.
 *
 * Backdrop/Escape dismiss behaves as Cancel, same reasoning as
 * RestoreConflictModal: an accidental dismiss must never silently pick the
 * destructive option.
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
        className="profile-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-game-confirm-title"
        aria-describedby="leave-game-confirm-body"
      >
        <header className="profile-modal-header">
          <div>
            <span>WAGER IN PLAY</span>
            <h2 id="leave-game-confirm-title">Leave now?</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={() => { tapSound(); onCancel(); }}
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </header>

        <div className="room-created-body">
          <p id="leave-game-confirm-body">{body}</p>

          <div className="room-created-actions">
            <button type="button" className="secondary-action" onClick={() => { tapSound(); onCancel(); }}>
              {cancelLabel}
            </button>
            <button type="button" className="primary-action" onClick={() => { selectSound(); onConfirm(); }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

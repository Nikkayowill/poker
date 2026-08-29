"use client";

import { X } from "lucide-react";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * Shown when the OAuth callback route deferred a Google sign-in because it
 * would otherwise discard this tab's own guest progress -- see
 * `findRestoreConflict` in lib/server/link-account.ts and the
 * `?restoreConfirm=1` effect in poker-app.tsx.
 *
 * Backdrop/Escape dismiss behaves as Cancel, the non-destructive choice: an
 * accidental dismiss must never silently pick "discard the guest run,"
 * which is exactly the surprise this modal exists to prevent.
 */
export function RestoreConflictModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onCancel);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="restore-conflict-title"
        aria-describedby="restore-conflict-body"
      >
        <header className="profile-modal-header">
          <div>
            <span>GOOGLE SIGN-IN</span>
            <h2 id="restore-conflict-title">This account already exists</h2>
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
          <p id="restore-conflict-body">
            That Google account already has a StackChips profile — its own Gold,
            collection, and stats. Continuing signs you into that account and{" "}
            <strong>this guest run&apos;s progress will not be saved.</strong>
          </p>

          <div className="room-created-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => { tapSound(); onCancel(); }}
            >
              Stay on this guest run
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => { selectSound(); onConfirm(); }}
            >
              Sign into that account
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

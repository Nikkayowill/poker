"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

/**
 * Shown once, immediately after hosting a private table.
 *
 * The room code used to live permanently in the table header. It does not
 * need to: a code matters intensely for about thirty seconds -- while you are
 * sending it to people -- and never again for the rest of the session. So it
 * gets one prominent moment here, and afterwards lives in the avatar menu for
 * whoever asks late.
 */
export function RoomCreatedModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const shareUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/?code=${encodeURIComponent(code)}`;

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard permission can be refused; the code is displayed in full
      // above, so it stays readable and typeable either way.
    }
  };

  // navigator.share exists on phones and almost nowhere else, so the button
  // is only offered where it will actually do something rather than being
  // rendered and then failing.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        className="profile-modal room-created-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-created-title"
      >
        <header className="profile-modal-header">
          <div>
            <span>PRIVATE TABLE</span>
            <h2 id="room-created-title">Room created</h2>
          </div>
          <button ref={closeRef} className="modal-close" onClick={() => { tapSound(); onClose(); }} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="room-created-body">
          <p>Share this code and everyone lands on the same felt.</p>
          {/* Letter-spaced and large: this is meant to be read aloud over a
              call or copied by eye, not just clicked. */}
          <strong className="room-created-code" aria-label={`Room code ${code.split("").join(" ")}`}>
            {code}
          </strong>

          <div className="room-created-actions">
            <button type="button" className="secondary-action" onClick={() => { selectSound(); void copy(code); }}>
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy code</>}
            </button>
            {canShare && (
              <button
                type="button"
                className="secondary-action"
                onClick={() => { selectSound(); void navigator.share({
                  title: "StackChips",
                  text: `Join my table with code ${code}`,
                  url: shareUrl,
                }).catch(() => {
                  // Dismissing the share sheet rejects; that is a choice, not
                  // an error, and needs no message.
                }); }}
              >
                <Share2 size={15} /> Share
              </button>
            )}
            <button type="button" className="primary-action" onClick={() => { tapSound(); onClose(); }}>
              Start playing
            </button>
          </div>

          <small className="room-created-hint">
            The code stays available in your profile menu.
          </small>
        </div>
      </section>
    </div>
  );
}

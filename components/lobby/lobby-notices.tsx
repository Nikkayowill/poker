"use client";

import { Check, Cloud, Coins, ShieldCheck, X } from "lucide-react";
import { CHEAPEST_TIER, TIER_CONFIG } from "@/lib/game/tiers";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

/**
 * The four status notices that sit above the lobby's own hero content --
 * a cash-out receipt, a one-line auth confirmation, the guest "save your
 * progress" upsell, and the below-the-minimum top-up offer. Byte-for-byte
 * duplicated between lobby.tsx's desktop render and mobile-shell.tsx's
 * PlayPane before this was pulled out; both render it identically, so this
 * is the only copy of the markup either needs to agree with.
 */
export function LobbyNotices({
  loading,
  cashOutNotice,
  onDismissCashOut,
  authNotice,
  onDismissAuthNotice,
  showSavePrompt,
  onSaveProgress,
  onDismissSaveProgress,
  needsTopUp,
  onClaimBackstop,
}: {
  /** Disables the top-up button while a request the pane is already tracking is in flight. */
  loading: boolean;
  cashOutNotice: number | null;
  onDismissCashOut: () => void;
  authNotice: string | null;
  onDismissAuthNotice: () => void;
  showSavePrompt: boolean;
  onSaveProgress: () => void;
  onDismissSaveProgress: () => void;
  needsTopUp: boolean;
  onClaimBackstop: () => void;
}) {
  return (
    <>
      {cashOutNotice !== null && (
        <div className="cash-out-notice" role="status">
          <Coins size={15} />
          <span>
            Cashed out <strong>{cashOutNotice.toLocaleString()}</strong> Gold from the table.
          </span>
          <button type="button" onClick={() => { tapSound(); onDismissCashOut(); }} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      {authNotice && (
        <div className="cash-out-notice" role="status">
          <Check size={15} />
          <span>{authNotice}</span>
          <button type="button" onClick={() => { tapSound(); onDismissAuthNotice(); }} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      {showSavePrompt && (
        <div className="save-progress-notice" role="status" aria-label="Save guest progress">
          <div className="save-progress-icon" aria-hidden="true"><Cloud size={18} /></div>
          <div className="save-progress-copy">
            <strong>Your run is worth keeping</strong>
            <span>
              This guest profile lives only in this browser. Save your Gold, avatar,
              and collection to an account before they get left behind.
            </span>
            <small><ShieldCheck size={12} /> Google sign-in · No password to remember</small>
          </div>
          <div className="save-progress-actions">
            <button type="button" className="save-progress-primary" onClick={() => { selectSound(); onSaveProgress(); }}>
              Save progress
            </button>
            <button type="button" className="save-progress-later" onClick={() => { tapSound(); onDismissSaveProgress(); }}>
              Maybe later
            </button>
          </div>
        </div>
      )}
      {needsTopUp && (
        <div className="broke-notice" role="status">
          <span>
            You&rsquo;re below the {TIER_CONFIG[CHEAPEST_TIER].minBuyIn.toLocaleString()} Gold minimum for the
            cheapest seat.
          </span>
          <button type="button" className="secondary-action" disabled={loading} onClick={() => { selectSound(); onClaimBackstop(); }}>
            Claim a top-up
          </button>
        </div>
      )}
    </>
  );
}

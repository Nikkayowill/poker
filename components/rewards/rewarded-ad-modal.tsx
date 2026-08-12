"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Coins, X } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import type { RewardTrigger } from "@/lib/rewards/triggers";
import {
  REWARDED_AD_DURATION_SECONDS,
  REWARDED_AD_GOLD,
  REWARDED_AD_OFFER_LABEL,
} from "@/lib/rewards/config";
import { REWARDED_AD_UNIT } from "@/lib/ads/adsterra";
import { AdsterraSlot } from "@/components/ads/adsterra-slot";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

/**
 * The offer, the ad, and the claim.
 *
 * Four states, one at a time: `offer` (take it or leave it), `watching` (the
 * unit is mounted and a countdown runs), `claiming` (the POST is in flight),
 * and `done`. There is no path that skips `watching`.
 *
 * THE COUNTDOWN IS NOT THE RULE
 *
 * The number on screen is a readout. The server issued the grant, wrote the
 * moment it did so, and re-derives the elapsed time from its own clock when
 * the claim arrives -- so a player who edits this countdown to zero simply
 * gets a 409 with the real remaining seconds in it, which is why the error
 * branch below renders the server's message verbatim rather than a generic
 * one. See lib/server/rewarded-ad-service.ts for what that guard can and
 * cannot establish.
 *
 * THE REWARD IS NOT CONDITIONAL ON THE AD RENDERING
 *
 * Deliberate. The unit sits in a sandboxed iframe with no same-origin access
 * (components/ads/adsterra-slot.tsx), so this document has no way to observe
 * whether it painted, and an ad blocker, a CSP block or a vendor outage would
 * otherwise strand a player behind a wait they completed. They did the thirty
 * seconds; they get the Gold.
 */

type Phase = "offer" | "watching" | "claiming" | "done";

interface GrantResponse {
  grantId: string;
  rewardGold: number;
  waitMs: number;
  remainingToday: number;
}

/** "4:32" once the wait is a minute or more, "45 seconds" below that -- same convention as the puzzle countdowns. */
function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface RewardedAdModalProps {
  trigger: RewardTrigger;
  onClose: () => void;
  /**
   * Handed the credited profile so the navbar balance updates without a
   * re-fetch, plus how many claims the server says are left today -- a caller
   * offering this outside an achievement (the lobby menu's "Free Gold" row)
   * uses that to stop offering it once the daily cap is actually reached,
   * rather than only once the balance climbs back over the threshold.
   */
  onCredited: (profile: PlayerProfile, remainingToday: number) => void;
  /** A guest cannot take this offer; the modal points them at the account flow instead. */
  onSaveProgress?: () => void;
  /** The server says today's cap is already spent. Same reason as onCredited's remainingToday. */
  onDailyLimitReached?: () => void;
}

export function RewardedAdModal({ trigger, onClose, onCredited, onSaveProgress, onDailyLimitReached }: RewardedAdModalProps) {
  const [phase, setPhase] = useState<Phase>("offer");
  const [grant, setGrant] = useState<GrantResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REWARDED_AD_DURATION_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [awarded, setAwarded] = useState(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Read by the unmount cleanup only. A grant the player walked away from has
  // to be released, or the one-pending-per-profile index blocks their next
  // offer until it ages out.
  const grantRef = useRef<GrantResponse | null>(null);
  const claimedRef = useRef(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape closes, but not mid-watch: a stray keypress should not throw
      // away a wait in progress. The × is always there for a deliberate exit.
      if (event.key === "Escape" && phase !== "watching" && phase !== "claiming") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, phase]);

  // Abandonment cleanup. keepalive so it survives the tab closing, which is
  // the single most likely way a grant is abandoned.
  useEffect(() => () => {
    const pending = grantRef.current;
    if (!pending || claimedRef.current) return;
    void fetch(`/api/profile/gold/rewarded?grant=${encodeURIComponent(pending.grantId)}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {
      // Best effort by design: the grant ages out on its own, and
      // startRewardedAd resumes or sweeps it on the next attempt.
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setNeedsAccount(false);
    try {
      const response = await fetch("/api/profile/gold/rewarded", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        if (data.reason === "guest") setNeedsAccount(true);
        if (data.reason === "daily-limit") onDailyLimitReached?.();
        throw new Error(data.error ?? "Could not start that ad.");
      }
      const issued = data.grant as GrantResponse;
      setGrant(issued);
      grantRef.current = issued;
      // Seeded from the server's own remaining time, not from the constant, so
      // a resumed grant (a reload mid-ad) picks up where it actually is.
      setSecondsLeft(Math.ceil(issued.waitMs / 1000));
      setPhase("watching");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start that ad.");
    }
  }, [onDailyLimitReached]);

  const claim = useCallback(async () => {
    if (!grant) return;
    setPhase("claiming");
    setError(null);
    try {
      const response = await fetch("/api/profile/gold/rewarded/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId: grant.grantId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.reason === "daily-limit") onDailyLimitReached?.();
        throw new Error(data.error ?? "Could not claim that reward.");
      }
      claimedRef.current = true;
      grantRef.current = null;
      setAwarded(data.awarded ?? grant.rewardGold);
      onCredited(data.profile, data.remainingToday ?? 0);
      setPhase("done");
    } catch (caught) {
      // Back to `watching` rather than to `offer`: the grant is still valid and
      // still theirs, so the button they need is Claim, not Start over.
      setPhase("watching");
      setError(caught instanceof Error ? caught.message : "Could not claim that reward.");
    }
  }, [grant, onCredited, onDailyLimitReached]);

  // The countdown. A setInterval, not a per-frame timer: nothing here animates,
  // and one tick a second is exactly the resolution the readout has.
  useEffect(() => {
    if (phase !== "watching" || secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, secondsLeft]);

  const ready = phase === "watching" && secondsLeft <= 0;

  return (
    <div
      className="profile-overlay rewarded-ad-overlay"
      role="presentation"
      onMouseDown={(event) => {
        // No click-outside dismissal while an ad is running or a claim is in
        // flight -- losing a completed wait to a misplaced click is the worst
        // thing this modal could do.
        if (event.currentTarget === event.target && phase !== "watching" && phase !== "claiming") onClose();
      }}
    >
      <section
        className="profile-modal rewarded-ad-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewarded-ad-title"
      >
        <header className="profile-modal-header">
          <div>
            <span>{trigger.headline.toUpperCase()}</span>
            <h2 id="rewarded-ad-title">
              {phase === "done" ? "Gold added" : `${REWARDED_AD_GOLD.toLocaleString("en-US")} Gold`}
            </h2>
          </div>
          <button ref={closeRef} className="modal-close" onClick={() => { tapSound(); onClose(); }} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="rewarded-ad-body">
          {phase === "offer" && (
            <>
              <p className="rewarded-ad-detail">{trigger.detail}</p>
              <p className="rewarded-ad-offer">{REWARDED_AD_OFFER_LABEL}.</p>
              {error && <p className="rewarded-ad-error" role="alert">{error}</p>}
              <div className="rewarded-ad-actions">
                {needsAccount && onSaveProgress
                  ? (
                    <button type="button" className="primary-action" onClick={() => { selectSound(); onSaveProgress(); }}>
                      Save progress to unlock
                    </button>
                  )
                  : (
                    <button type="button" className="primary-action" onClick={() => { selectSound(); void start(); }}>
                      <Coins size={15} /> Watch and claim
                    </button>
                  )}
                <button type="button" className="secondary-action" onClick={() => { tapSound(); onClose(); }}>
                  Not now
                </button>
              </div>
            </>
          )}

          {(phase === "watching" || phase === "claiming") && (
            <>
              {/* Fixed box from first paint, so nothing in the page reflows
                  when the unit fills or fails. See adsterra-slot.tsx. */}
              <AdsterraSlot
                adKey={REWARDED_AD_UNIT.adKey}
                scriptSrc={REWARDED_AD_UNIT.scriptSrc}
                width={REWARDED_AD_UNIT.width}
                height={REWARDED_AD_UNIT.height}
                className="rewarded-ad-slot"
              />
              <p className="rewarded-ad-countdown" aria-live="polite">
                {ready
                  ? `Ready — claim your ${REWARDED_AD_GOLD.toLocaleString("en-US")} Gold.`
                  : `${formatCountdown(secondsLeft)} to go…`}
              </p>
              {error && <p className="rewarded-ad-error" role="alert">{error}</p>}
              {/* `ready` already implies phase === "watching", so an in-flight
                  claim is disabled by !ready alone; testing "claiming" again on
                  the button is a comparison TypeScript proves dead. */}
              <div className="rewarded-ad-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => { selectSound(); void claim(); }}
                  disabled={!ready}
                >
                  {phase === "claiming"
                    ? "Claiming…"
                    : <><Coins size={15} /> Claim {REWARDED_AD_GOLD.toLocaleString("en-US")} Gold</>}
                </button>
              </div>
              {grant && grant.remainingToday > 0 && (
                <small className="rewarded-ad-hint">
                  {grant.remainingToday} more available today.
                </small>
              )}
            </>
          )}

          {phase === "done" && (
            <>
              <p className="rewarded-ad-done">
                <Check size={18} /> {awarded.toLocaleString("en-US")} Gold added to your balance.
              </p>
              <div className="rewarded-ad-actions">
                <button type="button" className="primary-action" onClick={() => { tapSound(); onClose(); }}>
                  Back to the table
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

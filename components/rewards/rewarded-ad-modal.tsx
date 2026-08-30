"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Check, Coins, X } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import type { RewardTrigger } from "@/lib/rewards/triggers";
import {
  ADMOB_SSV_POLL_INTERVAL_MS,
  ADMOB_SSV_POLL_TIMEOUT_MS,
  REWARDED_AD_DURATION_SECONDS,
  REWARDED_AD_GOLD,
  REWARDED_AD_OFFER_LABEL,
} from "@/lib/rewards/config";
import { REWARDED_AD_UNIT } from "@/lib/ads/adsterra";
import { watchNativeRewardedAd } from "@/lib/ads/admob-native";
import { AdsterraSlot } from "@/components/ads/adsterra-slot";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useModalDismiss } from "@/components/use-modal-dismiss";

/**
 * The offer, the ad, and the claim.
 *
 * Four states, one at a time: `offer` (take it or leave it), `watching` (the
 * unit is mounted and a countdown runs), `claiming` (the POST is in flight),
 * and `done`. There is no path that skips `watching`.
 *
 * The number on screen is a readout, not the rule. The server issued the
 * grant, wrote the moment it did so, and re-derives the elapsed time from
 * its own clock when the claim arrives, so a player who edits this countdown
 * to zero simply gets a 409 with the real remaining seconds in it, which is
 * why the error branch below renders the server's message verbatim rather
 * than a generic one. See lib/server/rewarded-ad-service.ts for what that
 * guard can and cannot establish.
 *
 * The reward is also not conditional on the ad actually rendering. The unit
 * sits in a sandboxed iframe with no same-origin access
 * (components/ads/adsterra-slot.tsx), so this document has no way to observe
 * whether it painted, and an ad blocker, a CSP block or a vendor outage would
 * otherwise strand a player behind a wait they completed. They did the thirty
 * seconds; they get the Gold.
 *
 * On the native shell (Capacitor.isNativePlatform()) this whole grant/claim
 * dance is replaced outright: there is no client-issued grant, no countdown
 * to fake, and no "trust the wait" fallback, because AdMob's rewarded-video
 * unit carries real server-side verification (see lib/server/admob-ssv-
 * service.ts). The native branch shows the platform's own ad UI (an
 * out-of-process overlay this component never renders), then polls
 * /api/profile/gold/admob-status for the one thing this device cannot
 * observe directly: whether Google's signed callback has reached our server
 * and actually moved the balance yet.
 */

type Phase = "offer" | "watching" | "claiming" | "done";

interface GrantResponse {
  grantId: string;
  rewardGold: number;
  waitMs: number;
  remainingToday: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "4:32" once the wait is a minute or more, "45 seconds" below that; same convention as the puzzle countdowns. */
function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface RewardedAdModalProps {
  trigger: RewardTrigger;
  /** Needed only on the native branch: AdMob's SSV callback identifies the player by profile id, and eligibility (registered, not unlimited Gold) is checked client-side before an ad view is spent on someone who could never be credited for it. */
  profile: PlayerProfile | null;
  onClose: () => void;
  /**
   * Handed the credited profile so the navbar balance updates without a
   * re-fetch, plus how many claims the server says are left today. A caller
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

export function RewardedAdModal({ trigger, profile, onClose, onCredited, onSaveProgress, onDailyLimitReached }: RewardedAdModalProps) {
  const isNative = Capacitor.isNativePlatform();
  const [phase, setPhase] = useState<Phase>("offer");
  const [grant, setGrant] = useState<GrantResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REWARDED_AD_DURATION_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [awarded, setAwarded] = useState(0);
  // Set only once the native poll (see startNative) gives up without ever
  // seeing the callback land. Not an error -- the ad genuinely finished --
  // just the one state where the player should be free to close the modal
  // without the "walked away mid-wait" framing canDismiss gives "watching".
  const [pollTimedOut, setPollTimedOut] = useState(false);
  // Escape and backdrop-click close, but not mid-watch: a stray keypress or
  // misplaced click should not throw away a wait in progress. The × is
  // always there for a deliberate exit (its own onClick is unguarded, below).
  const canDismiss = pollTimedOut || (phase !== "watching" && phase !== "claiming");
  const { closeButtonRef: closeRef, onBackdropMouseDown } = useModalDismiss(onClose, canDismiss);
  // Read by the unmount cleanup only. A grant the player walked away from has
  // to be released, or the one-pending-per-profile index blocks their next
  // offer until it ages out.
  const grantRef = useRef<GrantResponse | null>(null);
  const claimedRef = useRef(false);

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

  /**
   * The native path: no grant, no countdown. AdMob's own overlay plays the
   * video (this component never renders anything for it -- see phase
   * "watching" below, which on native shows a waiting message rather than
   * the AdsterraSlot), and once it reports the reward was earned the only
   * thing left to do is find out whether Google's SSV callback has reached
   * our server yet.
   */
  const startNative = useCallback(async () => {
    setError(null);
    setNeedsAccount(false);
    setPollTimedOut(false);
    if (!profile || !profile.isRegistered) {
      setNeedsAccount(true);
      return;
    }
    const adUnitId = process.env.NEXT_PUBLIC_ADMOB_REWARDED_AD_UNIT_ID;
    if (!adUnitId) {
      setError("Ads aren't set up on this build yet.");
      return;
    }
    // Same pre-flight the web path gets for free from its grant request
    // (see start()'s reason === "daily-limit" check) -- without this, a
    // capped-out player plays a full rewarded video that the eventual SSV
    // callback can never credit.
    try {
      const response = await fetch("/api/profile/gold/admob-status");
      const data = await response.json();
      if (response.ok && data.remainingToday === 0) {
        onDailyLimitReached?.();
        setError("You've hit today's ad limit. Come back tomorrow for more.");
        return;
      }
    } catch {
      // Transient network hiccup on the precheck alone -- fall through and
      // let the real SSV daily-cap trigger be the backstop, same as ever.
    }
    const isTesting = process.env.NEXT_PUBLIC_ADMOB_USE_TEST_ADS === "true";
    const nonce = crypto.randomUUID();
    setPhase("watching");
    try {
      const result = await watchNativeRewardedAd(adUnitId, { userId: profile.id, customData: nonce }, isTesting);
      if (!result.earned) {
        setPhase("offer");
        setError("The ad was closed before it finished, so there's nothing to claim yet.");
        return;
      }
    } catch (caught) {
      setPhase("offer");
      setError(caught instanceof Error ? caught.message : "No ad is available right now. Try again shortly.");
      return;
    }

    // The ad earned its reward on-device; the credit itself is still in
    // flight over Google's own network (see the module doc comment). Poll
    // rather than block indefinitely, and never treat a timeout as failure
    // -- the callback may simply still be arriving.
    setPhase("claiming");
    const deadline = Date.now() + ADMOB_SSV_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`/api/profile/gold/admob-status?nonce=${encodeURIComponent(nonce)}`);
        const data = await response.json();
        if (response.ok && data.credited) {
          const profileResponse = await fetch("/api/profile", { method: "POST" });
          const profileData = await profileResponse.json();
          setAwarded(data.awarded);
          if (profileResponse.ok) onCredited(profileData.profile, data.remainingToday ?? 0);
          setPhase("done");
          return;
        }
      } catch {
        // Transient network hiccup on the poll itself -- keep trying until
        // the deadline rather than surface an error for this alone.
      }
      await sleep(ADMOB_SSV_POLL_INTERVAL_MS);
    }
    setPollTimedOut(true);
    // Deliberately doesn't promise the Gold is still coming: a rejected SSV
    // callback (daily cap hit between the precheck above and now, a stale
    // signature, an ineligible profile) never writes a receipt at all, so
    // this poll timeout looks identical to "still in flight" from here --
    // there's nothing this client can tell the two apart with.
    setError("Couldn't confirm your reward yet. If your balance hasn't updated in a minute, it likely didn't go through -- try again later.");
  }, [profile, onCredited, onDailyLimitReached]);

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
      onMouseDown={onBackdropMouseDown}
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
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => { selectSound(); void (isNative ? startNative() : start()); }}
                    >
                      <Coins size={15} /> Watch and claim
                    </button>
                  )}
                <button type="button" className="secondary-action" onClick={() => { tapSound(); onClose(); }}>
                  Not now
                </button>
              </div>
            </>
          )}

          {isNative && (phase === "watching" || phase === "claiming") && (
            <>
              {/* AdMob's rewarded unit is a native, out-of-process overlay --
                  there is nothing for this component to render for the ad
                  itself, only the states around it. */}
              <p className="rewarded-ad-countdown" aria-live="polite">
                {phase === "watching" ? "Playing the ad…" : "Confirming your reward…"}
              </p>
              {error && <p className="rewarded-ad-error" role="alert">{error}</p>}
              {pollTimedOut && (
                <div className="rewarded-ad-actions">
                  <button type="button" className="primary-action" onClick={() => { tapSound(); onClose(); }}>
                    Close
                  </button>
                </div>
              )}
            </>
          )}

          {!isNative && (phase === "watching" || phase === "claiming") && (
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

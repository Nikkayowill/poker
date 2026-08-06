"use client";

import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { useInstallOffer } from "@/components/pwa/use-install-offer";

const DISMISS_STORAGE_KEY = "river.installPromptDismissedAt";
// Not gone forever on one tap: a player might dismiss out of reflex the
// first time and still want the nudge next session.
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A non-intrusive "install to home screen" nudge for the lobby hub.
 *
 * The platform detection and the captured `beforeinstallprompt` now come from
 * useInstallOffer, shared with the landing page's install panel -- the two
 * surfaces must agree about whether the app is already installed, and two
 * copies of that check is how they stop agreeing.
 *
 * What stays local to this component is what makes it a *nudge* rather than a
 * destination: the dismissal cooldown, and the rule that Android/desktop show
 * nothing until Chromium actually offers an install. The landing panel
 * deliberately does not follow that second rule; see its own header for why.
 */
export function InstallPrompt() {
  const { platform, installed, canPrompt, promptInstall } = useInstallOffer();
  // Starts hidden and only reveals once the dismissal cooldown has actually
  // been checked, so a returning visitor never sees a one-frame flash of a
  // banner they already dismissed.
  const [withinCooldown, setWithinCooldown] = useState(true);

  useEffect(() => {
    // Deferred a tick for the same reason useInstallOffer defers its own
    // reads -- see the note there.
    const timer = window.setTimeout(() => {
      const dismissedAt = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY) ?? 0);
      setWithinCooldown(Boolean(dismissedAt) && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    setWithinCooldown(true);
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "dismissed") dismiss();
  };

  if (installed || withinCooldown || platform === null) return null;
  const ios = platform === "ios";
  // Android/desktop Chrome: nothing to show until the browser actually
  // offers an install, which it withholds until its own engagement heuristics
  // are met -- there's no earlier moment to jump the gun from.
  if (!ios && !canPrompt) return null;

  return (
    <div className="save-progress-notice pwa-install-notice" role="status" aria-label="Install StackChips">
      <div className="save-progress-icon" aria-hidden="true">
        {ios ? <Share2 size={18} /> : <Download size={18} />}
      </div>
      <div className="save-progress-copy">
        <strong>Play like an app</strong>
        <span>
          {ios
            ? "Tap Share, then “Add to Home Screen” for instant, full-screen access."
            : "Install StackChips for instant, full-screen access from your home screen."}
        </span>
      </div>
      <div className="save-progress-actions">
        {ios
          ? <button type="button" className="save-progress-primary" onClick={dismiss}>Got it</button>
          : <button type="button" className="save-progress-primary" onClick={() => void install()}>Install</button>}
        <button type="button" className="save-progress-later" onClick={dismiss}>Maybe later</button>
      </div>
    </div>
  );
}

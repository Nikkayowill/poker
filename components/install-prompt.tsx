"use client";

import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { useInstallOffer } from "@/components/pwa/use-install-offer";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";

const DISMISS_STORAGE_KEY = "river.installPromptDismissedAt";
// Not gone forever on one tap: a player might dismiss out of reflex the
// first time and still want the nudge next session.
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A non-intrusive "install to home screen" nudge for the lobby hub.
 *
 * The platform detection and the captured `beforeinstallprompt` come from
 * useInstallOffer, shared with the landing page's install panel: the two
 * surfaces must agree about whether the app is already installed, and two
 * copies of that check is how they stop agreeing.
 *
 * What stays local to this component is what makes it a nudge rather than a
 * destination: the dismissal cooldown, and the rule that Android/desktop
 * show nothing until Chromium actually offers an install. The landing panel
 * does not follow that second rule; see its own header for why.
 */
export function InstallPrompt() {
  const { platform, installed, canPrompt, promptInstall } = useInstallOffer();
  // Starts hidden and only reveals once the dismissal cooldown has actually
  // been checked, so a returning visitor never sees a one-frame flash of a
  // banner they already dismissed.
  const [withinCooldown, setWithinCooldown] = useState(true);

  useEffect(() => {
    // Deferred a tick for the same reason useInstallOffer defers its own
    // reads, see the note there.
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
  // offers an install, which it withholds until its own engagement
  // heuristics are met. There's no earlier moment to jump the gun from.
  if (!ios && !canPrompt) return null;

  // One line, pinned to the viewport's bottom edge: an icon, a sentence, and
  // (where the browser can actually install) one action. The paragraph-and-
  // two-buttons card this replaced said the same thing in five times the
  // pixels.
  return (
    <div className="install-strip" role="status" aria-label="Install StackChips">
      <span className="install-strip-icon" aria-hidden="true">
        {ios ? <Share2 size={14} /> : <Download size={14} />}
      </span>
      <span className="install-strip-copy">
        {ios ? "Tap Share then Add to Home Screen." : "Add StackChips to your Home Screen."}
      </span>
      {!ios && (
        <button type="button" className="install-strip-action" onClick={() => { selectSound(); void install(); }}>
          Install App
        </button>
      )}
      <button type="button" className="install-strip-dismiss" aria-label="Dismiss" onClick={() => { tapSound(); dismiss(); }}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

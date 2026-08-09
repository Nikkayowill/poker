"use client";

import { Download, Smartphone } from "lucide-react";
import { installShortStep } from "@/lib/pwa/platform";
import { useInstallOffer } from "@/components/pwa/use-install-offer";

/**
 * The install offer on the sign-in page, in one line.
 *
 * This replaces components/pwa/install-cta.tsx, which was a two-column
 * marketing panel on a landing page that no longer exists -- the signed-out
 * screen is the login form and nothing else now. What it inherits from that
 * file is the rule that made it a separate surface from the lobby's nudge
 * (components/install-prompt.tsx) in the first place, and that rule is worth
 * restating because it is the whole reason two of these exist:
 *
 * - install-prompt is a *nudge*. It interrupts, so it is dismissible with a
 *   14-day cooldown and stays silent until Chromium offers an install itself.
 * - this is a *statement*. It is a footnote a visitor is already looking at,
 *   so it always says what the platform can really do -- including, on iOS and
 *   on anything that has not fired `beforeinstallprompt`, the manual taps.
 *   Waiting for that event here would leave the page silent about the app on
 *   the device class most likely to install it.
 *
 * Already-installed is still the one state that hides it entirely: an install
 * offer inside an installed app is noise.
 */
export function InstallLine() {
  const { platform, installed, canPrompt, promptInstall } = useInstallOffer();

  // platform is null only for the first tick, before the UA has been read.
  // Rendering a guess and correcting it is a visible flicker.
  if (installed || platform === null) return null;

  return (
    <p className="entry-install">
      <Smartphone size={14} aria-hidden="true" />
      {canPrompt ? (
        <>
          <span>Install StackChips as an app.</span>
          <button type="button" className="entry-install-action" onClick={() => void promptInstall()}>
            <Download size={13} aria-hidden="true" /> Install
          </button>
        </>
      ) : (
        // No button, because there is no programmatic install to fire. A
        // button that does nothing is worse than the taps that work.
        <span>Install as an app: {installShortStep(platform)}.</span>
      )}
    </p>
  );
}

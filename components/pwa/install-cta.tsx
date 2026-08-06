"use client";

import { Download, Share, Smartphone, WifiOff, Zap } from "lucide-react";
import { installHeadline, manualInstallSteps } from "@/lib/pwa/platform";
import { useInstallOffer } from "@/components/pwa/use-install-offer";

/**
 * The landing page's install panel.
 *
 * Distinct from components/install-prompt.tsx on purpose, and the difference
 * is the whole point of this file existing:
 *
 * - install-prompt is a *nudge*. It lives in the lobby hub, interrupts, and
 *   is therefore dismissible with a 14-day cooldown, and it stays silent
 *   until Chromium has decided to offer an install of its own accord.
 * - this is a *destination*. It is a section of the marketing page that a
 *   visitor scrolled to, so it always renders whatever the platform can
 *   actually do -- including, on iOS and on any browser that has not fired
 *   `beforeinstallprompt`, the manual steps. Waiting for the event here would
 *   mean the page mostly says nothing about the app on the one device class
 *   most likely to install it.
 *
 * The only state that hides it entirely is already-installed: an install
 * panel inside an installed app is noise.
 */
export function InstallCta() {
  const { platform, installed, canPrompt, promptInstall } = useInstallOffer();

  // platform is null only for the first tick, before the UA has been read.
  // Rendering a guess and correcting it is a visible flicker on the largest
  // block on the page.
  if (installed || platform === null) return null;

  const steps = manualInstallSteps(platform);

  return (
    <section className="install-cta" aria-labelledby="install-cta-title">
      <div className="install-cta-copy">
        <span className="install-cta-badge">
          <Smartphone size={13} aria-hidden="true" /> Progressive web app
        </span>
        <h2 id="install-cta-title">{installHeadline(platform)}</h2>
        <p>
          No app store, no download queue, no 200MB. StackChips installs
          straight from the browser and opens full-screen from your home
          screen — same account, same Gold, same tables.
        </p>
        <ul className="install-cta-perks">
          <li><Zap size={14} aria-hidden="true" /> Opens instantly, no address bar</li>
          <li><WifiOff size={14} aria-hidden="true" /> Shell is cached, so it loads on a bad connection</li>
          <li><Download size={14} aria-hidden="true" /> Updates itself — nothing to reinstall</li>
        </ul>

        {canPrompt ? (
          <button type="button" className="install-cta-button" onClick={() => void promptInstall()}>
            <Download size={17} aria-hidden="true" /> Install StackChips
          </button>
        ) : (
          // No button, because there is no programmatic install to fire. A
          // button that does nothing is worse than the three steps that work.
          <p className="install-cta-note">
            {platform === "ios"
              ? <><Share size={14} aria-hidden="true" /> Safari installs from the Share menu — three taps:</>
              : <><Smartphone size={14} aria-hidden="true" /> Add it from your browser menu — three taps:</>}
          </p>
        )}
      </div>

      <ol className="install-cta-steps" aria-label="How to install">
        {steps.map((step, index) => (
          <li key={step}>
            <span className="install-cta-step-number" aria-hidden="true">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

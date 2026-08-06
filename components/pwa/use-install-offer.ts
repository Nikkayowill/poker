"use client";

import { useEffect, useState } from "react";
import { installPlatform, type InstallPlatform } from "@/lib/pwa/platform";

/**
 * The browser side of the install offer, shared by the landing page's
 * always-on panel and the lobby hub's dismissible nudge.
 *
 * It exists because those two surfaces have to agree about three facts that
 * are all easy to get subtly different: whether the app is already installed
 * (in which case neither should render anything at all), which platform's
 * instructions apply, and whether a replayable `beforeinstallprompt` was
 * captured. The event fires once, on window, at a moment neither component
 * controls -- so both must be listening from mount, and both must agree.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export interface InstallOffer {
  /** Null until the platform has actually been read, so nothing renders on a
   *  guess during the first paint. */
  platform: InstallPlatform | null;
  /** True once running from the home screen -- there is nothing left to
   *  offer, and an install banner inside an installed app is a bug. */
  installed: boolean;
  /** Whether a real, pressable install exists right now. */
  canPrompt: boolean;
  /** Resolves to what the player chose, or null if there was nothing to
   *  prompt with. Chromium allows one replay per captured event. */
  promptInstall: () => Promise<"accepted" | "dismissed" | null>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function useInstallOffer(): InstallOffer {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  // Starts true so an already-installed session never flashes a banner it is
  // about to remove; the effect below corrects it a tick later.
  const [installed, setInstalled] = useState(true);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Deferred a tick rather than set in the effect body -- the same idiom
    // poker-app.tsx uses for its mount-time localStorage reads, which exists
    // to avoid the cascading-render lint rule on setState-in-effect.
    const timer = window.setTimeout(() => {
      setInstalled(isStandalone());
      setPlatform(installPlatform(window.navigator.userAgent, window.navigator.maxTouchPoints));
    }, 0);

    const onBeforeInstall = (event: Event) => {
      // Suppressing Chromium's own mini-infobar is the point of preventing
      // the default: the offer belongs in the page, next to the reason to
      // take it, not in a browser chrome strip.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return null;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The captured event is single-use; holding it would give a button that
    // silently does nothing on the second press.
    setDeferred(null);
    if (outcome === "accepted") setInstalled(true);
    return outcome;
  };

  return {
    platform,
    installed,
    canPrompt: deferred !== null,
    promptInstall,
  };
}

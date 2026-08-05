"use client";

import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";

const DISMISS_STORAGE_KEY = "river.installPromptDismissedAt";
// Not gone forever on one tap: a player might dismiss out of reflex the
// first time and still want the nudge next session.
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * A non-intrusive "install to home screen" nudge for the lobby hub.
 *
 * Chromium fires `beforeinstallprompt` and lets a saved copy of that event
 * be replayed later from a real button tap -- that's the Android/desktop
 * path below. iOS Safari never fires it at all; there is no programmatic
 * install there, only "Share -> Add to Home Screen", so that case gets
 * instructions instead of a button. Everything else (desktop Firefox,
 * desktop Safari) gets nothing: there's no real install path to offer, and
 * a banner with no working action is worse than no banner.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  // Starts hidden and only reveals once the dismissal cooldown has actually
  // been checked, so a returning visitor never sees a one-frame flash of a
  // banner they already dismissed.
  const [withinCooldown, setWithinCooldown] = useState(true);

  useEffect(() => {
    // Deferred a tick rather than set synchronously in the effect body --
    // same idiom poker-app.tsx uses for its own mount-time localStorage
    // reads (soundEnabled/musicEnabled), which exists to avoid the
    // cascading-render lint rule on setState-in-effect.
    const timer = window.setTimeout(() => {
      setInstalled(isStandalone());
      setIos(isIOS());
      const dismissedAt = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY) ?? 0);
      setWithinCooldown(Boolean(dismissedAt) && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS);
    }, 0);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    setWithinCooldown(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice.outcome === "accepted") setInstalled(true);
    else dismiss();
  };

  if (installed || withinCooldown) return null;
  // Android/desktop Chrome: nothing to show until the browser actually
  // offers an install, which it withholds until its own engagement heuristics
  // are met -- there's no earlier moment to jump the gun from.
  if (!ios && !deferredPrompt) return null;

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

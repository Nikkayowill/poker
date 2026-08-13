"use client";

import { useEffect, useId, useRef } from "react";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

// Cached across mounts so switching between sign-in and sign-up (which
// remounts this component) never injects the script twice.
let scriptLoad: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Turnstile."));
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/**
 * Cloudflare Turnstile bot check, paired with Supabase Auth's built-in
 * CAPTCHA verification (Authentication -> Attack Protection, server-side --
 * this component never sees the secret key). Renders nothing when no site
 * key is configured, so the form keeps working exactly as before until one
 * is set. See .env.example for the two-sided setup this depends on.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  resetSignal,
}: {
  siteKey: string | undefined;
  onToken: (token: string | null) => void;
  /** Bump after a failed submit -- tokens are single-use, so a retry needs a fresh one. */
  resetSignal: number;
}) {
  const containerId = `turnstile-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const widgetIdRef = useRef<string | null>(null);
  // Ref, not a dependency: the render callback should always call whatever
  // onToken the latest render passed, without tearing the widget down and
  // re-rendering it (and burning a fresh challenge) every parent re-render.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(`#${containerId}`, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, containerId]);

  useEffect(() => {
    if (resetSignal === 0 || !widgetIdRef.current || !window.turnstile) return;
    window.turnstile.reset(widgetIdRef.current);
    onTokenRef.current(null);
  }, [resetSignal]);

  if (!siteKey) return null;
  return <div id={containerId} className="account-turnstile" />;
}

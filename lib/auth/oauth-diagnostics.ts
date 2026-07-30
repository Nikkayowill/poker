"use client";

import * as Sentry from "@sentry/nextjs";

/**
 * Sign-in redirect telemetry.
 *
 * A wrong OAuth redirect is close to invisible from the server: Supabase sends
 * the browser wherever the *flow* recorded, so a stale bundle or a stale flow
 * strands the player on another origin without any request reaching this
 * deployment. These reports capture the values actually used in the browser at
 * the moment of the click, which is the only place that truth exists.
 */

/**
 * What the browser is about to hand Supabase as the post-Google destination.
 *
 * The destination is deliberately not called *Url: Sentry's data scrubber
 * redacted the first version of this field, and a diagnostic that arrives as
 * "[Filtered]" is no diagnostic at all.
 */
export function reportOAuthStart(callbackUrl: string): void {
  const detail = {
    redirectTarget: callbackUrl,
    origin: window.location.origin,
    href: window.location.href,
    buildSiteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    hasServiceWorker: Boolean(navigator.serviceWorker?.controller),
  };
  Sentry.addBreadcrumb({ category: "auth", level: "info", message: "oauth.start", data: detail });
  Sentry.captureMessage("oauth.start", { level: "info", extra: detail });
}

/**
 * An authorization code that arrived somewhere other than the callback route.
 * Supabase only does this when the flow's recorded redirect was a bare origin,
 * which today's code never sends -- so seeing this means the flow was started
 * by something else (a stale cached bundle, or an older deployment).
 */
export function reportStrayAuthCode(exchanged: boolean): void {
  const detail = {
    origin: window.location.origin,
    pathname: window.location.pathname,
    exchanged,
    buildSiteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    hasServiceWorker: Boolean(navigator.serviceWorker?.controller),
  };
  Sentry.captureMessage("oauth.stray_code_at_root", {
    level: exchanged ? "warning" : "error",
    extra: detail,
  });
}

/** A callback that never produced a session, with why-it-might-have-failed context. */
export function reportOAuthCallbackFailure(reason: string): void {
  Sentry.captureMessage("oauth.callback_failed", {
    level: "error",
    extra: {
      reason,
      origin: window.location.origin,
      href: window.location.href,
      buildSiteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    },
  });
}

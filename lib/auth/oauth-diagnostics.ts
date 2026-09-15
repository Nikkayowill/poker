"use client";

import { addTrail, reportMessage } from "@/lib/monitoring/monitor";

/**
 * Sign-in redirect telemetry.
 *
 * A wrong OAuth redirect is close to invisible from the server: Supabase sends
 * the browser wherever the *flow* recorded, so a stale bundle or a stale flow
 * strands the player on another origin without any request reaching this
 * deployment. These reports capture the values actually used in the browser at
 * the moment of the click, which is the only place that truth exists.
 */

// Reported through lib/monitoring/monitor.ts rather than "@sentry/nextjs"
// directly: poker-app.tsx imports this module, and naming the SDK here put
// its whole server build in every function that page belongs to.

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
  addTrail({ category: "auth", level: "info", message: "oauth.start", data: detail });
  reportMessage("oauth.start", { level: "info", extra: detail });
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
  reportMessage("oauth.stray_code_at_root", {
    level: exchanged ? "warning" : "error",
    extra: detail,
  });
}


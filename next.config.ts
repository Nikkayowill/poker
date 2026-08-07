import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Supabase Realtime/Storage endpoints are project-specific subdomains of
// supabase.co, so the CSP allow-lists that pattern rather than a single URL.
// Next.js dev mode (Fast Refresh, React's dev-mode error overlay) relies on
// eval(); that never ships in a production bundle, so it's only relaxed here.
const isDev = process.env.NODE_ENV !== "production";
// The Adsterra ad unit (components/ads/adsterra-slot.tsx, mounted by the
// rewarded-ad modal). Adsterra serves creative from sibling subdomains of the
// loader's host rather than a fixed host, so each entry is wildcarded on the
// subdomain -- and it moves publishers between *registrable domains* without
// notice, which is why there are now three. A loader on a domain this list
// does not name simply never executes: no error, no console entry the app can
// act on, just an empty box. lib/ads/adsterra.ts holds the same list in
// testable code and a unit test asserts the two agree, because next.config.ts
// cannot import from the app's module graph.
//
// Scope note, since this is a real widening of a previously deliberate stance:
// connect-src now names these three domains because the rewarded unit beacons
// its own impression, which is the vendor's own telemetry for creative the CSP
// already lets us load. It does NOT name spendsdetachment.com -- the unrelated
// domain the banner was seen reaching in an earlier pass, which stays blocked
// for exactly the reason recorded then.
const adsterraOrigins = [
  "https://*.effectivecpmnetwork.com",
  "https://*.profitabledisplaynetwork.com",
  "https://*.effectivecreativeformat.com",
].join(" ");
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${adsterraOrigins}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.supabase.co ${adsterraOrigins}`,
  "font-src 'self' data:",
  // Sentry's session-replay integration compresses events in a Worker
  // constructed from a blob: URL; without this it silently fails to record.
  "worker-src 'self' blob:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${adsterraOrigins}${isDev ? " ws:" : ""}`,
  // 'self' first, and it is not optional: the ad unit renders in a srcdoc
  // iframe, which has no URL of its own and is matched against the parent
  // document's own origin. Without it the whole slot is blocked before the
  // vendor's hosts are ever consulted -- and the previous value, which listed
  // only the ad origin, was blocking every same-origin frame in the app.
  `frame-src 'self' ${adsterraOrigins}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "river-room",

  project: "riverroom-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

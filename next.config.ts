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
// notice, which is why there are now three.
const adsterraOrigins = [
  "https://*.effectivecpmnetwork.com",
  "https://*.profitabledisplaynetwork.com",
  "https://*.effectivecreativeformat.com",
].join(" ");

// The Turnstile bot-check widget on the sign-in/sign-up form
// (components/auth/turnstile-widget.tsx). Fixed host, unlike Adsterra.
const turnstileOrigin = "https://challenges.cloudflare.com";

// Browser Sentry events used to be tunnelled through this app's own
// /monitoring route, which made every beacon a billed function invocation on
// an app with no users yet. They go straight to Sentry now, so the ingest
// host has to be reachable from the page.
const sentryIngestOrigin = "https://*.ingest.us.sentry.io";

// The canonical origin. Players land on www; the apex redirects there.
const siteOrigin = "https://www.stackchips.app";

const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' is for the 3D table room's Meshopt decoder
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${adsterraOrigins} ${turnstileOrigin}${isDev ? " 'unsafe-eval'" : ""}`,
  // 'unsafe-inline' above stays so pages can keep being served statically
  // (nonces would force a server render per visit). This still blocks inline
  // event-handler attributes like <img onerror=...>, the usual shape of an
  // injected-HTML attack. React never renders those.
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.supabase.co ${adsterraOrigins}`,
  "font-src 'self' data:",
  // Sentry's session-replay integration compresses events in a Worker
  "worker-src 'self' blob:",
  // blob: is for the 3D table room's GLTFLoader. Dev HMR needs ws: for its
  // websocket -- the bare scheme (any host) rather than a specific LAN IP,
  // so this doesn't leak a developer's home network address into source
  // control and still works from any device on the LAN, not just one.
  `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co ${sentryIngestOrigin} ${adsterraOrigins} ${turnstileOrigin}${isDev ? " ws:" : ""}`,
  `frame-src 'self' ${adsterraOrigins} ${turnstileOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// sharp is only reached by /api/profile/avatar (lib/profile/image.ts) and
// @vercel/og only by app/opengraph-image.tsx (an edge route, so it is bundled
// rather than traced), but Next traces both into every
// page function: 18.6MB of libvips plus ~3MB of og assets copied into 45 page
// bundles, about two thirds of this project's Vercel function storage. Vercel
// optimizes images on its own infrastructure and never calls the sharp inside a
// Lambda, so the page functions cannot use the copy they were carrying.
//
// The globs below list files, never directories. pnpm puts symlinked
// directories inside the @img trees and Turbopack panics if a trace entry
// resolves to one. The sharp include is pinned to the version package.json
// pins, so it picks up one libvips rather than every copy the store holds.
const sharpFiles = [
  "node_modules/.pnpm/**/@img/**",
  "node_modules/.pnpm/**/sharp/**",
  "node_modules/.pnpm/@img+*/**",
  "node_modules/.pnpm/sharp@*/**",
];

// sharp's entry point is dist/index.cjs, so a .js-only glob silently ships a
// route that cannot require it. Extensions are listed rather than a bare ** on
// the tree because pnpm symlinks @img directories in here too.
const sharpRuntimeFiles = [
  "node_modules/.pnpm/sharp@0.35.3*/node_modules/**/*.js",
  "node_modules/.pnpm/sharp@0.35.3*/node_modules/**/*.cjs",
  "node_modules/.pnpm/sharp@0.35.3*/node_modules/**/*.mjs",
  "node_modules/.pnpm/sharp@0.35.3*/node_modules/**/*.json",
  "node_modules/.pnpm/sharp@0.35.3*/node_modules/**/*.node",
  "node_modules/.pnpm/sharp@0.35.3*/node_modules/**/*.so.*",
];

const ogFiles = ["node_modules/**/next/dist/compiled/@vercel/og/**"];

const nextConfig: NextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  // CRITICAL FIX: Unified allowedDevOrigins configuration into the primary NextConfig object structure.
  allowedDevOrigins: ["192.168.2.144:3000", "192.168.2.144"],
  outputFileTracingExcludes: {
    "**": [...sharpFiles, ...ogFiles],
  },
  outputFileTracingIncludes: {
    "/api/profile/avatar": sharpRuntimeFiles,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: [
              "camera=()",
              "microphone=()",
              "geolocation=()",
              "payment=()",
              "usb=()",
              "bluetooth=()",
              "serial=()",
              "hid=()",
              "midi=()",
              "display-capture=()",
              "browsing-topics=()",
            ].join(", "),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Vercel's CDN adds `Access-Control-Allow-Origin: *` to static files and
        // prerendered pages. Naming our own origin replaces it, so no other
        // site can read those responses. API routes never had the header and
        // don't get one.
        source: "/((?!api/).*)",
        headers: [{ key: "Access-Control-Allow-Origin", value: siteOrigin }],
      },
      {
        // API responses are only ever read by this app's own pages. Pages and
        // images are left embeddable so share cards and email logos still load.
        source: "/api/:path*",
        headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }],
      },
    ];
  },
};

// CRITICAL FIX: Removed the conflicting module.exports syntax block completely.
export default withSentryConfig(nextConfig, {
  org: "river-room",
  project: "riverroom-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    // Wrapping cron routes for Sentry check-ins needs the Node SDK, which no
    // longer ships (see the note on instrumentation-client.ts being the only
    // Sentry entry point left).
    automaticVercelMonitors: false,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});


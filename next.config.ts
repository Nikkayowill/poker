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

const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' is for the 3D table room's Meshopt decoder
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${adsterraOrigins} ${turnstileOrigin}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.supabase.co ${adsterraOrigins}`,
  "font-src 'self' data:",
  // Sentry's session-replay integration compresses events in a Worker
  "worker-src 'self' blob:",
  // blob: is for the 3D table room's GLTFLoader. Dev HMR needs ws: for its
  // websocket -- the bare scheme (any host) rather than a specific LAN IP,
  // so this doesn't leak a developer's home network address into source
  // control and still works from any device on the LAN, not just one.
  `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co ${adsterraOrigins} ${turnstileOrigin}${isDev ? " ws:" : ""}`,
  `frame-src 'self' ${adsterraOrigins} ${turnstileOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // CRITICAL FIX: Unified allowedDevOrigins configuration into the primary NextConfig object structure.
  allowedDevOrigins: ["192.168.2.144:3000", "192.168.2.144"],
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

// CRITICAL FIX: Removed the conflicting module.exports syntax block completely.
export default withSentryConfig(nextConfig, {
  org: "river-room",
  project: "riverroom-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});


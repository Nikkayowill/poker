import type { CapacitorConfig } from "@capacitor/cli";

// This app is fully server-rendered (81 API routes, middleware.ts doing
// per-request auth-cookie refresh, per-request CSP headers) -- it cannot be
// statically exported into a bundled native build. The native shell instead
// runs in Capacitor's *remote* mode: `server.url` points the WebView at the
// live, already-deployed site, so the native app always shows the real,
// current production build with no separate native release needed for
// ordinary web changes. `webDir` is required by the CLI but unused in this
// mode since nothing is bundled locally.
//
// CAPACITOR_SERVER_URL lets a local dev build point at a LAN dev server
// (mirrors next.config.ts's allowedDevOrigins pattern for the same reason:
// testing from a phone/emulator against `next dev`) without hardcoding a
// developer's machine into source control. Falls back to production.
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://www.stackchips.app";

const config: CapacitorConfig = {
  appId: "app.stackchips.mobile",
  appName: "StackChips",
  webDir: "public",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;

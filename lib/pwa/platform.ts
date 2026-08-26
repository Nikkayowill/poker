/**
 * Which install path a visitor actually has, and what to tell them.
 *
 * Pure, and in lib/ rather than beside the components that render it, for the
 * reason lib/arcade/games.ts and lib/game/seat-presence.ts are: vitest.config
 * .ts's `include` only covers lib/ and app/, so nothing under components/ is
 * reachable by `npm test`. UA sniffing is exactly the kind of thing that
 * should be pinned by cases rather than eyeballed on one device.
 *
 * Three platforms, because there are three genuinely different answers:
 *
 * - "ios"     Safari never fires `beforeinstallprompt` and exposes no
 *             programmatic install at all. The only path is Share -> Add to
 *             Home Screen, so this platform gets instructions, never a button
 *             that would do nothing.
 * - "android" Chromium fires `beforeinstallprompt`; a saved copy of that
 *             event can be replayed from a real tap. A working button.
 * - "other"   Desktop, and mobile browsers that are neither. Chromium desktop
 *             may still fire the event (so a button may appear); everything
 *             else has no install path worth claiming.
 */

export type InstallPlatform = "ios" | "android" | "other";

/**
 * iPadOS 13+ reports a desktop Safari UA string ("Macintosh"), so the
 * literal /ipad/ test misses every modern iPad. The touch-points probe is
 * the standard disambiguator and is passed in rather than read off navigator
 * here, so this stays pure.
 */
export function installPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  // An actual Mac reports maxTouchPoints 0; an iPad reports 5.
  if (/macintosh/.test(ua) && maxTouchPoints > 1) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

/**
 * The install route, compressed to one line.
 *
 * The sign-in page is a form and nothing else now, so the install offer there
 * is a footnote rather than a section: a one-sentence step is what fits
 * beside a login form. An earlier ordered-list version (`manualInstallSteps`)
 * and its headline (`installHeadline`) were built for a landing-page-style
 * install panel that was deleted; this is the only rendering left.
 */
export function installShortStep(platform: InstallPlatform): string {
  if (platform === "ios") return "Share → Add to Home Screen";
  if (platform === "android") return "Browser menu → Add to Home screen";
  return "Open it on your phone, then add it to your home screen";
}

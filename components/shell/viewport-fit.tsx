"use client";

/**
 * Makes the app fill the whole screen on an installed phone.
 *
 * THE BUG THIS EXISTS FOR. On an installed iOS PWA's cold launch, WebKit
 * reports a layout viewport shorter than the screen it is actually filling.
 * Everything anchored to the bottom -- the lobby's tab pill, the sign-in
 * footer's legal row -- lands at the bottom of that short viewport, which is
 * some way up the glass, with a strip of dead colour beneath it. Rotating to
 * landscape and back fixes it for the rest of the session, because a real
 * bounds change is the one thing that makes WebKit re-measure.
 *
 * Six passes went looking for the cause in the stylesheets and found nothing,
 * because it is not there. It does not matter what WebKit's reason is: the
 * shortfall is measurable, so it can simply be cancelled.
 *
 * WHY THE MISSING STRIP IS OURS TO PAINT. In standalone with
 * `viewport-fit: cover` and a translucent status bar, the web view is the
 * whole screen -- visibly so, since the lobby's room gradient paints behind
 * the status bar at the top. Only the *layout viewport* is short. An element
 * pushed past the bottom of a layout viewport still paints; it is clipped by
 * the web view's frame, and here the frame is the whole display. So covering
 * the strip is a matter of reaching into it, not of resizing anything.
 *
 * WHY THIS IS NOT THE THING THAT WAS TRIED BEFORE. Three earlier attempts
 * forced a reflow (reading offsetHeight, toggling display) hoping WebKit
 * would re-measure, and were reverted each time. That reasoning was right:
 * a reflow re-runs layout against the same short viewport and changes
 * nothing. This does not ask WebKit for a better number. It takes the number
 * WebKit gives, compares it against the screen, and hands the difference to
 * CSS as `--vp-short` so the handful of rules that touch the bottom edge can
 * subtract it.
 *
 * It is self-cancelling in every healthy case: in a browser, on a device with
 * no shortfall, and on the same device after a rotation has corrected it,
 * the measurement is 0 and every `calc()` that reads it is a no-op.
 */

import { useEffect } from "react";

/**
 * Bigger than any shortfall this bug produces (it runs to about a status
 * bar's height) and smaller than any real layout. A measurement outside the
 * range means the assumptions below do not hold on this device, and doing
 * nothing is the right answer -- a wrong correction pushes the tab bar off
 * the bottom of the screen, which is worse than the bug.
 */
const MAX_CORRECTION_PX = 200;

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as { standalone?: boolean }).standalone === true;
}

function measure(): number {
  // Browsers only. In a tab the gap between the screen and the viewport is
  // the browser's own toolbars, and reaching into it would push our chrome
  // underneath them. Only an installed app is full-screen by definition,
  // which is what makes the comparison below mean anything.
  if (!isStandalone()) return 0;

  const portrait = window.innerHeight >= window.innerWidth;
  const long = Math.max(window.screen.width, window.screen.height);
  const short = Math.min(window.screen.width, window.screen.height);
  const screenHeight = portrait ? long : short;
  const screenWidth = portrait ? short : long;

  // A viewport narrower than the screen means something legitimately owns
  // part of the display -- iPad Split View, Slide Over, a zoomed display
  // mode. The height is then short for a real reason and must be left alone.
  if (Math.abs(screenWidth - window.innerWidth) > 1) return 0;

  const shortfall = Math.round(screenHeight - window.innerHeight);
  if (!Number.isFinite(shortfall) || shortfall <= 1 || shortfall > MAX_CORRECTION_PX) return 0;
  return shortfall;
}

export function ViewportFit() {
  useEffect(() => {
    const apply = () => {
      document.documentElement.style.setProperty("--vp-short", `${measure()}px`);
    };

    apply();
    // The launch measurement is the wrong one and WebKit corrects itself a
    // little later without always firing an event we hear about, so re-read
    // across the settle window rather than trusting the first value.
    const timers = [80, 300, 900, 2000].map((ms) => window.setTimeout(apply, ms));

    // And on anything that is or follows a real bounds change -- a rotation
    // being the one the player already knows fixes it. `pageshow` covers a
    // resume from the back/forward cache, which is how an installed app
    // usually comes back rather than through a fresh load.
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("pageshow", apply);
    window.visualViewport?.addEventListener("resize", apply);

    return () => {
      timers.forEach(window.clearTimeout);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("pageshow", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);

  return null;
}

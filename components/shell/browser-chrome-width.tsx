"use client";

/**
 * Gives the table back the width a mobile browser's own toolbar is
 * borrowing, in landscape.
 *
 * THE BUG THIS EXISTS FOR. 12-responsive.css's short-landscape tier locks
 * the game shell to a fixed 844:390 ratio (see its own "ASPECT-LOCKED
 * LETTERBOX" comment) so the shell always fits inside `100dvh` without
 * overflowing. That box's WIDTH is derived from `100dvh`, so anything that
 * shrinks `100dvh` shrinks the box's width too, even though the screen is
 * exactly as wide as it always was. On an installed PWA nothing shrinks
 * `100dvh` -- there is no browser chrome, so `100dvh` is the whole screen.
 * In a browser tab, Safari/Chrome's own toolbar sits inside that measurement
 * (it is real, visible chrome, not a layout bug), so `100dvh` comes in
 * shorter there than it does installed -- and the width formula reads that
 * shortfall as "the device is narrower," pillarboxing the table on both
 * sides for a reason that has nothing to do with the screen's actual width.
 *
 * WHAT THIS DOES. Measures the gap between the physical screen height and
 * the reported viewport height, the same comparison viewport-fit.tsx makes
 * for the opposite (installed-app) case, and hands it to CSS as
 * `--browser-chrome-px`. `06-table.css` and `12-responsive.css` add it back
 * into the `100dvh` term ONLY where that term is used to size a WIDTH
 * (`--table-height-cap`, the landscape shell's width formula) and never
 * where it sizes an actual HEIGHT -- the toolbar really is covering that
 * vertical strip and nothing should try to draw under it. The net effect:
 * the table reclaims the width the toolbar cost it, without pretending the
 * toolbar isn't there for anything that needs the room it actually occupies.
 *
 * WHY THIS IS THE MIRROR OF viewport-fit.tsx, NOT A DUPLICATE OF IT. That
 * file measures the opposite case (an installed PWA reporting a viewport
 * shorter than the screen it fills, with no chrome to blame) and deliberately
 * returns 0 for every browser tab -- reaching into a browser's real toolbar
 * would draw the app's own chrome underneath it. This one measures only
 * browser tabs and returns 0 for every installed PWA, for the same reason
 * pointed the other way: a standalone app already gets the full-width box
 * this hook exists to recover, so there is nothing here to compensate for.
 * The two hooks can never both be non-zero on the same launch.
 */

import { useEffect } from "react";

/**
 * Bigger than any mobile browser's landscape toolbar and smaller than a
 * genuinely narrower viewport (Slide Over, a resized window). A measurement
 * outside this range means the assumptions below don't hold, and adding
 * width back that isn't really free is worse than leaving the letterbox
 * alone -- it would run the table past the edge of the screen.
 */
const MAX_CHROME_PX = 200;

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as { standalone?: boolean }).standalone === true;
}

function measure(): number {
  // Standalone apps have no toolbar to give back width for -- the shell
  // already gets the full-width box on those.
  if (isStandalone()) return 0;

  // Only the short-landscape shell locks to a fixed ratio at all; in every
  // other layout this property is inert, so there is nothing to measure.
  if (window.innerWidth < window.innerHeight) return 0;

  const screenWidth = Math.max(window.screen.width, window.screen.height);
  const screenHeight = Math.min(window.screen.width, window.screen.height);

  // A viewport narrower than the screen means something legitimately owns
  // part of the display -- iPad Split View, Slide Over, a resized desktop
  // browser window. The height is short for a real reason there and nothing
  // should be added back.
  if (Math.abs(screenWidth - window.innerWidth) > 1) return 0;

  const shortfall = Math.round(screenHeight - window.innerHeight);
  if (!Number.isFinite(shortfall) || shortfall <= 1 || shortfall > MAX_CHROME_PX) return 0;
  return shortfall;
}

export function BrowserChromeWidth() {
  useEffect(() => {
    // Same coalescing rationale as viewport-fit.tsx: skip the write (and the
    // full-document restyle it triggers) unless the measurement actually
    // moved, and read once per frame rather than once per event.
    let written: number | null = null;
    let frame = 0;

    const write = () => {
      frame = 0;
      const next = measure();
      if (next === written) return;
      written = next;
      document.documentElement.style.setProperty("--browser-chrome-px", `${next}px`);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(write);
    };

    write();
    // A toolbar can show or hide after the initial measurement (Safari
    // collapses it on scroll), so the resize/orientationchange listeners
    // below are the steady-state source of truth. This just covers the
    // window between first paint and the first real bounds change.
    const timers = [80, 300, 900].map((ms) => window.setTimeout(write, ms));

    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("pageshow", schedule);

    return () => {
      timers.forEach(window.clearTimeout);
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("pageshow", schedule);
    };
  }, []);

  return null;
}

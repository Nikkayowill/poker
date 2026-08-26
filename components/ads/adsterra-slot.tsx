"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * An Adsterra unit, contained.
 *
 * This is an iframe rather than a `<Script>` because Adsterra's invoke
 * script is written for a 1990s page: it reads window.atOptions and then
 * `document.write`s the ad's markup at the point in the document where the
 * <script> tag sits. That works exactly once, during the initial parse.
 * Appended afterwards, on a document that has already closed,
 * `document.write` implicitly calls `document.open()`, which blanks the
 * entire page. In a single-page React app the parse is over before any
 * route mounts, so any version of this that injects the loader into the
 * main document is one ad-network deploy away from wiping the table
 * mid-hand.
 *
 * So the unit gets its own document. `srcDoc` hands the iframe markup it
 * then parses from scratch, the one situation `document.write` is defined
 * for, and whatever it writes lands in a document that isn't ours.
 *
 * The sandbox is narrow: `allow-scripts` and nothing else.
 *
 *   - No `allow-same-origin`, so the frame gets an opaque origin and can't
 *     reach into this document, read our cookies, or touch localStorage.
 *     (The pair `allow-scripts allow-same-origin` on a same-origin frame is
 *     not a sandbox at all; the frame can simply remove its own sandbox
 *     attribute from the parent DOM.)
 *   - No `allow-popups` and no `allow-top-navigation`, which is the real
 *     point. CLAUDE.md records that this vendor is known for popunders and
 *     redirect creative, and CSP governs only where a resource loads
 *     *from*, never what it does once loaded. These two flags are what
 *     govern that.
 *
 * A unit that needs those permissions to render doesn't get them; it gets
 * to not render. The reward in components/rewards/rewarded-ad-modal.tsx is
 * not conditional on this frame doing anything, so a blocked or empty ad
 * costs the player nothing.
 *
 * The box is reserved for the same reason: the wrapper is sized from the
 * props before the frame exists and never changes size afterwards. An ad
 * slot that grows on load is a layout shift, and this app has a header
 * whose height is a computed contract
 * (`calc(var(--game-header-h) + var(--safe-top))`, asserted at 127px under
 * an iPhone 14's insets by tests/e2e/safe-area.spec.ts). Nothing here may
 * push on that, so the slot is a fixed box from first paint and the frame
 * fills it.
 */

export interface AdsterraSlotProps {
  /** The unit's Adsterra key. */
  adKey: string;
  /** The loader URL for this unit. */
  scriptSrc: string;
  width: number;
  height: number;
  className?: string;
  /** Reader-facing label. The frame is decorative to a screen reader; this names it. */
  title?: string;
}

/**
 * Escapes a value for safe interpolation into a single-quoted JS string inside
 * an HTML <script>. Both of the interpolated values here are literals from
 * app/config, not user input, but a slot key is exactly the sort of thing
 * that gets moved into an env var later, and the escape costs nothing.
 */
function jsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/</g, "\\u003c")
    .replace(/\r?\n/g, "");
}

/**
 * "Are we past hydration?", as an external store.
 *
 * The server must render the reserved box and nothing else. An ad loader in
 * the streamed HTML is markup React then has to reconcile, and this particular
 * loader reacts to being reconciled by rewriting a document. A `useState` plus
 * a mount effect expresses the same thing but is a setState inside an effect,
 * which is a cascading render and which this repo's lint rules reject on
 * sight. useSyncExternalStore says it directly: one value on the server, a
 * different one on the client, no extra commit and no subscription, because
 * the answer never changes again once it's true.
 *
 * Module scope so the three callbacks are referentially stable; inline
 * arrows here would resubscribe on every render.
 */
const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

export function AdsterraSlot({
  adKey,
  scriptSrc,
  width,
  height,
  className,
  title = "Advertisement",
}: AdsterraSlotProps) {
  const mounted = useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);

  const srcDoc = useMemo(() => {
    // The <base target="_blank"> is not cosmetic: without it a creative's
    // link navigates the iframe itself, which the sandbox permits and which
    // silently replaces the ad with a landing page in place.
    return `<!doctype html><html><head><meta charset="utf-8">`
      + `<base target="_blank">`
      + `<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style>`
      + `</head><body>`
      + `<script>window.atOptions={'key':'${jsString(adKey)}','format':'iframe',`
      + `'height':${height},'width':${width},'params':{}};<\/script>`
      + `<script src="${jsString(scriptSrc)}"><\/script>`
      + `</body></html>`;
  }, [adKey, scriptSrc, width, height]);

  return (
    <div
      className={className ? `ad-slot ${className}` : "ad-slot"}
      style={{ width, height }}
      // Reserved before the frame exists and unchanged after: see the note on
      // layout above. aria-hidden because an ad is not part of the task the
      // player came here for, and the modal around it does its own labelling.
      aria-hidden="true"
    >
      {mounted && (
        <iframe
          title={title}
          width={width}
          height={height}
          // allow-scripts only. See the sandbox note above before widening it.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          scrolling="no"
          srcDoc={srcDoc}
          style={{ display: "block", border: 0, width, height }}
        />
      )}
    </div>
  );
}

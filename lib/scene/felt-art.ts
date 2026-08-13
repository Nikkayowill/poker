/**
 * The 2D table's felt/rail/room art, as plain image URLs.
 *
 * These used to be procedurally canvas-painted (instant, synchronous). Now
 * they're real images loaded via CSS `background-image` on `.poker-rail` /
 * `.game-shell` (see app/styles/06-table.css, 12-responsive.css,
 * 05-game-header.css), which means they load over the network like any
 * other image -- see use-felt-art-ready.ts, which turns "has this actually
 * finished loading" into a signal poker-table.tsx can gate its own loading
 * splash on.
 */

/**
 * Must match app/styles/12-responsive.css's `@media (max-width: 600px)`,
 * which is where `.poker-rail`'s background-image swaps from the desktop
 * plate to the mobile one. NOT table-geometry.ts's NARROW_BREAKPOINT_PX
 * (620) -- that one governs seat-ring geometry, a different concern with a
 * different threshold. Preloading against the wrong breakpoint would report
 * readiness for an image the browser never actually requested.
 */
export const FELT_ART_NARROW_BREAKPOINT_PX = 600;

export const FELT_DESKTOP_SRC = "/pokertable/table-desktop.webp";
export const FELT_MOBILE_SRC = "/pokertable/table-mobile.webp";
export const ROOM_BACKDROP_SRC = "/pokertable/room-backdrop.webp";

/** Which felt plate `.poker-rail` will actually request at this viewport width. */
export function feltSrcForViewport(viewportWidth: number): string {
  return viewportWidth <= FELT_ART_NARROW_BREAKPOINT_PX ? FELT_MOBILE_SRC : FELT_DESKTOP_SRC;
}

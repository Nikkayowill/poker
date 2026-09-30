/**
 * The page-change orb: the arcade's violet ground eases in over the page, a
 * ring of gold coins rises into a slow orbit, each coin flipping on its own
 * axis like a loading skeleton, while the next page loads. Then the coins
 * gather back into the middle and the ground lifts off the new page.
 *
 * It never delays the navigation. The route change starts on the same tap,
 * and the orb fills time the next page was going to take anyway, plus a
 * short minimum so a cached page still gets a full coin flip instead of a
 * flicker.
 *
 * This file is the timeline maths and a tiny controller. The canvas that
 * draws it is components/loading/orb-transition-layer.tsx, mounted once by
 * AppShell.
 */

/** Ground fades from clear to fully opaque. */
export const COVER_MS = 260;
/** Coins rise into the ring, one after another. */
export const ENTER_MS = 440;
/** The exit can't start before this, so the ring always forms and turns. */
export const MIN_HOLD_MS = 480;
/** Coins gather to the middle and the ground lifts. */
export const EXIT_MS = 420;
/** A navigation that never lands (cancelled, offline) lets go after this. */
export const STUCK_MS = 6_000;

/** Coins in the ring. */
export const COIN_COUNT = 8;

/** Share of ENTER_MS / EXIT_MS spent staggering coins around the ring. */
const STAGGER = 0.45;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Settles with a small overshoot, so each coin lands with a little pop. */
export const easeOutBack = (t: number) => {
  const s = 1.4;
  return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
};

/** Ground opacity while the orb forms. */
export function coverAlpha(elapsedMs: number): number {
  return easeInOutCubic(clamp01(elapsedMs / COVER_MS));
}

/**
 * Ground opacity during the exit, starting from whatever the cover reached.
 * It holds for the first stretch so the coins gather before the page shows.
 */
export function exitVeilAlpha(elapsedMs: number, fromAlpha: number): number {
  return fromAlpha * (1 - easeInOutCubic(clamp01((elapsedMs - EXIT_MS * 0.25) / (EXIT_MS * 0.75))));
}

function staggered(elapsedMs: number, index: number, spanMs: number): number {
  const start = (index / COIN_COUNT) * STAGGER * spanMs;
  return clamp01((elapsedMs - start) / (spanMs * (1 - STAGGER)));
}

/** How far one coin is into the ring, 0 to 1 (overshoots a touch on the way). */
export function coinEnterProgress(elapsedMs: number, index: number): number {
  return easeOutBack(staggered(elapsedMs, index, ENTER_MS));
}

/** How far one coin has gathered back into the middle, 0 to 1. */
export function coinExitProgress(elapsedMs: number, index: number): number {
  return easeInOutCubic(staggered(elapsedMs, index, EXIT_MS));
}

// ---- controller ----------------------------------------------------------

export type OrbCommand = "start" | "release";
type OrbListener = (command: OrbCommand) => void;

let listener: OrbListener | null = null;

/** The layer registers itself here. Returns the unregister function. */
export function attachOrbLayer(next: OrbListener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

/** Starts the orb. Does nothing when no layer is mounted (reduced motion). */
export function startOrb(): void {
  listener?.("start");
}

/**
 * Lifts the orb off the page. A URL change releases it on its own; call
 * this for swaps that keep the URL, such as sign-in becoming the lobby, or
 * when the thing being waited on failed.
 */
export function releaseOrb(): void {
  listener?.("release");
}

/** Starts the orb and navigates on the same tick. */
export function navigateWithOrb(go: () => void): void {
  startOrb();
  go();
}

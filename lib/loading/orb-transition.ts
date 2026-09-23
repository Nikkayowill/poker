/**
 * The page-change orb: a dark veil sweeps in, coloured dots swarm into a
 * spinning rainbow orb while the next page loads, then the orb bursts
 * outward and the veil lifts off the new page.
 *
 * It never delays anything. The navigation starts on the same tap, and the
 * orb only fills time the next page was going to take anyway, plus a short
 * minimum so a cached page still gets a clean burst instead of a flicker.
 *
 * This file is the timeline maths and a tiny controller. The canvas that
 * draws it is components/loading/orb-transition-layer.tsx, mounted once by
 * AppShell.
 */

/** Veil fades from clear to fully opaque. */
export const COVER_MS = 130;
/** Dots travel from the screen into the orb. */
export const GATHER_MS = 300;
/** The burst can't start before this, so the orb always forms. */
export const MIN_HOLD_MS = 200;
/** Orb bursts outward and the veil lifts. */
export const BURST_MS = 360;
/** A navigation that never lands (cancelled, offline) lets go after this. */
export const STUCK_MS = 6_000;

/** Share of GATHER_MS spent staggering dot start times. */
const GATHER_STAGGER = 0.3;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Veil opacity while the orb forms. */
export function coverAlpha(elapsedMs: number): number {
  return easeOutCubic(clamp01(elapsedMs / COVER_MS));
}

/**
 * Veil opacity during the burst, starting from whatever the cover had
 * reached. It lifts a touch behind the dots so the burst reads first.
 */
export function burstVeilAlpha(elapsedMs: number, fromAlpha: number): number {
  return fromAlpha * (1 - easeInOutCubic(clamp01((elapsedMs - BURST_MS * 0.1) / (BURST_MS * 0.9))));
}

/** How far one dot is along its flight into the orb, 0 to 1. */
export function gatherProgress(elapsedMs: number, seed: number): number {
  const start = seed * GATHER_STAGGER * GATHER_MS;
  return easeInOutCubic(clamp01((elapsedMs - start) / (GATHER_MS * (1 - GATHER_STAGGER))));
}

/** How far one dot has flown out of the orb, 0 to 1. Faster dots lead. */
export function burstProgress(elapsedMs: number, seed: number): number {
  return easeOutCubic(clamp01(elapsedMs / (BURST_MS * (0.7 + seed * 0.3))));
}

/** Evenly spread unit-sphere points (golden-angle spiral), as [x, y, z] triples. */
export function spherePoints(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    out[i * 3] = Math.cos(i * golden) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(i * golden) * r;
  }
  return out;
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
 * Bursts the orb off the page. A URL change releases it on its own; call
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

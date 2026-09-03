/**
 * The pure arithmetic behind every loading-state fade in the app: hidden ->
 * visible -> hiding -> hidden, driven by an `active` boolean.
 *
 * This started as table-loading-splash.tsx's own private phase machine, with
 * one gap -- it had no minimum hold. A resolve fast enough (an instant cache
 * hit, a resolve that beat the network) could flip `active` back to false
 * before a player ever really saw the loading state, which undercuts the
 * whole point of showing one: giving a real tap a beat to land on settled
 * content instead of content that's mid-swap. `components/loading/use-min-
 * hold-fade.ts` is the React wrapper (setState/setTimeout) around this file;
 * it has no test of its own, matching the rest of this codebase's split --
 * timing/state-machine logic lives here where plain vitest can pin it, the
 * hook is a thin, untested shell (same shape as lib/scene/chips's spring
 * engine vs. its React consumers).
 */

export type FadePhase = "hidden" | "visible" | "hiding";

/**
 * How much longer a "visible" phase that has already run for `elapsedMs`
 * must wait before it is allowed to start hiding.
 */
export function remainingHoldMs(elapsedMs: number, minMs: number): number {
  return Math.max(0, minMs - elapsedMs);
}

/**
 * What phase to move to the instant `active` flips from true to false.
 *
 * If the minimum hold hasn't elapsed yet, the phase stays "visible" -- the
 * caller is expected to schedule a follow-up timer for `remainingHoldMs` and
 * call this again (or move straight to hiding) once it fires. Reduced motion
 * skips the fade animation entirely rather than snapping through it.
 */
export function phaseOnDeactivate(elapsedMs: number, minMs: number, reducedMotion: boolean): FadePhase {
  if (elapsedMs < minMs) return "visible";
  return reducedMotion ? "hidden" : "hiding";
}

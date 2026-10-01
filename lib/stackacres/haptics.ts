/**
 * Haptic ticks for the farm. One place for the patterns so a tool stroke, a
 * crit and a story bubble feel like the same hand, not three.
 *
 * Silent wherever the browser has no vibrate (iOS Safari, desktops), so every
 * caller can fire it without checking. Pure DOM, no Phaser.
 */

/** One bed worked by a tool: a tick you feel under the thumb, not a buzz. */
export const TOOL_BUZZ: readonly number[] = [8];

/** A critical harvest: two beats, the second longer, so it reads as "extra". */
export const CRIT_BUZZ: readonly number[] = [12, 40, 24];

/** A short tick on a phone that has one. Silent everywhere else. */
export function buzz(pattern: readonly number[]): void {
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    // Some browsers throw rather than returning false. Either way, nothing happens.
  }
}

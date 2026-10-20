/**
 * Pick combo: picking crops in quick succession builds a streak that shows as a floating "x3" and
 * a rising blip. It is feel only. Nothing is paid for it and the server never sees it.
 */

/** How long after a pick the next one still counts. */
export const COMBO_WINDOW_MS = 2200;

/** The streak stops climbing here, in the label and the pitch. */
export const COMBO_CAP = 12;

export interface ComboState {
  readonly count: number;
  readonly at: number;
}

/** The streak after a pick at `nowMs`: one more if the last pick was inside the window, else a fresh one. */
export function nextCombo(prev: ComboState | null, nowMs: number): ComboState {
  if (prev && nowMs >= prev.at && nowMs - prev.at <= COMBO_WINDOW_MS) {
    return { count: Math.min(prev.count + 1, COMBO_CAP), at: nowMs };
  }
  return { count: 1, at: nowMs };
}

/** What floats off the crop: nothing for a lone pick, "x2" and up for a streak. */
export function comboLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 2) return null;
  return `x${Math.min(Math.floor(count), COMBO_CAP)}`;
}

/** Major pentatonic, so a long streak climbs like a tune and never clashes. */
const STEPS = [0, 2, 4, 7, 9];

/** The blip's pitch in Hz: starts at A4 and rises a pentatonic step per pick, an octave every five. */
export function comboHz(count: number): number {
  const n = Math.max(1, Math.min(Math.floor(Number.isFinite(count) ? count : 1), COMBO_CAP)) - 1;
  const semitones = STEPS[n % STEPS.length] + 12 * Math.floor(n / STEPS.length);
  return 440 * 2 ** (semitones / 12);
}

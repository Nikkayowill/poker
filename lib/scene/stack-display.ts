/**
 * Whether a chip stack reads as raw chips or as big blinds.
 *
 * Same boolean-in-localStorage shape as sound/menu-music in
 * lib/audio/sound-preference.ts, but the opposite default: those default ON
 * because their off state is a mute nobody wants to discover by accident.
 * This defaults OFF, because every other surface in the app (buy-in, HUD,
 * nameplate) already reports a stack in raw chips, and switching the format
 * on for players who never asked is a bigger surprise than the setting not
 * existing at all.
 *
 * In lib/ rather than beside the components that render a stack, for the
 * reason lib/scene/bet-style.ts gives: vitest.config.ts only collects lib/
 * and app/.
 */

export const STACK_DISPLAY_STORAGE_KEY = "stackchips:stack-in-big-blinds";

/** On only if the stored value is exactly "true" -- the opposite convention
 *  from `parseEnabledFlag`, because this preference defaults off, not on. */
export function parseStackInBigBlinds(raw: string | null): boolean {
  return raw === "true";
}

/**
 * A stack, formatted per the player's chosen display.
 *
 * Big blinds round to one decimal place, but that decimal only prints when
 * it's non-zero: "125 BB" is a stack of exactly 125 blinds, not one rounded
 * down from 125.4. Dropping a genuine ".5" would create the ambiguity this
 * format exists to avoid -- two stacks a half-blind apart both reading
 * "12 BB" -- so only an exact whole number loses its decimal.
 * `bigBlind <= 0` (no hand dealt yet, or blinds not assigned) falls back to
 * chips -- dividing by zero would print "Infinity BB".
 */
export function formatStack(stack: number, bigBlind: number, showInBigBlinds: boolean): string {
  if (showInBigBlinds && bigBlind > 0) {
    const rounded = Math.round((stack / bigBlind) * 10) / 10;
    const label = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
    return `${label} BB`;
  }
  return stack.toLocaleString();
}

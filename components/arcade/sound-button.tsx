"use client";

import { forwardRef } from "react";
import clsx from "clsx";
import { clearSound, comboSound, selectSound, tapSound } from "@/lib/audio/ui-sounds";

/**
 * The one button every arcade game should reach for instead of a bare
 * `<button>` plus a manual `tapSound()`/`selectSound()` call in the handler.
 * Drop it in anywhere a press should be heard and felt: it plays the right
 * cue itself, then calls through to `onClick`, and it presses down visually
 * (`.arcade-sound-btn` in 61-brain-games.css) so a tap reads as physical even
 * before the sound reaches the speaker.
 *
 *   tap     a navigation press: back, help, aiming a piece -- the default.
 *   select  a choice that changed something: a mode, a tier, a toggle.
 *   clear   a puzzle paid off: a line, a match, a correct answer.
 *   combo   a bigger payoff than one `clear` -- several at once, a milestone.
 *   none    the caller is playing its own cue (or deliberately wants none)
 *           and only needs the press animation.
 *
 * A disabled button makes no sound: `onClick` never fires for one anyway, but
 * the check is explicit here so a future change to the click wiring can't
 * make a "disabled" button audibly fire.
 */
const SOUND_BY_KIND = { tap: tapSound, select: selectSound, clear: clearSound, combo: comboSound } as const;

export type ArcadeSoundKind = keyof typeof SOUND_BY_KIND | "none";

export interface SoundButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  sound?: ArcadeSoundKind;
}

export const SoundButton = forwardRef<HTMLButtonElement, SoundButtonProps>(function SoundButton(
  { sound = "tap", className, onClick, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={clsx("arcade-sound-btn", className)}
      disabled={disabled}
      onClick={(event) => {
        if (!disabled && sound !== "none") SOUND_BY_KIND[sound]();
        onClick?.(event);
      }}
      {...rest}
    />
  );
});

import type { SoundEffect } from "./manifest";

/**
 * The sound a seat's action makes, read from the label the engine already
 * wrote for it.
 *
 * Sounds used to fire in exactly one place: the local player's own `act()`
 * call, optimistically, on tap. That meant the table was silent for every
 * other player at it -- five people folding, calling and shoving, and the
 * only thing you ever heard was yourself. This is the other half, driven off
 * the snapshot so it works for humans and bots alike.
 *
 * Reading `lastAction` rather than diffing chips: it is the one field that
 * says *what* a seat did rather than what changed as a result, and it is
 * already on the snapshot for the nameplate to display.
 */
export function soundForSeatAction(lastAction: string | null): SoundEffect | null {
  if (!lastAction) return null;
  // "Timed out · Fold" and "Timed out · Check" carry the same sound as the
  // deliberate versions. From across the table there is no difference: a fold
  // is a fold whether the player chose it or the clock did.
  const action = lastAction.split("·").pop()?.trim() ?? lastAction;

  if (action.startsWith("Fold")) return "fold";
  if (action.startsWith("Check")) return "check";
  if (action.startsWith("Call")) return "call";
  if (action.startsWith("Raise") || action.startsWith("Bet")) return "raise";
  if (action.startsWith("All in")) return "all-in";

  // Blinds are posted, not chosen, and the chip sound already fires for the
  // stack movement. A second sound here would double every deal.
  // A time card is silent by design (see the manifest).
  return null;
}

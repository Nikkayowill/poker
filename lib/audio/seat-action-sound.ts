import type { SoundEffect } from "./manifest";

/**
 * The sound a seat's action makes, read from the label the engine already
 * wrote for it.
 *
 * Only the local player's own `act()` call played a sound before, fired
 * optimistically on tap, which left the table silent for every other
 * player at it: five people folding, calling and shoving with nothing to
 * hear but yourself. This is the other half, driven off the snapshot so it
 * works for humans and bots alike.
 *
 * Reads `lastAction` rather than diffing chips because it is the one field
 * that says what a seat did rather than what changed as a result, and it is
 * already on the snapshot for the nameplate to display.
 */
export function soundForSeatAction(lastAction: string | null): SoundEffect | null {
  if (!lastAction) return null;

  // Every lastAction the engine writes for a real decision puts the action
  // name first and the amount after a " · " separator: "Call · 500",
  // "Raise to · 500", "All-in · 500". So the name to match is the text
  // before the separator, not after it. "Timed out · Fold" and
  // "Timed out · Check" are built the other way round (reason first, action
  // second), and they carry the same sound as a chosen action. From across
  // the table there is no difference between a fold a player chose and one
  // the clock made for them.
  const action = lastAction.startsWith("Timed out")
    ? lastAction.split("·").pop()?.trim() ?? lastAction
    : lastAction;

  if (action.startsWith("Fold")) return "fold";
  if (action.startsWith("Check")) return "check";
  if (action.startsWith("Call")) return "call";
  if (action.startsWith("Raise") || action.startsWith("Bet")) return "raise";
  if (action.startsWith("All-in") || action.startsWith("All in")) return "all-in";

  // Blinds are posted, not chosen, and the chip sound already fires for the
  // stack movement. A second sound here would double every deal.
  // A time card is silent by design (see the manifest).
  return null;
}

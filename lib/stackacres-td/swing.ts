/**
 * The overhead swing: the hoe into the ground, the axe into a tree or scrub,
 * the pick into rock. One tap is one swing; there is no meter to play.
 *
 * All three tools share one motion off the farmer's sheet (art/stackacres-td/
 * lpc/build.py's SWINGS): the wind-up, the top of the lift, the blur coming
 * down, and the strike, which is held. The hit lands as the fourth frame
 * starts. `SWING_STRIKE_MS` is the first three frames; ./swing.test.ts reads
 * them off the sheet, so retiming the art without moving this fails a test
 * instead of putting the hit out of time.
 *
 * Pure and renderer-free, same split as the rest of lib/stackacres-td.
 */

/** The farmer's swing tags: `${tool}_${facing}` on his sheet. */
export type SwingTool = "hoe" | "axe" | "pick";

/** Frames of the swing before the blade lands: wind-up, lift, the blur down. */
export const SWING_FRAMES_BEFORE_STRIKE = 3;

/** Ms from the start of the swing to the blade landing. */
export const SWING_STRIKE_MS = 330;

/** What he swings at a map tag, or null when a tap there is not a swing.
 *  Land obstacles name their kind separately (`land:<id>` does not say), so
 *  the scene passes it in. */
export function swingToolFor(tag: string, landKind?: "tree" | "boulder" | "scrub"): SwingTool | null {
  const kind = tag.split(":")[0];
  if (kind === "tree") return "axe";
  if (kind === "stone") return "pick";
  if (kind === "land") {
    if (landKind === undefined) return null;
    return landKind === "boulder" ? "pick" : "axe";
  }
  return null;
}

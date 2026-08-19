import { describe, expect, it } from "vitest";
import { soundForSeatAction } from "./seat-action-sound";
import { SOUND_FILES } from "./manifest";

describe("soundForSeatAction", () => {
  // These are the literal strings engine.ts writes to lastAction, not
  // approximations of them -- see the `seat.lastAction =` assignments in
  // performAction. A fixture that drifts from the real format is exactly how
  // this went unnoticed before: every one of these but Fold/Check used to
  // come back null in production while a "Raise 50"-shaped test fixture
  // still passed.
  it.each([
    ["Fold", "fold"],
    ["Check", "check"],
    ["Call · 20", "call"],
    ["Raise to · 60", "raise"],
    ["Bet · 40", "raise"],
    ["All-in · 500", "all-in"],
  ])("%s sounds like %s", (label, expected) => {
    expect(soundForSeatAction(label)).toBe(expected);
  });

  it.each([
    ["Timed out · Fold", "fold"],
    ["Timed out · Check", "check"],
  ])("%s sounds the same as choosing it", (label, expected) => {
    // From across the table there is no difference between a fold a player
    // chose and one the clock made for them.
    expect(soundForSeatAction(label)).toBe(expected);
  });

  it("stays silent for a posted blind, which the chip sound already covers", () => {
    expect(soundForSeatAction("Small blind · 5")).toBeNull();
    expect(soundForSeatAction("Big blind · 10")).toBeNull();
  });

  it("stays silent for a seat that has not acted", () => {
    expect(soundForSeatAction(null)).toBeNull();
    expect(soundForSeatAction("")).toBeNull();
  });

  it("only ever names a sound the manifest actually knows", () => {
    // A typo here would be silent in the worst way: playSound would look up
    // undefined and simply do nothing, which is indistinguishable from the
    // bug this whole file exists to fix.
    const labels = ["Fold", "Check", "Call · 20", "Raise to · 60", "All-in · 20", "Timed out · Fold"];
    labels.forEach((label) => {
      const effect = soundForSeatAction(label);
      expect(effect).not.toBeNull();
      expect(Object.keys(SOUND_FILES)).toContain(effect);
      // And it maps to a real file, not a null placeholder.
      expect(SOUND_FILES[effect!]).toBeTruthy();
    });
  });
});

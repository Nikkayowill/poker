import { describe, expect, it } from "vitest";
import {
  AUDIBLE_EFFECTS,
  SOUND_FILES,
  SOUND_LEVELS_FOR_TEST,
  soundGain,
  type SoundEffect,
} from "./manifest";

const { FILE_LEVEL_DB, EFFECT_TARGET_DB } = SOUND_LEVELS_FOR_TEST;

/** The inverse of the gain calculation, so a computed gain can be read back as a level. */
function playbackDb(effect: SoundEffect): number {
  const src = SOUND_FILES[effect]!;
  return FILE_LEVEL_DB[src] + 20 * Math.log10(soundGain(effect));
}

describe("the mix", () => {
  it("has a measured level for every file it plays", () => {
    // The gain is derived from this table. A file with no measurement falls
    // back to unity, which is silently the old bug -- one asset playing flat
    // out against a mix everything else respects.
    for (const effect of AUDIBLE_EFFECTS) {
      expect({ effect, measured: FILE_LEVEL_DB[SOUND_FILES[effect]!] !== undefined })
        .toEqual({ effect, measured: true });
    }
  });

  it("never asks for a gain it cannot have", () => {
    // HTMLMediaElement.volume caps at 1, so a target above its own file's
    // level is not loud -- it is just unity, quietly missing the balance it
    // claims. The clamp in soundGain keeps it from throwing; this keeps it
    // from being wrong in the first place.
    for (const effect of AUDIBLE_EFFECTS) {
      const src = SOUND_FILES[effect]!;
      expect({ effect, reachable: EFFECT_TARGET_DB[effect] <= FILE_LEVEL_DB[src] })
        .toEqual({ effect, reachable: true });
    }
  });

  it("lands each effect on the level it asked for", () => {
    for (const effect of AUDIBLE_EFFECTS) {
      expect(playbackDb(effect)).toBeCloseTo(EFFECT_TARGET_DB[effect], 6);
    }
  });

  it("is quieter than the raw files it was built from", () => {
    // The whole point. Every asset was played at 1.0 before this, and the set
    // spans 15.3 dB of mean level, so the loudest sample decided the mix.
    const gains = AUDIBLE_EFFECTS.map(soundGain);
    expect(Math.max(...gains)).toBeLessThanOrEqual(1);
    expect(Math.min(...gains)).toBeGreaterThan(0);
    // Only the quietest asset in the set runs wide open, and it is the flop
    // -- documented in the manifest as an asset limit rather than a choice.
    expect(AUDIBLE_EFFECTS.filter((effect) => soundGain(effect) === 1)).toEqual(["flop"]);
  });

  it("keeps the table's priorities in order", () => {
    // Written as levels rather than gains: two effects sharing a file compare
    // by gain, but effects on different files only compare meaningfully after
    // their source levels are accounted for, which is what playbackDb does.
    // Asserting gains directly here would pass for the wrong reason.
    expect(playbackDb("win")).toBeGreaterThan(playbackDb("call"));
    expect(playbackDb("all-in")).toBeGreaterThan(playbackDb("raise"));
    expect(playbackDb("raise")).toBeGreaterThan(playbackDb("call"));
    // Chip texture sits under the decision it accompanies -- both fire in the
    // same snapshot when someone calls.
    expect(playbackDb("chips")).toBeLessThan(playbackDb("call"));
    // Housekeeping never competes with the hand.
    expect(playbackDb("ui")).toBeLessThan(playbackDb("deal"));
    expect(playbackDb("ui")).toBeLessThan(playbackDb("fold"));
  });

  it("gives the turn cue room to interrupt", () => {
    // It shares the tap's recording, so this is entirely a question of gain,
    // and it is the reason the two do not read as the same event.
    expect(soundGain("your-turn")).toBeGreaterThan(soundGain("ui") * 2);
    expect(playbackDb("your-turn")).toBeGreaterThan(playbackDb("deal"));
    expect(playbackDb("your-turn")).toBeGreaterThan(playbackDb("check"));
  });

  it("separates effects that share one recording", () => {
    // raise and all-in are the same file at different levels. If these ever
    // resolve to one number, the sounds are interchangeable again and the
    // per-effect player in sound-effects.ts is pointless.
    expect(SOUND_FILES["all-in"]).toBe(SOUND_FILES.raise);
    expect(soundGain("all-in")).not.toBe(soundGain("raise"));
    expect(SOUND_FILES["your-turn"]).toBe(SOUND_FILES.ui);
    expect(soundGain("your-turn")).not.toBe(soundGain("ui"));
  });

  it("stays silent where there is no asset", () => {
    for (const effect of ["lose", "timeout", "time-card"] as SoundEffect[]) {
      expect({ effect, file: SOUND_FILES[effect], gain: soundGain(effect) })
        .toEqual({ effect, file: null, gain: 0 });
    }
    expect(AUDIBLE_EFFECTS).not.toContain("lose");
  });
});

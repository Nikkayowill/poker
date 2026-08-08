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
    // It has its own recording now, so comparing gains would compare two
    // different sources and mean nothing -- this is a question of the level
    // each one lands on. It has to clear the housekeeping it used to borrow
    // from by a wide margin, and clear the cues that fire alongside it.
    expect(playbackDb("your-turn")).toBeGreaterThan(playbackDb("ui") + 6);
    expect(playbackDb("your-turn")).toBeGreaterThan(playbackDb("deal"));
    expect(playbackDb("your-turn")).toBeGreaterThan(playbackDb("check"));
  });

  it("gives the borrowed cues their own recording", () => {
    // Both of these used to be another effect's file at a different gain,
    // which made them the same sound played twice as loud rather than a
    // different event. If either collapses back onto its old source, the
    // per-effect player in sound-effects.ts is doing nothing again.
    expect(SOUND_FILES["your-turn"]).not.toBe(SOUND_FILES.ui);
    expect(SOUND_FILES["all-in"]).not.toBe(SOUND_FILES.raise);
    // The all-in still has to read as the bigger bet of the two.
    expect(playbackDb("all-in")).toBeGreaterThan(playbackDb("raise"));
  });

  it("plays one recording for both clock cues", () => {
    // Deliberately shared: to the player, a timeout and a spent time card are
    // the same subject. Equal targets here are the intent, not an oversight.
    expect(SOUND_FILES.timeout).toBe(SOUND_FILES["time-card"]);
    expect(soundGain("timeout")).toBe(soundGain("time-card"));
    // The clock is worth hearing -- it sits in among the betting cues rather
    // than down with housekeeping -- but it never outranks the cue whose whole
    // job is to interrupt, or the hand ending.
    expect(playbackDb("timeout")).toBeGreaterThan(playbackDb("ui"));
    expect(playbackDb("timeout")).toBeLessThan(playbackDb("your-turn"));
    expect(playbackDb("timeout")).toBeLessThan(playbackDb("win"));
  });

  it("stays silent where there is no asset", () => {
    // `lose` is the last of these. It is silent because most hands at a
    // six-handed table are losses and a cue on each one would be relentless,
    // not because an asset is missing -- see table-sounds.ts, which cheers
    // every win instead.
    expect({ file: SOUND_FILES.lose, gain: soundGain("lose") })
      .toEqual({ file: null, gain: 0 });
    expect(AUDIBLE_EFFECTS).not.toContain("lose");
    for (const effect of ["timeout", "time-card"] as SoundEffect[]) {
      expect({ effect, audible: AUDIBLE_EFFECTS.includes(effect) })
        .toEqual({ effect, audible: true });
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  AMBIENCE_BEDS,
  ambienceCues,
  ambienceMix,
  livestockCue,
  rollGapMs,
  type AmbienceTimeOfDay,
} from "./ambience-plan";

const TIMES: AmbienceTimeOfDay[] = ["day", "dusk", "night"];

describe("ambienceMix", () => {
  it("keeps every bed inside 0..1 at every hour", () => {
    for (const tod of TIMES) {
      const mix = ambienceMix(tod);
      for (const bed of AMBIENCE_BEDS) {
        expect(mix[bed], `${tod}/${bed}`).toBeGreaterThanOrEqual(0);
        expect(mix[bed], `${tod}/${bed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not vary by district: the mix is one property of the hour now", () => {
    // Districts used to each carry their own bed values (the Wallow wetter,
    // the Ox Fields thinner). That made the ambience a property of where you
    // stood rather than of the farm, which is exactly what got cut -- so
    // there is no zone argument left to pass in the first place.
    expect(ambienceMix.length).toBe(1);
  });

  it("still gives the farm something in the mix by day and dusk, now that there is no air floor", () => {
    // There is no bed guaranteed non-zero any more -- the `air` floor read as
    // wind and was cut, and `grass` was cut the same way after it. By day and
    // dusk `insects` still carries the mix; at night it hands off to the
    // cricket CUE on purpose (see the test below), so the bed layer going
    // quiet overnight is correct, not a regression.
    for (const tod of ["day", "dusk"] as const) {
      const mix = ambienceMix(tod);
      expect(mix.grass + mix.water + mix.insects, tod).toBeGreaterThan(0);
    }
  });

  it("has no wind bed and no air bed", () => {
    // Not a level to be tuned down -- both beds are gone, and the doc over
    // AMBIENCE_BEDS says why neither must come back. A bed reinstated at a
    // "safe" gain, under either name, is the exact regression this catches.
    expect([...AMBIENCE_BEDS] as string[]).not.toContain("wind");
    expect([...AMBIENCE_BEDS] as string[]).not.toContain("air");
  });

  it("keeps grass silenced rather than reinstated under the same or a new name", () => {
    // `grass`'s own gust walk read as wind too (see AMBIENCE_BEDS), so it is
    // held at 0 for the same reason `wind`/`air` never came back.
    for (const tod of TIMES) {
      expect(ambienceMix(tod).grass, tod).toBe(0);
    }
  });

  it("hands the daytime insect hum over to the cricket cue at night", () => {
    expect(ambienceMix("night").insects).toBe(0);
    expect(ambienceCues("night").map((cue) => cue.cue)).toContain("cricket");
  });
});

describe("ambienceCues", () => {
  it("gives the farm something to hear at every hour", () => {
    for (const tod of TIMES) {
      expect(ambienceCues(tod).length, tod).toBeGreaterThan(0);
    }
  });

  it("does not vary by district: the cue table is one property of the hour now", () => {
    expect(ambienceCues.length).toBe(1);
  });

  it("never schedules the same cue twice", () => {
    // Two entries for one cue would run two independent schedulers for it,
    // quietly doubling how often it fires -- a mistake that is very hard to
    // hear as a bug and very easy to make while editing the table.
    for (const tod of TIMES) {
      const names = ambienceCues(tod).map((cue) => cue.cue);
      expect(new Set(names).size, tod).toBe(names.length);
    }
  });

  it("always leaves a real gap: no cue is a metronome", () => {
    // A cue whose min and max are equal fires on a fixed period, which is a
    // beat. The brief for this whole layer was explicitly "not beats".
    for (const tod of TIMES) {
      for (const cue of ambienceCues(tod)) {
        expect(cue.maxGapMs, `${tod}/${cue.cue}`).toBeGreaterThan(cue.minGapMs);
        expect(cue.minGapMs, `${tod}/${cue.cue}`).toBeGreaterThanOrEqual(1_000);
        expect(cue.gain, `${tod}/${cue.cue}`).toBeGreaterThan(0);
        expect(cue.gain, `${tod}/${cue.cue}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps birds to the daylight and owls to the dark", () => {
    const night = ambienceCues("night").map((cue) => cue.cue);
    expect(night).not.toContain("bird-high");
    expect(night).not.toContain("bird-low");
    expect(ambienceCues("day").map((cue) => cue.cue)).not.toContain("owl-hoot");
    expect(night).toContain("owl-hoot");
  });

  it("plays the frogs and the creaks everywhere now, not just their old home district", () => {
    const night = ambienceCues("night").map((cue) => cue.cue);
    expect(night).toContain("frog");
    expect(night).toContain("water-drop");
    expect(night).toContain("windmill-creak");
    expect(night).toContain("gate-creak");
  });
});

describe("livestockCue", () => {
  it("schedules nothing for an animal you do not own", () => {
    expect(livestockCue(0, "day")).toBeNull();
    expect(livestockCue(-1, "day")).toBeNull();
  });

  it("makes a bigger herd talk more often, but not proportionally", () => {
    const one = livestockCue(1, "day")!;
    const four = livestockCue(4, "day")!;
    expect(four.maxGapMs).toBeLessThan(one.maxGapMs);
    // Four animals are one herd, not four soloists: the gap halves rather
    // than quartering, or a full pen becomes a wall of noise.
    expect(four.maxGapMs).toBeGreaterThan(one.maxGapMs / 4);
  });

  it("settles the animals at night", () => {
    expect(livestockCue(3, "night")!.minGapMs).toBeGreaterThan(livestockCue(3, "day")!.minGapMs);
  });

  it("holds the gain in a narrow band however large the herd", () => {
    for (const count of [1, 3, 6, 18, 400]) {
      const cue = livestockCue(count, "day")!;
      expect(cue.gain, `${count}`).toBeGreaterThan(0);
      expect(cue.gain, `${count}`).toBeLessThanOrEqual(0.4);
    }
  });
});

describe("rollGapMs", () => {
  it("stays inside the cue's own range", () => {
    const cue = { minGapMs: 2_000, maxGapMs: 6_000 };
    expect(rollGapMs(cue, () => 0)).toBe(2_000);
    expect(rollGapMs(cue, () => 1)).toBe(6_000);
    expect(rollGapMs(cue, () => 0.5)).toBe(4_000);
  });

  it("copes with a zero-width range without returning NaN", () => {
    expect(rollGapMs({ minGapMs: 3_000, maxGapMs: 3_000 }, () => 0.7)).toBe(3_000);
  });
});

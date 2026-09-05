import { describe, expect, it } from "vitest";
import {
  AMBIENCE_BEDS,
  ambienceCues,
  ambienceMix,
  livestockCue,
  rollGapMs,
  type AmbienceTimeOfDay,
} from "./ambience-plan";
import { ZONE_IDS } from "./zones";

const TIMES: AmbienceTimeOfDay[] = ["day", "dusk", "night"];

describe("ambienceMix", () => {
  it("keeps every bed inside 0..1 for every district and hour", () => {
    for (const zone of ZONE_IDS) {
      for (const tod of TIMES) {
        const mix = ambienceMix(tod, zone);
        for (const bed of AMBIENCE_BEDS) {
          expect(mix[bed], `${zone}/${tod}/${bed}`).toBeGreaterThanOrEqual(0);
          expect(mix[bed], `${zone}/${tod}/${bed}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("still gives every district something in the mix, now that there is no air floor", () => {
    // There is no bed guaranteed non-zero any more (that guarantee was the
    // `air` floor, and it read as wind) -- but every real zone still carries
    // grass, so a district going genuinely silent would be a regression in
    // the zone table, not a property this file enforces directly.
    for (const zone of ZONE_IDS) {
      for (const tod of TIMES) {
        const mix = ambienceMix(tod, zone);
        const total = mix.grass + mix.water + mix.insects;
        expect(total, `${zone}/${tod}`).toBeGreaterThan(0);
      }
    }
  });

  it("makes the long meadow the grassiest district and the wallow the wettest", () => {
    // The districts have to be TOLD APART by ear, which is the whole point of
    // mixing per district rather than playing one farm bed everywhere.
    const grass = ZONE_IDS.map((zone) => ({ zone, value: ambienceMix("day", zone).grass }));
    expect(grass.sort((a, b) => b.value - a.value)[0].zone).toBe("meadow");

    const water = ZONE_IDS.map((zone) => ({ zone, value: ambienceMix("day", zone).water }));
    expect(water.sort((a, b) => b.value - a.value)[0].zone).toBe("wallow");
  });

  it("has no wind bed and no air bed", () => {
    // Not a level to be tuned down -- both beds are gone, and the doc over
    // AMBIENCE_BEDS says why neither must come back. A bed reinstated at a
    // "safe" gain, under either name, is the exact regression this catches.
    expect([...AMBIENCE_BEDS] as string[]).not.toContain("wind");
    expect([...AMBIENCE_BEDS] as string[]).not.toContain("air");
  });

  it("hands the daytime insect hum over to the cricket cue at night", () => {
    for (const zone of ZONE_IDS) {
      expect(ambienceMix("night", zone).insects, zone).toBe(0);
      const cues = ambienceCues("night", zone).map((cue) => cue.cue);
      expect(cues, zone).toContain("cricket");
    }
  });

  it("settles the grass with the light", () => {
    for (const zone of ZONE_IDS) {
      const day = ambienceMix("day", zone).grass;
      const night = ambienceMix("night", zone).grass;
      if (day > 0) expect(night, zone).toBeLessThan(day);
    }
  });
});

describe("ambienceCues", () => {
  it("gives every district something to hear at every hour", () => {
    for (const zone of ZONE_IDS) {
      for (const tod of TIMES) {
        expect(ambienceCues(tod, zone).length, `${zone}/${tod}`).toBeGreaterThan(0);
      }
    }
  });

  it("never schedules the same cue twice in one district", () => {
    // Two entries for one cue would run two independent schedulers for it,
    // quietly doubling how often it fires -- a mistake that is very hard to
    // hear as a bug and very easy to make while editing the table.
    for (const zone of ZONE_IDS) {
      for (const tod of TIMES) {
        const names = ambienceCues(tod, zone).map((cue) => cue.cue);
        expect(new Set(names).size, `${zone}/${tod}`).toBe(names.length);
      }
    }
  });

  it("always leaves a real gap: no cue is a metronome", () => {
    // A cue whose min and max are equal fires on a fixed period, which is a
    // beat. The brief for this whole layer was explicitly "not beats".
    for (const zone of ZONE_IDS) {
      for (const tod of TIMES) {
        for (const cue of ambienceCues(tod, zone)) {
          expect(cue.maxGapMs, `${zone}/${tod}/${cue.cue}`).toBeGreaterThan(cue.minGapMs);
          expect(cue.minGapMs, `${zone}/${tod}/${cue.cue}`).toBeGreaterThanOrEqual(1_000);
          expect(cue.gain, `${zone}/${tod}/${cue.cue}`).toBeGreaterThan(0);
          expect(cue.gain, `${zone}/${tod}/${cue.cue}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps birds to the daylight and owls to the dark", () => {
    for (const zone of ZONE_IDS) {
      const night = ambienceCues("night", zone).map((cue) => cue.cue);
      expect(night, zone).not.toContain("bird-high");
      expect(night, zone).not.toContain("bird-low");
    }
    expect(ambienceCues("day", "meadow").map((cue) => cue.cue)).not.toContain("owl-hoot");
    expect(ambienceCues("night", "meadow").map((cue) => cue.cue)).toContain("owl-hoot");
  });

  it("puts the frogs and the water in the wallow", () => {
    const wallow = ambienceCues("night", "wallow").map((cue) => cue.cue);
    expect(wallow).toContain("frog");
    expect(wallow).toContain("water-drop");
    expect(ambienceCues("night", "oxfields").map((cue) => cue.cue)).not.toContain("frog");
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

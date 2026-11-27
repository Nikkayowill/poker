import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_SOUNDS,
  cuesFor,
  FADE_IN,
  FADE_OUT,
  HEARING_RANGE,
  HUNT_HOLD,
  hearing,
  MUFFLE,
  MUSIC_TRACKS,
  MusicDirector,
  pick,
  playerStep,
  readStrain,
  SOUND_GROUPS,
  StepCounter,
  type CueContext,
  type MusicInput,
} from "./audio";
import { WEAPONS } from "./content";
import type { SimEvent } from "./types";

const ctx = (over: Partial<CueContext> = {}): CueContext => ({
  weaponId: "pistol",
  listener: { x: 0, y: 0 },
  blocked: () => false,
  roll: () => 0.5,
  ...over,
});

describe("the sound files", () => {
  it("has a file for every sound the code can ask for, and no unlisted ones", () => {
    const manifest = JSON.parse(readFileSync("public/stackstrike/audio/manifest.json", "utf8")) as { sfx: string[]; music: string[] };
    expect([...manifest.sfx].sort()).toEqual([...ALL_SOUNDS].sort());
    expect([...manifest.music].sort()).toEqual([...MUSIC_TRACKS].sort());
    for (const name of ALL_SOUNDS) expect(existsSync(`public/stackstrike/audio/${name}.wav`), name).toBe(true);
    for (const name of MUSIC_TRACKS) expect(existsSync(`public/stackstrike/audio/${name}.mp3`), name).toBe(true);
  });

  it("has a gun sound and a reload for every weapon", () => {
    for (const id of Object.keys(WEAPONS)) {
      expect(SOUND_GROUPS[`shot-${id}` as keyof typeof SOUND_GROUPS], id).toBeDefined();
      expect(ALL_SOUNDS, id).toContain(`reload-${id}`);
    }
  });

  it("picks every take of a group across a range of rolls and never runs off the end", () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < 1; roll += 0.01) seen.add(pick("shot-pistol", roll));
    expect(seen.size).toBe(SOUND_GROUPS["shot-pistol"].length);
    expect(pick("kill", 0.999999)).toBe("kill-2");
  });
});

describe("hearing", () => {
  it("is loudest close up and silent past the range", () => {
    const here = { x: 0, y: 0 };
    expect(hearing(here, { x: 0, y: 0 }, false).gain).toBe(1);
    expect(hearing(here, { x: 300, y: 0 }, false).gain).toBeGreaterThan(hearing(here, { x: 600, y: 0 }, false).gain);
    expect(hearing(here, { x: HEARING_RANGE + 1, y: 0 }, false).gain).toBe(0);
  });

  it("muffles a sound behind a wall", () => {
    const open = hearing({ x: 0, y: 0 }, { x: 200, y: 0 }, false).gain;
    expect(hearing({ x: 0, y: 0 }, { x: 200, y: 0 }, true).gain).toBeCloseTo(open * MUFFLE);
  });

  it("puts a sound on the side it comes from", () => {
    expect(hearing({ x: 0, y: 0 }, { x: -300, y: 0 }, false).pan).toBeLessThan(-0.3);
    expect(hearing({ x: 0, y: 0 }, { x: 300, y: 0 }, false).pan).toBeGreaterThan(0.3);
    expect(Math.abs(hearing({ x: 0, y: 0 }, { x: 5000, y: 0 }, false).pan)).toBeLessThanOrEqual(0.75);
  });
});

describe("what an event sounds like", () => {
  it("fires the held gun, and racks a shotgun a moment later", () => {
    const shot: SimEvent = { type: "shot", from: "player", pos: { x: 0, y: 0 } };
    expect(cuesFor(shot, ctx({ weaponId: "pistol" })).map((c) => c.name)).toEqual(["shot-pistol-2"]);
    expect(cuesFor(shot, ctx({ weaponId: "smg" }))[0].name).toMatch(/^shot-smg/);
    const shotgun = cuesFor(shot, ctx({ weaponId: "shotgun" }));
    expect(shotgun.map((c) => c.name)).toEqual(["shot-shotgun-2", "shotgun-rack"]);
    expect(shotgun[1].delay).toBeGreaterThan(0.3);
  });

  it("makes the shotgun the loudest of your guns", () => {
    const shot: SimEvent = { type: "shot", from: "player", pos: { x: 0, y: 0 } };
    const level = (weaponId: string) => cuesFor(shot, ctx({ weaponId }))[0].volume;
    expect(level("shotgun")).toBeGreaterThan(level("smg"));
    expect(level("smg")).toBeGreaterThanOrEqual(level("pistol"));
  });

  it("always plays the sound of being hit, but not a zombie hit from across the building", () => {
    expect(cuesFor({ type: "hit", pos: { x: 3000, y: 0 }, target: "player" }, ctx())[0].name).toMatch(/^hit-player/);
    expect(cuesFor({ type: "hit", pos: { x: 3000, y: 0 }, target: "enemy" }, ctx())).toEqual([]);
  });

  it("sounds an alarm when a wave starts, and a chime for a level-up", () => {
    expect(cuesFor({ type: "wave", number: 2 }, ctx()).map((c) => c.name)).toEqual(["alarm"]);
    expect(cuesFor({ type: "levelup", level: 3 }, ctx()).map((c) => c.name)).toEqual(["ui-confirm"]);
  });

  it("makes a barrel blast a deep boom that is still felt from across the building", () => {
    const near = cuesFor({ type: "barrel", pos: { x: -50, y: 0 } }, ctx())[0];
    const far = cuesFor({ type: "barrel", pos: { x: 5000, y: 0 } }, ctx())[0];
    expect(near.name).toMatch(/^shot-shotgun/);
    expect(near.rate).toBeLessThan(0.7);
    expect(far.volume).toBeGreaterThan(0);
    expect(far.volume).toBeLessThan(near.volume);
  });

  it("makes a bomb a deep shotgun boom", () => {
    const [boom] = cuesFor({ type: "bomb", pos: { x: 0, y: 0 } }, ctx());
    expect(boom.name).toMatch(/^shot-shotgun/);
    expect(boom.rate).toBeLessThan(0.7);
    expect(boom.volume).toBe(1);
  });

  it("gives every kind of event a sound or says why not", () => {
    const events: SimEvent[] = [
      { type: "shot", from: "player", pos: { x: 0, y: 0 } },
      { type: "hit", pos: { x: 0, y: 0 }, target: "enemy" },
      { type: "wall", pos: { x: 10, y: 0 } },
      { type: "kill", pos: { x: 10, y: 0 }, defId: "walker", points: 100 },
      { type: "reload" },
      { type: "pickup", pos: { x: 0, y: 0 }, kind: "health" },
      { type: "pickup", pos: { x: 0, y: 0 }, kind: "bomb" },
      { type: "pickup", pos: { x: 0, y: 0 }, kind: "frenzy" },
      { type: "wave", number: 1 },
      { type: "levelup", level: 2 },
      { type: "bomb", pos: { x: 0, y: 0 } },
      { type: "barrel", pos: { x: 0, y: 0 } },
      { type: "burst", pos: { x: 10, y: 0 }, radius: 110 },
      { type: "waveclear", number: 1, bonus: 100 },
      { type: "dead" },
    ];
    for (const event of events) {
      const cues = cuesFor(event, ctx());
      expect(cues.length, event.type).toBeGreaterThan(0);
      for (const c of cues) {
        expect(ALL_SOUNDS).toContain(c.name);
        expect(c.volume).toBeGreaterThan(0);
        expect(c.volume).toBeLessThanOrEqual(1);
        expect(c.rate).toBeGreaterThan(0.5);
        expect(c.rate).toBeLessThan(1.4);
      }
    }
  });

  it("plays a health pickup small and the power pickups bigger", () => {
    expect(cuesFor({ type: "pickup", pos: { x: 0, y: 0 }, kind: "health" }, ctx())[0].name).toBe("pickup-small");
    expect(cuesFor({ type: "pickup", pos: { x: 0, y: 0 }, kind: "bomb" }, ctx())[0].name).toBe("pickup-main");
    expect(cuesFor({ type: "pickup", pos: { x: 0, y: 0 }, kind: "frenzy" }, ctx())[0].name).toBe("pickup-main");
  });
});

describe("footsteps", () => {
  it("counts a step each stride, carrying the remainder", () => {
    const steps = new StepCounter(40);
    expect(steps.advance(30)).toBe(0);
    expect(steps.advance(30)).toBe(1);
    expect(steps.advance(100)).toBe(3);
    expect(steps.advance(0.5)).toBe(0);
    steps.reset();
    expect(steps.advance(39)).toBe(0);
  });

  it("keeps your own steps quiet and soft", () => {
    const step = playerStep(() => 0.4);
    expect(step.name).toMatch(/^step-soft/);
    expect(step.volume).toBeLessThan(0.6);
  });
});

describe("the music", () => {
  const calm: MusicInput = { hunted: false, strain: 0, ending: "none" };
  const run = (director: MusicDirector, seconds: number, input: MusicInput) => {
    let mix = director.update(0, input);
    for (let t = 0; t < seconds; t += 1 / 30) mix = director.update(1 / 30, input);
    return mix;
  };

  it("starts silent and brings the calm track in", () => {
    const director = new MusicDirector();
    expect(director.update(0, calm).stealth).toBe(0);
    const mix = run(director, FADE_IN + 0.2, calm);
    expect(mix.stealth).toBe(1);
    expect(mix.hunted).toBe(0);
  });

  it("swaps to the fight track while a wave is on, and holds it a while after", () => {
    const director = new MusicDirector();
    run(director, 3, calm);
    const chased = run(director, FADE_OUT + 0.3, { ...calm, hunted: true });
    expect(chased.hunted).toBe(1);
    expect(chased.stealth).toBe(0);
    const justAfter = run(director, HUNT_HOLD - 1, calm);
    expect(justAfter.hunted).toBeGreaterThan(0.9);
    const later = run(director, 8, calm);
    expect(later.hunted).toBe(0);
    expect(later.stealth).toBe(1);
  });

  it("does not drop the fight track for a one-second lull", () => {
    const director = new MusicDirector();
    run(director, 3, { ...calm, hunted: true });
    run(director, 1, calm);
    const back = run(director, 2, { ...calm, hunted: true });
    expect(back.hunted).toBe(1);
  });

  it("brings a heartbeat in as the player gets hurt, and speeds it up", () => {
    const quiet = run(new MusicDirector(), 5, calm);
    expect(quiet.heartSlow).toBe(0);
    expect(quiet.heartFast).toBe(0);
    const wary = run(new MusicDirector(), 5, { ...calm, strain: 0.4 });
    expect(wary.heartSlow).toBeGreaterThan(0.3);
    const nearly = run(new MusicDirector(), 5, { ...calm, strain: 0.97 });
    expect(nearly.heartFast).toBeGreaterThan(0.5);
    expect(nearly.heartSlow).toBeLessThan(wary.heartSlow);
  });

  it("dips the music when the run ends, and stops the heart", () => {
    const dead = run(new MusicDirector(), 6, { hunted: true, strain: 1, ending: "dead" });
    expect(dead.hunted).toBeLessThan(0.2);
    expect(dead.heartFast).toBe(0);
    expect(dead.heartSlow).toBe(0);
  });

  it("only ever asks for levels from 0 to 1", () => {
    const director = new MusicDirector();
    for (let i = 0; i < 600; i += 1) {
      const mix = director.update(1 / 30, { hunted: i % 90 < 30, strain: (i % 70) / 70, ending: "none" });
      for (const value of Object.values(mix)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("reads how hurt the player is", () => {
    expect(readStrain(100, 100)).toBe(0);
    expect(readStrain(25, 100)).toBeCloseTo(0.75);
    expect(readStrain(0, 100)).toBe(1);
    expect(readStrain(150, 100)).toBe(0);
    expect(readStrain(10, 0)).toBe(0);
  });
});

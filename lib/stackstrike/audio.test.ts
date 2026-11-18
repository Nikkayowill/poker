import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_SOUNDS,
  cuesFor,
  FADE_IN,
  FADE_OUT,
  GUARD_STRIDE,
  guardStep,
  HEARING_RANGE,
  HUNT_HOLD,
  hearing,
  MUFFLE,
  MUSIC_TRACKS,
  MusicDirector,
  pick,
  playerStep,
  readThreat,
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

  it("hears a guard's shot from where it is, and not at all from across the building", () => {
    const near = cuesFor({ type: "shot", from: "enemy", pos: { x: -200, y: 0 } }, ctx());
    expect(near).toHaveLength(1);
    expect(near[0].name).toMatch(/^shot-guard/);
    expect(near[0].pan).toBeLessThan(0);
    expect(cuesFor({ type: "shot", from: "enemy", pos: { x: 5000, y: 0 } }, ctx())).toEqual([]);
  });

  it("makes a guard's gun louder than yours when it is as close", () => {
    const mine = cuesFor({ type: "shot", from: "player", pos: { x: 0, y: 0 } }, ctx())[0].volume;
    const theirs = cuesFor({ type: "shot", from: "enemy", pos: { x: 10, y: 0 } }, ctx())[0].volume;
    expect(theirs).toBeGreaterThan(mine);
  });

  it("always plays the sound of being hit, and the radio call with an alarm behind it", () => {
    expect(cuesFor({ type: "hit", pos: { x: 3000, y: 0 }, target: "player" }, ctx())[0].name).toMatch(/^hit-player/);
    expect(cuesFor({ type: "hit", pos: { x: 3000, y: 0 }, target: "enemy" }, ctx())).toEqual([]);
    const radio = cuesFor({ type: "radio", pos: { x: 0, y: 0 } }, ctx());
    expect(radio.map((c) => c.name)).toEqual(["radio", "alarm"]);
    expect(radio[1].delay).toBeGreaterThan(0);
  });

  it("gives every kind of event a sound or says why not", () => {
    const events: SimEvent[] = [
      { type: "shot", from: "player", pos: { x: 0, y: 0 } },
      { type: "hit", pos: { x: 0, y: 0 }, target: "enemy" },
      { type: "wall", pos: { x: 10, y: 0 } },
      { type: "kill", pos: { x: 10, y: 0 }, defId: "grunt" },
      { type: "reload" },
      { type: "spotted", pos: { x: 0, y: 0 } },
      { type: "radio", pos: { x: 0, y: 0 } },
      { type: "hide", on: true },
      { type: "hide", on: false },
      { type: "pickup", pos: { x: 0, y: 0 }, main: true, value: 1 },
      { type: "pickup", pos: { x: 0, y: 0 }, main: false, value: 1 },
      { type: "body", pos: { x: 0, y: 0 } },
      { type: "escaped" },
      { type: "dead" },
    ];
    for (const event of events) {
      const cues = cuesFor(event, ctx());
      expect(cues.length, event.type).toBeGreaterThan(0);
      for (const c of cues) {
        expect(ALL_SOUNDS).toContain(c.name);
        expect(c.volume).toBeGreaterThan(0);
        expect(c.volume).toBeLessThanOrEqual(1);
        expect(c.rate).toBeGreaterThan(0.7);
        expect(c.rate).toBeLessThan(1.4);
      }
    }
  });

  it("plays the main pickup bigger than a small one", () => {
    expect(cuesFor({ type: "pickup", pos: { x: 0, y: 0 }, main: true, value: 1 }, ctx())[0].name).toBe("pickup-main");
    expect(cuesFor({ type: "pickup", pos: { x: 0, y: 0 }, main: false, value: 1 }, ctx())[0].name).toBe("pickup-small");
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

  it("hears a close guard through a wall but not a far one", () => {
    const base = { listener: { x: 0, y: 0 }, roll: () => 0.5 };
    expect(guardStep({ x: 150, y: 0 }, { ...base, blocked: () => true })).not.toBeNull();
    expect(guardStep({ x: 2000, y: 0 }, { ...base, blocked: () => false })).toBeNull();
    const open = guardStep({ x: 300, y: 0 }, { ...base, blocked: () => false })!;
    const shut = guardStep({ x: 300, y: 0 }, { ...base, blocked: () => true })!;
    expect(open.volume).toBeGreaterThan(shut.volume);
    expect(open.name).toMatch(/^step-boot/);
    expect(GUARD_STRIDE).toBeGreaterThan(0);
  });

  it("keeps your own steps quiet and soft", () => {
    const step = playerStep(() => 0.4);
    expect(step.name).toMatch(/^step-soft/);
    expect(step.volume).toBeLessThan(0.6);
  });
});

describe("the music", () => {
  const calm: MusicInput = { hunted: false, awareness: 0, ending: "none" };
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

  it("swaps to the hunt track when a guard gives chase, and holds it a while after", () => {
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

  it("does not drop the hunt for a one-second break in the chase", () => {
    const director = new MusicDirector();
    run(director, 3, { ...calm, hunted: true });
    run(director, 1, calm);
    const back = run(director, 2, { ...calm, hunted: true });
    expect(back.hunted).toBe(1);
  });

  it("brings a heartbeat in as a guard gets suspicious, and speeds it up", () => {
    const quiet = run(new MusicDirector(), 5, calm);
    expect(quiet.heartSlow).toBe(0);
    expect(quiet.heartFast).toBe(0);
    const wary = run(new MusicDirector(), 5, { ...calm, awareness: 0.4 });
    expect(wary.heartSlow).toBeGreaterThan(0.3);
    const nearly = run(new MusicDirector(), 5, { ...calm, awareness: 0.97 });
    expect(nearly.heartFast).toBeGreaterThan(0.5);
    expect(nearly.heartSlow).toBeLessThan(wary.heartSlow);
  });

  it("dips the music for the end of a run, harder for a death, and stops the heart", () => {
    const dead = run(new MusicDirector(), 6, { hunted: true, awareness: 1, ending: "dead" });
    const won = run(new MusicDirector(), 6, { hunted: false, awareness: 0, ending: "escaped" });
    expect(dead.hunted).toBeLessThan(0.2);
    expect(won.stealth).toBeLessThan(0.5);
    expect(won.stealth).toBeGreaterThan(dead.hunted);
    expect(dead.heartFast).toBe(0);
    expect(dead.heartSlow).toBe(0);
  });

  it("only ever asks for levels from 0 to 1", () => {
    const director = new MusicDirector();
    for (let i = 0; i < 600; i += 1) {
      const mix = director.update(1 / 30, { hunted: i % 90 < 30, awareness: (i % 70) / 70, ending: "none" });
      for (const value of Object.values(mix)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("reads the threat from the guards", () => {
    expect(readThreat([], 0)).toEqual({ hunted: false, awareness: 0 });
    expect(readThreat([{ mode: "patrol", awareness: 0.3 }, { mode: "suspicious", awareness: 0.6 }], 0)).toEqual({ hunted: false, awareness: 0.6 });
    expect(readThreat([{ mode: "chase", awareness: 1 }], 0).hunted).toBe(true);
    expect(readThreat([{ mode: "attack", awareness: 1 }], 0).hunted).toBe(true);
    expect(readThreat([], 1).awareness).toBeCloseTo(0.5);
  });
});

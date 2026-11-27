import type { EnemyState, SimEvent, Vec } from "./types";

/**
 * What StackStrike sounds like, as decisions: which sound an event makes, how loud and from
 * which side, and what the music is doing. Pure, so it can be tested; the scene's audio
 * object (components/stackstrike/stackstrike-audio.ts) only plays what this says.
 *
 * The sound files are in public/stackstrike/audio and made by scripts/stackstrike-audio.py.
 */

/** A group is a set of takes of one sound, so repeats do not sound like a machine. */
export const SOUND_GROUPS = {
  "shot-pistol": ["shot-pistol-1", "shot-pistol-2", "shot-pistol-3"],
  "shot-smg": ["shot-smg-1", "shot-smg-2", "shot-smg-3"],
  "shot-shotgun": ["shot-shotgun-1", "shot-shotgun-2"],
  "shot-guard": ["shot-guard-1", "shot-guard-2", "shot-guard-3"],
  "hit-enemy": ["hit-enemy-1", "hit-enemy-2"],
  "hit-player": ["hit-player-1", "hit-player-2"],
  kill: ["kill-1", "kill-2"],
  ricochet: ["ricochet-1", "ricochet-2", "ricochet-3"],
  "step-soft": ["step-soft-1", "step-soft-2", "step-soft-3", "step-soft-4"],
  "step-boot": ["step-boot-1", "step-boot-2", "step-boot-3", "step-boot-4"],
} as const;

export type SoundGroup = keyof typeof SOUND_GROUPS;

/** One-off sounds. */
export const SINGLE_SOUNDS = [
  "reload-pistol",
  "reload-smg",
  "reload-shotgun",
  "shotgun-rack",
  "empty-click",
  "swap",
  "hide",
  "spotted",
  "radio",
  "alarm",
  "body-found",
  "dead",
  "escaped",
  "pickup-small",
  "pickup-main",
  "heart-slow",
  "heart-fast",
  "ui-click",
  "ui-confirm",
  "ui-back",
] as const;

export const MUSIC_TRACKS = ["music-stealth", "music-hunted"] as const;

export type SoundName = (typeof SINGLE_SOUNDS)[number] | (typeof SOUND_GROUPS)[SoundGroup][number];
export type MusicName = (typeof MUSIC_TRACKS)[number];

export const ALL_SOUNDS: readonly SoundName[] = [...SINGLE_SOUNDS, ...Object.values(SOUND_GROUPS).flat()];

export function pick<G extends SoundGroup>(group: G, roll: number): (typeof SOUND_GROUPS)[G][number] {
  const takes = SOUND_GROUPS[group];
  return takes[Math.min(takes.length - 1, Math.floor(roll * takes.length))];
}

export interface Cue {
  name: SoundName;
  /** 0 to 1, before the master volume. */
  volume: number;
  /** Playback speed; slightly different each time so repeats do not sound the same. */
  rate: number;
  /** -1 left to 1 right. */
  pan: number;
  /** Seconds to wait before it starts. */
  delay: number;
}

const cue = (name: SoundName, volume: number, extra: Partial<Omit<Cue, "name" | "volume">> = {}): Cue => ({ name, volume, rate: 1, pan: 0, delay: 0, ...extra });

/* ------------------------------------------------------------------ hearing */

/** Past this far a sound is not heard at all. */
export const HEARING_RANGE = 900;
/** A sound behind a wall is this much quieter. */
export const MUFFLE = 0.5;
const PAN_RANGE = 420;

/** How loud, and from which side, a sound at `source` is to someone at `listener`. */
export function hearing(listener: Vec, source: Vec, blocked: boolean): { gain: number; pan: number } {
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  const near = Math.max(0, 1 - distance / HEARING_RANGE);
  const gain = near ** 1.6 * (blocked ? MUFFLE : 1);
  const pan = Math.max(-1, Math.min(1, (source.x - listener.x) / PAN_RANGE)) * 0.75;
  return { gain, pan };
}

/** Quieter than this is not worth starting a sound for. */
const AUDIBLE = 0.04;

export interface CueContext {
  /** The gun the player is holding when the event happens. */
  weaponId: string;
  listener: Vec;
  /** True when walls stand between the listener and the point. */
  blocked: (point: Vec) => boolean;
  /** A random number from 0 up to but not including 1. */
  roll: () => number;
}

const PLAYER_GUN_VOLUME: Record<string, number> = { pistol: 0.6, smg: 0.65, shotgun: 0.9 };

function jitter(roll: () => number, spread = 0.08): number {
  return 1 - spread / 2 + roll() * spread;
}

/** Everything an event makes you hear, in order. Often one sound, sometimes two. */
export function cuesFor(event: SimEvent, ctx: CueContext): Cue[] {
  const near = (at: Vec) => hearing(ctx.listener, at, ctx.blocked(at));
  switch (event.type) {
    case "shot": {
      if (event.from === "player") {
        const group: SoundGroup = ctx.weaponId === "smg" ? "shot-smg" : ctx.weaponId === "shotgun" ? "shot-shotgun" : "shot-pistol";
        const out = [cue(pick(group, ctx.roll()), PLAYER_GUN_VOLUME[ctx.weaponId] ?? 0.6, { rate: jitter(ctx.roll) })];
        if (ctx.weaponId === "shotgun") out.push(cue("shotgun-rack", 0.5, { delay: 0.5 }));
        return out;
      }
      const h = near(event.pos);
      return h.gain < AUDIBLE ? [] : [cue(pick("shot-guard", ctx.roll()), 0.95 * h.gain, { rate: jitter(ctx.roll, 0.05), pan: h.pan })];
    }
    case "hit": {
      if (event.target === "player") return [cue(pick("hit-player", ctx.roll()), 1)];
      const h = near(event.pos);
      return h.gain < AUDIBLE ? [] : [cue(pick("hit-enemy", ctx.roll()), 0.85 * h.gain, { rate: jitter(ctx.roll), pan: h.pan })];
    }
    case "wall": {
      const h = near(event.pos);
      return h.gain < AUDIBLE ? [] : [cue(pick("ricochet", ctx.roll()), 0.5 * h.gain, { rate: 0.9 + ctx.roll() * 0.25, pan: h.pan })];
    }
    case "kill": {
      const h = near(event.pos);
      return h.gain < AUDIBLE ? [] : [cue(pick("kill", ctx.roll()), 0.9 * h.gain, { rate: jitter(ctx.roll), pan: h.pan })];
    }
    case "reload": {
      const name = ctx.weaponId === "smg" ? "reload-smg" : ctx.weaponId === "shotgun" ? "reload-shotgun" : "reload-pistol";
      return [cue(name, 0.7)];
    }
    case "spotted":
      return [cue("spotted", 0.85)];
    case "radio":
      return [cue("radio", 0.8), cue("alarm", 0.32, { delay: 0.45 })];
    case "hide":
      return [event.on ? cue("hide", 0.6) : cue("hide", 0.45, { rate: 1.25 })];
    case "pickup":
      return [event.main ? cue("pickup-main", 0.8) : cue("pickup-small", 0.6)];
    case "body":
      return [cue("body-found", 0.8)];
    case "escaped":
      return [cue("escaped", 1)];
    case "dead":
      return [cue("dead", 1)];
  }
}

/* ----------------------------------------------------------------- footsteps */

/** Counts footfalls from the distance walked. */
export class StepCounter {
  private carried = 0;

  constructor(private readonly stride: number) {}

  /** How many steps this much walking makes. */
  advance(distance: number): number {
    this.carried += distance;
    const steps = Math.floor(this.carried / this.stride);
    this.carried -= steps * this.stride;
    return steps;
  }

  reset(): void {
    this.carried = 0;
  }
}

export const PLAYER_STRIDE = 58;
export const GUARD_STRIDE = 66;

/** The player's own footfall: soft, quiet, always heard. */
export function playerStep(roll: () => number): Cue {
  return cue(pick("step-soft", roll()), 0.5, { rate: 0.95 + roll() * 0.1 });
}

/** A guard's footfall, heard through walls if it is close enough: it is how you tell where they are in the dark. */
export function guardStep(at: Vec, ctx: Pick<CueContext, "listener" | "blocked" | "roll">): Cue | null {
  const h = hearing(ctx.listener, at, ctx.blocked(at));
  if (h.gain * 0.7 < AUDIBLE) return null;
  return cue(pick("step-boot", ctx.roll()), 0.7 * h.gain, { rate: 0.95 + ctx.roll() * 0.1, pan: h.pan });
}

/* --------------------------------------------------------------------- music */

export interface MusicMix {
  /** The calm track. */
  stealth: number;
  /** The track that plays while you are being hunted. */
  hunted: number;
  /** A slow heartbeat, for when something is getting suspicious. */
  heartSlow: number;
  /** A racing one, for when it nearly has you. */
  heartFast: number;
}

export interface MusicInput {
  /** At least one guard is chasing or shooting at the player. */
  hunted: boolean;
  /** How suspicious the most suspicious guard is, 0 to 1. */
  awareness: number;
  ending: "none" | "dead" | "escaped";
}

/** Seconds to bring a track in and to let it go. */
export const FADE_IN = 1.2;
export const FADE_OUT = 2.4;
/** The hunt music stays this long after the last guard gives up, so it does not flicker. */
export const HUNT_HOLD = 5;

export function readThreat(enemies: readonly Pick<EnemyState, "mode" | "awareness">[], caution: number): Pick<MusicInput, "hunted" | "awareness"> {
  let awareness = Math.max(0, Math.min(1, caution)) * 0.5;
  let hunted = false;
  for (const enemy of enemies) {
    if (enemy.mode === "chase" || enemy.mode === "attack") hunted = true;
    awareness = Math.max(awareness, enemy.awareness);
  }
  return { hunted, awareness };
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function slew(from: number, to: number, seconds: number, dt: number): number {
  const step = dt / seconds;
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step);
}

/**
 * Decides how loud each music layer is. Calm stealth music plays until a guard gives chase,
 * then the hunt track takes over and holds for a few seconds after it is over. A heartbeat
 * creeps in as a guard gets suspicious and speeds up as it closes in. When the run ends the music dips
 * so the ending sound can be heard.
 */
export class MusicDirector {
  private mix: MusicMix = { stealth: 0, hunted: 0, heartSlow: 0, heartFast: 0 };
  private hunting = false;
  private calm = 0;

  update(dt: number, input: MusicInput): MusicMix {
    if (input.hunted) {
      this.hunting = true;
      this.calm = 0;
    } else {
      this.calm += dt;
      if (this.calm >= HUNT_HOLD) this.hunting = false;
    }
    const over = input.ending !== "none";
    const duck = input.ending === "dead" ? 0.12 : input.ending === "escaped" ? 0.4 : 1;
    const tension = Math.max(0, Math.min(1, (input.awareness - 0.08) / 0.92));

    const target: MusicMix = {
      stealth: this.hunting ? 0 : duck,
      hunted: this.hunting ? duck : 0,
      heartSlow: over || this.hunting ? 0 : smoothstep(0.1, 0.55, tension) * (1 - smoothstep(0.5, 0.9, tension)),
      heartFast: over ? 0 : this.hunting ? 0.25 : smoothstep(0.45, 0.95, tension) * 0.85,
    };
    const next = { ...this.mix };
    for (const key of Object.keys(target) as (keyof MusicMix)[]) {
      next[key] = slew(this.mix[key], target[key], target[key] > this.mix[key] ? FADE_IN : FADE_OUT, dt);
    }
    this.mix = next;
    return this.mix;
  }

  reset(): void {
    this.mix = { stealth: 0, hunted: 0, heartSlow: 0, heartFast: 0 };
    this.hunting = false;
    this.calm = 0;
  }
}

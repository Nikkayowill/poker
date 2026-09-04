/**
 * The farm's ambient soundscape: a continuous synthesised bed plus sparse
 * cues, mixed for the time of day, the district you are standing in, and the
 * animals you actually own.
 *
 * This is the ASMR layer, and it is deliberately NOT music. It has no pulse,
 * no key and no loop -- see lib/audio/synth-voices.ts for why that is a
 * property of the implementation and not just of the mix. What decides the
 * levels and timings lives in lib/stackacres/ambience-plan.ts, which is pure
 * and tested; this file owns only the audio graph and the clock.
 *
 * It runs alongside, not instead of, the background music in
 * ./stackacres-music.ts, and shares that module's two mute switches: the
 * app-wide SFX mute and StackAcres' own toggle. Ambience is quiet enough to
 * sit under a track without fighting it, which is the whole reason the beds
 * are pitched where they are.
 *
 * LIFECYCLE. Nothing here exists until `startAmbience` is called, which
 * happens after the tap-to-play splash -- an AudioContext created before a
 * gesture starts suspended and every scheduled voice would pile up behind it.
 * The context is also suspended whenever the tab is hidden, because a farm
 * making wind noise in a background tab is a battery bug.
 */

import {
  ambienceCues,
  ambienceMix,
  livestockCue,
  rollGapMs,
  type AmbienceBed,
  type AmbienceCue,
  type AmbienceCueName,
  type AmbienceTimeOfDay,
} from "@/lib/stackacres/ambience-plan";
import type { ZoneId } from "@/lib/stackacres/zones";
import { RandomWalk, noiseSource, playVoice, type SynthVoice } from "./synth-voices";
import { respectSilentSwitch } from "./audio-session";

/**
 * The two cues that are recordings rather than synthesis, and the animals.
 *
 * Kept small on purpose. Every one of these is a file a phone has to fetch,
 * and each was generated because it is a sound that synthesis does badly: a
 * throat, or resonant timber under load.
 */
const SAMPLE_FILES = {
  "windmill-creak": "/audio/stackacres/sfx/windmill-creak.mp3",
  "gate-creak": "/audio/stackacres/sfx/gate-creak.mp3",
  hen: "/audio/stackacres/sfx/hen-cluck.mp3",
  "hen-fuss": "/audio/stackacres/sfx/hen-fuss.mp3",
  pig: "/audio/stackacres/sfx/sheep-bleat.mp3",
  cattle: "/audio/stackacres/sfx/cow-moo-near.mp3",
} as const;

type SampleName = keyof typeof SAMPLE_FILES;

function isSample(cue: AmbienceCueName): cue is AmbienceCueName & SampleName {
  return cue === "windmill-creak" || cue === "gate-creak";
}

/** How often the scheduler wakes to look ahead, and how far ahead it looks. */
const TICK_MS = 250;
const LOOKAHEAD_S = 0.6;

interface Bed {
  gain: GainNode;
  walks: RandomWalk[];
  sources: AudioBufferSourceNode[];
}

interface ScheduledCue {
  cue: AmbienceCue;
  /** Audio-clock time this cue is next allowed to sound. */
  nextAt: number;
}

/**
 * An animal you own, waiting its turn to speak.
 *
 * Kept apart from `ScheduledCue` because its timing comes from the herd
 * rather than from the district, and because what it plays is chosen at
 * firing time (a hen has two voices) rather than fixed in a table.
 */
interface ScheduledAnimal {
  kind: "hen" | "pig" | "cattle";
  timing: { minGapMs: number; maxGapMs: number; gain: number };
  nextAt: number;
}

class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedBus: GainNode | null = null;
  private cueBus: GainNode | null = null;
  /**
   * Action sounds hang off the destination directly rather than off `master`,
   * so muting the ambience does not also mute the farm's button feedback.
   * They are two different promises: one is "stop the background noise", the
   * other is "stop telling me my taps landed", and only the app-wide SFX mute
   * is allowed to make the second one.
   */
  private sfxBus: GainNode | null = null;
  private sfxMuted = false;
  private beds = new Map<AmbienceBed, Bed>();
  private buffers = new Map<SampleName, AudioBuffer>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private cues: ScheduledCue[] = [];
  private livestock: ScheduledAnimal[] = [];

  private zone: ZoneId = "farmstead";
  private tod: AmbienceTimeOfDay = "day";
  private herd: Partial<Record<SampleName, number>> = {};
  private muted = false;
  private running = false;

  // -- lifecycle ------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running || typeof window === "undefined") return;
    this.running = true;
    respectSilentSwitch();

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      // No Web Audio: the farm is silent rather than broken. Nothing below
      // this point has a fallback, and inventing one with <audio> elements
      // would be a second, worse ambience system to maintain.
      this.running = false;
      return;
    }

    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);
    this.master = master;

    this.bedBus = ctx.createGain();
    this.bedBus.gain.value = 0.5;
    this.bedBus.connect(master);

    this.cueBus = ctx.createGain();
    this.cueBus.gain.value = 0.85;
    this.cueBus.connect(master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxMuted ? 0 : 1;
    this.sfxBus.connect(ctx.destination);

    this.buildBeds();
    this.applyPlan();
    void this.loadSamples();

    this.timer = setInterval(() => this.tick(), TICK_MS);
    // A context created inside a gesture usually starts running, but Safari
    // can still hand one back suspended; resuming an already-running context
    // is a no-op, so this is unconditional rather than guarded.
    await ctx.resume().catch(() => {});
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const bed of this.beds.values()) {
      for (const walk of bed.walks) walk.stop();
      for (const source of bed.sources) {
        try {
          source.stop();
        } catch {
          // Already stopped: tearing down twice is not an error worth raising.
        }
      }
    }
    this.beds.clear();
    this.cues = [];
    this.livestock = [];
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
    this.running = false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    // Ramped, not switched: ambience cut dead reads as the audio breaking.
    this.master.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, this.ctx.currentTime + 0.4);
  }

  setSfxMuted(muted: boolean): void {
    this.sfxMuted = muted;
    if (this.sfxBus) this.sfxBus.gain.value = muted ? 0 : 1;
  }

  /**
   * Fires one action sound now.
   *
   * Unlike a cue this is never scheduled ahead: it answers a press, and a
   * press answered 600ms later has not been answered. `+0.005` rather than
   * exactly `currentTime` because a voice booked in the past is dropped
   * silently by some engines rather than played immediately.
   */
  playAction(voice: SynthVoice, gain = 1): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.sfxMuted || ctx.state !== "running") return;
    const level = ctx.createGain();
    level.gain.value = gain;
    level.connect(bus);
    const at = ctx.currentTime + 0.005;
    const stopAt = playVoice(ctx, level, voice, at);
    setTimeout(() => level.disconnect(), Math.max(0, (stopAt - ctx.currentTime) * 1000) + 250);
  }

  /** Plays one of the animal recordings as a foreground answer to a press. */
  playAnimal(kind: "hen" | "pig" | "cattle", gain = 0.7): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    const buffer = this.buffers.get(kind);
    if (!ctx || !bus || !buffer || this.sfxMuted || ctx.state !== "running") return;
    const level = ctx.createGain();
    level.gain.value = gain;
    level.connect(bus);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    source.connect(level);
    source.start(ctx.currentTime + 0.005);
    source.onended = () => level.disconnect();
  }

  /** Suspends the whole graph while the tab is in the background. */
  setAwake(awake: boolean): void {
    if (!this.ctx) return;
    if (awake) void this.ctx.resume().catch(() => {});
    else void this.ctx.suspend().catch(() => {});
  }

  // -- what the farm is doing ----------------------------------------------

  setPlace(zone: ZoneId, tod: AmbienceTimeOfDay): void {
    if (zone === this.zone && tod === this.tod) return;
    this.zone = zone;
    this.tod = tod;
    this.applyPlan();
  }

  /**
   * How many of each animal are standing in the district being listened to.
   * Called whenever the unit list or the district changes; cheap enough to
   * call on every render, since an unchanged herd re-rolls nothing.
   */
  setHerd(herd: Partial<Record<SampleName, number>>): void {
    const same =
      herd.hen === this.herd.hen && herd.pig === this.herd.pig && herd.cattle === this.herd.cattle;
    if (same) return;
    this.herd = herd;
    this.applyLivestock();
  }

  // -- graph ---------------------------------------------------------------

  private buildBeds(): void {
    const ctx = this.ctx;
    const bus = this.bedBus;
    if (!ctx || !bus) return;

    // `air`: the floor. Brown noise with the top taken off -- the sound of
    // being outdoors, with nothing in particular happening.
    this.beds.set("air", this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "brown");
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 420;
      source.connect(filter).connect(out);
      return { sources: [source], walks: [] };
    }));

    // `wind`: a band of pink-ish noise whose centre frequency AND level both
    // wander. Moving only the level gives a fan; moving the filter with it is
    // what makes a gust read as air moving past something.
    this.beds.set("wind", this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "brown");
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 0.7;
      filter.frequency.value = 400;
      const gust = ctx.createGain();
      gust.gain.value = 0.5;
      source.connect(filter).connect(gust).connect(out);
      return {
        sources: [source],
        walks: [
          new RandomWalk(filter.frequency, 180, 900, 2600, ctx),
          // 0.05..0.3, not 0.09..0.55, not 0.16..1.0. The first cut (ceiling
          // 0.55) still read as too loud by ear on 2026-09-04, a second pass
          // the same day: wind's 400Hz bandpass sits right on top of `air`'s
          // own 420Hz lowpass floor, so the two reinforce each other in a way
          // a same-bed-vs-other-beds ceiling comparison never accounted for.
          // Both ends are still scaled together, same reason as the first
          // cut: narrowing only the ceiling costs the gust the swing that
          // makes it read as weather rather than as a fan.
          new RandomWalk(gust.gain, 0.05, 0.3, 1900, ctx),
        ],
      };
    }));

    // `grass`: the rustle. Shares no signal with `wind`, but its own gust
    // walk runs on a similar timescale, so the two drift in and out of phase
    // instead of being locked -- which is what real grass in real wind does.
    this.beds.set("grass", this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "white");
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 1400;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 0.9;
      band.frequency.value = 3000;
      const gust = ctx.createGain();
      gust.gain.value = 0.3;
      source.connect(high).connect(band).connect(gust).connect(out);
      return {
        sources: [source],
        walks: [
          new RandomWalk(band.frequency, 2000, 5200, 2200, ctx),
          new RandomWalk(gust.gain, 0.06, 0.5, 1500, ctx),
        ],
      };
    }));

    // `water`: a narrow low band, the body of moving water. The individual
    // plips on top of it are cues, not part of this bed.
    this.beds.set("water", this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "white");
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.8;
      band.frequency.value = 750;
      const level = ctx.createGain();
      level.gain.value = 0.5;
      source.connect(band).connect(level).connect(out);
      return {
        sources: [source],
        walks: [
          new RandomWalk(band.frequency, 520, 1150, 1700, ctx),
          new RandomWalk(level.gain, 0.3, 0.8, 2100, ctx),
        ],
      };
    }));

    // `insects`: the daytime hum. Two very close high tones beating against
    // each other, kept far back in the mix -- audible as warmth rather than
    // as a pitch, which is what stops it becoming a mosquito in the room.
    this.beds.set("insects", this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "white");
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 9;
      band.frequency.value = 4300;
      const level = ctx.createGain();
      level.gain.value = 0.22;
      source.connect(band).connect(level).connect(out);
      return {
        sources: [source],
        walks: [
          new RandomWalk(band.frequency, 3600, 5400, 3000, ctx),
          new RandomWalk(level.gain, 0.08, 0.3, 2400, ctx),
        ],
      };
    }));
  }

  private bed(
    ctx: AudioContext,
    bus: GainNode,
    build: (out: GainNode) => { sources: AudioBufferSourceNode[]; walks: RandomWalk[] },
  ): Bed {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    const { sources, walks } = build(gain);
    for (const walk of walks) walk.start();
    return { gain, sources, walks };
  }

  // -- planning ------------------------------------------------------------

  private applyPlan(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const mix = ambienceMix(this.tod, this.zone);
    for (const [name, bed] of this.beds) {
      // Four seconds is a long crossfade on purpose: travelling between
      // districts should feel like walking into somewhere, and a fast
      // fade makes the map sound like it is cutting between rooms.
      bed.gain.gain.linearRampToValueAtTime(mix[name], ctx.currentTime + 4);
    }

    const now = ctx.currentTime;
    this.cues = ambienceCues(this.tod, this.zone).map((cue) => ({
      cue,
      // Stagger the first firing across the whole range rather than starting
      // every cue at once, or arriving somewhere sets off the entire district
      // in the first two seconds.
      nextAt: now + rollGapMs(cue, Math.random) / 1000,
    }));
    this.applyLivestock();
  }

  private applyLivestock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.livestock = [];
    for (const kind of ["hen", "pig", "cattle"] as const) {
      const timing = livestockCue(this.herd[kind] ?? 0, this.tod);
      if (!timing) continue;
      this.livestock.push({ kind, timing, nextAt: now + rollGapMs(timing, Math.random) / 1000 });
    }
  }

  // -- the clock -----------------------------------------------------------

  /**
   * Look-ahead scheduling: every tick, fire anything falling inside the next
   * `LOOKAHEAD_S` and book it on the AUDIO clock rather than a timer. A cue
   * placed by setTimeout inherits the main thread's jitter, which on a frame
   * where Phaser is rebuilding a district is tens of milliseconds -- audible
   * on anything percussive.
   */
  private tick(): void {
    const ctx = this.ctx;
    const bus = this.cueBus;
    if (!ctx || !bus || this.muted || ctx.state !== "running") return;
    const horizon = ctx.currentTime + LOOKAHEAD_S;

    for (const entry of this.cues) {
      if (entry.nextAt > horizon) continue;
      this.fire(entry.cue.cue, Math.max(entry.nextAt, ctx.currentTime), entry.cue.gain);
      entry.nextAt = entry.nextAt + rollGapMs(entry.cue, Math.random) / 1000;
    }

    for (const animal of this.livestock) {
      if (animal.nextAt > horizon) continue;
      // Hens are the one animal with a second voice: a single cluck most of
      // the time, an occasional flurry, which is what keeps a coop from
      // sounding like a metronome with feathers.
      const sample: SampleName =
        animal.kind === "hen" && Math.random() < 0.22 ? "hen-fuss" : animal.kind;
      this.playSample(sample, Math.max(animal.nextAt, ctx.currentTime), animal.timing.gain);
      animal.nextAt += rollGapMs(animal.timing, Math.random) / 1000;
    }
  }

  private fire(cue: AmbienceCueName, at: number, gain: number): void {
    if (isSample(cue)) this.playSample(cue, at, gain);
    else this.playSynth(cue as SynthVoice, at, gain);
  }

  /**
   * Places one voice in the stereo field with distance damping.
   *
   * The damping is the half that matters: a far sound is not just a quiet
   * near sound, it has lost its treble to the air between. Without the
   * lowpass, turning a bird down produces a bird whispering into the
   * microphone rather than a bird across a field.
   */
  private voiceChain(ctx: AudioContext, gain: number, distance: number): GainNode {
    const level = ctx.createGain();
    level.gain.value = gain;

    const air = ctx.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.value = 16000 - distance * 12000;

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.7;

    level.connect(air).connect(pan).connect(this.cueBus!);
    return level;
  }

  private playSynth(voice: SynthVoice, at: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const distance = Math.random() * 0.55;
    const chain = this.voiceChain(ctx, gain * (1 - distance * 0.5), distance);
    const stopAt = playVoice(ctx, chain, voice, at);
    // Release the chain once it has gone quiet. Nodes with nothing playing
    // into them are cheap, but this runs for as long as a session does.
    setTimeout(() => chain.disconnect(), Math.max(0, (stopAt - ctx.currentTime) * 1000) + 250);
  }

  private playSample(name: SampleName, at: number, gain: number): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!ctx || !buffer) return;
    const distance = Math.random() * 0.6;
    const chain = this.voiceChain(ctx, gain * (1 - distance * 0.55), distance);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // A few percent of pitch either way. Six recordings have to carry a whole
    // farm, and an unvaried sample is the fastest way to make a player notice
    // that the same cow is mooing every time.
    source.playbackRate.value = 0.92 + Math.random() * 0.16;
    source.connect(chain);
    source.start(at);
    source.onended = () => chain.disconnect();
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      (Object.keys(SAMPLE_FILES) as SampleName[]).map(async (name) => {
        try {
          const response = await fetch(SAMPLE_FILES[name]);
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          this.buffers.set(name, await ctx.decodeAudioData(bytes));
        } catch {
          // A cue with no buffer simply never sounds; the synthesised bed and
          // the rest of the cues carry the farm without it.
        }
      }),
    );
  }
}

const ambience = new Ambience();

/** Starts the soundscape. Must be called from a user gesture (the tap-to-play splash). */
export function startAmbience(): void {
  void ambience.start();
}

export function stopAmbience(): void {
  ambience.stop();
}

/** Where the listener is, and when. Safe to call on every render. */
export function setAmbiencePlace(zone: ZoneId, tod: AmbienceTimeOfDay): void {
  ambience.setPlace(zone, tod);
}

/** How many hens/sheep/cattle are standing in the district being listened to. */
export function setAmbienceHerd(herd: { hen?: number; pig?: number; cattle?: number }): void {
  ambience.setHerd(herd);
}

export function setAmbienceMuted(muted: boolean): void {
  ambience.setMuted(muted);
}

export function setAmbienceAwake(awake: boolean): void {
  ambience.setAwake(awake);
}

/** Mutes the farm's own action sounds. Wired to the app-wide SFX mute, not to the music toggle. */
export function setFarmSfxMuted(muted: boolean): void {
  ambience.setSfxMuted(muted);
}

/** Fires one synthesised action sound. See ./stackacres-sfx.ts for the intent-named callers. */
export function playFarmVoice(voice: SynthVoice, gain?: number): void {
  ambience.playAction(voice, gain);
}

/** Fires one animal recording in the foreground, as an answer to a press. */
export function playFarmAnimal(kind: "hen" | "pig" | "cattle", gain?: number): void {
  ambience.playAnimal(kind, gain);
}

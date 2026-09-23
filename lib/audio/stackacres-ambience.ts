/**
 * The farm's ambient soundscape: a continuous synthesised bed plus sparse
 * cues, mixed for the time of day and the animals you actually own. It no
 * longer varies by district -- see lib/stackacres/ambience-plan.ts for why.
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
 * making noise in a background tab is a battery bug.
 */

import {
  ambienceCues,
  ambienceMix,
  cueSuppressedByRain,
  livestockCue,
  rainBedGain,
  RAIN_INSECT_DUCK,
  riverBedGain,
  rollGapMs,
  type AmbienceBed,
  type AmbienceCue,
  type AmbienceCueName,
  type AmbienceTimeOfDay,
  type AmbienceWeather,
} from "@/lib/stackacres/ambience-plan";
import { RandomWalk, noiseSource, playVoice, type SynthVoice } from "./synth-voices";
import { respectSilentSwitch } from "./audio-session";

/**
 * Every recording the farm plays: two ambience cues, the animals, and the
 * action sounds that replaced some of the synth voices.
 *
 * Kept small on purpose. Every one of these is a file a phone has to fetch.
 */
const SAMPLE_FILES = {
  "windmill-creak": "/audio/stackacres/sfx/windmill-creak.mp3",
  "gate-creak": "/audio/stackacres/sfx/gate-creak.mp3",
  hen: "/audio/stackacres/sfx/hen-cluck.mp3",
  "hen-fuss": "/audio/stackacres/sfx/hen-fuss.mp3",
  pig: "/audio/stackacres/sfx/sheep-bleat.mp3",
  cattle: "/audio/stackacres/sfx/cow-moo-near.mp3",
  // Action recordings from the 400 Sounds Pack, picked by ear against the
  // synth voices they replace. Trimmed and levelled to about -15dBFS peak,
  // the same reference the synth action voices are trimmed to.
  "hoe-crunch": "/audio/stackacres/sfx/hoe-crunch.mp3",
  "axe-chop": "/audio/stackacres/sfx/axe-chop.mp3",
  "pick-crack": "/audio/stackacres/sfx/pick-crack.mp3",
  "pieces-gather": "/audio/stackacres/sfx/pieces-gather.mp3",
  "seed-pat": "/audio/stackacres/sfx/seed-pat.mp3",
  "water-splash": "/audio/stackacres/sfx/water-splash.mp3",
  whoosh: "/audio/stackacres/sfx/whoosh.mp3",
  "crate-drop": "/audio/stackacres/sfx/crate-drop.mp3",
  "coins-small": "/audio/stackacres/sfx/coins-small.mp3",
  "refuse-blip": "/audio/stackacres/sfx/refuse-blip.mp3",
  "glass-ping": "/audio/stackacres/sfx/glass-ping.mp3",
  "prestige-music-box": "/audio/stackacres/sfx/prestige-music-box.mp3",
  "step-floor-1": "/audio/stackacres/sfx/step-floor-1.mp3",
  "step-floor-2": "/audio/stackacres/sfx/step-floor-2.mp3",
  "step-floor-3": "/audio/stackacres/sfx/step-floor-3.mp3",
  "step-floor-4": "/audio/stackacres/sfx/step-floor-4.mp3",
  "step-grass-1": "/audio/stackacres/sfx/step-grass-1.mp3",
  "step-grass-2": "/audio/stackacres/sfx/step-grass-2.mp3",
  "step-grass-3": "/audio/stackacres/sfx/step-grass-3.mp3",
  "step-grass-4": "/audio/stackacres/sfx/step-grass-4.mp3",
  "door-open": "/audio/stackacres/sfx/door-open.mp3",
  "page-turn": "/audio/stackacres/sfx/page-turn.mp3",
  "map-rustle": "/audio/stackacres/sfx/map-rustle.mp3",
  "leaf-rustle": "/audio/stackacres/sfx/leaf-rustle.mp3",
  "berry-pop": "/audio/stackacres/sfx/berry-pop.mp3",
  "quest-chime": "/audio/stackacres/sfx/quest-chime.mp3",
} as const;

type SampleName = keyof typeof SAMPLE_FILES;

const CUE_AND_ANIMAL_SAMPLES = ["windmill-creak", "gate-creak", "hen", "hen-fuss", "pig", "cattle"] as const;

/** A recording that answers a press, as opposed to an ambience cue or an animal. */
export type FarmSample = Exclude<SampleName, (typeof CUE_AND_ANIMAL_SAMPLES)[number]>;

const FARM_SAMPLES = (Object.keys(SAMPLE_FILES) as SampleName[]).filter(
  (name): name is FarmSample => !(CUE_AND_ANIMAL_SAMPLES as readonly string[]).includes(name),
);

/**
 * How long after start the action recordings are fetched (about 230KB in
 * all). Late enough to stay out of the boot burst, early enough to be in hand
 * before most first taps. A press before then asks for its own file and is
 * silent that once.
 */
const FARM_SAMPLE_PREFETCH_MS = 2500;

function isSample(cue: AmbienceCueName): cue is AmbienceCueName & SampleName {
  return cue === "windmill-creak" || cue === "gate-creak";
}

/** How often the scheduler wakes to look ahead, and how far ahead it looks. */
const TICK_MS = 250;

/** Gestures a browser lets resume a suspended AudioContext. */
const UNLOCK_EVENTS = ["pointerdown", "touchend", "keydown"] as const;
const LOOKAHEAD_S = 0.6;

/**
 * How far ahead of a cue's firing its recording is fetched. The windmill and
 * the gate are 97KB between them and neither can sound sooner than 11s in, so
 * fetching them during the boot burst competes with Phaser and the sprites for
 * nothing. Missing the window costs one skipped firing: `playSample` no-ops
 * without a buffer and the cue comes round again.
 */
const SAMPLE_PREFETCH_S = 5;

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
  /**
   * The rain bed, kept apart from `beds` rather than folded into
   * `AmbienceBed`: it ramps on weather's own clock, not the tod crossfade
   * `applyPlan` drives every entry in `beds` on. See ambience-plan.ts's
   * `rainBedGain` for why the two must not share a ramp.
   */
  private rainBed: Bed | null = null;
  /** The river layer, gated on the wet sector being cleared -- see
   *  ambience-plan.ts's `riverBedGain` for why this is a permanent farm-wide
   *  fact rather than a positional one, and kept apart from `beds` for the
   *  same reason `rainBed` is: its own ramp, on its own trigger. */
  private riverBed: Bed | null = null;
  private buffers = new Map<SampleName, AudioBuffer>();
  /** Samples already fetched or in flight, so `ensureSample` is idempotent. */
  private requested = new Set<SampleName>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private cues: ScheduledCue[] = [];
  private livestock: ScheduledAnimal[] = [];

  private tod: AmbienceTimeOfDay = "day";
  private weather: AmbienceWeather = "clear";
  private riverUnlocked = false;
  private herd: Partial<Record<SampleName, number>> = {};
  private muted = false;
  private running = false;

  /**
   * Wakes the context on the next touch, click or key. The context is built
   * in an effect after the splash tap, and iOS also parks it whenever the app
   * goes to the background, and neither can be resumed outside a gesture.
   * Every sound checks for a running context and skips otherwise, so without
   * this the whole farm went quiet and stayed quiet.
   */
  private readonly unlock = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running") return;
    void ctx.resume().catch(() => {});
    // iOS only counts the context as unlocked once something plays inside the gesture.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(ctx.destination);
    blip.start();
  };

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

    this.timer = setInterval(() => this.tick(), TICK_MS);
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, { capture: true, passive: true });
    window.setTimeout(() => {
      if (this.ctx !== ctx) return;
      for (const name of FARM_SAMPLES) this.ensureSample(name);
    }, FARM_SAMPLE_PREFETCH_MS);
    // A context created inside a gesture usually starts running, but Safari
    // can still hand one back suspended; resuming an already-running context
    // is a no-op, so this is unconditional rather than guarded.
    await ctx.resume().catch(() => {});
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
    this.timer = null;
    for (const bed of this.beds.values()) this.teardownBed(bed);
    if (this.rainBed) this.teardownBed(this.rainBed);
    if (this.riverBed) this.teardownBed(this.riverBed);
    this.beds.clear();
    this.rainBed = null;
    this.riverBed = null;
    this.cues = [];
    this.livestock = [];
    // These were decoded by the context closing below, and the next `start`
    // builds a new one. Re-fetching on every start used to guarantee that for
    // free.
    this.buffers.clear();
    this.requested.clear();
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

  /**
   * Plays one action recording as a foreground answer to a press, through the
   * same bus as the synth voices. A small pitch spread keeps a repeated tap
   * (a footstep, a hoe stroke) from sounding like one sample on a loop.
   */
  playFarmSample(name: FarmSample, gain = 1, spread = 0.06): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.sfxMuted || ctx.state !== "running") return;
    const buffer = this.buffers.get(name);
    if (!buffer) {
      this.ensureSample(name);
      return;
    }
    const level = ctx.createGain();
    level.gain.value = gain;
    level.connect(bus);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 - spread / 2 + Math.random() * spread;
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

  setPlace(tod: AmbienceTimeOfDay): void {
    if (tod === this.tod) return;
    this.tod = tod;
    this.applyPlan();
  }

  /**
   * Whether it is raining, per WeatherOverlayManager -- the audio half of the
   * same state that already drives the screen's tint and rain streaks. Ramps
   * the `rain` bed and ducks the daytime hum independently of `applyPlan`'s
   * tod crossfade; see ambience-plan.ts's `rainBedGain` for why the two
   * clocks stay apart.
   */
  setWeather(weather: AmbienceWeather): void {
    if (weather === this.weather) return;
    this.weather = weather;
    this.applyPlan();
    const ctx = this.ctx;
    if (!ctx || !this.rainBed) return;
    // Three seconds: quicker than the four-second tod crossfade, because a
    // shower starting is a sharper event than the hour turning over, but
    // still a ramp rather than a switch -- a rain bed slammed to full gain
    // reads as a glitch, not as weather arriving.
    this.rainBed.gain.gain.linearRampToValueAtTime(rainBedGain(this.weather), ctx.currentTime + 3);
  }

  /**
   * Whether the farm's one wet sector (the Sheep Pens' mud hollow, `wallow`
   * -- see sectors.ts) has been cleared. Fades the `river` bed in once,
   * permanently, for the whole farm -- see ambience-plan.ts's `riverBedGain`
   * for why this is a farm-wide fact and not a "how close is the camera"
   * one. Eight seconds: slower than either the tod crossfade or the rain
   * ramp, because clearing a sector is a milestone to notice arriving, not
   * a moment to react to.
   */
  setRiverUnlocked(unlocked: boolean): void {
    if (unlocked === this.riverUnlocked) return;
    this.riverUnlocked = unlocked;
    const ctx = this.ctx;
    if (!ctx || !this.riverBed) return;
    this.riverBed.gain.gain.linearRampToValueAtTime(riverBedGain(unlocked), ctx.currentTime + 8);
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

    // `grass`: the rustle, and all that is left of the weather -- see
    // AMBIENCE_BEDS in lib/stackacres/ambience-plan.ts for why there is no
    // wind bed above it, and no `air` floor underneath it, any more. Grass
    // used to carry its own gust walk (the band's centre frequency and level
    // both wandering), on the theory that it would read as air going THROUGH
    // grass rather than as wind. It read as wind: that walk is the same
    // "band of noise that wanders in level and pitch" the wind bed was cut
    // for, just moved rather than removed. Fixed, static filter -- a steady
    // rustle, no gusts.
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
      return { sources: [source], walks: [] };
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

    // `rain`: a wide, soft patter -- brown noise (see synth-voices.ts's own
    // noiseBuffers for why brown carries the low body) opened up by a gentle
    // highpass, with a fast, shallow wander on its level so the shower
    // breathes rather than sitting at one dead-flat volume. No band-pass
    // peak the way `water`/`insects` get one: rain is broadband by nature,
    // and narrowing it would turn a downpour back into a stream.
    this.rainBed = this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "brown");
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 900;
      const level = ctx.createGain();
      level.gain.value = 0.6;
      source.connect(high).connect(level).connect(out);
      return { sources: [source], walks: [new RandomWalk(level.gain, 0.45, 0.75, 900, ctx)] };
    });

    // `river`: a livelier, higher, more restless cousin of `water` above --
    // that bed is "a body of moving water", pitched low and wandering slow;
    // this is the audible reward for actually having running water on the
    // farm, so it sits higher and wanders on a noticeably shorter clock (a
    // bubble rather than a swell). See ambience-plan.ts's `riverBedGain` for
    // why this is gated on the wet sector being cleared, farm-wide, rather
    // than on standing near it.
    this.riverBed = this.bed(ctx, bus, (out) => {
      const source = noiseSource(ctx, "white");
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 2.4;
      band.frequency.value = 1050;
      const level = ctx.createGain();
      level.gain.value = 0.5;
      source.connect(band).connect(level).connect(out);
      return {
        sources: [source],
        walks: [
          new RandomWalk(band.frequency, 780, 1500, 650, ctx),
          new RandomWalk(level.gain, 0.28, 0.65, 900, ctx),
        ],
      };
    });
  }

  /** Stops a bed's walks and sources. Shared by `stop()` and by nothing else
   *  yet -- `rainBed` tears down through the same path rather than a second
   *  copy of this loop. */
  private teardownBed(bed: Bed): void {
    for (const walk of bed.walks) walk.stop();
    for (const source of bed.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped: tearing down twice is not an error worth raising.
      }
    }
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

    const mix = ambienceMix(this.tod);
    const raining = this.weather === "rain";
    for (const [name, bed] of this.beds) {
      // Insects duck under rain the same way they duck at night: the hour's
      // own mix, multiplied down rather than replaced, so dusk-in-the-rain
      // is still dusk. Four seconds either way -- the day/night handover and
      // a rain duck are both gradual on purpose, never a cut between rooms.
      const target = name === "insects" && raining ? mix[name] * RAIN_INSECT_DUCK : mix[name];
      bed.gain.gain.linearRampToValueAtTime(target, ctx.currentTime + 4);
    }

    const now = ctx.currentTime;
    this.cues = ambienceCues(this.tod).map((cue) => ({
      cue,
      // Stagger the first firing across the whole range rather than starting
      // every cue at once, or the hour turning over sets off every cue at
      // once.
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
      // On ownership rather than on firing, unlike the cue samples in `tick`:
      // an animal is pressable, and `playAnimal` answers with whatever is in
      // hand that instant. This is the saving that matters here -- an empty
      // farm used to fetch all four animal recordings (126KB) to play none.
      this.ensureSample(kind);
      if (kind === "hen") this.ensureSample("hen-fuss");
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
    const prefetchHorizon = ctx.currentTime + SAMPLE_PREFETCH_S;

    const rainSilenced = this.weather === "rain";
    for (const entry of this.cues) {
      if (isSample(entry.cue.cue) && entry.nextAt <= prefetchHorizon) {
        this.ensureSample(entry.cue.cue);
      }
      // Paused, not advanced: a bird due mid-shower simply waits at its own
      // `nextAt` rather than rolling a fresh gap it would only sit through,
      // so it picks back up on its existing schedule once the rain clears
      // instead of going quiet for a fixed cooldown of its own.
      if (rainSilenced && cueSuppressedByRain(entry.cue.cue)) continue;
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

  /**
   * Fetches and decodes ONE recording, once. This used to be `loadSamples`,
   * which pulled all six (222KB) at start whether the player owned an animal
   * or not -- what actually plays is decided by the herd and the hour's cues,
   * both known before the sound is due.
   *
   * Fire and forget: every caller is on the audio path and none can wait.
   * Until a buffer lands, `playSample`/`playAnimal` fall through to silence
   * exactly as they already did for a sample that failed to load.
   */
  private ensureSample(name: SampleName): void {
    const ctx = this.ctx;
    if (!ctx || this.requested.has(name)) return;
    this.requested.add(name);
    void (async () => {
      try {
        const response = await fetch(SAMPLE_FILES[name]);
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(bytes);
        // `stop()` may have run while this was in flight, in which case the
        // context that decoded it is closed and a new one is playing.
        if (this.ctx !== ctx) return;
        this.buffers.set(name, buffer);
      } catch {
        // A cue with no buffer simply never sounds; the synthesised bed and
        // the rest of the cues carry the farm without it.
      }
    })();
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

/** What hour the farm is in. Safe to call on every render. */
export function setAmbiencePlace(tod: AmbienceTimeOfDay): void {
  ambience.setPlace(tod);
}

/** Whether it is raining, per WeatherOverlayManager. Fades in the rain bed
 *  and ducks birds/insects; safe to call every frame with the same value. */
export function setAmbienceWeather(weather: AmbienceWeather): void {
  ambience.setWeather(weather);
}

/** Whether the farm's wet sector is cleared. Fades the river bed in
 *  permanently, farm-wide, the first time this is passed `true`. */
export function setAmbienceRiverUnlocked(unlocked: boolean): void {
  ambience.setRiverUnlocked(unlocked);
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

/** Fires one action recording. See ./stackacres-sfx.ts for the intent-named callers. */
export function playFarmSample(name: FarmSample, gain?: number, spread?: number): void {
  ambience.playFarmSample(name, gain, spread);
}

/** Fires one animal recording in the foreground, as an answer to a press. */
export function playFarmAnimal(kind: "hen" | "pig" | "cattle", gain?: number): void {
  ambience.playAnimal(kind, gain);
}

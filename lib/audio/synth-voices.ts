/**
 * Every noise StackAcres makes that is not a recording.
 *
 * This is a Web Audio instrument, not a player: each voice below builds a
 * small graph, schedules its own envelopes on the audio clock, and tears
 * itself down when it has finished sounding. Nothing here holds state between
 * calls and nothing here decides WHEN to fire -- see stackacres-ambience.ts
 * for the scheduler and lib/stackacres/ambience-plan.ts for the timings.
 *
 * WHY SYNTHESIS AND NOT FILES. Two reasons, and the second is the real one.
 *
 * The cheap reason is weight and fidelity: the whole action-sound set below
 * costs zero bytes and never has to be fetched on a phone that is already
 * pulling three minutes of music.
 *
 * The load-bearing reason is that a farm ambience made of files LOOPS, and a
 * loop under a quiet game is heard. Give a player a ten-second wind bed and
 * they will notice the seam inside a minute, and once they have heard it they
 * cannot stop hearing it -- which is the end of the calm the layer exists to
 * produce. Filtered noise driven by a random walk has no seam to find, and a
 * cue fired on a rolled gap never lands on a beat. That is what "ASMR, not
 * beats" actually requires of the implementation.
 *
 * The voices are deliberately plain: filtered noise, a few oscillators, and
 * envelopes. A farm is wood, wind, grass, water and animals, and none of
 * those want a synthesiser that sounds like one.
 */

/** Shared, immutable noise beds. Built once per context and reused by every voice. */
const noiseCache = new WeakMap<BaseAudioContext, { white: AudioBuffer; brown: AudioBuffer }>();

/**
 * Ten seconds of noise, long enough that looping it is inaudible.
 *
 * Looping noise is safe in a way that looping anything else is not: a loop is
 * heard when a recognisable EVENT recurs, and noise has no events in it. What
 * would still betray a loop is the filtering on top repeating with it, which
 * is exactly why every bed's filter is driven by a random walk rather than by
 * an LFO -- see `RandomWalk`.
 */
function noiseBuffers(ctx: BaseAudioContext) {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate * 10);
  const white = ctx.createBuffer(1, length, ctx.sampleRate);
  const brown = ctx.createBuffer(1, length, ctx.sampleRate);
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);

  let last = 0;
  for (let i = 0; i < length; i++) {
    const value = Math.random() * 2 - 1;
    w[i] = value;
    // A one-pole integrator: brown noise, the low rumble under wind and water.
    last = (last + 0.02 * value) / 1.02;
    b[i] = last * 3.5;
  }
  // Crossfade the last 50ms into the first so the loop point has no step in
  // it. A step in a noise buffer is a click, and a click every ten seconds is
  // the one artefact a listener WILL find.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    w[i] = w[i] * t + w[length - fade + i] * (1 - t);
    b[i] = b[i] * t + b[length - fade + i] * (1 - t);
  }

  const built = { white, brown };
  noiseCache.set(ctx, built);
  return built;
}

/** A looping noise source, started immediately. The caller owns stopping it. */
export function noiseSource(ctx: AudioContext, colour: "white" | "brown"): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffers(ctx)[colour];
  source.loop = true;
  // A random start offset means two beds built in the same tick are not
  // reading the same samples, which would make them correlate and collapse
  // toward a single mono hiss.
  source.start(0, Math.random() * 9);
  return source;
}

/**
 * An aperiodic control signal.
 *
 * The obvious way to make wind gust is an LFO, and an LFO is periodic: at
 * 0.05Hz it repeats every twenty seconds, and twenty seconds is well inside
 * the time a player spends standing still on this map. Instead the walk
 * schedules a linear ramp to a fresh random target every `stepMs`, so the
 * parameter wanders and never returns to a previous trajectory.
 */
export class RandomWalk {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly param: AudioParam,
    private readonly min: number,
    private readonly max: number,
    private readonly stepMs: number,
    private readonly ctx: AudioContext,
  ) {}

  start(): void {
    if (this.timer) return;
    this.step();
    this.timer = setInterval(() => this.step(), this.stepMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private step(): void {
    const target = this.min + Math.random() * (this.max - this.min);
    // Ramp over slightly longer than the step so targets overlap and the
    // parameter never actually settles, which is what a held value sounds
    // like: a synthesiser pad rather than weather.
    this.param.linearRampToValueAtTime(target, this.ctx.currentTime + (this.stepMs / 1000) * 1.25);
  }
}

// ---------------------------------------------------------------------------
// Primitives. Every voice below is built from these three.
// ---------------------------------------------------------------------------

interface Envelope {
  attack: number;
  decay: number;
  peak: number;
}

/** A gain node carrying one attack/decay envelope, scheduled from `at`. */
function envelope(ctx: AudioContext, at: number, env: Envelope): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(env.peak, at + env.attack);
  // Exponential decay is how physical things actually stop; a linear fade on
  // a struck or plucked sound reads as a synthesiser cutting off.
  gain.gain.exponentialRampToValueAtTime(0.0001, at + env.attack + env.decay);
  return gain;
}

/** A band of noise with an envelope on it: every wooden, grainy and airy sound here. */
function noiseBurst(
  ctx: AudioContext,
  at: number,
  opts: {
    freq: number;
    q: number;
    env: Envelope;
    /** Optional end frequency: the filter sweeps there over the voice's life. */
    sweepTo?: number;
    type?: BiquadFilterType;
  },
): { out: AudioNode; stopAt: number } {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffers(ctx).white;
  source.loop = true;
  source.start(at, Math.random() * 9);

  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? "bandpass";
  filter.Q.value = opts.q;
  filter.frequency.setValueAtTime(opts.freq, at);
  const life = opts.env.attack + opts.env.decay;
  if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, at + life);

  const gain = envelope(ctx, at, opts.env);
  source.connect(filter).connect(gain);
  source.stop(at + life + 0.02);
  return { out: gain, stopAt: at + life };
}

/** A pitched partial, optionally sweeping. The animals, the bell, the water drops. */
function tone(
  ctx: AudioContext,
  at: number,
  opts: {
    freq: number;
    env: Envelope;
    type?: OscillatorType;
    sweepTo?: number;
    /** Cents of slow wobble, for anything that came out of a throat. */
    vibrato?: { depth: number; rate: number };
  },
): { out: AudioNode; stopAt: number } {
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  const life = opts.env.attack + opts.env.decay;
  osc.frequency.setValueAtTime(opts.freq, at);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, at + life);

  if (opts.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = opts.vibrato.rate;
    depth.gain.value = opts.vibrato.depth;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + life + 0.02);
  }

  const gain = envelope(ctx, at, opts.env);
  osc.connect(gain);
  osc.start(at);
  osc.stop(at + life + 0.02);
  return { out: gain, stopAt: at + life };
}

// ---------------------------------------------------------------------------
// Voices. Each returns when it will have finished, so the caller can bin it.
// ---------------------------------------------------------------------------

/** Every synthesised voice this module can make. */
export type SynthVoice =
  // Ambience cues
  | "bird-high"
  | "bird-low"
  | "pigeon-coo"
  | "crow-caw"
  | "owl-hoot"
  | "cricket"
  | "frog"
  | "water-drop"
  | "farm-bell"
  | "straw-rustle"
  // Action cues
  | "sow-seed"
  | "harvest-pour"
  | "feed-scatter"
  | "muck-clear"
  | "buy-latch"
  | "coins-pour"
  | "crate-down"
  | "scythe-swish"
  | "post-hammer"
  | "travel-steps"
  | "refuse"
  | "panel-slide"
  | "tool-tap";

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Per-voice output trim, MEASURED rather than guessed.
 *
 * Every voice is built from envelope peaks that look comparable in the source
 * and are not: a bandpassed noise burst at Q 1.8 throws away most of its
 * energy, where a bare sine keeps all of its. Rendered through an
 * OfflineAudioContext at a nominal gain of 1, the set spanned about 22dB --
 * `post-hammer` peaked at -11dBFS and `panel-slide` at -32.7 -- which meant a
 * call site asking for "gain: 0.9" got wildly different loudness depending
 * only on which recipe it named. That is not a mix, it is a coincidence.
 *
 * These bring every voice to roughly one of two references: action sounds to
 * about -14dBFS, ambience cues to about -18dBFS, so a cue sits under an
 * action by design rather than by luck. Re-measure and re-derive if a recipe
 * changes -- there is a render harness for it, and the numbers above are what
 * it reported.
 */
const VOICE_TRIM: Record<SynthVoice, number> = {
  // Ambience cues, referenced to about -18dBFS.
  "bird-high": 0.68,
  "bird-low": 1.06,
  "pigeon-coo": 0.79,
  "crow-caw": 2.09,
  "owl-hoot": 0.79,
  cricket: 3,
  frog: 1.83,
  "water-drop": 0.76,
  "farm-bell": 0.5,
  "straw-rustle": 2.27,
  // Action sounds, referenced to about -14dBFS.
  "sow-seed": 5,
  "harvest-pour": 4.8,
  "feed-scatter": 4.2,
  "muck-clear": 5.9,
  "buy-latch": 1.43,
  "coins-pour": 1.45,
  "crate-down": 0.85,
  "scythe-swish": 2.14,
  "post-hammer": 0.71,
  "travel-steps": 2.26,
  refuse: 1.05,
  "panel-slide": 8.6,
  "tool-tap": 2.63,
};

/**
 * Build one voice into `destination`, starting at `at` (audio-clock seconds).
 * Returns the time it will have gone quiet, which the scheduler uses only to
 * decide when it is safe to stop caring.
 */
export function playVoice(
  ctx: AudioContext,
  destination: AudioNode,
  voice: SynthVoice,
  at: number,
): number {
  const parts: { out: AudioNode; stopAt: number }[] = [];

  switch (voice) {
    case "bird-high": {
      // Two to four chirps, each a fast pitch sweep. The variation between
      // firings is what stops a garden of identical robins.
      const chirps = Math.floor(rand(2, 5));
      let t = at;
      for (let i = 0; i < chirps; i++) {
        const from = rand(2400, 3600);
        parts.push(
          tone(ctx, t, {
            freq: from,
            sweepTo: from * rand(0.72, 1.5),
            env: { attack: 0.008, decay: rand(0.05, 0.11), peak: rand(0.1, 0.2) },
          }),
        );
        t += rand(0.07, 0.16);
      }
      break;
    }
    case "bird-low": {
      // A warble rather than a chirp: one longer note that wobbles.
      const base = rand(1000, 1700);
      parts.push(
        tone(ctx, at, {
          freq: base,
          sweepTo: base * rand(0.85, 1.2),
          vibrato: { depth: rand(30, 90), rate: rand(9, 16) },
          env: { attack: 0.02, decay: rand(0.18, 0.34), peak: 0.12 },
        }),
      );
      break;
    }
    case "pigeon-coo": {
      // Two syllables, the second lower and longer. Soft attack: a coo has
      // no transient in it at all, which is most of why it reads as gentle.
      const base = rand(390, 460);
      parts.push(
        tone(ctx, at, {
          freq: base,
          sweepTo: base * 1.12,
          vibrato: { depth: 6, rate: 5 },
          env: { attack: 0.09, decay: 0.2, peak: 0.16 },
        }),
      );
      parts.push(
        tone(ctx, at + 0.34, {
          freq: base * 0.94,
          sweepTo: base * 0.82,
          vibrato: { depth: 5, rate: 4.5 },
          env: { attack: 0.11, decay: 0.4, peak: 0.13 },
        }),
      );
      break;
    }
    case "crow-caw": {
      const caws = Math.floor(rand(2, 4));
      let t = at;
      for (let i = 0; i < caws; i++) {
        const base = rand(330, 430);
        parts.push(
          tone(ctx, t, {
            freq: base,
            sweepTo: base * 0.78,
            type: "sawtooth",
            env: { attack: 0.012, decay: 0.16, peak: 0.055 },
          }),
        );
        // The rasp: a crow is a buzzy tone plus a lot of broadband noise.
        parts.push(noiseBurst(ctx, t, { freq: 1500, q: 1.2, env: { attack: 0.01, decay: 0.15, peak: 0.05 } }));
        t += rand(0.24, 0.38);
      }
      break;
    }
    case "owl-hoot": {
      // A near-pure tone with a dip in it, twice. Almost no harmonics, which
      // is why an owl carries so far and sounds so close at the same time.
      for (let i = 0; i < 2; i++) {
        const base = rand(300, 360);
        parts.push(
          tone(ctx, at + i * 0.62, {
            freq: base,
            sweepTo: base * 0.93,
            vibrato: { depth: 3, rate: 6 },
            env: { attack: 0.07, decay: 0.42, peak: 0.16 },
          }),
        );
      }
      break;
    }
    case "cricket": {
      // A stridulation is a burst TRAIN, not a tone: four to seven very short
      // noise pulses in a row, then a gap. Getting the pulse spacing right is
      // the whole sound.
      const pulses = Math.floor(rand(4, 8));
      const spacing = rand(0.02, 0.03);
      const centre = rand(4200, 5200);
      for (let i = 0; i < pulses; i++) {
        parts.push(
          noiseBurst(ctx, at + i * spacing, {
            freq: centre,
            q: 22,
            env: { attack: 0.001, decay: 0.011, peak: 0.34 },
          }),
        );
      }
      break;
    }
    case "frog": {
      // A croak is a low buzz through a resonance: sawtooth low enough that
      // the individual cycles are nearly audible as clicks.
      const base = rand(78, 104);
      parts.push(
        tone(ctx, at, {
          freq: base,
          sweepTo: base * 1.08,
          type: "sawtooth",
          env: { attack: 0.02, decay: 0.22, peak: 0.09 },
        }),
      );
      parts.push(noiseBurst(ctx, at, { freq: 620, q: 6, env: { attack: 0.02, decay: 0.2, peak: 0.06 } }));
      break;
    }
    case "water-drop": {
      // A drop rises in pitch as the cavity it leaves closes. Sweeping the
      // other way gives a cartoon "boing", which is the classic mistake here.
      const from = rand(520, 780);
      parts.push(
        tone(ctx, at, {
          freq: from,
          sweepTo: from * rand(1.8, 2.6),
          env: { attack: 0.003, decay: rand(0.05, 0.1), peak: 0.16 },
        }),
      );
      parts.push(noiseBurst(ctx, at, { freq: 2400, q: 2, env: { attack: 0.001, decay: 0.014, peak: 0.05 } }));
      break;
    }
    case "farm-bell": {
      // Additive, with INHARMONIC partials -- a bell's overtones are not
      // integer multiples, and using integers gives an organ instead. Higher
      // partials decay faster, which is what makes the strike bright and the
      // tail warm.
      const base = rand(560, 660);
      const ratios = [1, 2.01, 2.98, 4.12, 5.43];
      ratios.forEach((ratio, i) => {
        parts.push(
          tone(ctx, at, {
            freq: base * ratio,
            env: { attack: 0.002, decay: 2.4 / (1 + i * 0.85), peak: 0.13 / (1 + i * 1.1) },
          }),
        );
      });
      parts.push(noiseBurst(ctx, at, { freq: 3000, q: 1, env: { attack: 0.001, decay: 0.03, peak: 0.06 } }));
      break;
    }
    case "straw-rustle": {
      // Not one burst: a handful of overlapping ones at different bands, or
      // it reads as a hiss rather than as dry material moving.
      const bursts = Math.floor(rand(3, 6));
      for (let i = 0; i < bursts; i++) {
        parts.push(
          noiseBurst(ctx, at + rand(0, 0.3), {
            freq: rand(1800, 4200),
            q: rand(1.4, 3),
            env: { attack: rand(0.01, 0.04), decay: rand(0.08, 0.22), peak: rand(0.05, 0.12) },
          }),
        );
      }
      break;
    }

    // --- Action cues -------------------------------------------------------

    case "sow-seed":
    case "feed-scatter": {
      // Granular: many tiny grains, not one patter sample. Seed is the wider
      // and longer of the two because it is thrown further.
      const wide = voice === "feed-scatter";
      const grains = wide ? Math.floor(rand(22, 32)) : Math.floor(rand(14, 22));
      const span = wide ? 0.42 : 0.26;
      for (let i = 0; i < grains; i++) {
        parts.push(
          noiseBurst(ctx, at + Math.random() * span, {
            freq: rand(2200, 5200),
            q: rand(3, 9),
            env: { attack: 0.001, decay: rand(0.008, 0.026), peak: rand(0.06, 0.16) },
          }),
        );
      }
      break;
    }
    case "harvest-pour": {
      // A stream rather than a scatter: dense grains under a filter that
      // falls as the container fills, which is the cue that it is filling.
      const grains = 46;
      for (let i = 0; i < grains; i++) {
        const t = (i / grains) ** 0.8;
        parts.push(
          noiseBurst(ctx, at + t * 0.55 + rand(0, 0.02), {
            freq: rand(1400, 4600) * (1 - t * 0.42),
            q: rand(2, 6),
            env: { attack: 0.001, decay: rand(0.01, 0.03), peak: rand(0.07, 0.15) * (1 - t * 0.4) },
          }),
        );
      }
      break;
    }
    case "muck-clear": {
      // A wet scrape: one long band of noise whose centre sweeps up and the
      // filter opens, plus a heavy low body under it.
      parts.push(
        noiseBurst(ctx, at, {
          freq: 300,
          sweepTo: 900,
          q: 1.6,
          env: { attack: 0.08, decay: 0.34, peak: 0.16 },
        }),
      );
      parts.push(
        noiseBurst(ctx, at + 0.02, {
          freq: 160,
          q: 0.9,
          type: "lowpass",
          env: { attack: 0.05, decay: 0.3, peak: 0.12 },
        }),
      );
      break;
    }
    case "buy-latch": {
      // Wood, not metal: a click transient plus a short damped low tone. The
      // tone is what makes it read as a box rather than as a mouse button.
      parts.push(noiseBurst(ctx, at, { freq: 2600, q: 1.4, env: { attack: 0.0008, decay: 0.016, peak: 0.2 } }));
      parts.push(tone(ctx, at + 0.004, { freq: 940, env: { attack: 0.002, decay: 0.06, peak: 0.11 } }));
      parts.push(tone(ctx, at + 0.004, { freq: 1580, env: { attack: 0.002, decay: 0.035, peak: 0.05 } }));
      break;
    }
    case "coins-pour": {
      // Each coin is two inharmonic partials, which is the whole difference
      // between "coin" and "beep".
      const coins = Math.floor(rand(9, 15));
      for (let i = 0; i < coins; i++) {
        const t = at + Math.random() * 0.46;
        const base = rand(2100, 4200);
        parts.push(tone(ctx, t, { freq: base, env: { attack: 0.001, decay: rand(0.06, 0.16), peak: 0.075 } }));
        parts.push(tone(ctx, t, { freq: base * 1.71, env: { attack: 0.001, decay: rand(0.03, 0.09), peak: 0.04 } }));
      }
      break;
    }
    case "crate-down": {
      parts.push(tone(ctx, at, { freq: 168, sweepTo: 132, env: { attack: 0.002, decay: 0.17, peak: 0.24 } }));
      parts.push(noiseBurst(ctx, at, { freq: 700, q: 0.8, type: "lowpass", env: { attack: 0.001, decay: 0.07, peak: 0.16 } }));
      break;
    }
    case "scythe-swish": {
      // The signature: a band of noise sweeping up and back down under a
      // bell-shaped envelope. Sweeping only upward sounds like an arrow.
      parts.push(
        noiseBurst(ctx, at, {
          freq: 800,
          sweepTo: 4200,
          q: 1.1,
          env: { attack: 0.075, decay: 0.05, peak: 0.2 },
        }),
      );
      parts.push(
        noiseBurst(ctx, at + 0.1, {
          freq: 4000,
          sweepTo: 1100,
          q: 1.3,
          env: { attack: 0.02, decay: 0.16, peak: 0.15 },
        }),
      );
      break;
    }
    case "post-hammer": {
      parts.push(tone(ctx, at, { freq: 140, sweepTo: 108, env: { attack: 0.001, decay: 0.22, peak: 0.28 } }));
      parts.push(noiseBurst(ctx, at, { freq: 1600, q: 1, env: { attack: 0.0008, decay: 0.035, peak: 0.18 } }));
      break;
    }
    case "travel-steps": {
      // Four footfalls with uneven spacing. Even spacing is a drum machine.
      let t = at;
      for (let i = 0; i < 4; i++) {
        parts.push(
          noiseBurst(ctx, t, {
            freq: rand(700, 1300),
            sweepTo: rand(300, 500),
            q: 1.1,
            env: { attack: 0.004, decay: rand(0.07, 0.12), peak: rand(0.09, 0.15) },
          }),
        );
        parts.push(tone(ctx, t, { freq: rand(90, 130), env: { attack: 0.002, decay: 0.06, peak: 0.07 } }));
        t += rand(0.15, 0.23);
      }
      break;
    }
    case "refuse": {
      // Deliberately NOT a buzzer. A refusal on this farm is a dull knock on
      // a plank: it says "that did not move" without scolding, which is the
      // register the rest of StackAcres is written in.
      parts.push(tone(ctx, at, { freq: 190, sweepTo: 150, env: { attack: 0.003, decay: 0.13, peak: 0.2 } }));
      parts.push(noiseBurst(ctx, at, { freq: 420, q: 1.2, type: "lowpass", env: { attack: 0.002, decay: 0.06, peak: 0.09 } }));
      break;
    }
    case "panel-slide": {
      parts.push(
        noiseBurst(ctx, at, {
          freq: 1100,
          sweepTo: 480,
          q: 1.8,
          env: { attack: 0.03, decay: 0.15, peak: 0.1 },
        }),
      );
      break;
    }
    case "tool-tap": {
      parts.push(noiseBurst(ctx, at, { freq: 1400, q: 2.2, env: { attack: 0.001, decay: 0.028, peak: 0.16 } }));
      parts.push(tone(ctx, at + 0.002, { freq: 520, env: { attack: 0.002, decay: 0.045, peak: 0.08 } }));
      break;
    }
  }

  // One trim node for the whole voice rather than scaling each part's own
  // envelope peak: the parts are balanced against each other by ear inside a
  // recipe, and that internal balance has to survive the level correction.
  const trim = ctx.createGain();
  trim.gain.value = VOICE_TRIM[voice] ?? 1;
  trim.connect(destination);

  let stopAt = at;
  for (const part of parts) {
    part.out.connect(trim);
    stopAt = Math.max(stopAt, part.stopAt);
  }
  // Nothing was built (an unknown voice): drop the node rather than leave it
  // connected to the graph for the life of the session.
  if (parts.length === 0) trim.disconnect();
  return stopAt;
}

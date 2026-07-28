export type SoundEffect =
  | "ui"
  | "deal"
  | "card"
  | "flop"
  | "chips"
  | "fold"
  | "check"
  | "call"
  | "raise"
  | "all-in"
  | "win"
  | "lose"
  | "timeout"
  | "time-card";

let enabled = true;
let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  return audioContext;
}

function tone(
  context: AudioContext,
  frequency: number,
  duration: number,
  start: number,
  gainAmount: number,
  type: OscillatorType = "sine",
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainAmount, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function noise(
  context: AudioContext,
  duration: number,
  start: number,
  gainAmount: number,
  frequency: number,
) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency, start);
  filter.Q.setValueAtTime(1.8, start);
  gain.gain.setValueAtTime(gainAmount, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  source.stop(start + duration + 0.01);
}

function whoosh(context: AudioContext, start: number, gainAmount: number) {
  const duration = 0.22;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "bandpass";
  filter.Q.setValueAtTime(0.8, start);
  filter.frequency.setValueAtTime(420, start);
  filter.frequency.exponentialRampToValueAtTime(3600, start + duration * 0.72);
  filter.frequency.exponentialRampToValueAtTime(1500, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainAmount, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  source.stop(start + duration + 0.01);
}

function brass(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  gainAmount: number,
) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(frequency * 0.99, start);
  oscillator.frequency.linearRampToValueAtTime(frequency, start + 0.06);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1100, start);
  filter.frequency.linearRampToValueAtTime(2200, start + 0.08);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainAmount, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(gainAmount * 0.55, start + duration * 0.72);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

export function playSound(effect: SoundEffect) {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;

  void context.resume().catch(() => {
    // Browsers can reject resume until a user gesture; the next click will retry.
  });
  const start = context.currentTime + 0.005;
  const quiet = 0.038;

  switch (effect) {
    case "ui":
      tone(context, 680, 0.045, start, quiet * 0.7, "triangle");
      noise(context, 0.035, start, quiet * 0.5, 1800);
      break;
    case "deal":
      noise(context, 0.055, start, quiet * 1.1, 2600);
      tone(context, 290, 0.08, start + 0.02, quiet * 0.7, "triangle");
      noise(context, 0.045, start + 0.075, quiet * 0.9, 3300);
      tone(context, 440, 0.1, start + 0.08, quiet * 0.7, "triangle");
      break;
    case "card":
      whoosh(context, start, quiet * 1.35);
      noise(context, 0.035, start + 0.17, quiet * 0.6, 3000);
      break;
    case "flop":
      whoosh(context, start, quiet * 1.2);
      whoosh(context, start + 0.16, quiet * 1.05);
      whoosh(context, start + 0.32, quiet * 0.95);
      break;
    case "chips":
      noise(context, 0.08, start, quiet * 1.2, 1500);
      tone(context, 180, 0.08, start + 0.02, quiet * 0.8, "square");
      tone(context, 270, 0.1, start + 0.075, quiet, "square");
      noise(context, 0.065, start + 0.12, quiet, 2100);
      break;
    case "fold":
      tone(context, 280, 0.14, start, quiet * 0.75, "sine");
      tone(context, 165, 0.2, start + 0.08, quiet * 0.65, "sine");
      noise(context, 0.07, start + 0.03, quiet * 0.35, 700);
      break;
    case "check":
      // Two low, dry transients: a pair of knuckles on felt, not a digital ping.
      noise(context, 0.045, start, quiet * 1.1, 520);
      tone(context, 115, 0.075, start, quiet * 0.95, "triangle");
      noise(context, 0.045, start + 0.145, quiet * 1.05, 520);
      tone(context, 108, 0.075, start + 0.145, quiet * 0.9, "triangle");
      break;
    case "call":
      noise(context, 0.05, start, quiet * 0.8, 1700);
      tone(context, 390, 0.08, start + 0.025, quiet * 0.7, "triangle");
      noise(context, 0.045, start + 0.09, quiet * 0.8, 2300);
      tone(context, 560, 0.11, start + 0.105, quiet * 0.8, "triangle");
      break;
    case "raise":
      tone(context, 392, 0.1, start, quiet * 0.8, "triangle");
      tone(context, 523, 0.1, start + 0.07, quiet, "triangle");
      tone(context, 784, 0.16, start + 0.14, quiet * 1.1, "triangle");
      break;
    case "all-in":
      tone(context, 220, 0.12, start, quiet, "sawtooth");
      tone(context, 330, 0.12, start + 0.09, quiet, "sawtooth");
      tone(context, 440, 0.12, start + 0.18, quiet, "sawtooth");
      tone(context, 880, 0.22, start + 0.28, quiet * 1.25, "square");
      noise(context, 0.12, start + 0.3, quiet * 0.8, 2800);
      break;
    case "win":
      // A bright major-key trumpet fanfare with a sustained final note.
      brass(context, 392, start, 0.25, quiet * 1.05);
      brass(context, 494, start + 0.1, 0.25, quiet * 0.95);
      brass(context, 587, start + 0.2, 0.28, quiet * 0.95);
      brass(context, 523, start + 0.36, 0.22, quiet * 0.95);
      brass(context, 659, start + 0.46, 0.24, quiet * 1.05);
      brass(context, 784, start + 0.58, 0.62, quiet * 1.35);
      tone(context, 1568, 0.56, start + 0.58, quiet * 0.22, "triangle");
      noise(context, 0.3, start + 0.67, quiet * 0.7, 2400);
      break;
    case "lose":
      tone(context, 330, 0.2, start, quiet * 0.9, "sine");
      tone(context, 277, 0.2, start + 0.13, quiet * 0.8, "sine");
      tone(context, 220, 0.3, start + 0.26, quiet * 0.7, "sine");
      break;
    case "timeout":
      tone(context, 880, 0.09, start, quiet, "square");
      tone(context, 660, 0.12, start + 0.13, quiet, "square");
      tone(context, 440, 0.2, start + 0.28, quiet, "square");
      break;
    case "time-card":
      tone(context, 523, 0.1, start, quiet * 0.8, "triangle");
      tone(context, 659, 0.1, start + 0.08, quiet, "triangle");
      tone(context, 1047, 0.18, start + 0.16, quiet * 1.1, "triangle");
      break;
  }
}

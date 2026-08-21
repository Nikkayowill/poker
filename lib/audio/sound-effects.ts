import {
  AUDIBLE_EFFECTS,
  CHROME_EFFECTS,
  SOUND_FILES,
  SOUND_REPEAT,
  soundGain,
  type SoundEffect,
} from "./manifest";

export type { SoundEffect };

let enabled = true;
/**
 * Keyed by effect, not by file.
 *
 * It was by file, which was correct while every sound played at volume 1.0
 * and two effects sharing an asset were genuinely interchangeable. They are
 * not interchangeable now: `raise` and `all-in` are the same recording at
 * -29 and -26 dBFS, and one shared element means whichever played last leaves
 * its gain behind for the other. An all-in would announce itself at raise
 * volume, or a raise would shout. One element per effect costs four extra
 * <audio> objects for the whole app and makes the mix mean what it says.
 */
const players = new Map<SoundEffect, HTMLAudioElement>();
let primed = false;

function playerFor(effect: SoundEffect): HTMLAudioElement | null {
  const cached = players.get(effect);
  if (cached) return cached;
  const src = SOUND_FILES[effect];
  if (!src) return null;
  const audio = new Audio(src);
  audio.preload = "auto";
  // Set once here and never touched again: the gain belongs to the effect,
  // and re-applying it per play would be the same shared-mutable-state bug in
  // a slower form.
  audio.volume = soundGain(effect);
  players.set(effect, audio);
  return audio;
}

/**
 * Instantiates (and starts loading) a set of sounds once. Browsers block audio
 * playback before any user gesture, so there is nothing to gain by loading
 * earlier, and building the <audio> elements up front means later playSound
 * calls only ever reuse an existing element -- never create one mid-game.
 *
 * WHAT gets primed WHEN is the part that matters. This used to be every
 * audible effect on the first gesture anywhere, which meant the first tap on
 * the lobby pulled the entire table sound set down the wire on a screen with
 * no table on it -- ~450KB competing with the lobby's own first load, on the
 * one connection a phone has. The set is split instead: the chrome cues on
 * first gesture (they are the only ones the lobby can make), the table's own
 * on the way into a game. Both are idempotent, so the second caller is free.
 */
function prime(effects: readonly SoundEffect[]) {
  if (typeof window === "undefined") return;
  for (const effect of effects) playerFor(effect);
}

function primeChromeOnce() {
  if (primed) return;
  primed = true;
  prime(CHROME_EFFECTS);
}

/**
 * Loads the cues a hand makes. Called on the edge of arriving at a game --
 * poker-app.tsx, and the arcade tables through use-arcade-sound -- so the deal
 * finds its elements already built rather than fetching mid-hand.
 */
export function primeTableSounds() {
  prime(AUDIBLE_EFFECTS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", primeChromeOnce, { once: true, passive: true });
  window.addEventListener("keydown", primeChromeOnce, { once: true });
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

function fire(audio: HTMLAudioElement) {
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Autoplay can still be blocked before any gesture reaches this tab;
    // the next real interaction will succeed, nothing to recover here.
  });
}

export function playSound(effect: SoundEffect) {
  if (!enabled) return;
  const audio = playerFor(effect);
  if (!audio) return;
  fire(audio);

  // A handful of effects are a real gesture repeated -- a double knock on
  // the felt for `check` -- rather than one longer recording. Timed replays
  // of the same element, not two overlapping calls to play() in the same
  // tick, which would just restart it once.
  const repeat = SOUND_REPEAT[effect];
  if (!repeat) return;
  for (let i = 1; i < repeat.times; i++) {
    setTimeout(() => {
      if (!enabled) return;
      fire(audio);
    }, repeat.gapMs * i);
  }
}

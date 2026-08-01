import { AUDIBLE_EFFECTS, SOUND_FILES, soundGain, type SoundEffect } from "./manifest";

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
 * Instantiates (and starts loading) every mapped sound once, the first time
 * the player interacts with the page. Browsers block audio playback before
 * any user gesture, so there is nothing to gain by loading earlier, and
 * building every <audio> element up front means later playSound calls only
 * ever reuse an existing element -- never create one mid-game.
 */
function primeOnce() {
  if (primed || typeof window === "undefined") return;
  primed = true;
  for (const effect of AUDIBLE_EFFECTS) playerFor(effect);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", primeOnce, { once: true, passive: true });
  window.addEventListener("keydown", primeOnce, { once: true });
}

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

export function playSound(effect: SoundEffect) {
  if (!enabled) return;
  const audio = playerFor(effect);
  if (!audio) return;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Autoplay can still be blocked before any gesture reaches this tab;
    // the next real interaction will succeed, nothing to recover here.
  });
}

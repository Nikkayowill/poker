import { SOUND_FILES, type SoundEffect } from "./manifest";

export type { SoundEffect };

let enabled = true;
const players = new Map<string, HTMLAudioElement>();
let primed = false;

function playerFor(src: string): HTMLAudioElement {
  const cached = players.get(src);
  if (cached) return cached;
  const audio = new Audio(src);
  audio.preload = "auto";
  players.set(src, audio);
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
  for (const src of new Set(Object.values(SOUND_FILES))) {
    if (src) playerFor(src);
  }
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
  const src = SOUND_FILES[effect];
  if (!src) return;
  const audio = playerFor(src);
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Autoplay can still be blocked before any gesture reaches this tab;
    // the next real interaction will succeed, nothing to recover here.
  });
}

import { MENU_MUSIC_GAIN, MENU_MUSIC_TRACK } from "./music-manifest";

let enabled = true;
let player: HTMLAudioElement | null = null;
let fadeHandle: number | null = null;
// Set only when a play() call was blocked by the browser's autoplay policy
// rather than by MENU_MUSIC_TRACK being unset -- the next real gesture on
// the page retries it once, the same way the caller originally asked.
let pendingStart = false;

const FADE_MS = 700;
const FADE_STEPS = 14;

function ensurePlayer(): HTMLAudioElement | null {
  if (!MENU_MUSIC_TRACK) return null;
  if (player) return player;
  const audio = new Audio(MENU_MUSIC_TRACK);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  player = audio;
  return audio;
}

function clearFade() {
  if (fadeHandle === null) return;
  window.clearInterval(fadeHandle);
  fadeHandle = null;
}

function fadeTo(target: number, onDone?: () => void) {
  const audio = player;
  if (!audio) return;
  clearFade();
  const start = audio.volume;
  let step = 0;
  fadeHandle = window.setInterval(() => {
    step += 1;
    audio.volume = start + (target - start) * (step / FADE_STEPS);
    if (step >= FADE_STEPS) {
      audio.volume = target;
      clearFade();
      onDone?.();
    }
  }, FADE_MS / FADE_STEPS);
}

function retryOnGesture() {
  if (!pendingStart) return;
  pendingStart = false;
  startMenuMusic();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", retryOnGesture, { passive: true });
  window.addEventListener("keydown", retryOnGesture);
}

export function setMenuMusicEnabled(value: boolean) {
  enabled = value;
  if (!enabled) stopMenuMusic();
}

/** Idempotent: safe to call on every render of the lobby, not just on entry. */
export function startMenuMusic() {
  if (!enabled) return;
  const audio = ensurePlayer();
  if (!audio) return; // no track configured yet -- silent by design
  if (!audio.paused) return;
  pendingStart = false;
  audio.play()
    .then(() => fadeTo(MENU_MUSIC_GAIN))
    .catch(() => {
      // Blocked before any gesture reached this tab; retryOnGesture picks
      // this back up the moment one does.
      pendingStart = true;
    });
}

export function stopMenuMusic() {
  pendingStart = false;
  const audio = player;
  if (!audio || audio.paused) return;
  fadeTo(0, () => audio.pause());
}

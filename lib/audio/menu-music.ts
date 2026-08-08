import { MENU_MUSIC_GAIN, MENU_MUSIC_TRACKS } from "./music-manifest";

let enabled = true;
let player: HTMLAudioElement | null = null;
let fadeHandle: number | null = null;
// Set only when a play() call was blocked by the browser's autoplay policy
// rather than by the playlist being empty -- the next real gesture on the
// page retries it once, the same way the caller originally asked.
let pendingStart = false;

// Indices not yet played in this cycle, and the one currently loaded. One
// element is reused for the whole playlist rather than one per track: the
// browser's autoplay permission is granted to an element that has already
// played, so swapping `src` on it keeps the rest of the set from being blocked
// after the first gesture unlocks the first track.
let queue: number[] = [];
let current = -1;

const FADE_MS = 700;
const FADE_STEPS = 14;

/**
 * Fisher-Yates over the track indices.
 *
 * Exported for the tests, which pass a fixed sequence in place of
 * Math.random: a shuffle nobody can pin down is a shuffle nobody can prove
 * plays every track exactly once per cycle. Note this is presentation rather
 * than game state, so unlike lib/scene it is genuinely allowed to be random --
 * it just is not allowed to be untestable.
 */
export function shuffleIndices(
  count: number,
  random: () => number = Math.random,
): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** The next track's src, advancing the cycle. Null when there is no playlist. */
function nextTrack(): string | null {
  if (MENU_MUSIC_TRACKS.length === 0) return null;
  if (queue.length === 0) {
    queue = shuffleIndices(MENU_MUSIC_TRACKS.length);
    // A fresh cycle opening on the track that just ended would play it twice
    // in a row, which is the one thing a shuffle is expected not to do.
    if (queue.length > 1 && queue[0] === current) {
      [queue[0], queue[1]] = [queue[1], queue[0]];
    }
  }
  current = queue.shift() as number;
  return MENU_MUSIC_TRACKS[current];
}

function ensurePlayer(): HTMLAudioElement | null {
  if (player) return player;
  const first = nextTrack();
  if (first === null) return null;
  const audio = new Audio(first);
  // A single-track playlist loops itself. A real one must not, or `ended`
  // never fires and the first track is the only one anybody ever hears.
  audio.loop = MENU_MUSIC_TRACKS.length === 1;
  audio.preload = "auto";
  audio.volume = 0;
  audio.addEventListener("ended", playNextTrack);
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

/** Advances the playlist. Bound to the element's `ended` event, not polled. */
function playNextTrack() {
  const audio = player;
  if (!audio || !enabled) return;
  const src = nextTrack();
  if (src === null) return;
  clearFade();
  audio.src = src;
  audio.volume = 0;
  audio.play()
    .then(() => fadeTo(MENU_MUSIC_GAIN))
    .catch(() => {
      pendingStart = true;
    });
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
  if (!audio) return; // empty playlist -- silent by design
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

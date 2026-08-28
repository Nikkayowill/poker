import {
  MENU_MUSIC_GAIN,
  MENU_MUSIC_METADATA,
  MENU_MUSIC_TRACKS,
} from "./music-manifest";
import { respectSilentSwitch } from "./audio-session";

let enabled = true;
let player: HTMLAudioElement | null = null;
let fadeHandle: number | null = null;
// Set only when a play() call was blocked by the browser's autoplay policy
// rather than by the playlist being empty. The next real gesture on the
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
 * plays every track exactly once per cycle. This is presentation rather than
 * game state, so unlike lib/scene it's genuinely allowed to be random. It
 * just isn't allowed to be untestable.
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
  // "none", not "auto". The tracks are 2-3.5MB each, and autoplay policy means
  // the first one usually can't play until the player touches something
  // anyway, so "auto" would spend a phone's whole connection on a file that
  // isn't going to be heard yet, while the lobby is still loading around it.
  // play() streams it when there is actually something to hear.
  audio.preload = "none";
  audio.volume = 0;
  audio.addEventListener("ended", playNextTrack);
  player = audio;
  return audio;
}

/**
 * Names the stream in the OS media controls, and points their transport at this
 * module rather than at the bare element.
 *
 * Without this the phone prints "Untitled" (see MENU_MUSIC_METADATA). Without
 * the handlers, the OS pause button would pause the element behind this
 * module's back, and the next lobby render's idempotent startMenuMusic() would
 * override the player, so pause is routed through stopMenuMusic, the one path
 * that also fades.
 *
 * Every branch is feature-detected: MediaSession is absent on desktop Safari
 * and in every test environment, and its absence isn't an error, just a sign
 * nothing outside the page was going to show a label anyway.
 */
function publishMediaSession(state: "playing" | "paused") {
  if (typeof navigator === "undefined") return;
  const session = navigator.mediaSession;
  if (!session) return;
  if (typeof MediaMetadata === "function" && !session.metadata) {
    session.metadata = new MediaMetadata({ ...MENU_MUSIC_METADATA, artwork: [...MENU_MUSIC_METADATA.artwork] });
  }
  session.playbackState = state;
  try {
    session.setActionHandler("play", () => startMenuMusic());
    session.setActionHandler("pause", () => stopMenuMusic());
    session.setActionHandler("stop", () => stopMenuMusic());
    // A bed has no chapters; leaving these unset is what tells the OS to draw
    // no skip buttons rather than dead ones.
    session.setActionHandler("previoustrack", null);
    session.setActionHandler("nexttrack", null);
  } catch {
    // Older engines throw on an action they do not implement rather than
    // ignoring it, and a missing skip button is not worth failing playback for.
  }
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
    .then(() => {
      publishMediaSession("playing");
      fadeTo(MENU_MUSIC_GAIN);
    })
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
  respectSilentSwitch();
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
  if (!audio) return; // empty playlist, silent by design
  if (!audio.paused) return;
  pendingStart = false;
  audio.play()
    .then(() => {
      publishMediaSession("playing");
      fadeTo(MENU_MUSIC_GAIN);
    })
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
  fadeTo(0, () => {
    audio.pause();
    publishMediaSession("paused");
  });
}

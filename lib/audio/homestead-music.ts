/**
 * Homestead background music: loops ambient tracks keyed to time of day.
 *
 * Music is separate from SFX: players expect background music to keep playing
 * across multiple taps/actions, while SFX are one-shot cues. The system respects
 * the global mute setting (which SFX obey via playSound) and persists a
 * separate mute toggle for music itself.
 */

type TimeOfDay = "day" | "dusk" | "night";

const MUSIC_CONFIG: Record<TimeOfDay, { file: string; fadeTime: number }> = {
  day: { file: "/audio/homestead/day.mp3", fadeTime: 2000 },
  dusk: { file: "/audio/homestead/dusk.mp3", fadeTime: 2000 },
  night: { file: "/audio/homestead/night.mp3", fadeTime: 2000 },
};

let currentTrack: HTMLAudioElement | null = null;
let musicEnabled = true; // Separate from SFX mute; persisted to localStorage
let globalMuteEnabled = false;

/**
 * Initialize the music system and apply stored preferences.
 * Call once on app mount.
 */
export function initHomesteadMusic(): void {
  if (typeof window === "undefined") return;

  // Check if app-wide mute is on (from lib/audio/sound-effects)
  try {
    const storedMute = localStorage.getItem("soundMuted");
    globalMuteEnabled = storedMute === "true";
  } catch {
    // localStorage might be blocked
  }

  // Check if music itself is muted (separate toggle)
  try {
    const musicMute = localStorage.getItem("homesteadMusicMuted");
    musicEnabled = musicMute !== "true";
  } catch {
    // localStorage might be blocked
  }
}

/**
 * Determine time of day based on a given timestamp or the current time.
 * Used to pick the current track and in tests.
 *
 * Times are arbitrary and can be tuned per your night-plan.md:
 * - day: 6am - 5:59pm (6 to 18, 12 hours)
 * - dusk: 6pm - 8:59pm (18 to 21, 3 hours)
 * - night: 9pm - 5:59am (21 to 6, 9 hours)
 */
export function timeOfDay(timestamp?: number): TimeOfDay {
  const date = new Date(timestamp || Date.now());
  const hour = date.getHours();

  if (hour >= 6 && hour < 18) return "day";
  if (hour >= 18 && hour < 21) return "dusk";
  return "night";
}

/**
 * Start or switch the background music track. Crossfades between the old and
 * new track if one is already playing. Safe to call repeatedly (e.g., every
 * frame or on a timer) — the system does nothing if the track is already
 * correct.
 *
 * @param tod Time of day to play music for (defaults to current time)
 */
export async function playHomesteadMusic(tod?: TimeOfDay): Promise<void> {
  if (typeof window === "undefined") return;
  if (!musicEnabled || globalMuteEnabled) return;

  const targetTod = tod || timeOfDay();
  const config = MUSIC_CONFIG[targetTod];

  // Already playing the right track, nothing to do
  if (currentTrack?.src.includes(config.file) && !currentTrack.paused) {
    return;
  }

  const nextTrack = new Audio(config.file);
  nextTrack.loop = true;
  nextTrack.volume = 0; // Start muted for crossfade

  try {
    // Start the new track and let it buffer
    const playPromise = nextTrack.play();
    if (playPromise) await playPromise;

    // Crossfade: old track out, new track in
    if (currentTrack && !currentTrack.paused) {
      crossfade(currentTrack, nextTrack, config.fadeTime);
    } else {
      // No old track, just fade in the new one
      fadeIn(nextTrack, config.fadeTime);
    }

    currentTrack = nextTrack;
  } catch (err) {
    // Autoplay might be blocked; next gesture will try again
    console.debug("Homestead music playback failed:", err);
    nextTrack.pause();
  }
}

/**
 * Stop all background music and clean up. Call on component unmount.
 */
export function stopHomesteadMusic(): void {
  if (currentTrack) {
    currentTrack.pause();
    currentTrack.currentTime = 0;
    currentTrack = null;
  }
}

/**
 * Toggle music mute. Persists the preference and stops/resumes playback.
 *
 * Muting fades out rather than cutting instantly -- this is a deliberate tap,
 * not the page going away, so an abrupt stop reads as broken rather than
 * intentional. `stopHomesteadMusic` (a hard stop) is for unmount instead.
 */
export function toggleHomesteadMusicMute(): boolean {
  musicEnabled = !musicEnabled;
  try {
    localStorage.setItem("homesteadMusicMuted", String(!musicEnabled));
  } catch {
    // localStorage might be blocked
  }

  if (musicEnabled) {
    void playHomesteadMusic();
  } else if (currentTrack) {
    const fading = currentTrack;
    currentTrack = null;
    void fadeOut(fading, 400);
  }

  return musicEnabled;
}

/**
 * Update global mute state (called from the app-wide sound preference).
 * This is read-only from Homestead's perspective — the app-shell owns it.
 */
export function setGlobalMute(muted: boolean): void {
  globalMuteEnabled = muted;
  if (!muted && musicEnabled) {
    void playHomesteadMusic();
  } else if (muted) {
    stopHomesteadMusic();
  }
}

/**
 * Check if music is currently enabled (app-mute AND music-mute both off).
 */
export function isHomesteadMusicPlaying(): boolean {
  return musicEnabled && !globalMuteEnabled && currentTrack !== null;
}

// Internal helpers for crossfading

function fadeOut(
  audio: HTMLAudioElement,
  durationMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const startVolume = audio.volume;
    const startTime = Date.now();

    const fadeInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      audio.volume = startVolume * (1 - progress);

      if (progress >= 1) {
        clearInterval(fadeInterval);
        audio.pause();
        audio.currentTime = 0;
        resolve();
      }
    }, 16); // ~60fps
  });
}

function fadeIn(audio: HTMLAudioElement, durationMs: number): void {
  const startTime = Date.now();

  const fadeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    audio.volume = progress;

    if (progress >= 1) {
      clearInterval(fadeInterval);
    }
  }, 16); // ~60fps
}

function crossfade(
  oldTrack: HTMLAudioElement,
  newTrack: HTMLAudioElement,
  durationMs: number,
): void {
  const startTime = Date.now();

  const crossfadeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / durationMs, 1);

    oldTrack.volume = 1 - progress;
    newTrack.volume = progress;

    if (progress >= 1) {
      clearInterval(crossfadeInterval);
      oldTrack.pause();
      oldTrack.currentTime = 0;
    }
  }, 16); // ~60fps
}

/**
 * The menu music playlist, and how loud it sits by default.
 *
 * These seven tracks are the owner's own, supplied for this app, which is what
 * finally settled the sourcing question this file used to be a research note
 * about. The short version of that note, kept because it still applies to
 * anything added later: Pixabay Music is where every stock file in
 * public/sounds/ came from and its licence allows commercial use with no
 * attribution; Kevin MacLeod / incompetech is CC BY despite being universally
 * mislabelled "no copyright", so it needs a visible credit line; and FreePD,
 * which was the best CC0 answer, shut down in 2025.
 *
 * ENCODING. The delivered masters were 256 kbps stereo totalling 40 MB, and
 * they were re-encoded in place to 128 kbps with an EBU R128 pass
 * (`loudnorm=I=-18:TP=-1.5:LRA=11`) and their metadata stripped. That halved
 * the payload to 20 MB and, more importantly, pulled the track-to-track spread
 * from 6.9 dB down to 3.0 dB -- on shuffle, an unnormalised set steps up and
 * down in volume every few minutes, which is far more noticeable than any
 * bitrate difference at the gain below. The masters are kept at
 * assets-src/audio-master/, which is gitignored; the originals are also still
 * in this repo's history, since they were committed before being re-encoded.
 *
 * An empty array here is the silent-by-design path -- the same convention
 * `lose` uses in ./manifest.ts -- and ./menu-music.ts builds no player at all
 * for it rather than 404ing mid-loop.
 */
export const MENU_MUSIC_TRACKS: readonly string[] = [
  "/sounds/StackChips_Track1.mp3",
  "/sounds/StackChips_Track2.mp3",
  "/sounds/StackChips_Track3.mp3",
  "/sounds/StackChips_Track4.mp3",
  "/sounds/StackChips_Track5.mp3",
  "/sounds/StackChips_Track6.mp3",
  "/sounds/StackChips_Track7.mp3",
];

/**
 * Target playback gain, 0..1. Menu music is a bed, not a cue -- it should sit
 * well under every effect's target in ./manifest.ts (the loudest of which,
 * `win`, lands at -24 dBFS) so table sound effects are never competing with it
 * once a hand actually starts.
 *
 * Against the -18 LUFS the tracks are normalised to, 0.35 is -9.1 dB, putting
 * the bed around -27 -- under the quietest of the betting cues. Unlike the SFX
 * table this is one number rather than a per-file measurement, which is only
 * honest because the loudnorm pass above made the files agree with each other.
 */
export const MENU_MUSIC_GAIN = 0.35;

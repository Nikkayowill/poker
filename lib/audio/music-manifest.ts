/**
 * The one music track the app plays, and how loud it sits by default.
 *
 * Same convention as SOUND_FILES in ./manifest.ts: null means "stay silent,
 * on purpose" rather than a missing asset 404ing mid-loop. Drop a licensed,
 * loop-friendly track at the path below and point this at it -- nothing
 * else in ./menu-music.ts or its caller needs to change.
 */
export const MENU_MUSIC_TRACK: string | null = null;
// export const MENU_MUSIC_TRACK = "/sounds/menu-theme.mp3";

/**
 * Target playback gain, 0..1. Menu music is a bed, not a cue -- it should
 * sit well under every effect's target in ./manifest.ts (the loudest of
 * which, `win`, lands at -24 dBFS) so table sound effects are never
 * competing with it once a hand actually starts. There is no measured file
 * to derive this from soundGain-style, so it is a flat, conservative
 * default rather than a calculated one; re-tune by ear once a real track is
 * in place.
 */
export const MENU_MUSIC_GAIN = 0.35;

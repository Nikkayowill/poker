/**
 * The one music track the app plays, and how loud it sits by default.
 *
 * Same convention as SOUND_FILES in ./manifest.ts: null means "stay silent,
 * on purpose" rather than a missing asset 404ing mid-loop. Drop a licensed,
 * loop-friendly track at the path below and point this at it -- nothing
 * else in ./menu-music.ts or its caller needs to change.
 *
 * WHERE TO GET ONE (checked 2026-08-06, because two of the obvious answers
 * are wrong):
 *
 * - Pixabay Music is what every file already in public/sounds/ came from --
 *   the `freesound_community-`, `oxidvideos-` and `bigsoundbank-` prefixes on
 *   those filenames are Pixabay uploader handles. Its content licence allows
 *   commercial use with no attribution, which is what "non copyright" means
 *   in practice here. Staying on one source also keeps the licence story for
 *   this project's audio to a single paragraph. Search "casino" or
 *   "jazz lounge"; the catalogue has purpose-cut Vegas/lounge beds.
 * - Kenney.nl is genuinely CC0 and safe, but its audio is jingles and stings,
 *   not a two-minute bed you can loop under a menu.
 * - NOT Kevin MacLeod / incompetech: that catalogue is CC BY 4.0, so it needs
 *   a visible credit line, and removing that requirement is a paid licence.
 *   It is widely mislabelled as "free, no copyright".
 * - NOT FreePD: it was the best CC0 answer and it shut down in 2025.
 *
 * Whatever is chosen, the file has to be listened to and the licence page
 * read before it ships. That check is the reason this is still null rather
 * than pointed at something plausible-looking fetched blind.
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

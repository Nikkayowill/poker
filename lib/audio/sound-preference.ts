/**
 * Where the player's mute lives.
 *
 * These two keys were private constants inside components/poker-app.tsx, which
 * was fine while the poker table was the only thing that made a noise. It is
 * not any more: the arcade machines are their own routes, poker-app is not
 * mounted on them, and `setSoundEnabled` in lib/audio/sound-effects.ts defaults
 * to `true` -- so a page that played a sound without reading this would ignore
 * a mute the player had already set, on a screen with no control to fix it.
 *
 * In lib/ rather than beside the component for the reason lib/arcade/games.ts
 * gives: vitest.config.ts collects only lib/ and app/, and a key that has
 * already caused one silent un-muting incident (see LEGACY_SOUND_STORAGE_KEY)
 * belongs somewhere `npm test` can see it.
 */

export const SOUND_STORAGE_KEY = "stackchips:sound-enabled";

/**
 * The pre-rename key, still read once so the rename is not a silent reset.
 *
 * `river-room:sound-enabled` is where every existing player's preference
 * lives. The StackChips rename (f7a7cbb) moved the key without migrating it,
 * and because the default is "enabled unless the value is exactly false",
 * anyone who had muted the app got sound turned back on and no way to tell
 * why. Same class of legacy id as the `river_*` cookies -- kept for
 * compatibility, not for style.
 */
export const LEGACY_SOUND_STORAGE_KEY = "river-room:sound-enabled";

export const MUSIC_STORAGE_KEY = "stackchips:menu-music-enabled";

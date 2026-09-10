/**
 * Where the player's mute lives.
 *
 * These two keys were private constants inside components/poker-app.tsx, which
 * was fine while the poker table was the only thing that made a noise. It is
 * not any more: the arcade machines are their own routes, poker-app is not
 * mounted on them, and `setSoundEnabled` in lib/audio/sound-effects.ts defaults
 * to `true`, so a page that played a sound without reading this would ignore
 * a mute the player had already set, on a screen with no control to fix it.
 *
 * In lib/ rather than beside the component for the reason lib/arcade/games.ts
 * gives: vitest.config.ts collects only lib/ and app/, and a key that has
 * already caused one silent un-muting incident (the StackChips rename moved
 * it without a migration) belongs somewhere `npm test` can see it.
 */

export const SOUND_STORAGE_KEY = "stackchips:sound-enabled";

export const MUSIC_STORAGE_KEY = "stackchips:menu-music-enabled";

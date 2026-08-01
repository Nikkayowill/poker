/**
 * Every sound the table can play, which real file (if any) plays for it, and
 * how loud it sits in the mix. The only place a filename should ever appear --
 * change a sound by editing a line here, not by hunting through components.
 *
 * A null entry means "stay silent": there is no real asset for that event,
 * and the right behavior is nothing, not a synthesized stand-in.
 */
export type SoundEffect =
  | "ui"
  | "deal"
  | "card"
  | "flop"
  | "chips"
  | "fold"
  | "check"
  | "call"
  | "raise"
  | "all-in"
  | "win"
  | "lose"
  | "timeout"
  | "time-card"
  | "your-turn";

export const SOUND_FILES: Record<SoundEffect, string | null> = {
  ui: "/sounds/freesound_community-screen-tap-38717.mp3",
  deal: "/sounds/freesound_community-flipcard-91468.mp3",
  card: "/sounds/freesound_community-flipcard-91468.mp3",
  // The flop reveals three cards at once -- the richer flip sound marks it
  // as the bigger moment it is, rather than reusing the routine deal sound.
  flop: "/sounds/playing-card-flipped-over-epic-stock-media-1-00-00.mp3",
  chips: "/sounds/bigsoundbank-poker-chips-4-0945.mp3",
  fold: "/sounds/oxidvideos-taking-playing-card-3-522513.mp3",
  check: "/sounds/freesound_community-knocking-wood-61988.mp3",
  call: "/sounds/oxidvideos-placing-poker-chips-522515.mp3",
  raise: "/sounds/oxidvideos-placing-poker-chips-522521.mp3",
  "all-in": "/sounds/oxidvideos-placing-poker-chips-522521.mp3",
  win: "/sounds/freesound_community-crowd-cheer-ii-6263.mp3",
  // The one sound that has to reach someone who is not looking at the screen.
  // Borrowed from the UI tap because there is no dedicated asset yet; it runs
  // much hotter than the tap does (see EFFECT_TARGET_DB) so the two do not
  // read as the same event. Swapping in a real cue is a one-line change here.
  "your-turn": "/sounds/freesound_community-screen-tap-38717.mp3",
  lose: null,
  timeout: null,
  "time-card": null,
};

/**
 * Mean level of each file as it sits on disk, dBFS, measured with
 * `ffmpeg -i <file> -af volumedetect -f null /dev/null`.
 *
 * These are not preferences, they are measurements, and they are the reason
 * this table exists. The nine assets come from four different libraries and
 * span 15.3 dB of mean level -- the crowd cheer at -16.3 against the epic
 * card flip at -31.6 -- while every one of them was played at volume 1.0. The
 * mix was therefore whatever each library happened to normalise to, which is
 * why the room roared and the flop was a whisper.
 *
 * Re-measure the line if you replace a file. Nothing else needs to change.
 */
const FILE_LEVEL_DB: Record<string, number> = {
  "/sounds/bigsoundbank-poker-chips-4-0945.mp3": -21.4,
  "/sounds/freesound_community-crowd-cheer-ii-6263.mp3": -16.3,
  "/sounds/freesound_community-flipcard-91468.mp3": -28.2,
  "/sounds/freesound_community-knocking-wood-61988.mp3": -23.5,
  "/sounds/freesound_community-screen-tap-38717.mp3": -25.8,
  "/sounds/oxidvideos-placing-poker-chips-522515.mp3": -19.3,
  "/sounds/oxidvideos-placing-poker-chips-522521.mp3": -21.5,
  "/sounds/oxidvideos-taking-playing-card-3-522513.mp3": -29.2,
  "/sounds/playing-card-flipped-over-epic-stock-media-1-00-00.mp3": -31.6,
};

/**
 * Where each event should sit once it is playing, dBFS mean. This half is
 * judgement rather than measurement: it is the table's balance written down,
 * loudest moment to quietest housekeeping.
 *
 * A gain can only ever attenuate -- HTMLMediaElement.volume is capped at 1 --
 * so every target here must be at or below its file's measured level, and the
 * unit tests enforce exactly that. The practical consequence is that the
 * quietest asset sets the ceiling for its own event: the flop runs wide open
 * at unity and is still the most restrained of the big moments. That is an
 * asset limitation and not a tuning choice. If the flop should hit harder,
 * the file has to be replaced; no number in this file can do it.
 */
const EFFECT_TARGET_DB: Record<SoundEffect, number> = {
  // The hand is over and the room reacts. Longest sample in the set at 2.5s,
  // so it plays as a bed under the celebration rather than a hit, and it is
  // trimmed well below its own peak to keep it from swamping the payout.
  win: -24,
  // The bets, in the order they deserve attention.
  "all-in": -26,
  raise: -29,
  call: -31,
  // Chips moving generally. Deliberately the quietest of the chip sounds
  // because it layers *underneath* call/raise in the same snapshot -- it is
  // texture for the stack movement, not the announcement of a decision.
  chips: -36,
  // Cards. The flop is the moment; a routine deal is furniture.
  flop: -31.6,
  fold: -33,
  deal: -33,
  card: -33,
  check: -32,
  // It is on you, and you may not be looking at the screen. Hotter than
  // everything else relative to its source for that reason: with a 15s clock
  // and a seat that is given away after three misses, this is the one cue
  // whose whole job is to interrupt.
  "your-turn": -28,
  // Housekeeping. Should never compete with the table.
  ui: -36,
  // Silent by design -- no file, so the target is unused. Kept in the record
  // so adding an asset is one line and the compiler names the other.
  lose: -30,
  timeout: -30,
  "time-card": -30,
};

/**
 * Playback gain for an effect, 0..1, derived from the two tables above.
 *
 * Amplitude ratio from a decibel difference, which is the 10^(dB/20) the
 * whole file is built on. Clamped at 1 rather than trusted: a target above
 * its file's level is a mistake, and silently clipping it to unity here beats
 * throwing mid-hand. The unit tests fail on that mistake instead.
 */
export function soundGain(effect: SoundEffect): number {
  const src = SOUND_FILES[effect];
  if (!src) return 0;
  const fileDb = FILE_LEVEL_DB[src];
  if (fileDb === undefined) return 1;
  return Math.min(1, 10 ** ((EFFECT_TARGET_DB[effect] - fileDb) / 20));
}

/** Every effect that has a file behind it, for priming and for the tests. */
export const AUDIBLE_EFFECTS = (Object.keys(SOUND_FILES) as SoundEffect[])
  .filter((effect) => SOUND_FILES[effect] !== null);

export const SOUND_LEVELS_FOR_TEST = { FILE_LEVEL_DB, EFFECT_TARGET_DB };

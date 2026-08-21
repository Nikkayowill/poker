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
  | "select"
  | "game-on"
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
  | "win-modest"
  | "lose"
  | "timeout"
  | "your-turn";

export const SOUND_FILES: Record<SoundEffect, string | null> = {
  // The three chrome cues, and the whole reason they are three rather than
  // one. Before this, every button in the app either played `ui` or nothing,
  // so a menu row, a mode switch and sitting down at a table were the same
  // click -- or silence. The split is by what the press DID, not by which
  // screen it was on:
  //   ui      -- you moved: a menu opened, a link was followed, a panel closed.
  //   select  -- you chose: a mode, a tier, a toggle, a tab. Something changed.
  //   game-on -- you are in: a table or a game actually took you.
  // Keep it at three. A fourth would have to answer what a press means that
  // these do not, and the answer so far has always been "it is one of these".
  ui: "/sounds/Menu_clicks.mp3",
  // The old screen tap, which had sat unused since `your-turn` was given its
  // own recording -- but cut down, and the cut is the point. That file is
  // 1.08s holding TWO taps (a 5ms artefact at 0.10s, the real hit at 0.48s)
  // over 0.42s of trailing silence, which is exactly what the owner's own
  // rename of it, Check_Sound_Repeats_Twice.mp3, says on the tin. Pointed at
  // whole it makes one button press sound like a double-click. This is the
  // second burst alone, 0.25s, and it is drier and shorter than the menu
  // click -- which is what makes a choice read as a choice beside it.
  select: "/sounds/Select_Tap.mp3",
  // Built rather than sourced: every unused file in public/sounds turned out
  // to be a byte-identical rename of a cue the table already plays, so there
  // was nothing on disk that could sound like arriving somewhere. This is the
  // house chip riffle under a rising D5-A5-D6, rendered with ffmpeg from that
  // same licensed recording -- see the note in AUDIO.md. Replacing it with a
  // supplied take is this one line plus its measured level below.
  "game-on": "/sounds/Game_On.mp3",
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
  // No longer the raise recording at a hotter gain: an all-in is the one bet
  // that ends someone's hand, and it now has its own take to say so.
  "all-in": "/sounds/All_In.mp3",
  // The stock crowd cheer, now reserved for a genuinely huge pot (see
  // `HUGE_POT_BIG_BLINDS` in table-sounds.ts) rather than every showdown --
  // a full table roaring for a routine walked blind was the "regular tables
  // sound like a stadium" complaint this split fixes. Still 2.5s for the same
  // reason as before: it has to finish reacting before the next hand deals.
  win: "/sounds/freesound_community-crowd-cheer-ii-6263.mp3",
  // Every other pot. One of the two supplied alternatives noted above --
  // `Winning_a_regular_pot_2.mp3` -- turned out to hold its real hit in the
  // first 1.7s with over two seconds of trailing silence baked into the
  // export; trimmed to that, at 1.85s, it clears NEXT_HAND_DELAY_MS same as
  // the cheer does. (Its sibling `Winning_a_regular_pot.mp3` has a genuine
  // 5.2s hit and still doesn't fit -- left on disk unused.)
  "win-modest": "/sounds/Winning_a_regular_pot_trimmed.mp3",
  // The one sound that has to reach someone who is not looking at the screen.
  // It borrowed the UI tap for want of a dedicated asset; it has a real cue
  // now, so the two no longer differ only by gain.
  "your-turn": "/sounds/Your_Turn.mp3",
  lose: null,
  timeout: "/sounds/TimeBank.mp3",
};

/**
 * Mean level of each file as it sits on disk, dBFS, measured with
 * `ffmpeg -i <file> -af volumedetect -f null /dev/null`.
 *
 * These are not preferences, they are measurements, and they are the reason
 * this table exists. The twelve assets come from four stock libraries plus the
 * owner's own set, and span 15.3 dB of mean level -- the crowd cheer at -16.3
 * against the epic card flip at -31.6 -- while every one of them was played at
 * volume 1.0. The mix was therefore whatever each source happened to normalise
 * to, which is why the room roared and the flop was a whisper.
 *
 * Re-measure the line if you replace a file. Nothing else needs to change.
 *
 * The full-length screen-tap entry is kept although nothing points at it any
 * more -- `select` plays the trimmed cut of it instead -- on the same grounds
 * as before: it is still on disk, and a measurement already taken is cheaper
 * to keep than to redo if some effect is pointed back at it.
 */
const FILE_LEVEL_DB: Record<string, number> = {
  "/sounds/All_In.mp3": -21.9,
  "/sounds/Game_On.mp3": -25.6,
  "/sounds/Menu_clicks.mp3": -24.5,
  "/sounds/Select_Tap.mp3": -19.9,
  "/sounds/TimeBank.mp3": -20.4,
  "/sounds/Your_Turn.mp3": -20.8,
  "/sounds/bigsoundbank-poker-chips-4-0945.mp3": -21.4,
  "/sounds/freesound_community-crowd-cheer-ii-6263.mp3": -16.3,
  "/sounds/freesound_community-flipcard-91468.mp3": -28.2,
  "/sounds/freesound_community-knocking-wood-61988.mp3": -23.5,
  "/sounds/freesound_community-screen-tap-38717.mp3": -25.8,
  "/sounds/oxidvideos-placing-poker-chips-522515.mp3": -19.3,
  "/sounds/oxidvideos-placing-poker-chips-522521.mp3": -21.5,
  "/sounds/oxidvideos-taking-playing-card-3-522513.mp3": -29.2,
  "/sounds/playing-card-flipped-over-epic-stock-media-1-00-00.mp3": -31.6,
  "/sounds/Winning_a_regular_pot_trimmed.mp3": -21.9,
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
  // The ordinary case -- a routine pot at a routine table. Quieter and
  // shorter than the cheer above: a moment, not a celebration.
  "win-modest": -26,
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
  // Sitting down. The one press in the app that is a moment rather than
  // housekeeping, so it is mixed with the hand's own cues instead of under
  // them -- but still below `win`, because arriving at a table is a smaller
  // event than taking a pot at one. It also fires into silence by
  // construction: the lobby's music has stopped and the table has not dealt.
  "game-on": -28,
  // Housekeeping. Should never compete with the table.
  ui: -36,
  // A choice is worth hearing slightly more than a navigation tap -- it is
  // the confirmation that the thing you pressed took -- but it is still
  // housekeeping and still sits under every cue the hand itself makes.
  select: -34,
  // Silent by design -- no file, so the target is unused. Kept in the record
  // so adding an asset is one line and the compiler names the other.
  lose: -30,
  // The clock. Sits under the betting cues: running out of time is
  // information, not a moment, and it arrives while the table is already busy.
  timeout: -30,
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

/**
 * The cues a screen with no table on it can actually make -- the three chrome
 * presses of ./ui-sounds, and nothing else.
 *
 * This split exists for bytes, not for taste. Priming used to mean every
 * audible effect at once, and the first tap on the phone lobby pulled the
 * whole table's sound set (~450KB across sixteen files) down a phone
 * connection, for a hand that had not been dealt and a seat nobody had taken.
 * `primeChromeSounds` covers this list; `primeTableSounds` covers the rest and
 * runs when a game actually starts. See ./sound-effects.
 */
export const CHROME_EFFECTS: readonly SoundEffect[] = ["ui", "select", "game-on"];

/**
 * Effects that repeat rather than play once. `check` is the one case: a live
 * player checks by rapping the felt twice, and the file behind it
 * (`freesound_community-knocking-wood-61988.mp3`) is a single knock -- so the
 * gesture is two real plays of that same file with a knock's own gap between
 * them, not a second, longer recording.
 */
export const SOUND_REPEAT: Partial<Record<SoundEffect, { times: number; gapMs: number }>> = {
  check: { times: 2, gapMs: 190 },
};

export const SOUND_LEVELS_FOR_TEST = { FILE_LEVEL_DB, EFFECT_TARGET_DB };

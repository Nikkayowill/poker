/**
 * Every sound the table can play, and which real file (if any) plays for it.
 * The only place a filename should ever appear -- change a sound by editing
 * a line here, not by hunting through components.
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
  | "time-card";

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
  lose: null,
  timeout: null,
  "time-card": null,
};

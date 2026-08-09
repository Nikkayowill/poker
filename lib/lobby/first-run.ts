/**
 * The hub's first-run strip: what a brand-new player is told to do, in order,
 * and the one rule for when the app stops telling them.
 *
 * This is pure data plus two predicates and lives in `lib/` rather than beside
 * the component for the reason `lib/arcade/games.ts` and
 * `lib/game/seat-presence.ts` do: `vitest.config.ts`'s `include` only collects
 * `lib/` and `app/`, so nothing under `components/` is reachable by
 * `npm test`. The retirement rule below is exactly the kind of thing that must
 * be testable -- an onboarding strip that fails to retire is a permanent
 * banner on the home screen of a game somebody has been playing for a month.
 *
 * WHY ONE STRIP AND NOT A TOUR
 *
 * The hub answers "pick your game" for a returning player and "what is this?"
 * for a new one, and those want opposite amounts of chrome. A modal tour
 * blocks the first group to serve the second. A numbered strip at the top of
 * the scroll is skippable by scrolling, costs one row, and -- because it
 * retires itself -- is not a permanent tax on the ninety-nine percent of
 * sessions that are not somebody's first.
 *
 * WHY EACH STEP GOES SOMEWHERE REAL
 *
 * Every step's primary action navigates or opens something the player could
 * have found on their own. None of them are "next" for its own sake, and none
 * describe a feature the app does not have -- the same rule
 * `lib/arcade/games.ts` states about hub blurbs, which has been broken three
 * times there. A step whose action is a no-op is worse than no step: it
 * teaches that the guidance is decoration.
 */

import { ARCADE_GAMES } from "@/lib/arcade/games";

/**
 * How many free dailies there actually are, counted rather than written down.
 *
 * The arcade panel's header used to read "10 games in the works", which was
 * true until Blackjack shipped and then quietly became a lie. Onboarding copy
 * is the worst possible place for that failure: a strip that opens by
 * miscounting the free games is the first sentence a new player reads. This
 * imports pure data -- `lib/arcade/games.ts` has no server dependencies, which
 * is why the panel can read it too.
 */
export const FREE_DAILY_COUNT = ARCADE_GAMES.filter(
  (game) => game.kind === "puzzle" && game.status === "live",
).length;

/** What a step's primary button does. The component maps these to handlers. */
export type FirstRunAction =
  /** Open the buy-in modal for a Hold'em seat -- the same control the hero tile drives. */
  | { kind: "seat" }
  /** Navigate somewhere in the app. */
  | { kind: "link"; href: string };

export interface FirstRunStep {
  /** Stable id, so a step can be reordered without changing what is persisted. */
  id: string;
  /** One or two sentences. The first states the action, the second sets an expectation. */
  body: string;
  /** The primary button's label. A verb, in the player's voice. */
  actionLabel: string;
  action: FirstRunAction;
  /** The secondary button's label -- always the way onward, never a dead "dismiss". */
  nextLabel: string;
}

/**
 * Three steps, in the order a new player's questions actually arrive: where do
 * I play, what else is there, and what does it cost. Three and not five --
 * past about three a numbered strip stops reading as orientation and starts
 * reading as a form to complete.
 */
export const FIRST_RUN_STEPS: readonly FirstRunStep[] = [
  {
    id: "seat",
    body: "Take a seat at a 1,000 Gold table. Your first hand is dealt in about ten seconds.",
    actionLabel: "Deal me in",
    action: { kind: "seat" },
    nextLabel: "Show me around",
  },
  {
    id: "arcade",
    body: "Ten more games sit behind the arcade — blackjack, roulette, video poker and the rest.",
    actionLabel: "Open the arcade",
    action: { kind: "link", href: "/games" },
    nextLabel: "Next",
  },
  {
    id: "free",
    body: `${FREE_DAILY_COUNT} puzzles are free every day and never touch your Gold. They reset at midnight UTC.`,
    actionLabel: "Play today's Wordle",
    action: { kind: "link", href: "/games/wordle" },
    nextLabel: "Got it",
  },
];

/**
 * The persisted key, and it is deliberately not a boolean preference.
 *
 * The app's other localStorage values (sound, music, chip style) all go through
 * `lib/profile/stored-preference.ts`'s "on unless exactly false" convention,
 * which is right for a mute and wrong for this: the safe default there is *on*,
 * and the safe default here is "not yet retired". Storing the retirement as a
 * present/absent key rather than a true/false value means a corrupted or
 * truncated value reads as "still learning" -- which shows a strip to somebody
 * who did not need it, rather than hiding it from somebody who did.
 */
export const FIRST_RUN_STORAGE_KEY = "stackchips:first-run-done";

/** The value written on retirement. Its content is irrelevant; its presence is the signal. */
export const FIRST_RUN_DONE = "done";

/**
 * Has the strip retired?
 *
 * One signal, and it is deliberately not two. The strip retires when the flag
 * is present, and exactly two things write it:
 *
 * 1. The player reached the end of the strip. They read it; they are done.
 * 2. THE PLAYER REACHED A TABLE. This is the one that carries the feature.
 *    Somebody who ignores the strip entirely and taps the Texas Hold'em tile
 *    has answered "what do I do?" more convincingly than finishing three steps
 *    ever could, and a strip still explaining how to sit down to a player who
 *    is sitting down is the exact failure mode onboarding is mocked for. The
 *    write happens in components/poker-app.tsx the moment a table snapshot
 *    exists -- it cannot happen in the component, which by then is unmounted.
 *
 * Routing both through the stored flag rather than giving the component a
 * second `seated` prop is what makes the retirement survive a reload, a second
 * tab and a session weeks later. A prop would only have described this tab,
 * this minute, on a screen the strip is not even rendered on.
 */
export function isFirstRunRetired(stored: string | null): boolean {
  return stored === FIRST_RUN_DONE;
}

/**
 * The next step index, or null once the strip is finished.
 *
 * Clamped rather than trusting the caller: the index is held in component
 * state and a step being removed in a later release would otherwise leave a
 * saved index pointing past the end of the array.
 */
export function nextFirstRunStep(index: number, total = FIRST_RUN_STEPS.length): number | null {
  if (!Number.isInteger(index) || index < 0) return total > 0 ? 0 : null;
  const next = index + 1;
  return next >= total ? null : next;
}

/** "1 of 3", the counter the strip prints. One-based, because it is read by a human. */
export function firstRunProgressLabel(index: number, total = FIRST_RUN_STEPS.length): string {
  const clamped = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  return `${clamped + 1} of ${total}`;
}

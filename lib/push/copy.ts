/**
 * The daily "come back" push notification copy pool.
 *
 * Kayo's reference point was PlayPokerGO's own re-engagement pushes ("Case
 * of the Mondays? ... tap to play now") -- playful and specific rather than
 * a flat "You have a notification." One line is picked per send (see
 * lib/server/notify-inactive-players below); a pool instead of one fixed
 * line is what keeps a daily push from reading as the same robotic text
 * forever, which is its own reason to eventually stop being opened.
 *
 * Kept in lib/ rather than beside the cron route for the same reason
 * lib/arcade/games.ts is: testable, and reusable if a second trigger
 * (someone's turn, a friend challenge) ever wants its own pool here later.
 */

export const COME_BACK_PUSH_COPY: readonly string[] = [
  "Your daily Gold is sitting there. Come claim it before someone else takes your seat.",
  "Case of the Mondays? Take a break and stack some chips — tap to play.",
  "The tables are still running. Your seat's open whenever you are.",
  "Your streak's on the line — one hand keeps it alive.",
  "Miss us? StackChips doesn't miss you any less. Come play a hand.",
  "Free Gold's waiting on you today. Don't leave it on the table.",
  "Bored? There's a seat with your name on it. Tap to play now.",
  "Today's daily Gold hasn't been claimed yet — it won't wait forever.",
  "Something in your treasury has turned gold. Come harvest it.",
];

/** Deterministic-enough pick for a cron run: seeded off the day so re-running the same day doesn't reshuffle who gets which line. */
export function pickComeBackPushCopy(seed: number): string {
  const index = Math.abs(seed) % COME_BACK_PUSH_COPY.length;
  return COME_BACK_PUSH_COPY[index];
}

/**
 * The chance games that are no longer offered, and the one predicate that
 * enforces it.
 *
 * Retired 2026-08-12 at the owner's instruction: every game whose only
 * mechanic was a wager against fixed house odds is off the floor, while the
 * games with a skill or social component (Hold'em, Blackjack, the free
 * dailies) stay. This is a product decision, not a technical one.
 *
 * ## Why a guard and not a deletion
 *
 * Removing the catalog rows hides the links. It does not close the routes:
 * `POST /api/arcade/roulette` is still mounted, still reachable by anyone who
 * has the URL or an open tab, and would still debit a stake. A retirement that
 * only edits a catalog is a retirement in the UI alone.
 *
 * So the block lives on the *deal* path -- the single place a new round can be
 * opened and a stake can leave a wallet -- rather than on any of the eight
 * routes, which is what keeps a ninth route from being added later without it.
 * Actions on an ALREADY-OPEN round are deliberately not blocked: a player who
 * had a live round when this shipped has already paid for it, and refusing
 * their Stand would take the stake and give nothing back. Those rounds settle
 * out normally and then no new one can be opened.
 *
 * This module is in lib/arcade rather than lib/server so `npm test` reaches it
 * (vitest.config.ts collects only lib/ and app/) and so both the catalog and
 * the services can read the same list -- two lists that agree only by luck is
 * exactly how a retired game gets quietly re-offered.
 */

/**
 * The `game` discriminators, as they appear in `arcade_rounds.game` and in
 * each service's own GAME constant. Strings rather than ArcadeGameId because
 * this is matched against the storage key, not the catalog id, and the two are
 * spelled differently for several games ("roulette" vs "roulette-wheel").
 */
export const RETIRED_ARCADE_GAMES: readonly string[] = [
  "hi-lo",
  "video-poker",
  "roulette",
  "baccarat",
  "coin-flip",
];

/** What a player is told. One sentence, no apology, no "for now" -- it is not coming back. */
export const RETIRED_GAME_MESSAGE =
  "This game has been retired. Try a duel or a daily puzzle instead.";

export function isRetiredArcadeGame(game: string): boolean {
  return RETIRED_ARCADE_GAMES.includes(game);
}

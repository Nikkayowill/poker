/**
 * The reusable retirement guard: whichever games are stopped without being
 * deleted, and the one predicate that enforces it.
 *
 * Built to retire five pure-chance-against-the-house games (Hi-Lo, Video
 * Poker, Roulette, Baccarat, Coin Flip) at the owner's instruction, while
 * the games with a skill or social component (Hold'em, Blackjack, the free
 * dailies) stayed. That was a product decision, not a technical one. Those
 * five were later deleted outright, code, routes, components, all of it,
 * rather than left in this half-retired state, so RETIRED_ARCADE_GAMES is
 * empty today. The mechanism stays: it's still the correct way to stop
 * offering a *future* game the moment that decision is made, without a
 * same-day code deletion.
 *
 * Why a guard and not just a deletion: removing a catalog row hides its
 * link, but it doesn't close its routes. A still-mounted `POST` handler is
 * still reachable by anyone who has the URL or an open tab, and would still
 * debit a stake. A retirement that only edits a catalog is a retirement in
 * the UI alone; the guard below is what actually blocks a new round, on the
 * *deal* path, the single place a stake can leave a wallet, rather than on
 * any one route (which is what keeps a new route from being added later
 * without it). Actions on an already-open round are not blocked: a player
 * mid-round when a retirement ships has already paid for it, and refusing
 * their next action would take the stake and give nothing back. Those
 * rounds settle out normally and then no new one can be opened.
 *
 * This module is in lib/arcade rather than lib/server so `npm test` reaches it
 * (vitest.config.ts collects only lib/ and app/) and so both the catalog and
 * the services can read the same list; two lists that agree only by luck is
 * exactly how a retired game gets quietly re-offered.
 */

/**
 * The `game` discriminators, as they appear in `arcade_rounds.game` and in
 * each service's own GAME constant. Strings rather than ArcadeGameId because
 * this is matched against the storage key, not the catalog id, and the two
 * can be spelled differently for a given game (e.g. the catalog id
 * "chess-duel" stores its matches under the shorter "chess", see
 * lib/pvp/registry.ts).
 */
export const RETIRED_ARCADE_GAMES: readonly string[] = [];

/** What a player is told. One sentence, no apology, no "for now": it is not coming back. */
export const RETIRED_GAME_MESSAGE =
  "This game has been retired. Try a duel or a daily puzzle instead.";

export function isRetiredArcadeGame(game: string): boolean {
  return RETIRED_ARCADE_GAMES.includes(game);
}

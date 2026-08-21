/**
 * The arcade catalogue -- everything beside Hold'em.
 *
 * Pure data plus the wallet predicates the panel renders from, and it lives
 * in lib/ rather than next to the component for the same reason
 * lib/game/seat-presence.ts does: vitest.config.ts's `include` only covers
 * lib/ and app/, so nothing under components/ is reachable by `npm test`.
 *
 * ## Three kinds, and the 2026-08-12 turn
 *
 * The floor was ten house games and free dailies. On 2026-08-12 the owner cut
 * every game whose only mechanic was a wager against fixed odds -- "the legit
 * brain dead gambling games are dead" -- and asked for social, skill-based
 * games to stake Gold on instead. Five rows (Hi-Lo, Video Poker, Roulette
 * Wheel, Baccarat, Coin Flip) went `retired` that day, then were deleted
 * outright on 2026-08-20 -- code, routes, components, all of it, per the
 * owner's own follow-up that "retired but still in the repo" wasn't good
 * enough. lib/arcade/retired.ts's guard mechanism stays (it is the correct,
 * reusable way to retire a *future* game without a code deletion the same
 * day), it just has nobody in its list right now. Four `duel` rows replaced
 * the five removed casino rows.
 *
 * A duel is the first thing here that is NOT played against the house: both
 * players ante, the winner takes the pot, and there is no rake. That is why
 * `kind` gained a third value rather than duels being priced as casino rows --
 * it decides what the button says (a duel opens a lobby, it does not deal) and
 * which section of the floor a row lands in.
 *
 * ## Rules that have each been broken at least once
 *
 * - A live entry needs an href and a non-live one must not have one. A test
 *   pins it: a live row with a null href renders an unclickable Play, and a
 *   coming-soon row with an href is a 404 waiting to be linked.
 * - `entryCost` must be a stake TIER_CONFIG can actually select. Two of the
 *   now-deleted casino rows once sat at prices no button could actually
 *   charge, and a placeholder before that made the same mistake. Price a new
 *   row off the ladder or leave it at 0. For a duel it is a floor, not a
 *   price: the challenger names any wager at or above MIN_DUEL_STAKE, so the
 *   floor renders it as "from N".
 * - A blurb must not promise a mechanic the game lacks -- a now-deleted row
 *   once promised "ride the streak" on a game with no streak.
 */

import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import type { PlayerProfile } from "@/lib/profile/types";

export type ArcadeGameId =
  | "blackjack-21"
  | "daily-word-stack"
  | "connections"
  | "daily-sudoku"
  | "memory-match"
  | "chess-duel"
  | "checkers-duel"
  | "trivia-showdown"
  | "word-race"
  | "cribbage-table";

/**
 * `casino` stakes Gold against the house on a chance outcome; `duel` stakes
 * Gold against another PLAYER in a skill/social match, winner takes the pot
 * -- see lib/pvp/; `wager` stakes Gold against your OWN performance -- beat a
 * challenge or forfeit the wager, see lib/arcade/ante-up*.ts. `wager` is not
 * `casino` wearing a different name: nothing here is decided by odds the
 * house sets, only by whether the challenge gets beaten, which is the same
 * "skill, not chance" line that got the pure-chance games cut in the first
 * place. The split is what decides whether a row is wallet-gated at all and
 * how its "Play" button behaves (deal immediately vs. open a challenge lobby
 * vs. open a wager step), so it is a field rather than something inferred
 * from entryCost being zero.
 *
 * `puzzle` is unused as of 2026-08-21 -- see that date's note below -- but
 * kept as a type value (and `splitArcadeFloor`/`arcade-floor.tsx` keep their
 * "Free today" branch, which the empty-bucket guard already hides at zero
 * code cost) in case a genuinely free-only puzzle is added later.
 *
 * ## 2026-08-21: the four brain games gained a wager, one way each
 *
 * Word Stack, Connections, Sudoku and Memory Match were `kind: "puzzle"`
 * (free-only) with a separate standalone `ante-up-sudoku` wager row beside
 * them -- the split Kayo flagged as confusing ("I still see free to play...
 * it was supposed to allow players to wager"). A same-day first pass merged
 * all four into one shape (free daily play first, a separate repeatable
 * "Ante Up" wager sibling unlocked after) and shipped it; Kayo's follow-up
 * the same day ("choose a wager before the game even starts... no more daily
 * limits except word stack and connections") split that shape back in two,
 * because it wasn't actually two different problems:
 *
 * - **Sudoku and Memory Match have no daily identity worth protecting** (no
 *   shared board, nothing shareable) -- they lost the daily gate entirely.
 *   `/games/sudoku` and `/games/memory` open straight into a wager-or-Free
 *   step, replayable any time, no bonus, no cap -- see lib/arcade/ante-up.ts
 *   and lib/arcade/ante-up-memory.ts.
 * - **Word Stack and Connections keep their once-a-day shared puzzle** (the
 *   share grid is the reason the feature exists), but the wager-or-Free step
 *   now gates opening *that one attempt* instead of trailing it as a link to
 *   a second, unlimited game -- see lib/server/word-stack-service.ts and
 *   lib/server/connections-service.ts.
 *
 * All four stay `kind: "wager"` -- the mechanic (skill, not chance; beat a
 * challenge or forfeit the stake) didn't change, only where the daily line
 * sits. The standalone `ante-up-sudoku`/`ante-up-memory`/`ante-up-word-stack`/
 * `ante-up-connections` catalog rows never existed as separate entries and
 * still don't; their old routes now just redirect (Sudoku/Memory) or were
 * deleted outright (Word Stack/Connections, which no longer have a second,
 * unlimited mode to redirect to).
 */
export type ArcadeGameKind = "casino" | "puzzle" | "duel" | "wager";

/**
 * `retired` is the status a game gets when it stops being offered but the
 * decision to stop isn't "this was never finished" -- see lib/arcade/
 * retired.ts, the guard that actually blocks a new round for whichever ids
 * are in its list (empty today; every game that was ever in it has since
 * been deleted outright, not merely retired). Deliberately a distinct status
 * from `coming-soon`: one is "not built yet", the other is "was built, moved
 * real Gold, and a human decided to stop offering it" -- collapsing them
 * would lose that distinction the moment anyone next reads this file.
 */
export type ArcadeGameStatus = "coming-soon" | "live" | "retired";

export interface ArcadeGame {
  id: ArcadeGameId;
  name: string;
  /** One line, short enough to sit on a single row in a narrow column. */
  blurb: string;
  kind: ArcadeGameKind;
  /** Gold staked to start a round. Always 0 for `puzzle`. */
  entryCost: number;
  status: ArcadeGameStatus;
  /**
   * Where a live game lives. Null while it is coming-soon -- a route that is
   * not built yet is a 404 waiting for whoever flips the status without
   * reading this file.
   */
  href: string | null;
}

/**
 * The wallet a row is checked against. Deliberately narrower than
 * PlayerProfile: affordability needs the balance and the unlimited flag and
 * nothing else, and taking the whole profile would let a future caller reach
 * for lastDailyClaimAt or isRegistered from inside a pricing rule.
 */
export interface ArcadeWallet {
  goldBalance: number;
  unlimitedGold: boolean;
}

/**
 * Entry costs sit on the same ladder as the table tiers (1k is the cheapest
 * seat in the house), so the arcade reads as the shallow end of the same
 * economy rather than a second, unrelated price list.
 */
export const ARCADE_GAMES: readonly ArcadeGame[] = [
  {
    id: "blackjack-21",
    name: "Blackjack 21",
    blurb: "Beat the dealer, 3:2 on naturals",
    kind: "casino",
    entryCost: 1000,
    status: "live",
    href: "/games/blackjack",
  },
  {
    id: "daily-word-stack",
    name: "Daily Word Stack",
    // Accurate to the mechanic: one word a day, shared by everyone, which is
    // what makes the emoji grid worth posting -- that stays true. A blurb
    // promising something the board does not do is a promise broken on the
    // click -- see this file's own header for the row that learned that the
    // hard way.
    blurb: "Wager Gold on today's word, or play free",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/word-stack",
  },
  {
    id: "connections",
    name: "Connections",
    blurb: "Wager Gold on today's puzzle, or play free",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/connections",
  },
  {
    id: "daily-sudoku",
    name: "Sudoku",
    blurb: "Wager Gold, or play free — any time",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/sudoku",
  },
  {
    id: "memory-match",
    name: "Memory Match",
    blurb: "Wager Gold, or play free — any time",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/memory",
  },
  // ---- Duels: skill/social games staked against another PLAYER, not the
  // house. Winner takes the pot both players anted -- see lib/pvp/. Priced at
  // the cheapest tier as a "starting at": the challenger actually picks the
  // stake tier when they send the challenge, same as a table buy-in.
  {
    id: "chess-duel",
    name: "Chess",
    blurb: "1v1, winner takes the pot",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/chess",
  },
  {
    id: "checkers-duel",
    name: "Checkers",
    blurb: "1v1, winner takes the pot",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/checkers",
  },
  {
    id: "trivia-showdown",
    name: "Trivia Showdown",
    blurb: "Multiple choice, fastest correct answer wins",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/trivia",
  },
  {
    id: "word-race",
    name: "Word Race",
    blurb: "Unscramble it before they do",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/word-race",
  },
  // Not a 1v1 -- a 3-4 player free-for-all table, still winner-takes-the-
  // pot with no house. `kind: "duel"` is a UI category ("staked against
  // other players, opens a lobby rather than dealing"), not a literal
  // headcount, so it fits here without a new kind or section.
  {
    id: "cribbage-table",
    name: "Cribbage",
    blurb: "3-4 players, winner takes the pot",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/cribbage",
  },
];

/**
 * A missing profile is a wallet with nothing in it, not an unlimited one --
 * the hub renders during the first-POST window before a profile exists, and
 * failing open there would show every paid row as playable for a moment.
 */
export function toArcadeWallet(profile: PlayerProfile | null | undefined): ArcadeWallet {
  const balance = profile?.goldBalance;
  return {
    goldBalance: Number.isFinite(balance) ? Math.max(0, balance as number) : 0,
    unlimitedGold: profile?.unlimitedGold ?? false,
  };
}

/** An unlimited profile is never charged anywhere else in the app either. */
export function canAffordArcadeGame(game: ArcadeGame, wallet: ArcadeWallet): boolean {
  if (game.entryCost <= 0) return true;
  if (wallet.unlimitedGold) return true;
  return wallet.goldBalance >= game.entryCost;
}

/** What the row prints where a table tile would print its buy-in. */
export function arcadeEntryLabel(game: ArcadeGame): string {
  if (game.entryCost > 0) return game.entryCost.toLocaleString();
  // A puzzle's zero is "there is nothing to wager here"; a wager row's zero
  // is "you get to choose" -- the same number means opposite things, so it
  // needs two different sentences rather than one that is wrong for either.
  //
  // A bare "Free to play" on a wager row reads as "nothing is actually
  // wagered here", which is backwards for a row where the wager is chosen up
  // front, before anything deals -- see this file's own 2026-08-21 note
  // above. The exact wording still differs by the two sub-shapes that note
  // describes: Sudoku/Memory Match are unlimited (no daily identity to name),
  // Word Stack/Connections are still the one shared puzzle for the day.
  if (game.kind !== "wager") return "Free daily";
  return game.id === "daily-word-stack" || game.id === "connections"
    ? "Free daily · or wager it"
    : "Free, or wager Gold";
}

/**
 * The single reason a row is not playable, in the order the player can act
 * on it: the game not existing yet outranks not being able to afford it.
 * Null means it is selectable.
 */
export function arcadeBlockedReason(
  game: ArcadeGame,
  wallet: ArcadeWallet,
): "coming-soon" | "retired" | "insufficient-gold" | null {
  // Retired outranks coming-soon, and both outrank affordability: telling a
  // player they cannot afford a game nobody can play is the wrong sentence.
  if (game.status === "retired") return "retired";
  if (game.status !== "live") return "coming-soon";
  if (!canAffordArcadeGame(game, wallet)) return "insufficient-gold";
  return null;
}

/**
 * The floor, split the way the page presents it: free dailies, then head-to-
 * head duels, then solo skill wagers, then what is left of the house games.
 *
 * The split is on `kind`, not on `entryCost > 0`, and that distinction is the
 * whole reason `kind` is a field rather than something inferred -- a puzzle is
 * free because it is a puzzle, and a casino game priced at 0 by mistake would
 * otherwise silently promote itself into the free section. `wager` gets its
 * own bucket for the same reason `duel` did: it is priced at 0 (a floor, not
 * a price -- the player names the real wager on the page) but is not free the
 * way a puzzle is, and lumping it into either the free or the casino section
 * would misdescribe it in both.
 *
 * Retired and coming-soon entries are both dropped: `live` is the filter, so a
 * game that stops being offered leaves the floor by changing one field, and a
 * section whose header promises "free every day" cannot contain something that
 * is not offered at all.
 */
export function splitArcadeFloor(games: readonly ArcadeGame[] = ARCADE_GAMES): {
  free: ArcadeGame[];
  duels: ArcadeGame[];
  wagers: ArcadeGame[];
  staked: ArcadeGame[];
} {
  const live = games.filter((game) => game.status === "live");
  return {
    free: live.filter((game) => game.kind === "puzzle"),
    duels: live.filter((game) => game.kind === "duel"),
    wagers: live.filter((game) => game.kind === "wager"),
    staked: live.filter((game) => game.kind === "casino"),
  };
}

/** How many titles the hub tile names before it stops. Four fits one line at phone width. */
const FLOOR_PREVIEW_COUNT = 4;

/**
 * What the hub tile says about the floor without listing it.
 *
 * Counted from the catalogue every time rather than stored, for the reason the
 * file header gives about prices: a number about the arcade that is written
 * down somewhere else is a number that will eventually be wrong, and the hub
 * is the surface where being wrong is most visible.
 */
export function arcadeFloorSummary(games: readonly ArcadeGame[] = ARCADE_GAMES): {
  free: number;
  staked: number;
  previewNames: string[];
} {
  const { free, duels, wagers, staked } = splitArcadeFloor(games);
  return {
    free: free.length,
    // Duels and wagers are staked Gold too -- the tile's second number is
    // "how many cost something", and splitting it further would need a third
    // line of copy on a tile that has room for two.
    staked: duels.length + wagers.length + staked.length,
    // Free first, matching the order the floor puts them in, so the tile and
    // the page it opens do not disagree about what the arcade leads with.
    previewNames: [...free, ...duels, ...wagers, ...staked]
      .slice(0, FLOOR_PREVIEW_COUNT)
      .map((game) => game.name),
  };
}

export function arcadeActionLabel(game: ArcadeGame, wallet: ArcadeWallet): string {
  switch (arcadeBlockedReason(game, wallet)) {
    case "coming-soon":
      return "Soon";
    case "retired":
      return "Retired";
    case "insufficient-gold":
      return "Low Gold";
    default:
      // A duel is not dealt on the click -- it opens a challenge lobby, and
      // the button should say so rather than implying a round starts.
      // Cribbage is `kind: "duel"` too (see its own catalog entry) but opens
      // a joinable table list, not a 1:1 challenge -- "Challenge" would name
      // an action the button does not actually offer.
      return game.kind === "duel" && game.id !== "cribbage-table" ? "Challenge" : "Play";
  }
}

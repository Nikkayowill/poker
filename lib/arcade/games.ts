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
 * games to stake Gold on instead. So five rows are `retired` (their code and
 * their arcade_rounds history are untouched; lib/arcade/retired.ts is what
 * actually stops a new round) and four `duel` rows replace them.
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
 * - `entryCost` must be a stake TIER_CONFIG can actually select. Video poker
 *   sat at 500 and coin flip at 250, so the hub quoted prices no button in
 *   either game could charge -- the third and fourth times this went wrong
 *   (Hi-Lo's placeholder was the first). Price a new row off the ladder or
 *   leave it at 0. For a duel it is a floor, not a price: the challenger picks
 *   the tier, so the floor renders it as "from N".
 * - A blurb must not promise a mechanic the game lacks. Hi-Lo's said "ride the
 *   streak" when there was no streak.
 */

import type { PlayerProfile } from "@/lib/profile/types";

export type ArcadeGameId =
  | "blackjack-21"
  | "daily-wordle"
  | "connections"
  | "hi-lo"
  | "video-poker"
  | "roulette-wheel"
  | "daily-sudoku"
  | "memory-match"
  | "baccarat"
  | "coin-flip"
  | "chess-duel"
  | "checkers-duel"
  | "trivia-showdown"
  | "word-race";

/**
 * `casino` stakes Gold against the house on a chance outcome; `puzzle` is a
 * once-a-day free round; `duel` stakes Gold against another PLAYER in a
 * skill/social match, winner takes the pot -- see lib/pvp/. The split is what
 * decides whether a row is wallet-gated at all and how its "Play" button
 * behaves (deal immediately vs. open a challenge lobby), so it is a field
 * rather than something inferred from entryCost being zero.
 */
export type ArcadeGameKind = "casino" | "puzzle" | "duel";

/**
 * `retired` is 2026-08-12's cut of every pure-chance-against-the-house game
 * (the owner's call: "the legit brain dead gambling games are dead"). Code,
 * routes and the arcade_rounds history are all left in place -- only the
 * catalog listing and new rounds are blocked, at casino-round-service.ts's
 * and hi-lo-service.ts's single guard. Deliberately a distinct status from
 * `coming-soon`: one is "not built yet", the other is "was built, moved real
 * Gold, and a human decided to stop offering it" -- collapsing them would
 * lose that distinction the moment anyone next reads this file.
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
    id: "daily-wordle",
    name: "Daily Wordle",
    // Accurate to the mechanic: one word a day, shared by everyone, which is
    // what makes the emoji grid worth posting. A blurb promising something the
    // board does not do is a promise broken on the click -- see Hi-Lo's.
    blurb: "Five letters, six guesses, one a day",
    kind: "puzzle",
    entryCost: 0,
    status: "live",
    href: "/games/wordle",
  },
  {
    id: "connections",
    name: "Connections",
    blurb: "Find the four hidden groups",
    kind: "puzzle",
    entryCost: 0,
    status: "live",
    href: "/games/connections",
  },
  {
    id: "hi-lo",
    name: "Hi-Lo",
    blurb: "Call the next card, higher or lower",
    kind: "casino",
    entryCost: 1000,
    // Retired 2026-08-12 with the rest of the pure-chance games. Route and
    // service code are untouched (arcade_rounds keeps the history); dealHiLo
    // rejects a new round with "This game has been retired."
    status: "retired",
    href: null,
  },
  {
    id: "video-poker",
    name: "Video Poker",
    blurb: "Jacks or better, single hand",
    kind: "casino",
    entryCost: 1000,
    status: "retired",
    href: null,
  },
  {
    id: "roulette-wheel",
    name: "Roulette Wheel",
    blurb: "European single zero",
    kind: "casino",
    entryCost: 1000,
    status: "retired",
    href: null,
  },
  {
    id: "daily-sudoku",
    name: "Daily Sudoku",
    blurb: "One grid a day, four difficulties",
    kind: "puzzle",
    entryCost: 0,
    status: "live",
    href: "/games/sudoku",
  },
  {
    id: "memory-match",
    name: "Memory Match",
    blurb: "Pair the card backs against the clock",
    kind: "puzzle",
    entryCost: 0,
    status: "live",
    href: "/games/memory",
  },
  {
    id: "baccarat",
    name: "Baccarat",
    blurb: "Punto banco, player or bank",
    kind: "casino",
    entryCost: 5000,
    status: "retired",
    href: null,
  },
  {
    id: "coin-flip",
    name: "Coin Flip",
    blurb: "Call it, then bank or let it ride",
    kind: "casino",
    entryCost: 1000,
    status: "retired",
    href: null,
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
    entryCost: 1000,
    status: "live",
    href: "/games/chess",
  },
  {
    id: "checkers-duel",
    name: "Checkers",
    blurb: "1v1, winner takes the pot",
    kind: "duel",
    entryCost: 1000,
    status: "live",
    href: "/games/checkers",
  },
  {
    id: "trivia-showdown",
    name: "Trivia Showdown",
    blurb: "Multiple choice, fastest correct answer wins",
    kind: "duel",
    entryCost: 1000,
    status: "live",
    href: "/games/trivia",
  },
  {
    id: "word-race",
    name: "Word Race",
    blurb: "Unscramble it before they do",
    kind: "duel",
    entryCost: 1000,
    status: "live",
    href: "/games/word-race",
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
  return game.entryCost <= 0 ? "Free daily" : game.entryCost.toLocaleString();
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
 * head duels, then what is left of the house games.
 *
 * The split is on `kind`, not on `entryCost > 0`, and that distinction is the
 * whole reason `kind` is a field rather than something inferred -- a puzzle is
 * free because it is a puzzle, and a casino game priced at 0 by mistake would
 * otherwise silently promote itself into the free section.
 *
 * Retired and coming-soon entries are both dropped: `live` is the filter, so a
 * game that stops being offered leaves the floor by changing one field, and a
 * section whose header promises "free every day" cannot contain something that
 * is not offered at all.
 */
export function splitArcadeFloor(games: readonly ArcadeGame[] = ARCADE_GAMES): {
  free: ArcadeGame[];
  duels: ArcadeGame[];
  staked: ArcadeGame[];
} {
  const live = games.filter((game) => game.status === "live");
  return {
    free: live.filter((game) => game.kind === "puzzle"),
    duels: live.filter((game) => game.kind === "duel"),
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
  const { free, duels, staked } = splitArcadeFloor(games);
  return {
    free: free.length,
    // Duels are staked Gold too -- the tile's second number is "how many cost
    // something", and splitting it further would need a third line of copy on
    // a tile that has room for two.
    staked: duels.length + staked.length,
    // Free first, matching the order the floor puts them in, so the tile and
    // the page it opens do not disagree about what the arcade leads with.
    previewNames: [...free, ...duels, ...staked]
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
      return game.kind === "duel" ? "Challenge" : "Play";
  }
}

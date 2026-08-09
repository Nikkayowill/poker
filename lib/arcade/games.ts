/**
 * The arcade catalogue -- the ten mini-games queued behind Hold'em.
 *
 * Pure data plus the wallet predicates the panel renders from, and it lives
 * in lib/ rather than next to the component for the same reason
 * lib/game/seat-presence.ts does: vitest.config.ts's `include` only covers
 * lib/ and app/, so nothing under components/ is reachable by `npm test`.
 *
 * All ten are live now. The `coming-soon` / null-href convention that carried
 * the last six is still the one to use for an eleventh: the shape is finished
 * and going live is two fields, rather than a stub that has to be redesigned
 * when the game behind it actually lands. A test pins live-iff-href, because a
 * live entry with a null href renders an unclickable Play and a coming-soon
 * entry with an href is a 404 waiting to be linked.
 *
 * Two `entryCost`s were corrected when their games landed -- video poker's 500
 * and coin flip's 250. Neither was a stake the tier ladder can select, so the
 * hub was quoting a price no button in the game could charge. A placeholder
 * cost is a claim about the economy, and it has now been wrong three times
 * (Hi-Lo's was the first): price a new row off TIER_CONFIG or leave it at 0.
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
  | "coin-flip";

/**
 * `casino` stakes Gold on an outcome; `puzzle` is a once-a-day free round.
 * The split is what decides whether a row is wallet-gated at all, so it is a
 * field rather than something inferred from entryCost being zero.
 */
export type ArcadeGameKind = "casino" | "puzzle";

export type ArcadeGameStatus = "coming-soon" | "live";

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
    // Not "ride the streak": there is no streak. One card, one call, settled
    // -- and a hub blurb promising a mechanic the table does not have is a
    // promise broken on the click.
    blurb: "Call the next card, higher or lower",
    kind: "casino",
    // 1,000, not the 500 this sat at while it was a placeholder: the round
    // charges TIER_CONFIG's cheapest tier, and the hub must not quote a price
    // no stake button can actually select.
    entryCost: 1000,
    status: "live",
    href: "/games/hi-lo",
  },
  {
    id: "video-poker",
    name: "Video Poker",
    blurb: "Jacks or better, single hand",
    kind: "casino",
    // 1,000, not the 500 this sat at while it was a placeholder: the round
    // charges TIER_CONFIG's cheapest tier, and the hub must not quote a price
    // no stake button can actually select. Same correction Hi-Lo needed.
    entryCost: 1000,
    status: "live",
    href: "/games/video-poker",
  },
  {
    id: "roulette-wheel",
    name: "Roulette Wheel",
    blurb: "European single zero",
    kind: "casino",
    entryCost: 1000,
    status: "live",
    href: "/games/roulette",
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
    status: "live",
    href: "/games/baccarat",
  },
  {
    id: "coin-flip",
    name: "Coin Flip",
    // Not "double or nothing": a fair coin paying exactly double has a house
    // edge of precisely zero, which is a hole in the economy rather than a
    // generous game. Wins pay 1.97x and the run compounds until you bank it --
    // see lib/arcade/coin-flip.ts. A blurb promising a mechanic the table does
    // not have is a promise broken on the click, the same way Hi-Lo's was.
    blurb: "Call it, then bank or let it ride",
    kind: "casino",
    // 1,000, not 250: the ladder's cheapest rung is what a round costs.
    entryCost: 1000,
    status: "live",
    href: "/games/coin-flip",
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
): "coming-soon" | "insufficient-gold" | null {
  if (game.status !== "live") return "coming-soon";
  if (!canAffordArcadeGame(game, wallet)) return "insufficient-gold";
  return null;
}

/**
 * The floor, split the way the page presents it: free dailies first, then the
 * rounds that cost Gold.
 *
 * The split is on `kind`, not on `entryCost > 0`, and that distinction is the
 * whole reason `kind` is a field rather than something inferred -- a puzzle is
 * free because it is a puzzle, and a casino game priced at 0 by mistake would
 * otherwise silently promote itself into the free section. Coming-soon entries
 * are dropped here rather than rendered greyed out: the arcade has no such
 * entries today, and a section whose header promises "free every day" should
 * not contain something that is not.
 */
export function splitArcadeFloor(games: readonly ArcadeGame[] = ARCADE_GAMES): {
  free: ArcadeGame[];
  staked: ArcadeGame[];
} {
  const live = games.filter((game) => game.status === "live");
  return {
    free: live.filter((game) => game.kind === "puzzle"),
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
  const { free, staked } = splitArcadeFloor(games);
  return {
    free: free.length,
    staked: staked.length,
    // Free first, matching the order the floor puts them in, so the tile and
    // the page it opens do not disagree about what the arcade leads with.
    previewNames: [...free, ...staked].slice(0, FLOOR_PREVIEW_COUNT).map((game) => game.name),
  };
}

export function arcadeActionLabel(game: ArcadeGame, wallet: ArcadeWallet): string {
  switch (arcadeBlockedReason(game, wallet)) {
    case "coming-soon":
      return "Soon";
    case "insufficient-gold":
      return "Low Gold";
    default:
      return "Play";
  }
}

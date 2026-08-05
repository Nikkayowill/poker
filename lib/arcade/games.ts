/**
 * The arcade catalogue -- the ten mini-games queued behind Hold'em.
 *
 * Pure data plus the wallet predicates the panel renders from, and it lives
 * in lib/ rather than next to the component for the same reason
 * lib/game/seat-presence.ts does: vitest.config.ts's `include` only covers
 * lib/ and app/, so nothing under components/ is reachable by `npm test`.
 *
 * Blackjack 21 is live (lib/arcade/blackjack.ts, /games/blackjack). The other
 * nine are `status: "coming-soon"` with a null href -- the same convention
 * MENU_MUSIC_TRACK and the unverified SFX entries already use here: the shape
 * is finished and going live is two fields, rather than a stub that has to be
 * redesigned when the game behind it actually lands.
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
    blurb: "Five letters, six guesses",
    kind: "puzzle",
    entryCost: 0,
    status: "coming-soon",
    href: null,
  },
  {
    id: "connections",
    name: "Connections",
    blurb: "Find the four hidden groups",
    kind: "puzzle",
    entryCost: 0,
    status: "coming-soon",
    href: null,
  },
  {
    id: "hi-lo",
    name: "Hi-Lo",
    blurb: "Call the next card, ride the streak",
    kind: "casino",
    entryCost: 500,
    status: "coming-soon",
    href: null,
  },
  {
    id: "video-poker",
    name: "Video Poker",
    blurb: "Jacks or better, single hand",
    kind: "casino",
    entryCost: 500,
    status: "coming-soon",
    href: null,
  },
  {
    id: "roulette-wheel",
    name: "Roulette Wheel",
    blurb: "European single zero",
    kind: "casino",
    entryCost: 1000,
    status: "coming-soon",
    href: null,
  },
  {
    id: "daily-sudoku",
    name: "Daily Sudoku",
    blurb: "One grid a day, four difficulties",
    kind: "puzzle",
    entryCost: 0,
    status: "coming-soon",
    href: null,
  },
  {
    id: "memory-match",
    name: "Memory Match",
    blurb: "Pair the card backs against the clock",
    kind: "puzzle",
    entryCost: 0,
    status: "coming-soon",
    href: null,
  },
  {
    id: "baccarat",
    name: "Baccarat",
    blurb: "Punto banco, player or bank",
    kind: "casino",
    entryCost: 5000,
    status: "coming-soon",
    href: null,
  },
  {
    id: "coin-flip",
    name: "Coin Flip",
    blurb: "Double or nothing, one call",
    kind: "casino",
    entryCost: 250,
    status: "coming-soon",
    href: null,
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

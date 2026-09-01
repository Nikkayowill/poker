/**
 * The arcade catalogue: everything beside Hold'em.
 *
 * Pure data plus the wallet predicates the panel renders from. It lives in
 * lib/ rather than next to the component for the same reason
 * lib/game/seat-presence.ts does: vitest.config.ts's `include` only covers
 * lib/ and app/, so nothing under components/ is reachable by `npm test`.
 *
 * The floor once carried house games staked against fixed odds. Every such
 * game has since been retired and deleted outright, code, routes and
 * components included; `lib/arcade/retired.ts`'s guard mechanism stays as
 * the reusable way to retire a future game without a same-day code deletion,
 * even though its list is empty today. Duels took their place: a duel is the
 * one thing here not played against the house, both players ante and the
 * winner takes the pot with no rake. That's why `kind` carries its own
 * value rather than duels being priced as casino rows: it decides what the
 * button says (a duel opens a lobby, it does not deal) and which section of
 * the floor a row lands in.
 *
 * Rules that have each been broken at least once:
 *
 * - A live entry needs an href and a non-live one must not have one. A test
 *   pins it: a live row with a null href renders an unclickable Play, and a
 *   coming-soon row with an href is a 404 waiting to be linked.
 * - `entryCost` must be a stake TIER_CONFIG can actually select — a price no
 *   button could charge has shipped more than once. Price a new row off the
 *   ladder or leave it at 0. For a duel it is a floor, not a price: the
 *   challenger names any wager at or above MIN_DUEL_STAKE, so the floor
 *   renders it as "from N".
 * - A blurb must not promise a mechanic the game lacks — a row once promised
 *   "ride the streak" on a game with no streak.
 */

import { MIN_DUEL_STAKE } from "@/lib/pvp/match-contract";
import type { PlayerProfile } from "@/lib/profile/types";

export type ArcadeGameId =
  | "blackjack-21"
  | "daily-word-stack"
  | "connections"
  | "daily-sudoku"
  | "memory-match"
  | "minesweeper"
  | "nonogram"
  | "chess-duel"
  | "checkers-duel"
  | "othello-duel"
  | "trivia-showdown"
  | "word-race"
  | "cribbage-table"
  | "homestead";

/**
 * `casino` stakes Gold against the house on a chance outcome. `duel` stakes
 * Gold against another player in a skill/social match, winner takes the pot,
 * see lib/pvp/. `wager` stakes Gold against your own performance: beat a
 * challenge or forfeit the wager, see lib/arcade/ante-up*.ts. `wager` is not
 * `casino` under a different name: nothing here is decided by odds the house
 * sets, only by whether the challenge gets beaten, the same "skill, not
 * chance" line that got the pure-chance games cut in the first place. The
 * split decides whether a row is wallet-gated at all and how its "Play"
 * button behaves (deal immediately vs. open a challenge lobby vs. open a
 * wager step), so it is a field rather than something inferred from
 * entryCost being zero.
 *
 * `puzzle` currently has no members, but stays as a type value (and
 * `splitArcadeFloor`/`arcade-floor.tsx` keep their "Free today" branch,
 * which the empty-bucket guard already hides at zero code cost) in case a
 * genuinely free-only puzzle is added later.
 *
 * Word Stack, Connections, Sudoku and Memory Match are all `kind: "wager"`,
 * but split into two shapes:
 *
 * - Sudoku and Memory Match have no daily identity worth protecting (no
 *   shared board, nothing shareable), so they carry no daily gate at all.
 *   `/games/sudoku` and `/games/memory` open straight into a wager-or-Free
 *   step, replayable any time, no bonus, no cap. See lib/arcade/ante-up.ts
 *   and lib/arcade/ante-up-memory.ts.
 * - Word Stack and Connections keep their once-a-day shared puzzle (the
 *   share grid is the reason the feature exists); the wager-or-Free step
 *   gates opening that one attempt rather than trailing it as a link to a
 *   second, unlimited game. See lib/server/word-stack-service.ts and
 *   lib/server/connections-service.ts.
 *
 * All four stay `kind: "wager"`: the mechanic (skill, not chance; beat a
 * challenge or forfeit the stake) is the same, only where the daily line
 * sits differs. There are no standalone `ante-up-sudoku`/`ante-up-memory`/
 * `ante-up-word-stack`/`ante-up-connections` catalog rows; the old routes by
 * those names either redirect to the primary route (Sudoku/Memory) or are
 * gone (Word Stack/Connections, which have no second, unlimited mode to
 * redirect to).
 */
export type ArcadeGameKind = "casino" | "puzzle" | "duel" | "wager";

/**
 * `retired` is the status a game gets when it stops being offered but the
 * decision to stop isn't "this was never finished". See lib/arcade/
 * retired.ts, the guard that blocks a new round for whichever ids are in its
 * list (empty today; every game that was ever in it has since been deleted
 * outright, not merely retired). It's a distinct status from `coming-soon`:
 * one is "not built yet", the other is "was built, moved real Gold, and a
 * human decided to stop offering it" — collapsing them would lose that
 * distinction.
 */
/**
 * `unlisted` is a fourth state and not a flavour of the other three: the game
 * is finished, mounted, and moving real Gold, but is not being advertised yet.
 * It is not `coming-soon` (that means "not built"), and it is not `retired`
 * (that means "was offered, then stopped"). Collapsing it into either would
 * lose exactly the distinction this type exists to keep.
 *
 * `splitArcadeFloor` shows `live` rows and nothing else, so an unlisted game
 * never reaches the floor. That is ALL it does. Per lib/arcade/retired.ts's
 * lesson, a catalog row is not a lock: the routes stay open, so anyone with
 * the URL can play it. Unlisted means unadvertised, never unreachable -- if a
 * game must actually be closed, the route has to refuse, and that is a
 * separate thing to build.
 */
export type ArcadeGameStatus = "coming-soon" | "live" | "retired" | "unlisted";

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
   * Where a live game lives. Null while it is coming-soon: a route that is
   * not built yet is a 404 waiting for whoever flips the status without
   * reading this file.
   */
  href: string | null;
}

/**
 * The wallet a row is checked against, narrower than PlayerProfile:
 * affordability needs the balance and the unlimited flag and nothing else,
 * and taking the whole profile would let a future caller reach for
 * lastDailyClaimAt or isRegistered from inside a pricing rule.
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
    blurb: "Beat the dealer, 3:2 on a natural",
    kind: "casino",
    entryCost: 1000,
    status: "live",
    href: "/games/blackjack",
  },
  {
    id: "daily-word-stack",
    name: "Daily Word Stack",
    // Accurate to the mechanic: one word a day, shared by everyone, which is
    // what makes the emoji grid worth posting. A blurb promising something
    // the board does not do is a promise broken on the click; see this
    // file's own header for the rule that learned that the hard way.
    blurb: "Six guesses at the word everyone gets today",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/word-stack",
  },
  {
    id: "connections",
    name: "Connections",
    blurb: "Find the four groups hiding in sixteen words",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/connections",
  },
  {
    id: "daily-sudoku",
    name: "Sudoku",
    blurb: "Fill the grid, from easy up to expert",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/sudoku",
  },
  {
    id: "memory-match",
    name: "Memory Match",
    blurb: "Pair the whole board before your turns run out",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/memory",
  },
  {
    id: "minesweeper",
    name: "Minesweeper",
    blurb: "Clear the field, no guesswork on any board",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/minesweeper",
  },
  {
    id: "nonogram",
    name: "Nonogram",
    blurb: "Turn a grid of numbers into a picture",
    kind: "wager",
    entryCost: 0,
    status: "live",
    href: "/games/nonogram",
  },
  // `kind: "wager"` in the loose sense the doc comment above gives it (Gold
  // staked on something other than another player, no house odds), but the
  // Homestead has no free mode and no way to lose: a plot's payout is fixed
  // at stocking. entryCost 0 rather than the cheapest crop's stake so the
  // floor never wallet-gates the tile -- a broke player may still own plots
  // ready to sell, and blocking the door to their own payout over the price
  // of the *next* stake would strand exactly the Gold that gets them un-broke.
  {
    id: "homestead",
    name: "StackChips Homestead",
    blurb: "Raise crops and livestock, sell what they make",
    kind: "wager",
    entryCost: 0,
    // Deployed but not released: off the floor by this status, and its routes
    // and page additionally refuse anyone whose account is not named in
    // HOMESTEAD_ALLOWED_USER_IDS (see lib/server/homestead-access.ts). To
    // release it, flip this to "live" AND clear that variable -- either one
    // alone still leaves it hidden.
    status: "unlisted",
    href: "/games/homestead",
  },
  // ---- Duels: skill/social games staked against another player, not the
  // house. Winner takes the pot both players anted; see lib/pvp/. Priced at
  // the cheapest tier as a "starting at": the challenger actually picks the
  // stake tier when they send the challenge, same as a table buy-in.
  {
    id: "chess-duel",
    name: "Chess",
    blurb: "Checkmate them and take the pot",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/chess",
  },
  {
    id: "checkers-duel",
    name: "Checkers",
    blurb: "Take their last piece to take the pot",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/checkers",
  },
  // Perfect information and no dice, like the two above it. Picked over
  // Connect Four for one reason worth writing down: Connect Four is solved,
  // and a player who has memorised the first-player win would farm every
  // opponent they got seat 0 against. See lib/pvp/othello.ts's own header.
  {
    id: "othello-duel",
    name: "Othello",
    blurb: "Hold the most discs when the board runs out",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/othello",
  },
  {
    id: "trivia-showdown",
    name: "Trivia Showdown",
    blurb: "First right answer takes the question",
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
  // Not a 1v1: a 3-4 player free-for-all table, still winner-takes-the-pot
  // with no house. `kind: "duel"` is a UI category ("staked against other
  // players, opens a lobby rather than dealing"), not a literal headcount,
  // so it fits here without a new kind or section.
  {
    id: "cribbage-table",
    name: "Cribbage",
    blurb: "Peg to 121 at a table of three or four",
    kind: "duel",
    entryCost: MIN_DUEL_STAKE,
    status: "live",
    href: "/games/cribbage",
  },
];
// Sit & Go and heads-up poker are deliberately NOT catalog rows here.
// Both are real poker (lib/game/engine.ts's createTournamentGame /
// createHeadsUpGame), not arcade side-games, and now live as two of the
// three formats offered directly in the main buy-in flow
// (components/lobby/buy-in-modal.tsx) alongside the ordinary 6-max cash
// game -- Kayo's explicit call after Sit & Go first shipped tucked into
// Ante Up: "dont hide the tournaments in the ante up." Their own
// /games/sit-and-go and /games/heads-up pages/routes stay mounted (a
// stale link, a direct visit, or the waiting-room deep link still needs
// them), just not advertised as an Ante Up tile any more.

/**
 * A missing profile is a wallet with nothing in it, not an unlimited one:
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
  // is "you get to choose". The same number means opposite things, so it
  // needs two different sentences rather than one that is wrong for either.
  //
  // A bare "Free to play" on a wager row reads as "nothing is actually
  // wagered here", which is backwards for a row where the wager is chosen up
  // front, before anything deals; see the `ArcadeGameKind` doc comment
  // above. The exact wording still differs by the two sub-shapes described
  // there: Sudoku/Memory Match are unlimited (no daily identity to name),
  // Word Stack/Connections are still the one shared puzzle for the day.
  if (game.kind !== "wager") return "Free daily";
  // The Homestead's zero is a third meaning again: there is no free mode at all,
  // only stakes chosen inside (its entryCost is 0 purely so the floor never
  // wallet-gates the door to a harvest; see its own catalog comment).
  if (game.id === "homestead") return "Raise stock, sell for Gold";
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
 * whole reason `kind` is a field rather than something inferred: a puzzle is
 * free because it is a puzzle, and a casino game priced at 0 by mistake would
 * otherwise silently promote itself into the free section. `wager` gets its
 * own bucket for the same reason `duel` did: it is priced at 0 (a floor, not
 * a price — the player names the real wager on the page) but is not free the
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
    // "Costs nothing to start", not "kind: puzzle". The puzzle bucket is
    // empty and has been for a while, so counting only it printed a literal
    // "0 free every day" on the hub tile. A wager row is genuinely free to
    // open -- the stake is a choice made on the game's own page -- so it
    // belongs on this side of the line.
    free: free.length + wagers.length,
    // The rows that cannot be opened without spending: a duel's ante and
    // Blackjack's buy-in are both charged before anything deals.
    staked: duels.length + staked.length,
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
      // A duel is not dealt on the click, it opens a challenge lobby, and
      // the button should say so rather than implying a round starts.
      // Cribbage is `kind: "duel"` too (see its own catalog entry) but opens
      // a joinable table list, not a 1:1 challenge, so "Challenge" would
      // name an action the button does not actually offer. Sit & Go and
      // heads-up poker used to need the same exception here -- both are
      // gone from this catalog now (see ARCADE_GAMES' own note on why), so
      // cribbage is the only member left.
      const opensATableList = game.id === "cribbage-table";
      return game.kind === "duel" && !opensATableList ? "Challenge" : "Play";
  }
}

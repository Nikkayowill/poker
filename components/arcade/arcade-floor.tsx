"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins, HelpCircle } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  arcadeActionLabel,
  arcadeBlockedReason,
  arcadeEntryLabel,
  splitArcadeFloor,
  toArcadeWallet,
  type ArcadeGame,
  type ArcadeWallet,
} from "@/lib/arcade/games";
import { gameOnSound, tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "./use-arcade-sound";
import { markEmbeddedFloorNav } from "./floor-back-link";
import { HowToPlayModal } from "./how-to-play-modal";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";

/**
 * The arcade floor: every game that is not Hold'em, on its own route.
 *
 * This is the page the hub tile used to try to be. Ten rows of name, stake
 * and button don't belong in a grid cell, and the six games below the fold
 * used to be reachable only by scrolling inside a card on a page that also
 * scrolled.
 *
 * Two sections rather than one list, because the free dailies and the Gold
 * rounds are different propositions. A daily costs nothing, is the same
 * board for everybody, and expires, so it gets a card with room for its
 * blurb and a button that's never gated. A staked round costs real Gold
 * from the same wallet as the tables, so it gets a dense row that states
 * its price next to its name, since the price is the decision a player is
 * actually making. Rendering both the same way would hide the one thing
 * that tells them apart.
 *
 * The wallet is fetched here rather than passed in, since this route
 * doesn't mount PokerApp and has no profile in scope, same as each arcade
 * machine fetching its own.
 *
 * Two props exist only because the phone lobby renders this same component
 * as one of its swipe panes (components/lobby/mobile-shell.tsx) instead of
 * reimplementing the floor:
 *   - `profile` hands it the wallet PokerApp already holds. Without it the
 *     pane would keep a second copy that a buy-in or a claim never updates.
 *   - `embedded` drops the page furniture: the `<main>` (it would nest
 *     inside PokerApp's) and the `.floor-bar` header, whose "← The floor"
 *     link would navigate away from the shell the player is already
 *     standing in, and whose wallet readout duplicates the one above it.
 * Both default to the route's normal behaviour, so
 * `app/(lobby)/games/page.tsx` is unchanged.
 */
export function ArcadeFloor({
  profile: suppliedProfile,
  embedded = false,
}: {
  profile?: PlayerProfile | null;
  embedded?: boolean;
} = {}) {
  // Applies the player's stored mute on a route where PokerApp isn't
  // mounted. The module-level flag it sets is global, which is what lets
  // the cards below call tapSound and gameOnSound directly instead of
  // threading a play() callback through three components. Remove it and
  // the whole floor goes loud for a muted player. See lib/audio/ui-sounds.ts.
  useArcadeSound();
  const [fetchedProfile, setFetchedProfile] = useState<PlayerProfile | null>(null);
  const [fetched, setFetched] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const mounted = useRef(true);
  // PokerApp only hands down a profile once it has one, so a supplied
  // wallet is already loaded.
  const supplied = suppliedProfile !== undefined;
  const profile = supplied ? suppliedProfile : fetchedProfile;
  const loaded = supplied ? true : fetched;

  useEffect(() => {
    if (supplied) return;
    mounted.current = true;
    // Deferred through a timer rather than fired from the effect body, matching
    // the profile load in poker-app.tsx and components/profile/rank-strip.tsx:
    // a fetch started synchronously here sets state during the same commit.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        if (!mounted.current) return;
        if (response.ok) setFetchedProfile(((await response.json()) as { profile: PlayerProfile }).profile);
      } catch {
        // An unreachable wallet is an empty one, which is what toArcadeWallet
        // already returns for a null profile. The floor still lists every
        // game; the staked rows simply say what they cost.
      } finally {
        if (mounted.current) setFetched(true);
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, [supplied]);

  const wallet = toArcadeWallet(profile);
  const { free, duels, wagers, staked } = splitArcadeFloor();

  // A plain div when embedded: PokerApp already owns the page's <main>, and a
  // nested one is invalid. The extra class is what 45-mobile-shell.css hangs
  // the "this is a pane, not a page" sizing off.
  const Shell = embedded ? "div" : "main";
  // Same rule leaderboard.tsx follows: embedded, this is one pane of the
  // phone shell and its heading sits under the page's, not beside it.
  const Heading = embedded ? "h2" : "h1";

  return (
    <Shell className={embedded ? "floor-shell floor-shell-embedded" : "floor-shell"}>
      {!embedded && (
      <header className="floor-bar">
        <div className="floor-bar-left">
          <Link className="floor-back" href="/" onClick={tapSound}>← The floor</Link>
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How Ante Up works
          </button>
        </div>
        {/* .gold-balance is the navbar badge's own coin+amount layout
            (03-profile.css), reused rather than restated: the number a
            player checks before picking a stake should look the same
            everywhere it appears. An em dash shows until the fetch lands,
            since an unloaded wallet is empty (correct for gating) and
            shouldn't be worded as a verdict before it's known. */}
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded ? "—" : wallet.unlimitedGold ? "Unlimited" : wallet.goldBalance.toLocaleString()}
          </strong>
        </span>
      </header>
      )}

      {!embedded && showHelp && (
        <HowToPlayModal title="How Ante Up works" onClose={() => setShowHelp(false)}>
          {/* Scoped to the solo boards on purpose. The floor also carries
              duels and Blackjack, neither of which has a free mode, and the
              old wording ("Every Ante Up game can be played completely
              free") promised one for all eleven rows. */}
          <p>
            The solo boards under &ldquo;Beat the board&rdquo; are always free to play, so
            there&apos;s never a cost to trying one. Stake Gold on a round instead and
            you&apos;re staking it against your own play, not another player and not the
            house: beat the board and you cash out a multiple of the stake, miss it and the
            stake is gone.
          </p>
          <p>
            Sudoku, Memory Match, Minesweeper and Nonogram are unlimited, any time, dealing a
            fresh board every round. Word Stack and Connections are each one shared puzzle a day
            for everyone, so there&apos;s exactly one wagered attempt allowed per day — choose
            your wager, or play free, before that day&apos;s puzzle opens.
          </p>
          {/* Nonogram is the newest board and the one nobody arrives already
              knowing, so it gets its rules stated here rather than only behind
              its own How to play. Everything else in this modal is a rule
              about wagering; this paragraph is the exception, and it earns it
              by being the difference between the game looking arbitrary and
              looking solvable. */}
          <p>
            <strong>Nonogram</strong> is the one that needs a word of explanation. The numbers
            down the side and across the top of the grid are its answer: each one is the length
            of a run of filled squares in that line, in order, with a gap between runs. A row
            reading &ldquo;4 2&rdquo; has four filled squares, a gap, then two more. Fill in
            every square in the picture and you win. Crossing off a square you have worked out
            is empty is free and never scored, so only a wrong <em>fill</em> costs you one of
            the board&apos;s few mistakes. Boards run 5×5 up to 25×25, and like Minesweeper,
            every one can be finished by logic alone.
          </p>
          <p>
            Every wager has a ceiling. Sudoku&apos;s, Minesweeper&apos;s and Nonogram&apos;s
            climb with difficulty, since a harder board is worth staking more on; Memory Match,
            Word Stack, and Connections cap at one flat amount. Whatever you wager, the payout
            it can earn is locked in the moment the round opens, so a later retune never changes
            what&apos;s already in play.
          </p>
        </HowToPlayModal>
      )}

      <div className="floor-head">
        {/* Kicker, one short noun phrase, one line of context: the same head
            shape every other floor uses (Challenges, Achievements, Rewards,
            Collection, the leaderboard), so a swipe between tabs doesn't
            change the furniture. This used to read "Eleven more ways in.",
            which counted the catalogue off a number-to-words table and
            framed the whole section as an appendix to poker. It named a
            count nobody asked for and matched nothing else in the app.

            No number in here on purpose, for the reason lib/arcade/games.ts
            gives about prices: a count written into a sentence is a count
            that goes stale the day a game ships. */}
        <div className="lobby-kicker">Ante Up</div>
        <Heading>Every game beside the table.</Heading>
        <p>
          Play free, or stake Gold from the same wallet as the tables.
        </p>
      </div>

      {free.length > 0 && (
        <section className="floor-section" aria-labelledby="floor-free">
          <h2 className="floor-section-head" id="floor-free">Free today</h2>
          <div className="floor-free-grid">
            {free.map((game) => (
              <FreeCard key={game.id} game={game} embedded={embedded} />
            ))}
          </div>
        </section>
      )}

      {duels.length > 0 && (
        <section className="floor-section" aria-labelledby="floor-duels">
          {/* Its own section, above the house games, because a duel is a
              different proposition: the Gold goes to the other player(s),
              not the house, and nobody is playing against fixed odds.
              That's worth saying in the header rather than leaving the
              player to infer it from a blurb. Worded for "however many are
              seated" rather than "both" since Cribbage joined this section
              as a 3-4 player table, not a 1v1 (see its own catalog
              entry). */}
          <h2 className="floor-section-head" id="floor-duels">Head to head</h2>
          <p className="floor-section-note">
            Everyone seated antes in and the winner takes the pot. The house takes nothing.
          </p>
          <div className="floor-free-grid">
            {duels.map((game) => (
              <GameCard key={game.id} game={game} wallet={wallet} stakeLabel={`from ${arcadeEntryLabel(game)} Gold`} embedded={embedded} />
            ))}
          </div>
        </section>
      )}

      {wagers.length > 0 && (
        <section className="floor-section" aria-labelledby="floor-wagers">
          {/* Its own section too, for the mirror-image reason the duels get
              one: the Gold you stake here goes to you if you beat the
              challenge, or nowhere if you don't. No house edge, no
              opponent, only your own performance. Every row is a brain
              game; see lib/arcade/games.ts's own note on the two sub-shapes
              ("keeps a daily puzzle" vs. "no daily gate at all") this one
              line covers. */}
          <h2 className="floor-section-head" id="floor-wagers">Beat the board</h2>
          <p className="floor-section-note">
            Free as often as you like. Stake Gold instead and you win it back with interest, or lose it,
            on your own play alone.
          </p>
          <div className="floor-free-grid">
            {wagers.map((game) => (
              <GameCard key={game.id} game={game} wallet={wallet} stakeLabel={arcadeEntryLabel(game)} embedded={embedded} />
            ))}
          </div>
        </section>
      )}

      {staked.length > 0 && (
        <section className="floor-section" aria-labelledby="floor-staked">
          {/* "Staked in Gold" described the two sections above it just as
              well. What actually sets this one apart is the opponent. */}
          <h2 className="floor-section-head" id="floor-staked">Against the house</h2>
          <ul className="floor-staked-list">
            {staked.map((game) => (
              <StakedRow key={game.id} game={game} wallet={wallet} embedded={embedded} />
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

/**
 * The sound plus, when this card is rendered inside the mobile shell's
 * embedded pane, the marker FloorBackLink needs to know a "← Ante Up" from
 * the game we're about to open should go back in history rather than to the
 * /games route. See floor-back-link.tsx.
 */
function onPlayClick(embedded: boolean): () => void {
  return () => {
    gameOnSound();
    if (embedded) markEmbeddedFloorNav();
  };
}

/**
 * A free daily. Never gated, so it's always a link: a puzzle that costs
 * nothing has no state where its button should be dead.
 */
function FreeCard({ game, embedded }: { game: ArcadeGame; embedded: boolean }) {
  return (
    <article className="floor-card">
      <strong>{game.name}</strong>
      <small>{game.blurb}</small>
      <Link className="floor-play" href={game.href ?? "/"} onClick={onPlayClick(embedded)}>Play</Link>
    </article>
  );
}

/**
 * A duel or a solo skill wager. Card-shaped like a daily rather than
 * row-shaped like a house game, because the decision here is "who/what do
 * I want to play", not "what does it cost". The stake is picked inside, on
 * the challenge or wager step, the same way a table buy-in is.
 *
 * `stakeLabel` carries the one difference between the two callers: a
 * duel's catalogue entryCost is a floor across up to eight stakes ("from
 * 1,000 Gold"), never the price, since quoting one number for a game that
 * offers eight would misstate it. A wager's `arcadeEntryLabel` already
 * returns a full phrase ("Free to play") for this kind, so it's passed
 * through as-is rather than wrapped in "from … Gold".
 */
function GameCard({
  game,
  wallet,
  stakeLabel,
  embedded,
}: {
  game: ArcadeGame;
  wallet: ArcadeWallet;
  stakeLabel: string;
  embedded: boolean;
}) {
  const blocked = arcadeBlockedReason(game, wallet);
  return (
    <article className="floor-card">
      <strong>{game.name}</strong>
      <small>{game.blurb}</small>
      <small className="floor-card-stake">{stakeLabel}</small>
      {blocked === null && game.href ? (
        <Link className="floor-play" href={game.href} onClick={onPlayClick(embedded)}>{arcadeActionLabel(game, wallet)}</Link>
      ) : (
        <button type="button" className="floor-play" disabled>
          {arcadeActionLabel(game, wallet)}
        </button>
      )}
      {/* Only the Gold-blocked case -- a coming-soon or retired row has
          nowhere for "earn more Gold" to send anyone. compact: this is a
          grid card, not a modal. */}
      {blocked === "insufficient-gold" && <GoldShortfallHint needed={game.entryCost} compact />}
    </article>
  );
}

/**
 * A staked round. The price sits between the name and the button because it is
 * the thing being decided; a player scanning this list is reading the middle
 * column, not the left one.
 */
function StakedRow({ game, wallet, embedded }: { game: ArcadeGame; wallet: ArcadeWallet; embedded: boolean }) {
  const blocked = arcadeBlockedReason(game, wallet);
  return (
    <li className={clsx("floor-row", blocked && "floor-row-blocked")}>
      <span className="floor-row-identity">
        <strong>{game.name}</strong>
        <small>{game.blurb}</small>
        {/* Inside the identity column (flex column, not the row's own flex
            row) so this stacks under the blurb instead of becoming a fourth
            item alongside the stake/button. Gold-blocked only, same reason
            GameCard above gates it -- coming-soon/retired have no earn-more
            link to offer. */}
        {blocked === "insufficient-gold" && <GoldShortfallHint needed={game.entryCost} compact />}
      </span>
      <span className="floor-row-stake">{arcadeEntryLabel(game)}</span>
      {/* A playable row is a link, not a button with an onClick, since it
          navigates and should middle-click and open in a new tab like
          every other route. The blocked states stay buttons: there's
          nowhere to go. */}
      {blocked === null && game.href ? (
        <Link className="floor-play" href={game.href} onClick={onPlayClick(embedded)}>{arcadeActionLabel(game, wallet)}</Link>
      ) : (
        <button
          type="button"
          className="floor-play"
          disabled
          title={
            blocked === "coming-soon"
              ? `${game.name} is not open yet`
              : blocked === "retired"
                ? `${game.name} is no longer offered`
                : `Needs ${arcadeEntryLabel(game)} Gold to play`
          }
        >
          {arcadeActionLabel(game, wallet)}
        </button>
      )}
    </li>
  );
}

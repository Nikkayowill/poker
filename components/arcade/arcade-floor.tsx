"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
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

/**
 * Small counts as words, because both call sites are sentences: "10 more
 * ways in." reads as a spec line, "Ten more ways in." reads as a person
 * saying it. Capped at twelve, falling back to digits above that; the
 * catalogue is ten games, so this never needs a real number-to-words
 * library. The words are capitalised here (both call sites start a
 * sentence) rather than via a text-transform that would shout the whole
 * line to fix one word.
 *
 * Index 0 is "No", so an empty catalogue reads "No more ways in." instead
 * of the "0 more ways in." a bare number would give.
 */
const WORDS = [
  "No", "One", "Two", "Three", "Four", "Five",
  "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];
function spell(count: number): string {
  return WORDS[count] ?? String(count);
}

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

  return (
    <Shell className={embedded ? "floor-shell floor-shell-embedded" : "floor-shell"}>
      {!embedded && (
      <header className="floor-bar">
        <Link className="floor-back" href="/" onClick={tapSound}>← The floor</Link>
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

      <div className="floor-head">
        <div className="lobby-kicker">Ante Up</div>
        {/* Both numbers are counted off the catalogue, never hardcoded,
            the same rule lib/arcade/games.ts states about prices and blurbs
            and has broken before. Spelled as words because these are
            sentences: "10 more ways in." reads as a spec line, "Ten more
            ways in." reads as a person saying it. */}
        <h1>{spell(duels.length + wagers.length + staked.length)} more ways in.</h1>
        <p>
          Every Ante Up game starts free — wager Gold from the same wallet as the
          tables once you&apos;ve got the hang of it.
        </p>
      </div>

      {free.length > 0 && (
        <section className="floor-section" aria-labelledby="floor-free">
          <h2 className="floor-section-head" id="floor-free">Free today</h2>
          <div className="floor-free-grid">
            {free.map((game) => (
              <FreeCard key={game.id} game={game} />
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
          <h2 className="floor-section-head" id="floor-duels">Player vs. player</h2>
          <p className="floor-section-note">
            Everyone seated antes in. Winner takes the pot — the house takes nothing.
          </p>
          <div className="floor-free-grid">
            {duels.map((game) => (
              <GameCard key={game.id} game={game} wallet={wallet} stakeLabel={`from ${arcadeEntryLabel(game)} Gold`} />
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
          <h2 className="floor-section-head" id="floor-wagers">Ante up</h2>
          <p className="floor-section-note">
            Choose a wager, or play free — miss it and the wager is gone, but there&apos;s never a cost to trying.
          </p>
          <div className="floor-free-grid">
            {wagers.map((game) => (
              <GameCard key={game.id} game={game} wallet={wallet} stakeLabel={arcadeEntryLabel(game)} />
            ))}
          </div>
        </section>
      )}

      {staked.length > 0 && (
        <section className="floor-section" aria-labelledby="floor-staked">
          <h2 className="floor-section-head" id="floor-staked">Staked in Gold</h2>
          <ul className="floor-staked-list">
            {staked.map((game) => (
              <StakedRow key={game.id} game={game} wallet={wallet} />
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

/**
 * A free daily. Never gated, so it's always a link: a puzzle that costs
 * nothing has no state where its button should be dead.
 */
function FreeCard({ game }: { game: ArcadeGame }) {
  return (
    <article className="floor-card">
      <strong>{game.name}</strong>
      <small>{game.blurb}</small>
      <Link className="floor-play" href={game.href ?? "/"} onClick={gameOnSound}>Play</Link>
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
function GameCard({ game, wallet, stakeLabel }: { game: ArcadeGame; wallet: ArcadeWallet; stakeLabel: string }) {
  const blocked = arcadeBlockedReason(game, wallet);
  return (
    <article className="floor-card">
      <strong>{game.name}</strong>
      <small>{game.blurb}</small>
      <small className="floor-card-stake">{stakeLabel}</small>
      {blocked === null && game.href ? (
        <Link className="floor-play" href={game.href} onClick={gameOnSound}>{arcadeActionLabel(game, wallet)}</Link>
      ) : (
        <button type="button" className="floor-play" disabled>
          {arcadeActionLabel(game, wallet)}
        </button>
      )}
    </article>
  );
}

/**
 * A staked round. The price sits between the name and the button because it is
 * the thing being decided; a player scanning this list is reading the middle
 * column, not the left one.
 */
function StakedRow({ game, wallet }: { game: ArcadeGame; wallet: ArcadeWallet }) {
  const blocked = arcadeBlockedReason(game, wallet);
  return (
    <li className={clsx("floor-row", blocked && "floor-row-blocked")}>
      <span className="floor-row-identity">
        <strong>{game.name}</strong>
        <small>{game.blurb}</small>
      </span>
      <span className="floor-row-stake">{arcadeEntryLabel(game)}</span>
      {/* A playable row is a link, not a button with an onClick, since it
          navigates and should middle-click and open in a new tab like
          every other route. The blocked states stay buttons: there's
          nowhere to go. */}
      {blocked === null && game.href ? (
        <Link className="floor-play" href={game.href} onClick={gameOnSound}>{arcadeActionLabel(game, wallet)}</Link>
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

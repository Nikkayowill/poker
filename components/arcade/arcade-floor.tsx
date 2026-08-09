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

/**
 * Small counts as words, because both call sites are sentences.
 *
 * "10 more ways in." reads as a spec line; "Ten more ways in." reads as a
 * person saying it. Only up to twelve, falling back to digits above that
 * rather than growing a number-to-words library -- the catalogue is ten games
 * and the copy reading this is two sentences long. Both entries start their
 * sentence, so the words are capitalised here rather than by a
 * text-transform, which would have had to shout a whole line to fix one word.
 *
 * Index 0 is "No", so an empty catalogue reads "No more ways in." -- which is
 * at least a sentence, rather than the "0 more ways in." a bare number gives.
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
 * This is the page the hub tile used to try to be. Ten rows of name + stake +
 * button do not belong in a grid cell, and the six games below the fold were
 * reachable only by scrolling inside a card on a page that also scrolled.
 *
 * Two sections, not one list, and the split is the point rather than a
 * grouping convenience: the free dailies and the Gold rounds are different
 * propositions. A daily costs nothing, is the same board for everybody, and
 * expires -- so it gets a card with room for its blurb and a button that is
 * never gated. A staked round costs real Gold from the same wallet as the
 * tables -- so it gets a dense row that states its price next to its name,
 * because the price is the decision. Rendering both the same way would be
 * tidier and would hide the only thing a player needs to tell them apart.
 *
 * The wallet is fetched here rather than passed in: this route does not mount
 * PokerApp, so there is no profile in scope -- the same reason each arcade
 * machine fetches its own.
 */
export function ArcadeFloor() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Deferred through a timer rather than fired from the effect body, matching
    // the profile load in poker-app.tsx and components/profile/rank-strip.tsx:
    // a fetch started synchronously here sets state during the same commit.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        if (!mounted.current) return;
        if (response.ok) setProfile(((await response.json()) as { profile: PlayerProfile }).profile);
      } catch {
        // An unreachable wallet is an empty one, which is what toArcadeWallet
        // already returns for a null profile. The floor still lists every
        // game; the staked rows simply say what they cost.
      } finally {
        if (mounted.current) setLoaded(true);
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, []);

  const wallet = toArcadeWallet(profile);
  const { free, staked } = splitArcadeFloor();

  return (
    <main className="floor-shell">
      <header className="floor-bar">
        <Link className="floor-back" href="/">← The floor</Link>
        {/* .gold-balance is the navbar badge's own coin+amount layout
            (03-profile.css), reused rather than restated -- the number a player
            checks before picking a stake should look the same everywhere it
            appears. An em dash until the fetch lands: an unloaded wallet is
            empty, which is correct for gating and must not be *worded* as a
            verdict before it is known. */}
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded ? "—" : wallet.unlimitedGold ? "Unlimited" : wallet.goldBalance.toLocaleString()}
          </strong>
        </span>
      </header>

      <div className="floor-head">
        <div className="lobby-kicker">Arcade &amp; Puzzles</div>
        {/* Both numbers are counted off the catalogue, never written down --
            the same rule lib/arcade/games.ts states about prices and blurbs,
            which has been broken there three times. Spelled as words because
            these are sentences: "10 more ways in." reads as a spec line and
            "Ten more ways in." reads as a person saying it. */}
        <h1>{spell(free.length + staked.length)} more ways in.</h1>
        <p>
          {spell(free.length)} are free every day. The rest stake Gold from the same
          wallet as the tables.
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
    </main>
  );
}

/**
 * A free daily. Never gated, so it is always a link -- a puzzle that costs
 * nothing has no state in which its button should be dead.
 */
function FreeCard({ game }: { game: ArcadeGame }) {
  return (
    <article className="floor-card">
      <strong>{game.name}</strong>
      <small>{game.blurb}</small>
      <Link className="floor-play" href={game.href ?? "/"}>Play</Link>
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
      {/* A playable row is a link, not a button with an onClick -- it
          navigates, so it should middle-click and open in a new tab like every
          other route. The blocked states stay buttons: there is nowhere to
          go. */}
      {blocked === null && game.href ? (
        <Link className="floor-play" href={game.href}>{arcadeActionLabel(game, wallet)}</Link>
      ) : (
        <button
          type="button"
          className="floor-play"
          disabled
          title={
            blocked === "coming-soon"
              ? `${game.name} is not open yet`
              : `Needs ${arcadeEntryLabel(game)} Gold to play`
          }
        >
          {arcadeActionLabel(game, wallet)}
        </button>
      )}
    </li>
  );
}

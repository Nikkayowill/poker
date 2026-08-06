"use client";

import Link from "next/link";
import { Coins, Gamepad2 } from "lucide-react";
import clsx from "clsx";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ARCADE_GAMES,
  arcadeActionLabel,
  arcadeBlockedReason,
  arcadeEntryLabel,
  toArcadeWallet,
} from "@/lib/arcade/games";

/**
 * The fourth hub panel: what is coming after Hold'em.
 *
 * It is a .hub-tile like every other panel in the grid -- same radius,
 * padding and hover -- with a scrolling list inside it, rather than a new
 * kind of card. .arcade-* in 22-arcade.css holds only the list.
 *
 * Every row is wallet-aware: the stake renders through .gold-balance, the
 * same coin+amount layout the navbar badge uses, so taking a game live is a
 * status flip in lib/arcade/games.ts and nothing here.
 */
export function ArcadePanel({ profile }: { profile: PlayerProfile | null }) {
  const wallet = toArcadeWallet(profile);
  // Counted, not written down. The header used to read "10 games in the
  // works", which was true when none of them were and quietly became a lie
  // the day Blackjack shipped -- a hub blurb must not misdescribe what is
  // behind it (see the note on Hi-Lo's blurb in lib/arcade/games.ts).
  const liveCount = ARCADE_GAMES.filter((game) => game.status === "live").length;

  return (
    <section className="hub-tile hub-tile-arcade" aria-labelledby="arcade-heading">
      <div className="arcade-head">
        <Gamepad2 size={16} aria-hidden="true" />
        <div className="arcade-head-copy">
          <strong id="arcade-heading">Arcade &amp; Puzzles</strong>
          <small>{liveCount} playable now, more dealing in</small>
        </div>
      </div>

      <ul className="arcade-list">
        {ARCADE_GAMES.map((entry) => {
          const blocked = arcadeBlockedReason(entry, wallet);
          return (
            <li key={entry.id} className={clsx("arcade-row", blocked && "arcade-row-blocked")}>
              <span className="arcade-identity">
                <strong>{entry.name}</strong>
                <small>{entry.blurb}</small>
              </span>
              <span className="arcade-stake">
                {entry.entryCost > 0
                  ? (
                    <span className="gold-balance">
                      <Coins size={12} aria-hidden="true" />
                      <strong>{arcadeEntryLabel(entry)}</strong>
                    </span>
                  )
                  : <span className="arcade-free">{arcadeEntryLabel(entry)}</span>}
              </span>
              {/* A playable row is a link, not a button with an onClick --
                  it navigates, so it should middle-click and open in a new
                  tab like every other route in the hub. The disabled states
                  stay buttons: there is nowhere to go. */}
              {blocked === null && entry.href
                ? (
                  <Link className="arcade-play" href={entry.href}>
                    {arcadeActionLabel(entry, wallet)}
                  </Link>
                )
                : (
                  <button
                    type="button"
                    className="arcade-play"
                    disabled
                    title={
                      blocked === "coming-soon"
                        ? `${entry.name} is not open yet`
                        : `Needs ${arcadeEntryLabel(entry)} Gold to play`
                    }
                  >
                    {arcadeActionLabel(entry, wallet)}
                  </button>
                )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { seatArtSrc } from "@/lib/scene/seat-art";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import type { ArcadeGame, ArcadeWallet } from "@/lib/arcade/games";
import type { PlayerProfile } from "@/lib/profile/types";
import { RailGameCard } from "./rail-game-card";

/** Bodie Ferris, the roster character the sign-in page puts in the middle. */
const HOLDEM_FIGURE_ID = "character25";

/** The StackStrike icon at card size, from public/stackstrike. */
const STRIKE_ART = "/stackstrike/card.png";

/**
 * The phone Play tab's first row: Hold'em, then StackAcres, then one duel.
 *
 * Hold'em leads and is the widest card, and its "Take a seat" is on the card
 * itself, the one saturated action on the screen. Format and stakes both live
 * one step in, inside the buy-in modal, the same flow the desktop hub's tile
 * opens, so nothing here picks a format.
 *
 * The figure is a current seat-art plate, the same art the racetrack table
 * draws, not a separate asset.
 *
 * StackAcres is on the row for everyone, badged as a premium expansion. A
 * player with stackacresAccess (granted from the admin dashboard) gets the
 * link, everyone else gets the info modal, since there is no checkout yet.
 * prefetch={false} because the row is on screen on mount and a default link
 * would prefetch the heaviest route.
 *
 * StackStrike shows for everyone. A player with stackstrikeAccess gets the
 * link to the prototype, everyone else gets a "Coming soon" card that does
 * nothing when tapped.
 */

export function PlayRail({
  profile,
  wallet,
  loading,
  sessionReady,
  onOpenBuyIn,
  featuredDuel,
}: {
  profile: PlayerProfile;
  wallet: ArcadeWallet;
  loading: boolean;
  sessionReady: boolean;
  onOpenBuyIn: () => void;
  featuredDuel: ArcadeGame | null;
}) {
  return (
    <section className="mshell-section" aria-label="Play">
      <div className="mshell-section-head">
        <h2 className="lobby-kicker">Play</h2>
      </div>
      <div className="mshell-rail mshell-play-row">
        <div className="mshell-card mshell-play-card mshell-play-holdem">
          <div className="mshell-play-body">
            <span className="lobby-kicker">Poker · No-limit</span>
            <strong className="mshell-play-name">Texas Hold&rsquo;em</strong>
            <span className="mshell-play-meta">Six-max, Heads-Up, Sit &amp; Go</span>
            <button
              type="button"
              className="mshell-primary mshell-play-cta"
              disabled={loading || !sessionReady}
              onClick={() => { selectSound(); onOpenBuyIn(); }}
            >
              {!sessionReady ? "Getting your seat ready" : loading ? "Finding you a table" : "Take a seat"}
              {!loading && sessionReady && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mshell-play-figure" src={seatArtSrc(HOLDEM_FIGURE_ID, 0)} alt="" draggable={false} />
        </div>

        {profile.stackacresAccess ? (
          <Link
            className="mshell-card mshell-play-card mshell-play-mid"
            href="/games/stackacres"
            onClick={tapSound}
            prefetch={false}
          >
            <span className="mshell-premium-badge">Premium</span>
            <StackAcresLogo variant="badge" className="mshell-play-art" alt="" />
            <strong>StackAcres</strong>
            <small>Raise crops and livestock</small>
          </Link>
        ) : (
          // Not owned yet: the same door, which shows the price and sells it
          // (or says to ask for access while it is not for sale). A tile that
          // only said "coming soon" left a player with no way to buy.
          <Link
            className="mshell-card mshell-play-card mshell-play-mid"
            href="/games/stackacres"
            onClick={tapSound}
            prefetch={false}
          >
            <span className="mshell-premium-badge">Premium</span>
            <StackAcresLogo variant="badge" className="mshell-play-art" alt="" />
            <strong>StackAcres</strong>
            <small>Raise crops and livestock</small>
          </Link>
        )}

        {profile.stackstrikeAccess ? (
          <Link
            className="mshell-card mshell-play-card mshell-play-mid"
            href="/stackstrike"
            onClick={tapSound}
            prefetch={false}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mshell-play-art mshell-play-art-soft" src={STRIKE_ART} alt="" width={64} height={64} draggable={false} />
            <strong>StackStrike</strong>
            <small>Stealth heist · Private preview</small>
          </Link>
        ) : (
          <div className="mshell-card mshell-play-card mshell-play-mid mshell-play-soon">
            <span className="mshell-premium-badge">Coming soon</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mshell-play-art mshell-play-art-soft" src={STRIKE_ART} alt="" width={64} height={64} draggable={false} />
            <strong>StackStrike</strong>
            <small>Stealth heist</small>
          </div>
        )}

        {featuredDuel && <RailGameCard game={featuredDuel} wallet={wallet} />}
      </div>
    </section>
  );
}

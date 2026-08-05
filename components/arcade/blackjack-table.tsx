"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { PlayingCard } from "@/components/table/playing-card";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { Card } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { toArcadeWallet } from "@/lib/arcade/games";
import {
  canCoverStake,
  dealRound,
  dealerUpCards,
  doubleDown,
  handTotal,
  hit,
  legalBlackjackActions,
  outcomeLabel,
  stand,
  type BlackjackRound,
} from "@/lib/arcade/blackjack";

/**
 * Blackjack 21.
 *
 * The rules all live in lib/arcade/blackjack.ts; this file is the felt. It
 * holds one round in state and replaces it wholesale on every action, because
 * the engine is pure and returns the next round rather than mutating one.
 *
 * The round is dealt in the browser, which is exactly why it does not settle
 * against real Gold: a client that owns the deck can report any result it
 * likes, and CLAUDE.md's first rule is that the server is the only authority
 * on game truth. So the wallet is *read* -- it gates which stakes can be
 * selected and whether a double is offered -- and the running total is shown
 * as a session score, clearly marked. Making the Gold real means a route that
 * owns the deck and returns the round, the same shape as
 * app/api/games/[id]/actions; the engine is already written to drop straight
 * into one.
 */

/** Math.random is fine here: nothing is settled against it. A server round would pass crypto's randomInt. */
const browserRandomInt = (maxExclusive: number) => Math.floor(Math.random() * maxExclusive);

function Hand({
  cards,
  label,
  total,
  hideTotal = false,
  faceDown = false,
}: {
  cards: Card[];
  label: string;
  total: string;
  hideTotal?: boolean;
  /** Draws the dealer's hole card while it is still hidden. */
  faceDown?: boolean;
}) {
  return (
    <div className="bj-hand">
      <div className="bj-hand-head">
        <span className="bj-hand-label">{label}</span>
        {!hideTotal && <span className="bj-hand-total">{total}</span>}
      </div>
      {/* PlayingCard is reused as-is rather than restyled: .card-large is
          already the felt's dominant card size, and the deal stagger is done
          with nth-child in CSS so no per-card prop is needed. */}
      <div className="bj-cards">
        {cards.map((card) => (
          <PlayingCard key={`${card.rank}-${card.suit}`} card={card} large />
        ))}
        {faceDown && <PlayingCard card={null} large />}
      </div>
    </div>
  );
}

export function BlackjackTable() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tier, setTier] = useState<StakesTier>("1k");
  const [round, setRound] = useState<BlackjackRound | null>(null);
  /** Play-money running total across the session. Deliberately not persisted -- see the file comment. */
  const [sessionNet, setSessionNet] = useState(0);
  const [handsPlayed, setHandsPlayed] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setProfile(data.profile ?? data);
    } catch {
      // The table is playable without a profile; it just cannot gate stakes.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  // An unloaded wallet is an empty one (toArcadeWallet never fails open), so
  // every gate below is closed for the length of one fetch. That is the right
  // default, but it must not be *worded* as a verdict -- "Not enough Gold"
  // before the balance has arrived is simply untrue.
  const cover = canCoverStake(stake, wallet);
  const live = round && round.phase !== "settled";
  const actions = round ? legalBlackjackActions(round) : { hit: false, stand: false, double: false };

  const settleInto = (next: BlackjackRound, previous: BlackjackRound) => {
    setRound(next);
    if (next.phase === "settled" && previous.phase !== "settled") {
      setSessionNet((total) => total + next.netGold);
      setHandsPlayed((count) => count + 1);
    }
  };

  const deal = () => {
    if (!cover.open) return;
    const next = dealRound(stake, browserRandomInt);
    setRound(next);
    // A natural settles inside dealRound, so it has to score here too.
    if (next.phase === "settled") {
      setSessionNet((total) => total + next.netGold);
      setHandsPlayed((count) => count + 1);
    }
  };

  const act = (move: (current: BlackjackRound) => BlackjackRound) => {
    if (!round) return;
    settleInto(move(round), round);
  };

  const dealerCards = round ? dealerUpCards(round) : [];
  const dealerTotal = round ? handTotal(dealerCards) : null;
  const playerTotal = round ? handTotal(round.playerHand) : null;

  return (
    <main className="bj-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/">← Back to the lobby</Link>
          <h1>Blackjack 21</h1>
          <p>Dealer stands on soft 17 · Blackjack pays 3:2</p>
        </div>
        <div className="bj-header-meters">
          <span className="bj-meter">
            <small>Your Gold</small>
            <span className="gold-balance">
              <Coins size={13} aria-hidden="true" />
              <strong>
                {!loaded ? "—" : wallet.unlimitedGold ? "Unlimited" : wallet.goldBalance.toLocaleString()}
              </strong>
            </span>
          </span>
          <span className={clsx("bj-meter", sessionNet > 0 && "bj-meter-up", sessionNet < 0 && "bj-meter-down")}>
            <small>Session</small>
            <strong>{sessionNet > 0 ? `+${sessionNet.toLocaleString()}` : sessionNet.toLocaleString()}</strong>
          </span>
          <span className="bj-meter">
            <small>Hands</small>
            <strong>{handsPlayed}</strong>
          </span>
        </div>
      </header>

      {/* Said once, plainly, rather than buried: this table does not move real
          Gold, and pretending otherwise would be the dishonest option. */}
      <p className="bj-practice-note">
        Practice table — rounds are dealt in your browser, so nothing is staked against your real
        balance yet. Your Gold sets which stakes you can sit at.
      </p>

      <section className="bj-felt" aria-live="polite">
        <Hand
          label="Dealer"
          cards={dealerCards}
          total={dealerTotal ? `${dealerTotal.total}${dealerTotal.soft ? " soft" : ""}` : ""}
          hideTotal={!round}
          faceDown={Boolean(live)}
        />

        <div className="bj-verdict">
          {round?.outcome
            ? (
              <span
                className={clsx(
                  "bj-verdict-chip",
                  round.netGold > 0 && "bj-verdict-win",
                  round.netGold < 0 && "bj-verdict-loss",
                )}
              >
                {outcomeLabel(round.outcome)}
                <em>
                  {round.netGold > 0 ? `+${round.netGold.toLocaleString()}`
                    : round.netGold < 0 ? round.netGold.toLocaleString()
                      : "Stake returned"}
                </em>
              </span>
            )
            : <span className="bj-verdict-idle">{round ? "Your move" : "Pick a stake and deal"}</span>}
        </div>

        <Hand
          label={round?.doubled ? "You · doubled" : "You"}
          cards={round?.playerHand ?? []}
          total={playerTotal ? `${playerTotal.total}${playerTotal.soft ? " soft" : ""}` : ""}
          hideTotal={!round}
        />
      </section>

      <section className="bj-controls">
        <div className="bj-stakes" role="group" aria-label="Stake">
          {STAKES_TIERS.map((entry) => {
            const affordable = canCoverStake(TIER_CONFIG[entry].minBuyIn, wallet).open;
            return (
              <button
                key={entry}
                type="button"
                className={clsx("bj-stake", entry === tier && "bj-stake-on")}
                // Locked mid-round: the wager is already committed.
                disabled={Boolean(live) || !loaded || !affordable}
                title={!loaded || affordable ? undefined : "More Gold needed for this stake"}
                onClick={() => setTier(entry)}
              >
                {TIER_CONFIG[entry].label}
              </button>
            );
          })}
        </div>

        <div className="bj-actions">
          {live
            ? (
              <>
                <button type="button" className="bj-action" disabled={!actions.hit} onClick={() => act(hit)}>
                  Hit
                </button>
                <button type="button" className="bj-action" disabled={!actions.stand} onClick={() => act(stand)}>
                  Stand
                </button>
                <button
                  type="button"
                  className="bj-action"
                  // Two gates, not one: the engine says whether doubling is
                  // legal on this hand, the wallet says whether the doubled
                  // stake is covered.
                  disabled={!actions.double || !cover.double}
                  title={!cover.double && actions.double ? "Not enough Gold to double" : undefined}
                  onClick={() => act(doubleDown)}
                >
                  Double
                </button>
              </>
            )
            : (
              <button
                type="button"
                className="bj-action bj-action-deal"
                disabled={!loaded || !cover.open}
                onClick={deal}
              >
                {!loaded
                  ? "Loading your Gold…"
                  : !cover.open
                    ? "Not enough Gold"
                    : round ? "Deal again" : `Deal · ${stake.toLocaleString()}`}
              </button>
            )}
        </div>
      </section>
    </main>
  );
}

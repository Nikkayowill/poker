"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { PlayingCard } from "@/components/table/playing-card";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { DealerAvatar } from "@/components/arcade/dealer-avatar";
import { DEALER_NAME, dealerLine } from "@/lib/arcade/dealer";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { Card } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { toArcadeWallet } from "@/lib/arcade/games";
import {
  canCoverStake,
  handTotal,
  outcomeLabel,
  type BlackjackSnapshot,
} from "@/lib/arcade/blackjack";

/**
 * Blackjack 21.
 *
 * The rules live in lib/arcade/blackjack.ts and the round lives on the
 * server. This file is the felt: it holds one snapshot and replaces it
 * wholesale with whatever the API returns, because every action is a request
 * and the response is the new truth.
 *
 * Nothing is dealt or decided here any more. The client cannot see the
 * undealt deck (the snapshot has no `deck` field to see) and cannot see the
 * dealer's hole card until the dealer's turn, so it also cannot report a
 * result -- which is what makes it safe for this table to settle real Gold.
 * Every button below is a hint about what the server will accept, never a
 * decision; `snapshot.legal` is computed from the same engine call the route
 * re-runs before it moves anything.
 */

interface BlackjackResponse {
  round: BlackjackSnapshot | null;
  profile: PlayerProfile;
}

function Hand({
  cards,
  label,
  total,
  hideTotal = false,
  faceDown = false,
  avatar,
  caption,
  cardBack,
}: {
  cards: Card[];
  label: string;
  total: string;
  hideTotal?: boolean;
  /** Draws the dealer's hole card while it is still hidden. */
  faceDown?: boolean;
  /** Whose hand this is: the house dealer, or the player wearing their equipped avatar. */
  avatar?: ReactNode;
  /** A line under the name -- the dealer's patter. */
  caption?: string;
  /**
   * The player's equipped card-back cosmetic, for the one face-down card at
   * this table. Undefined resolves to the house deck inside PlayingCard.
   */
  cardBack?: string | null;
}) {
  return (
    <div className="bj-hand">
      <div className="bj-hand-head">
        {avatar}
        <span className="bj-hand-who">
          <span className="bj-hand-label">{label}</span>
          {caption && <span className="bj-hand-caption">{caption}</span>}
        </span>
        {!hideTotal && <span className="bj-hand-total">{total}</span>}
      </div>
      {/* PlayingCard is reused as-is rather than restyled: .card-large is
          already the felt's dominant card size, and the deal stagger is done
          with nth-child in CSS so no per-card prop is needed. */}
      <div className="bj-cards">
        {cards.map((card) => (
          <PlayingCard key={`${card.rank}-${card.suit}`} card={card} large />
        ))}
        {faceDown && <PlayingCard card={null} large back={cardBack} />}
      </div>
    </div>
  );
}

export function BlackjackTable() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tier, setTier] = useState<StakesTier>("1k");
  const [round, setRound] = useState<BlackjackSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionNet, setSessionNet] = useState(0);
  const [handsPlayed, setHandsPlayed] = useState(0);
  /**
   * Which round ids have already been added to the session tally. Scoring on
   * "the snapshot says settled" alone would double-count every time a settled
   * round came back twice -- which a resume after a refresh does by design.
   */
  const scored = useRef<Set<string>>(new Set());

  const absorb = useCallback((next: BlackjackSnapshot | null) => {
    setRound(next);
    if (!next || next.phase !== "settled" || scored.current.has(next.id)) return;
    scored.current.add(next.id);
    setSessionNet((total) => total + next.netGold);
    setHandsPlayed((count) => count + 1);
  }, []);

  /**
   * One request path for all three verbs. Errors are shown rather than
   * swallowed -- this table moves real Gold now, so "nothing happened" is not
   * an acceptable thing for a click to mean. A 409 carries the true round, so
   * a client that fell behind resyncs from the error instead of staying stuck.
   */
  const send = useCallback(
    async (url: string, body?: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          cache: "no-store",
          ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        });
        const data = (await response.json()) as Partial<BlackjackResponse> & { error?: string };
        if (data.profile) setProfile(data.profile);
        if (!response.ok) {
          setError(data.error ?? "That did not go through. Try again.");
          if (data.round !== undefined) absorb(data.round);
          return;
        }
        absorb(data.round ?? null);
      } catch {
        setError("Could not reach the table. Check your connection.");
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [absorb],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void send("/api/arcade/blackjack"), 0);
    return () => window.clearTimeout(timer);
  }, [send]);

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  // An unloaded wallet is an empty one (toArcadeWallet never fails open), so
  // every gate below is closed for the length of one fetch. That is the right
  // default, but it must not be *worded* as a verdict -- "Not enough Gold"
  // before the balance has arrived is simply untrue.
  const cover = canCoverStake(stake, wallet);
  const live = Boolean(round && round.phase !== "settled");
  const actions = round?.legal ?? { hit: false, stand: false, double: false };
  // The opening wager is already debited, so doubling needs one more of it in
  // the wallet -- not two.
  const canAffordDouble = round ? canCoverStake(round.baseStake, wallet).open : false;

  const deal = () => {
    if (!cover.open || busy) return;
    void send("/api/arcade/blackjack", { tier });
  };

  const act = (action: "hit" | "stand" | "double") => {
    if (!round || busy) return;
    void send("/api/arcade/blackjack/actions", {
      roundId: round.id,
      version: round.version,
      action,
    });
  };

  const dealerCards = round?.dealerHand ?? [];
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

      {/* Said once, plainly, rather than buried -- this table stakes real
          Gold, and a player deserves to know that before the first click. */}
      <p className="bj-practice-note">
        Rounds are dealt on the server and settled against your real balance. Your stake leaves your
        Gold when the hand is dealt and any winnings are paid when it finishes.
      </p>

      {error && <p className="bj-error" role="alert">{error}</p>}

      <section className="bj-felt" aria-live="polite" aria-busy={busy}>
        <Hand
          label={DEALER_NAME}
          caption={dealerLine(round?.phase ?? null, round?.outcome ?? null)}
          avatar={<DealerAvatar />}
          cards={dealerCards}
          total={dealerTotal ? `${dealerTotal.total}${dealerTotal.soft ? " soft" : ""}` : ""}
          hideTotal={!round}
          faceDown={Boolean(round?.dealerHoleHidden)}
          // The hole card is the one back anyone sees at this table, so it is
          // the player's own -- a cosmetic sold as "seen by the whole table"
          // that the arcade drew as the house deck would be the same defect
          // PlayingCard's `back` prop was added to fix.
          cardBack={profile?.equipped.cardBack}
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
          // The player's own name, not "You" -- they are wearing their avatar
          // and their card back here, and a generic label beside a face they
          // chose reads as somebody else's seat.
          label={profile?.displayName ?? "You"}
          caption={round?.doubled ? "Doubled" : undefined}
          avatar={
            profile
              ? <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />
              : undefined
          }
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
                disabled={live || busy || !loaded || !affordable}
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
                <button type="button" className="bj-action" disabled={!actions.hit || busy} onClick={() => act("hit")}>
                  Hit
                </button>
                <button type="button" className="bj-action" disabled={!actions.stand || busy} onClick={() => act("stand")}>
                  Stand
                </button>
                <button
                  type="button"
                  className="bj-action"
                  // Two gates, not one: the server says whether doubling is
                  // legal on this hand, the wallet says whether the second
                  // wager is covered. The route re-checks both.
                  disabled={!actions.double || !canAffordDouble || busy}
                  title={!canAffordDouble && actions.double ? "Not enough Gold to double" : undefined}
                  onClick={() => act("double")}
                >
                  Double
                </button>
              </>
            )
            : (
              <button
                type="button"
                className="bj-action bj-action-deal"
                disabled={!loaded || !cover.open || busy}
                onClick={deal}
              >
                {!loaded
                  ? "Loading your Gold…"
                  : busy
                    ? "Dealing…"
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

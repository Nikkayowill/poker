"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { PlayingCard } from "@/components/table/playing-card";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { DealerStage } from "@/components/arcade/dealer-stage";
import { DEALER_NAME, TIP_LINE, dealerLine } from "@/lib/arcade/dealer";
import { dealerExpression } from "@/lib/arcade/dealer-scene";
import { TIP_AMOUNTS, shouldOfferTip, type TipAmount } from "@/lib/arcade/tipping";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { Card } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { toArcadeWallet } from "@/lib/arcade/games";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
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

/*
 * DealerStage is a plain import now.
 *
 * It used to be behind next/dynamic with `ssr: false`, because it was a
 * three.js scene and three is ~350KB of JavaScript that a lobby, a landing
 * page and eight other arcade boards had no use for. It is four positioned 2D
 * layers today -- no renderer, no GPU context, nothing for the server to
 * choke on -- so the split bought nothing except a frame of empty felt on
 * every page load. three.js left the dependency tree with the old scene; this
 * route was its only importer.
 */

interface TipResponse {
  profile: PlayerProfile;
  thanks: string;
}

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
  // Applies the player's stored mute on a route where PokerApp is not
  // mounted. The flag it sets is module-global, which is what lets the JSX
  // below call the chrome cues directly. See lib/audio/ui-sounds.ts.
  useArcadeSound();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tier, setTier] = useState<StakesTier>("1k");
  const [round, setRound] = useState<BlackjackSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionNet, setSessionNet] = useState(0);
  const [handsPlayed, setHandsPlayed] = useState(0);
  /**
   * The tip jar's cadence, which is client state on purpose.
   *
   * How often the pair ask is presentation and costs nothing if a refresh
   * forgets it; how much Gold actually left the wallet is not, and lives
   * server-side in lib/server/tip-service.ts. `resolvedAtHand` carries no
   * record of WHICH way an offer was resolved, because asking a payer back
   * sooner than a refuser is how a tip jar turns into a dark pattern -- see
   * lib/arcade/tipping.ts.
   */
  const [tipResolvedAtHand, setTipResolvedAtHand] = useState<number | null>(null);
  const [tipThanks, setTipThanks] = useState<string | null>(null);
  const [tipping, setTipping] = useState(false);
  /**
   * Which round ids have already been added to the session tally. Scoring on
   * "the snapshot says settled" alone would double-count every time a settled
   * round came back twice -- which a resume after a refresh does by design.
   */
  const scored = useRef<Set<string>>(new Set());

  /**
   * Tally settled hands as a reaction to the round changing, not inside the
   * fetch path. A ref belongs in an effect rather than in a chain reachable
   * from a click handler, and every path that can produce a settled hand -- an
   * action, a resume, a 409 carrying the true state -- goes through `round`,
   * so there is one place to get this right instead of three. Kept identical
   * to the Hi-Lo table's, since the two are read side by side.
   */
  useEffect(() => {
    if (!round || round.phase !== "settled" || scored.current.has(round.id)) return;
    scored.current.add(round.id);
    setSessionNet((total) => total + round.netGold);
    setHandsPlayed((count) => count + 1);
  }, [round]);

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
          if (data.round !== undefined) setRound(data.round);
          return;
        }
        setRound(data.round ?? null);
      } catch {
        setError("Could not reach the table. Check your connection.");
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [],
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

  /**
   * Tipping the pair. A pure sink -- the Gold leaves and nothing comes back
   * but XP and a thank-you, which is exactly what a tip is.
   *
   * `setTipResolvedAtHand` runs in `finally`, so a failed tip still starts the
   * cooldown: the alternative is a bubble that re-offers immediately after an
   * error and nags hardest at the player it just failed.
   */
  const tip = async (amount: TipAmount) => {
    if (tipping) return;
    setTipping(true);
    setError(null);
    try {
      const response = await fetch("/api/arcade/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = (await response.json()) as Partial<TipResponse> & { error?: string };
      if (data.profile) setProfile(data.profile);
      if (!response.ok) {
        setError(data.error ?? "That tip did not go through.");
        return;
      }
      setTipThanks(data.thanks ?? null);
    } catch {
      setError("Could not reach the table. Check your connection.");
    } finally {
      setTipping(false);
      setTipResolvedAtHand(handsPlayed);
    }
  };

  // The thanks is a beat, not a state: it clears itself so the bubble does not
  // sit on the felt for the rest of the session.
  useEffect(() => {
    if (!tipThanks) return;
    const timer = window.setTimeout(() => setTipThanks(null), 4000);
    return () => window.clearTimeout(timer);
  }, [tipThanks]);

  const offeringTip = shouldOfferTip({
    handsPlayed,
    resolvedAtHand: tipResolvedAtHand,
    roundLive: live,
  });

  /**
   * Which face the pair are wearing.
   *
   * A tip overrides the round's own expression, and outranking it is the
   * point: being thanked is the one moment the dogs are reacting to the
   * PLAYER rather than to the cards.
   */
  const expression = tipThanks
    ? "cheer"
    : dealerExpression(round?.phase ?? null, round?.outcome ?? null);

  const dealerCards = round?.dealerHand ?? [];
  const dealerTotal = round ? handTotal(dealerCards) : null;
  const playerTotal = round ? handTotal(round.playerHand) : null;

  return (
    <main className="bj-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/" onClick={tapSound}>← Back to the lobby</Link>
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
        {/*
         * The room: casino, cloth and the pair, as layers behind the cards.
         *
         * Not a panel dropped into the top of the felt -- these are grid
         * children of this section, and the boundary between its two rows is
         * the table's rail. See app/styles/23-blackjack.css.
         */}
        <DealerStage
          expression={expression}
          bubble={
            tipThanks
              ? (
                <div className="bj-bubble">
                  <span className="bj-bubble-line">{tipThanks}</span>
                </div>
              )
              : offeringTip
                ? (
                  <div className="bj-bubble">
                    <span className="bj-bubble-line">{TIP_LINE}</span>
                    <span className="bj-tip-amounts">
                      {TIP_AMOUNTS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className="bj-tip-amount"
                          // The wallet gate is a courtesy that produces a
                          // better disabled state; spendGold on the server is
                          // the authority, and a stale balance here cannot let
                          // an unaffordable tip through.
                          disabled={
                            tipping
                            || (!wallet.unlimitedGold && wallet.goldBalance < amount)
                          }
                          onClick={() => { selectSound(); void tip(amount); }}
                        >
                          {amount}
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      className="bj-tip-dismiss"
                      aria-label="Not now"
                      // Waving them away resolves the offer exactly as paying
                      // does, and buys exactly the same quiet.
                      onClick={() => { tapSound(); setTipResolvedAtHand(handsPlayed); }}
                    >
                      ×
                    </button>
                  </div>
                )
                : null
          }
        />

        <div className="bj-play">
        {/*
         * No avatar on this hand.
         *
         * It used to carry a 34px <DealerAvatar />, which meant the page drew
         * Loki and Finn TWICE -- once in the stage above, once again forty
         * pixels below in a different art style, both labelled "Loki & Finn".
         * That duplication was most of what made the stage read as a
         * television rather than a table. The pair are in the room now; this
         * row is just their hand.
         */}
        <Hand
          label={DEALER_NAME}
          caption={dealerLine(round?.phase ?? null, round?.outcome ?? null)}
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
              ? <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
              : undefined
          }
          cards={round?.playerHand ?? []}
          total={playerTotal ? `${playerTotal.total}${playerTotal.soft ? " soft" : ""}` : ""}
          hideTotal={!round}
        />
        </div>
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
                onClick={() => { selectSound(); setTier(entry); }}
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
                <button type="button" className="bj-action" disabled={!actions.hit || busy} onClick={() => { selectSound(); act("hit"); }}>
                  Hit
                </button>
                <button type="button" className="bj-action" disabled={!actions.stand || busy} onClick={() => { selectSound(); act("stand"); }}>
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
                  onClick={() => { selectSound(); act("double"); }}
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
                onClick={() => { selectSound(); void deal(); }}
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

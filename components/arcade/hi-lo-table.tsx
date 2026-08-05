"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Coins } from "lucide-react";
import { PlayingCard } from "@/components/table/playing-card";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { DealerAvatar } from "@/components/arcade/dealer-avatar";
import { DEALER_NAME } from "@/lib/arcade/dealer";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import { toArcadeWallet } from "@/lib/arcade/games";
import { canCoverStake } from "@/lib/arcade/blackjack";
import { hiLoOutcomeLabel, type HiLoCall, type HiLoSnapshot } from "@/lib/arcade/hi-lo";

/**
 * Hi-Lo.
 *
 * The rules live in lib/arcade/hi-lo.ts and the round lives on the server.
 * This file is the felt: it holds one snapshot and replaces it wholesale with
 * whatever the API returns, because every action is a request and the
 * response is the new truth.
 *
 * The client cannot see the deck -- the snapshot has no `deck` field -- which
 * matters more here than at blackjack, since the single card that decides the
 * round is sitting on top of it. Every button is a hint about what the server
 * will accept; `snapshot.legal` comes from the same engine call the route
 * re-runs before it moves any Gold.
 *
 * The quoted odds are shown ON the buttons, before the call. They are derived
 * from the face-up card, so the player can see exactly what they are being
 * offered and check it against the card themselves.
 */

interface HiLoResponse {
  round: HiLoSnapshot | null;
  profile: PlayerProfile;
}

/** "1.91x" -- what a winning call returns per Gold staked, stake included. */
function payoutLabel(multiplier: number): string {
  return `${(1 + multiplier).toFixed(2)}x`;
}

export function HiLoTable() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tier, setTier] = useState<StakesTier>("1k");
  const [round, setRound] = useState<HiLoSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionNet, setSessionNet] = useState(0);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  /** Round ids already added to the tally -- a resume re-delivers a settled round by design. */
  const scored = useRef<Set<string>>(new Set());

  /**
   * Tally settled rounds as a reaction to the round changing, not inside the
   * fetch path. Two reasons: a ref belongs in an effect rather than in a
   * chain reachable from a click handler (react-hooks/refs is right to flag
   * that), and every path that can produce a settled round -- a call, a
   * resume, a 409 carrying the true state -- goes through `round`, so there is
   * one place to get this right instead of three.
   */
  useEffect(() => {
    if (!round || round.phase !== "settled" || scored.current.has(round.id)) return;
    scored.current.add(round.id);
    setSessionNet((total) => total + round.netGold);
    setRoundsPlayed((count) => count + 1);
  }, [round]);

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
        const data = (await response.json()) as Partial<HiLoResponse> & { error?: string };
        if (data.profile) setProfile(data.profile);
        if (!response.ok) {
          setError(data.error ?? "That did not go through. Try again.");
          // A 409 carries the true round, so a client that fell behind
          // resyncs from the error rather than staying stuck.
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
    const timer = window.setTimeout(() => void send("/api/arcade/hi-lo"), 0);
    return () => window.clearTimeout(timer);
  }, [send]);

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  // An unloaded wallet is an empty one (toArcadeWallet never fails open), so
  // the gates stay closed for the length of one fetch -- correct, but it must
  // not be *worded* as a verdict before the balance has arrived.
  const cover = canCoverStake(stake, wallet);
  const live = Boolean(round && round.phase === "call");

  const deal = () => {
    if (!cover.open || busy) return;
    void send("/api/arcade/hi-lo", { tier });
  };

  const placeCall = (choice: HiLoCall) => {
    if (!round || busy) return;
    void send("/api/arcade/hi-lo/actions", { roundId: round.id, version: round.version, call: choice });
  };

  return (
    <main className="bj-shell">
      <header className="bj-header">
        <div className="bj-header-copy">
          <Link className="bj-back" href="/">← Back to the lobby</Link>
          <h1>Hi-Lo</h1>
          <p>One card, one call · Odds priced off the deck · Ties lose</p>
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
            <small>Rounds</small>
            <strong>{roundsPlayed}</strong>
          </span>
        </div>
      </header>

      {/* Two rules a player must not have to discover: the Gold is real, and a
          tie goes to the house. The second is load-bearing on the odds -- see
          the note at the top of lib/arcade/hi-lo.ts. */}
      <p className="bj-practice-note">
        Rounds are dealt on the server and settled against your real balance. A tie counts as a loss,
        which is what lets even the safest call pay something — the price of each call is shown on its
        button before you commit.
      </p>

      {error && <p className="bj-error" role="alert">{error}</p>}

      <section className="bj-felt" aria-live="polite" aria-busy={busy}>
        <div className="bj-hand-head hl-dealer-head">
          <DealerAvatar />
          <span className="bj-hand-who">
            <span className="bj-hand-label">{DEALER_NAME}</span>
            <span className="bj-hand-caption">
              {!round ? "Pick a stake." : live ? "Higher, or lower?" : "Next card?"}
            </span>
          </span>
        </div>

        <div className="hl-cards">
          <div className="hl-slot">
            <span className="hl-slot-label">Face up</span>
            <PlayingCard card={round?.baseCard ?? null} large back={profile?.equipped.cardBack} />
          </div>
          <div className="hl-slot">
            <span className="hl-slot-label">{round?.drawnCard ? "Drawn" : "Next"}</span>
            {/* Before the call this is a back, not a ghost: there really is a
                card there, the player just cannot see it. */}
            <PlayingCard card={round?.drawnCard ?? null} large back={profile?.equipped.cardBack} />
          </div>
        </div>

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
                {hiLoOutcomeLabel(round.outcome)}
                <em>
                  {round.netGold > 0
                    ? `+${round.netGold.toLocaleString()}`
                    : round.netGold.toLocaleString()}
                </em>
              </span>
            )
            : <span className="bj-verdict-idle">{live ? "Your call" : "Pick a stake and deal"}</span>}
        </div>

        {profile && (
          <div className="bj-hand-head hl-player-head">
            <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />
            <span className="bj-hand-who">
              <span className="bj-hand-label">{profile.displayName}</span>
              {round && <span className="bj-hand-caption">Staked {round.stake.toLocaleString()}</span>}
            </span>
          </div>
        )}
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
          {live && round
            ? (["higher", "lower"] as HiLoCall[]).map((choice) => {
              const side = round.odds[choice];
              return (
                <button
                  key={choice}
                  type="button"
                  className={clsx("bj-action hl-call", `hl-call-${choice}`)}
                  // Closed when no card can win it -- "lower" on a 2, "higher"
                  // on an ace. A button that can only take money is not a
                  // choice, so it is disabled rather than priced at zero.
                  disabled={!round.legal[choice] || busy}
                  title={round.legal[choice] ? undefined : `No card is ${choice} than this one`}
                  onClick={() => placeCall(choice)}
                >
                  <span className="hl-call-name">
                    {choice === "higher" ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {choice === "higher" ? "Higher" : "Lower"}
                  </span>
                  <span className="hl-call-odds">
                    {round.legal[choice] ? `${payoutLabel(side.multiplier)} · ${side.winners}/51` : "No card wins"}
                  </span>
                </button>
              );
            })
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

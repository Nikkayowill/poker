"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Crown, Landmark, TrendingUp } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { DealerAvatar } from "@/components/arcade/dealer-avatar";
import { DEALER_NAME } from "@/lib/arcade/dealer";
import {
  ArcadeError,
  ArcadeHeader,
  ArcadeHistoryStrip,
  ArcadeMeters,
  ArcadeSeat,
  ArcadeStakeNote,
  ArcadeVerdict,
  type HistoryChip,
} from "@/components/arcade/arcade-hud";
import { useCasinoMachine } from "@/components/arcade/use-casino-machine";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { toArcadeWallet } from "@/lib/arcade/games";
import { canCoverStake } from "@/lib/arcade/blackjack";
import {
  MAX_STREAK,
  coinFlipOutcomeLabel,
  type CoinFlipSnapshot,
  type CoinSide,
} from "@/lib/arcade/coin-flip";

/**
 * Coin Flip.
 *
 * One stake buys a run: call it, and every win offers the pot back with the
 * choice to take it or risk it again. The rules and the price live in
 * lib/arcade/coin-flip.ts; this is the coin and the ladder.
 *
 * ## The coin lands before the result is read out
 *
 * Same reveal discipline as the roulette wheel: the response already carries
 * the side that came up, so the verdict and the streak ladder are held behind
 * `revealed` until the flip animation finishes. The Gold is banked either way
 * -- this only decides the order a player finds out, and finding out from a
 * number before the coin has landed makes the coin a decoration.
 */

const FLIP_MS = 900;
/**
 * Module-level, not an inline arrow: the machine hook lists this in an effect's
 * dependencies, and a new closure every render would re-run that effect on
 * every render for no reason.
 */
const isSettledRound = (round: { phase: string }) => round.phase === "settled";


export function CoinFlipTable() {
  const machine = useCasinoMachine<CoinFlipSnapshot>({
    endpoint: "/api/arcade/coin-flip",
    isSettled: isSettledRound,
  });
  const { profile, round, loaded, busy } = machine;

  const [tier, setTier] = useState<StakesTier>("1k");
  /**
   * How many flips the coin has finished showing.
   *
   * A count rather than a boolean, and advanced only from the landing timer --
   * never synchronously from an effect. That is what lets `revealed` below be
   * derived instead of held, which in turn is what keeps a resume honest: a
   * refresh mid-flight replays the coin, and a refresh afterwards does not.
   */
  const [shownFlips, setShownFlips] = useState(0);

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  const cover = canCoverStake(stake, wallet);
  const calling = round?.phase === "call";
  const deciding = round?.phase === "decide";
  const live = calling || deciding;

  /**
   * A new flip is a growing `results` array -- not a phase change, since a win
   * and a miss both add one result and only one of them moves the phase.
   */
  const flips = round?.results.length ?? 0;
  const revealed = shownFlips >= flips;

  useEffect(() => {
    if (revealed) return;
    // Reduced motion lands it immediately rather than skipping the mechanism:
    // one code path, one place the count advances.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setShownFlips(flips), reduced ? 0 : FLIP_MS);
    return () => window.clearTimeout(timer);
  }, [flips, revealed]);

  const landed = round?.results[round.results.length - 1] ?? null;

  const buy = () => {
    if (!cover.open || busy || live) return;
    // A new run starts with an empty `results`, so the count has to come back
    // to zero with it or the first flip of the run would count as already shown.
    setShownFlips(0);
    machine.deal(tier);
  };

  const call = (side: CoinSide) => {
    if (!round || !live || busy || !revealed) return;
    machine.act(round, { move: { kind: "call", call: side } });
  };

  const bank = () => {
    if (!round || !deciding || busy || !revealed) return;
    machine.act(round, { move: { kind: "bank" } });
  };

  const history: HistoryChip[] = machine.history.map((entry) => ({
    key: entry.id,
    label: entry.banked ? `${entry.streak}✓` : `${entry.streak}✗`,
    tone: entry.netGold > 0 ? "win" : entry.netGold < 0 ? "loss" : "push",
  }));

  return (
    <main className="bj-shell cf-shell">
      <ArcadeHeader
        title="Coin Flip"
        rules={`Fair coin · Wins pay 1.97x · Ride up to ${MAX_STREAK}`}
      >
        <ArcadeMeters
          loaded={loaded}
          goldBalance={wallet.goldBalance}
          unlimitedGold={wallet.unlimitedGold}
          sessionNet={machine.sessionNet}
          roundsPlayed={machine.roundsPlayed}
          extra={round && live ? { label: "Riding", value: round.pot.toLocaleString() } : undefined}
        />
      </ArcadeHeader>

      <ArcadeStakeNote>
        The coin is a true 50/50 drawn on the server — the house takes its margin from the price, not
        from the coin, so a win pays 1.97 times the pot rather than double. One stake buys the whole run;
        a miss at any point takes it all, and {MAX_STREAK} wins banks itself.
      </ArcadeStakeNote>

      <ArcadeError message={machine.error} />

      <section className="bj-felt cf-felt" aria-live="polite" aria-busy={busy}>
        <ArcadeSeat
          className="cf-dealer-head"
          avatar={<DealerAvatar />}
          name={DEALER_NAME}
          caption={
            !round
              ? "Buy a run."
              : !revealed
                ? "In the air…"
                : deciding
                  ? "Take it, or ride?"
                  : calling
                    ? "Heads or tails?"
                    : "Again?"
          }
        />

        <div className={clsx("cf-coin-stage", !revealed && "cf-coin-flipping")}>
          <div
            className={clsx(
              "cf-coin",
              revealed && landed === "heads" && "cf-coin-heads",
              revealed && landed === "tails" && "cf-coin-tails",
            )}
          >
            <span className="cf-coin-face cf-coin-face-heads">
              <Crown size={26} aria-hidden="true" />
              <em>Heads</em>
            </span>
            <span className="cf-coin-face cf-coin-face-tails">
              <Landmark size={26} aria-hidden="true" />
              <em>Tails</em>
            </span>
          </div>
        </div>

        {/* The ladder. Every rung is what the pot would be worth there, so the
            decision to ride is priced before it is taken rather than after. */}
        <ol className="cf-ladder" aria-label="Streak">
          {Array.from({ length: MAX_STREAK }, (_, index) => index + 1).map((rung) => {
            const reached = revealed && (round?.streak ?? 0) >= rung;
            const next = revealed && round?.phase === "decide" && round.streak + 1 === rung;
            return (
              <li
                key={rung}
                className={clsx("cf-rung", reached && "cf-rung-on", next && "cf-rung-next")}
              >
                <span className="cf-rung-number">{rung}</span>
              </li>
            );
          })}
        </ol>

        <ArcadeVerdict
          label={round && revealed ? coinFlipOutcomeLabel(round) : null}
          netGold={round && revealed && round.phase === "settled" ? round.netGold : null}
          stake={round?.stake ?? stake}
          // A live run has no verdict yet, so the idle line is doing the work.
          // While deciding it must say what is actually on the table -- "Call
          // it" there is the wrong instruction and buries the streak the whole
          // decision turns on.
          idle={
            !revealed
              ? "…"
              : deciding && round
                ? `${round.streak} in a row · bank ${round.pot.toLocaleString()} or ride`
                : live
                  ? "Call it"
                  : "Buy a run"
          }
        />

        <ArcadeHistoryStrip items={history} empty="No runs yet" />

        {profile && (
          <ArcadeSeat
            className="cf-player-head"
            avatar={<ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />}
            name={profile.displayName}
            caption={round && live ? `Riding ${round.pot.toLocaleString()}` : undefined}
          />
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
                disabled={Boolean(live) || busy || !loaded || !affordable}
                title={!loaded || affordable ? undefined : "More Gold needed for this stake"}
                onClick={() => setTier(entry)}
              >
                {TIER_CONFIG[entry].label}
              </button>
            );
          })}
        </div>

        <div className="bj-actions">
          {live && round ? (
            <>
              {(["heads", "tails"] as CoinSide[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  className="bj-action hud-bet"
                  disabled={busy || !revealed}
                  onClick={() => call(side)}
                >
                  <span className="hud-bet-name">
                    {side === "heads" ? <Crown size={14} /> : <Landmark size={14} />}
                    {side === "heads" ? "Heads" : "Tails"}
                  </span>
                  <span className="hud-bet-odds">
                    {deciding ? `to ${round.potIfWon.toLocaleString()}` : "1.97x"}
                  </span>
                </button>
              ))}
              {deciding && (
                <button
                  type="button"
                  className="bj-action bj-action-deal hud-bet"
                  disabled={busy || !revealed}
                  onClick={bank}
                >
                  <span className="hud-bet-name">
                    <TrendingUp size={14} />
                    Bank
                  </span>
                  <span className="hud-bet-odds cf-bank-amount">{round.pot.toLocaleString()}</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="bj-action bj-action-deal"
              disabled={!loaded || !cover.open || busy || !revealed}
              onClick={buy}
            >
              {!loaded
                ? "Loading your Gold…"
                : !revealed
                  ? "…"
                  : busy
                    ? "Starting…"
                    : !cover.open
                      ? "Not enough Gold"
                      : round
                        ? "New run"
                        : `Start · ${stake.toLocaleString()}`}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

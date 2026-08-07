"use client";

import { useState } from "react";
import clsx from "clsx";
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
import { RouletteWheel } from "@/components/arcade/roulette-wheel";
import { useCasinoMachine } from "@/components/arcade/use-casino-machine";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { toArcadeWallet } from "@/lib/arcade/games";
import { canCoverStake } from "@/lib/arcade/blackjack";
import {
  POCKET_COUNT,
  ROULETTE_ODDS,
  betLabel,
  pocketColour,
  rouletteOutcomeLabel,
  winningPockets,
  type RouletteBet,
  type RouletteSnapshot,
} from "@/lib/arcade/roulette";

/**
 * Roulette.
 *
 * The wheel and the odds live in lib/arcade/roulette.ts; the round lives on
 * the server. This file is the layout: a grid of numbers, the outside bets
 * under it, and a canvas wheel that spins to the pocket the server drew.
 *
 * ## The reveal waits for the wheel
 *
 * The response to a spin already contains the winning number -- it has to,
 * since the same response carries the settled balance. So the verdict and the
 * marquee are held back behind `revealed` until the wheel actually stops.
 * Showing the number and then spinning a wheel toward it would make the
 * animation a re-enactment, which is the difference between a game and a
 * receipt. The Gold is already banked either way; this is about which order a
 * player finds out.
 */

/** Every number on the layout, 0 first and then the three columns. */
const STRAIGHT_POCKETS = Array.from({ length: POCKET_COUNT }, (_, index) => index);

/** The outside bets, in the order a real layout prints them. */
const OUTSIDE_BETS: readonly RouletteBet[] = [
  { kind: "dozen", dozen: 1 },
  { kind: "dozen", dozen: 2 },
  { kind: "dozen", dozen: 3 },
  { kind: "half", half: "low" },
  { kind: "parity", parity: "even" },
  { kind: "colour", colour: "red" },
  { kind: "colour", colour: "black" },
  { kind: "parity", parity: "odd" },
  { kind: "half", half: "high" },
  { kind: "column", column: 1 },
  { kind: "column", column: 2 },
  { kind: "column", column: 3 },
];

function sameBet(a: RouletteBet, b: RouletteBet | null): boolean {
  if (!b || a.kind !== b.kind) return false;
  // The union's payload is one key per kind, so comparing the serialised bet
  // is exact rather than a heuristic -- and it cannot go stale when a kind is
  // added, the way a hand-written switch would.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Module-level, not an inline arrow: the machine hook lists this in an effect's
 * dependencies, and a new closure every render would re-run that effect on
 * every render for no reason.
 */
const isSettledRound = (round: { phase: string }) => round.phase === "settled";

export function RouletteTable() {
  const machine = useCasinoMachine<RouletteSnapshot>({
    endpoint: "/api/arcade/roulette",
    isSettled: isSettledRound,
  });
  const { profile, round, loaded, busy } = machine;

  const [tier, setTier] = useState<StakesTier>("1k");
  const [bet, setBet] = useState<RouletteBet>({ kind: "colour", colour: "red" });
  /** The round whose wheel has finished turning. Set by the wheel, never by an effect. */
  const [spunRoundId, setSpunRoundId] = useState<string | null>(null);

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  const cover = canCoverStake(stake, wallet);
  const placed = round?.phase === "bet";
  const settled = round?.phase === "settled";

  /**
   * Whether the result is the player's to know yet.
   *
   * Derived rather than held: a round that has not settled has nothing to
   * reveal, and one that has is revealed exactly when its own wheel stopped.
   * Deriving it is what keeps the reveal correct on a resume -- a refresh
   * mid-spin replays the wheel for a result the player never saw, which is
   * right, and a refresh afterwards does not.
   */
  const revealed = !settled || spunRoundId === round.id;

  const place = () => {
    if (!cover.open || busy || placed) return;
    machine.deal(tier, { bet });
  };

  const spin = () => {
    if (!round || !placed || busy) return;
    machine.act(round, {});
  };

  const history: HistoryChip[] = machine.history
    .filter((entry) => entry.pocket !== null)
    // While the current wheel is still turning its result is not yet the
    // player's to know, so it is held out of the marquee too.
    .filter((entry) => revealed || entry.id !== round?.id)
    .map((entry) => ({
      key: entry.id,
      label: String(entry.pocket),
      tone: entry.won ? "win" : "loss",
      style: { color: "#f4efe2", background: pocketColour(entry.pocket!) === "red" ? "#a3232b" : pocketColour(entry.pocket!) === "black" ? "#17191c" : "#1c6b47" },
    }));

  return (
    <main className="bj-shell rl-shell">
      <ArcadeHeader title="Roulette" rules="European single zero · 37 pockets · One bet a spin">
        <ArcadeMeters
          loaded={loaded}
          goldBalance={wallet.goldBalance}
          unlimitedGold={wallet.unlimitedGold}
          sessionNet={machine.sessionNet}
          roundsPlayed={machine.roundsPlayed}
        />
      </ArcadeHeader>

      <ArcadeStakeNote>
        Spins are drawn on the server and settled against your real balance. There is one zero, not two —
        it is the only thing the house is paid for, and it takes every outside bet. Each bet quotes its own
        odds before you place it.
      </ArcadeStakeNote>

      <ArcadeError message={machine.error} />

      <section className="bj-felt hud-felt-plain rl-felt" aria-live="polite" aria-busy={busy}>
        <ArcadeSeat
          className="rl-dealer-head"
          avatar={<DealerAvatar />}
          name={DEALER_NAME}
          caption={
            !round
              ? "Place your bet."
              : placed
                ? "No more bets?"
                : revealed
                  ? "Again?"
                  : "Round and round…"
          }
        />

        <div className="rl-stage">
          <RouletteWheel
            className="rl-wheel"
            pocket={settled && round.pocket !== null ? round.pocket : null}
            // Re-checked inside the closure: the wheel only calls this after a
            // spin, but the round it belongs to can be gone by the time it
            // lands if the player navigated away and back.
            onSpinEnd={() => {
              if (round) setSpunRoundId(round.id);
            }}
          />

          <div className="rl-stage-copy">
            <span className="rl-stage-label">Your bet</span>
            <strong className="rl-stage-bet">{betLabel(bet)}</strong>
            <span className="rl-stage-odds">
              {ROULETTE_ODDS[bet.kind]} to 1 · {winningPockets(bet)} of {POCKET_COUNT}
            </span>
          </div>
        </div>

        <ArcadeVerdict
          label={settled && revealed ? rouletteOutcomeLabel(round) : null}
          netGold={settled && revealed ? round.netGold : null}
          stake={round?.stake ?? stake}
          idle={placed ? "Spin the wheel" : !revealed ? "…" : "Place a bet"}
        />

        <ArcadeHistoryStrip items={history} empty="No spins yet" />

        {profile && (
          <ArcadeSeat
            className="rl-player-head"
            avatar={<ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />}
            name={profile.displayName}
            caption={round ? `${betLabel(round.bet)} · ${round.stake.toLocaleString()}` : undefined}
          />
        )}
      </section>

      <section className="rl-layout" role="group" aria-label="Betting layout">
        <div className="rl-numbers">
          {STRAIGHT_POCKETS.map((pocket) => {
            const candidate: RouletteBet = { kind: "straight", pocket };
            return (
              <button
                key={pocket}
                type="button"
                className={clsx(
                  "rl-number",
                  `rl-number-${pocketColour(pocket)}`,
                  pocket === 0 && "rl-number-zero",
                  sameBet(candidate, bet) && "rl-number-on",
                )}
                // Locked once a chip is down: the wager is committed and the
                // layout must not imply otherwise.
                disabled={placed || busy}
                aria-pressed={sameBet(candidate, bet)}
                onClick={() => setBet(candidate)}
              >
                {pocket}
              </button>
            );
          })}
        </div>

        <div className="rl-outside">
          {OUTSIDE_BETS.map((candidate) => (
            <button
              key={betLabel(candidate)}
              type="button"
              className={clsx("rl-outside-bet", sameBet(candidate, bet) && "rl-outside-on")}
              disabled={placed || busy}
              aria-pressed={sameBet(candidate, bet)}
              onClick={() => setBet(candidate)}
            >
              <span>{betLabel(candidate)}</span>
              <em>{ROULETTE_ODDS[candidate.kind]}:1</em>
            </button>
          ))}
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
                disabled={placed || busy || !loaded || !affordable}
                title={!loaded || affordable ? undefined : "More Gold needed for this stake"}
                onClick={() => setTier(entry)}
              >
                {TIER_CONFIG[entry].label}
              </button>
            );
          })}
        </div>

        <div className="bj-actions">
          {placed ? (
            <button type="button" className="bj-action bj-action-deal" disabled={busy} onClick={spin}>
              {busy ? "Spinning…" : "Spin"}
            </button>
          ) : (
            <button
              type="button"
              className="bj-action bj-action-deal"
              disabled={!loaded || !cover.open || busy || !revealed}
              onClick={place}
            >
              {!loaded
                ? "Loading your Gold…"
                : !revealed
                  ? "…"
                  : busy
                    ? "Placing…"
                    : !cover.open
                      ? "Not enough Gold"
                      : `Place ${stake.toLocaleString()} on ${betLabel(bet)}`}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

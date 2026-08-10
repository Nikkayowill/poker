"use client";

import { useState } from "react";
import clsx from "clsx";
import { PlayingCard } from "@/components/table/playing-card";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { DealerAvatar } from "@/components/arcade/dealer-avatar";
import { DEALER_NAME } from "@/lib/arcade/dealer";
import {
  ArcadeError,
  ArcadeHeader,
  ArcadeMeters,
  ArcadeSeat,
  ArcadeStakeNote,
  ArcadeVerdict,
} from "@/components/arcade/arcade-hud";
import { useCasinoMachine } from "@/components/arcade/use-casino-machine";
import { STAKES_TIERS, TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { toArcadeWallet } from "@/lib/arcade/games";
import { canCoverStake } from "@/lib/arcade/blackjack";
import {
  baccaratOutcomeLabel,
  sideLabel,
  sideOdds,
  type BaccaratSide,
  type BaccaratSnapshot,
} from "@/lib/arcade/baccarat";

/**
 * Baccarat.
 *
 * The tableau lives in lib/arcade/baccarat.ts and the coup lives on the
 * server. This file is the felt: two hands, three bets, and the bead plate.
 *
 * ## The bead plate is the reason people sit at this table
 *
 * Baccarat players track results obsessively -- the road maps are as much a
 * part of the game as the cards. The grid here is the simplest of them: one
 * bead per coup, newest last, colour by winning side, filling top-to-bottom
 * then across, exactly as it is drawn on a real board.
 *
 * It is worth being clear-eyed about what it is. Every coup is independent and
 * the roads predict nothing; the bead plate is pattern, not information. It is
 * built purely from results the player has already been shown this session, so
 * it cannot carry anything the round did not -- and it never claims to be a
 * signal.
 */

const SIDES: readonly BaccaratSide[] = ["player", "banker", "tie"];

/** Rows in the bead plate, as on a real board. Six, filling down then across. */
const BEAD_ROWS = 6;
const BEAD_COLUMNS = 8;

/**
 * Module-level, not an inline arrow: the machine hook lists this in an effect's
 * dependencies, and a new closure every render would re-run that effect on
 * every render for no reason.
 */
const isSettledRound = (round: { phase: string }) => round.phase === "settled";

export function BaccaratTable() {
  const machine = useCasinoMachine<BaccaratSnapshot>({
    endpoint: "/api/arcade/baccarat",
    isSettled: isSettledRound,
  });
  const { profile, round, loaded, busy } = machine;

  // The bottom rung, like every other machine. This opened on "5k" while a
  // new profile carries 2,000 Gold, so the first thing a player saw on this
  // page was a dead "Not enough Gold" button with nothing on screen saying
  // the cheaper stake beside it would have worked.
  const [tier, setTier] = useState<StakesTier>("1k");
  const [bet, setBet] = useState<BaccaratSide>("banker");

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  const cover = canCoverStake(stake, wallet);
  const placed = round?.phase === "bet";
  const settled = round?.phase === "settled";

  const place = () => {
    if (!cover.open || busy || placed) return;
    machine.deal(tier, { bet });
  };

  const deal = () => {
    if (!round || !placed || busy) return;
    machine.act(round, {});
  };

  // Oldest first, which is the direction a bead plate is read and the reverse
  // of the order the machine keeps its history in.
  const beads = [...machine.history].reverse().slice(-(BEAD_ROWS * BEAD_COLUMNS));

  return (
    <main className="bj-shell bc-shell">
      <ArcadeHeader
        title="Baccarat"
        rules="Punto banco · 8 decks · Banker pays 0.95 · Tie pays 9"
      >
        <ArcadeMeters
          loaded={loaded}
          goldBalance={wallet.goldBalance}
          unlimitedGold={wallet.unlimitedGold}
          sessionNet={machine.sessionNet}
          roundsPlayed={machine.roundsPlayed}
        />
      </ArcadeHeader>

      <ArcadeStakeNote>
        Coups are dealt on the server and settled against your real balance. Nobody draws by choice — the
        third-card tableau decides every card once the bet is down. Banker wins slightly more often, so it
        pays 0.95 rather than even money; a tie returns a player or banker stake rather than taking it.
      </ArcadeStakeNote>

      <ArcadeError message={machine.error} />

      <section className="bj-felt hud-felt-plain bc-felt" aria-live="polite" aria-busy={busy}>
        <ArcadeSeat
          className="bc-dealer-head"
          avatar={<DealerAvatar />}
          name={DEALER_NAME}
          caption={!round ? "Back a side." : placed ? "No more bets?" : "Another coup?"}
        />

        <div className="bc-hands">
          {(["player", "banker"] as const).map((side) => {
            const cards = side === "player" ? round?.playerHand : round?.bankerHand;
            const total = side === "player" ? round?.playerTotal : round?.bankerTotal;
            return (
              <div
                key={side}
                className={clsx(
                  "bc-hand",
                  `bc-hand-${side}`,
                  settled && round.result === side && "bc-hand-won",
                  round?.bet === side && "bc-hand-backed",
                )}
              >
                <span className="bc-hand-head">
                  <span className="bj-hand-label">{sideLabel(side)}</span>
                  <span className="bj-hand-total">{settled ? total : "—"}</span>
                </span>
                <div className="bc-cards">
                  {(cards?.length ? cards : [null, null]).map((card, index) => (
                    <PlayingCard key={index} card={card} back={profile?.equipped.cardBack} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <ArcadeVerdict
          label={settled ? baccaratOutcomeLabel(round) : null}
          netGold={settled ? round.netGold : null}
          stake={round?.stake ?? stake}
          idle={placed ? "Deal the coup" : "Back a side"}
        />

        {/* The bead plate. Pattern, not prediction -- see the note above. */}
        <div className="bc-road" aria-label="Recent coups">
          {beads.length === 0 ? (
            <span className="hud-history-empty">No coups yet</span>
          ) : (
            beads.map((entry) => (
              <span
                key={entry.id}
                className={clsx("bc-bead", entry.result && `bc-bead-${entry.result}`)}
                title={baccaratOutcomeLabel(entry)}
              >
                {entry.result === "player" ? "P" : entry.result === "banker" ? "B" : "T"}
              </span>
            ))
          )}
        </div>

        {profile && (
          <ArcadeSeat
            className="bc-player-head"
            avatar={<ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />}
            name={profile.displayName}
            caption={round ? `${sideLabel(round.bet)} · ${round.stake.toLocaleString()}` : undefined}
          />
        )}
      </section>

      <section className="bc-layout" role="group" aria-label="Betting layout">
        {SIDES.map((side) => (
          <button
            key={side}
            type="button"
            className={clsx("bc-side", `bc-side-${side}`, bet === side && "bc-side-on")}
            // Locked once a chip is down: the wager is committed.
            disabled={placed || busy}
            aria-pressed={bet === side}
            onClick={() => setBet(side)}
          >
            <strong>{sideLabel(side)}</strong>
            <em>{sideOdds(side)}</em>
          </button>
        ))}
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
            <button type="button" className="bj-action bj-action-deal" disabled={busy} onClick={deal}>
              {busy ? "Dealing…" : "Deal"}
            </button>
          ) : (
            <button
              type="button"
              className="bj-action bj-action-deal"
              disabled={!loaded || !cover.open || busy}
              onClick={place}
            >
              {!loaded
                ? "Loading your Gold…"
                : busy
                  ? "Placing…"
                  : !cover.open
                    ? "Not enough Gold"
                    : `Back ${sideLabel(bet)} · ${stake.toLocaleString()}`}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

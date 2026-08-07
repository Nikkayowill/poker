"use client";

import { useState } from "react";
import clsx from "clsx";
import { Lock } from "lucide-react";
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
  VIDEO_POKER_PAYTABLE,
  payLine,
  videoPokerOutcomeLabel,
  type VideoPokerSnapshot,
} from "@/lib/arcade/video-poker";

/**
 * Video Poker.
 *
 * The rules live in lib/arcade/video-poker.ts and the hand lives on the
 * server; this file is the cabinet. The pay table is rendered from
 * VIDEO_POKER_PAYTABLE rather than typed out here, so the glass cannot
 * advertise a line the engine does not pay -- the same reason the landing
 * page's game grid is rendered from ARCADE_GAMES.
 *
 * Holds are local state and are sent in one go with the draw. A hold is a
 * change of mind, not a wager: making each toggle a server round trip would
 * put five chances to lose a version race in front of every draw, and would
 * feel nothing like a machine.
 */

const HOLD_HINT = "Tap a card to hold it";
/**
 * Module-level, not an inline arrow: the machine hook lists this in an effect's
 * dependencies, and a new closure every render would re-run that effect on
 * every render for no reason.
 */
const isSettledRound = (round: { phase: string }) => round.phase === "settled";


export function VideoPokerMachine() {
  const machine = useCasinoMachine<VideoPokerSnapshot>({
    endpoint: "/api/arcade/video-poker",
    isSettled: isSettledRound,
  });
  const { profile, round, loaded, busy } = machine;

  const [tier, setTier] = useState<StakesTier>("1k");
  const [held, setHeld] = useState<boolean[]>([false, false, false, false, false]);

  const wallet = toArcadeWallet(profile);
  const stake = TIER_CONFIG[tier].minBuyIn;
  const cover = canCoverStake(stake, wallet);
  const live = round?.phase === "draw";

  const deal = () => {
    if (!cover.open || busy) return;
    setHeld([false, false, false, false, false]);
    machine.deal(tier);
  };

  const draw = () => {
    if (!round || !live || busy) return;
    machine.act(round, { held });
  };

  const toggleHold = (index: number) => {
    if (!live || busy) return;
    setHeld((current) => current.map((value, position) => (position === index ? !value : value)));
  };

  // After the draw the machine shows what was actually held, which is the
  // server's word rather than this component's -- they agree, and showing the
  // authoritative one means a resumed hand renders correctly too.
  const shownHolds = live ? held : round?.held ?? held;
  const holdCount = shownHolds.filter(Boolean).length;

  return (
    <main className="bj-shell vp-shell">
      <ArcadeHeader
        title="Video Poker"
        rules="Jacks or Better · 8/5 pay table · One draw"
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
        Hands are dealt on the server and settled against your real balance. A pair of jacks or better
        returns your stake — the pay table below is what every line is worth, and the row you land on
        lights up.
      </ArcadeStakeNote>

      <ArcadeError message={machine.error} />

      <section className="bj-felt hud-felt-plain vp-felt" aria-live="polite" aria-busy={busy}>
        <ArcadeSeat
          className="vp-dealer-head"
          avatar={<DealerAvatar />}
          name={DEALER_NAME}
          caption={!round ? "Pick a stake." : live ? HOLD_HINT : "Deal again?"}
        />

        {/* The glass. Rendered from the engine's own table so it can never
            advertise a line the engine does not pay. */}
        <table className="vp-paytable">
          <caption className="vp-paytable-caption">Pays per {stake.toLocaleString()} staked</caption>
          <tbody>
            {VIDEO_POKER_PAYTABLE.map((line) => (
              <tr
                key={line.rank}
                className={clsx("vp-payrow", round?.rank === line.rank && "vp-payrow-hit")}
              >
                <th scope="row">{line.label}</th>
                <td>{Math.floor(stake * line.multiplier).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="vp-hand">
          {(round?.hand ?? Array.from({ length: 5 }, () => null)).map((card, index) => {
            const holding = shownHolds[index];
            return (
              <div key={index} className="vp-slot">
                <button
                  type="button"
                  className={clsx(
                    "vp-card-button",
                    holding && "vp-card-held",
                    !live && "vp-card-locked",
                    round?.replaced[index] && "vp-card-drawn",
                  )}
                  // Disabled rather than hidden when the hand is over: the row
                  // must not reflow between the draw and the next deal.
                  disabled={!live || busy}
                  aria-pressed={live ? holding : undefined}
                  aria-label={
                    card ? `${card.rank} of ${card.suit}${holding ? ", held" : ""}` : "Empty card slot"
                  }
                  onClick={() => toggleHold(index)}
                >
                  <PlayingCard card={card} large back={profile?.equipped.cardBack} />
                </button>
                <span className={clsx("vp-hold-tag", holding && "vp-hold-tag-on")}>
                  {holding ? (
                    <>
                      <Lock size={9} aria-hidden="true" />
                      Held
                    </>
                  ) : (
                    " "
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <ArcadeVerdict
          label={round && round.phase === "settled" ? videoPokerOutcomeLabel(round) : null}
          netGold={round && round.phase === "settled" ? round.netGold : null}
          stake={round?.stake ?? stake}
          idle={live ? HOLD_HINT : "Pick a stake and deal"}
        />

        {profile && (
          <ArcadeSeat
            className="vp-player-head"
            avatar={<ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar }} />}
            name={profile.displayName}
            caption={round ? `Staked ${round.stake.toLocaleString()}` : undefined}
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
                // Locked mid-hand: the wager is already committed.
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
          {live ? (
            <button type="button" className="bj-action bj-action-deal" disabled={busy} onClick={draw}>
              {busy
                ? "Drawing…"
                : holdCount === 5
                  ? "Stand pat"
                  : `Draw ${5 - holdCount}`}
            </button>
          ) : (
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
                    : round
                      ? "Deal again"
                      : `Deal · ${stake.toLocaleString()}`}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

/** Exported for the page's metadata description -- the machine's one-line pitch. */
export const VIDEO_POKER_TAGLINE = `Jacks or Better pays ${payLine("jacks-or-better").multiplier}x, a royal pays ${payLine("royal-flush").multiplier}x.`;

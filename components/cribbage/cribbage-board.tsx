"use client";

import clsx from "clsx";
import { PlayingCard } from "@/components/table/playing-card";
import type { Card as PokerCard } from "@/lib/game/types";
import type { Card as CribCard, CribbageHandEntry } from "@/lib/cribbage/types";
import type { CribbageBoardProps } from "./cribbage-shell";

/**
 * The cribbage board: your hand, the crib/starter, the pegging pile, and the
 * reveal for the hand that just finished.
 *
 * Purely presentational, same split as every other duel board: everything on
 * screen comes out of `state` (the server's redacted, per-viewer snapshot),
 * and a click only ever emits an intent through `onMove`. There is no
 * separate "counting" UI to build; lib/cribbage/engine.ts's header explains
 * why counting has no player decisions in it at all. `lastHandSummary` is
 * just the reveal of what already happened, rendered here as a panel rather
 * than acted on.
 *
 * Card art is components/table/playing-card.tsx's, the same component the
 * poker table uses. Cribbage keeps its own {rank:1-13, suit:"S"|"H"|"D"|"C"}
 * shape in the engine (rank arithmetic is most of what scoring.ts does), so
 * `toDisplayCard` is a cosmetic adapter to the table's own card type, never
 * touched by game logic.
 */

const SUITS: Record<CribCard["suit"], PokerCard["suit"]> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};
const RANKS: Record<number, PokerCard["rank"]> = {
  1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K",
};

function toDisplayCard(card: CribCard): PokerCard {
  return { rank: RANKS[card.rank], suit: SUITS[card.suit] };
}

export function CribbageBoard({ state, yourSeat, players, busy, onMove }: CribbageBoardProps) {
  const opponents = players.filter((p) => p.seat !== yourSeat);
  const dealer = players.find((p) => p.seat === state.dealerSeat);
  const isDealer = state.dealerSeat === yourSeat;

  const discarding = state.phase === "discard";
  const pegging = state.phase === "pegging";
  const yourTurn = pegging && state.pegging?.turn === yourSeat;

  return (
    <div className="crib-board">
      <div className="crib-hand-number">
        Hand {state.handNumber + 1} · {dealer ? `${dealer.displayName} deals` : "Dealing"}
        {isDealer && " (you)"}
      </div>

      {state.lastHandSummary && <CribbageHandReveal summary={state.lastHandSummary} players={players} yourSeat={yourSeat} />}

      <div className="crib-table-area">
        <div className="crib-crib">
          <span className="crib-label">Crib</span>
          <span className="crib-crib-owner">{isDealer ? "Yours this hand" : `${dealer?.displayName ?? ""}'s`}</span>
        </div>
        <div className="crib-starter">
          <span className="crib-label">Starter</span>
          {state.starter ? <PlayingCard card={toDisplayCard(state.starter)} /> : <PlayingCard card={null} ghost />}
        </div>
      </div>

      {pegging && state.pegging && (
        <div className="crib-pegging">
          <div className="crib-pegging-pile" aria-label="Cards on the table this round">
            {state.pegging.pile.map((card, index) => (
              <PlayingCard key={index} card={toDisplayCard(card)} small />
            ))}
          </div>
          <div className={clsx("crib-count", yourTurn && "crib-count-yours")}>
            <strong>{state.pegging.count}</strong>
            <small>of 31</small>
          </div>
          <p className="crib-turn-note">
            {yourTurn
              ? state.pegging.yourGoAvailable
                ? "You have nothing that fits — say go."
                : "Your turn — play a card."
              : `Waiting on ${opponents.find((p) => p.seat === state.pegging?.turn)?.displayName ?? "the table"}…`}
          </p>
        </div>
      )}

      <div className="crib-opponents" role="list" aria-label="Other players">
        {opponents.map((player) => (
          <div key={player.profileId} className="crib-opponent" role="listitem">
            <span className="duel-avatar" style={{ background: player.accent }} aria-hidden="true">
              {player.initials}
            </span>
            <span className="crib-opponent-name">{player.displayName}</span>
            <span className="crib-opponent-cards" aria-label={`${cardsInHandFor(state, player.seat)} cards`}>
              {Array.from({ length: cardsInHandFor(state, player.seat) }, (_, i) => (
                <PlayingCard key={i} card={null} small />
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="crib-your-hand">
        <p className="crib-hand-prompt">
          {discarding
            ? state.yourDiscarded
              ? "Waiting on the rest of the table to discard…"
              : "Pick one card to send to the crib."
            : yourTurn
              ? "Pick a card to play."
              : "Your hand."}
        </p>
        <div className="crib-hand-cards">
          {state.yourHand.map((card, index) => {
            const playable = discarding
              ? !state.yourDiscarded
              : yourTurn && !state.pegging?.yourGoAvailable && wouldFit(card, state.pegging?.count ?? 0);
            return (
              <button
                key={index}
                type="button"
                className="crib-card-button"
                disabled={busy || !playable}
                onClick={() => onMove(discarding ? { type: "discard", card } : { type: "peg", card })}
              >
                <PlayingCard card={toDisplayCard(card)} />
              </button>
            );
          })}
        </div>
        {yourTurn && state.pegging?.yourGoAvailable && (
          <button type="button" className="floor-play crib-go" disabled={busy} onClick={() => onMove({ type: "go" })}>
            Go
          </button>
        )}
      </div>
    </div>
  );
}

function wouldFit(card: CribCard, count: number): boolean {
  return Math.min(card.rank, 10) + count <= 31;
}

function cardsInHandFor(state: CribbageBoardProps["state"], seat: number): number {
  return state.opponents.find((o) => o.seat === seat)?.cardsInHand ?? 0;
}

function CribbageHandReveal({
  summary,
  players,
  yourSeat,
}: {
  summary: NonNullable<CribbageBoardProps["state"]["lastHandSummary"]>;
  players: CribbageBoardProps["players"];
  yourSeat: CribbageBoardProps["yourSeat"];
}) {
  const nameFor = (entry: CribbageHandEntry): string => {
    if (entry.subject === "crib") return `${players.find((p) => p.seat === entry.owner)?.displayName ?? "Dealer"}'s crib`;
    const player = players.find((p) => p.seat === entry.subject);
    return entry.subject === yourSeat ? "Your hand" : `${player?.displayName ?? "Hand"}`;
  };

  return (
    <details className="crib-reveal" open>
      <summary>Last hand — starter {RANKS[summary.starter.rank]}{summary.heelsPoints > 0 && " (his heels, +2)"}</summary>
      <ul>
        {summary.entries.map((entry, index) => (
          <li key={index} className="crib-reveal-entry">
            <span>{nameFor(entry)}</span>
            <span>{entry.points > 0 ? `+${entry.points}` : "0"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

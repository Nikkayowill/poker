"use client";

import { useState } from "react";
import clsx from "clsx";
import type { DuelBoardProps } from "./duel-shell";
import { otherSeat, type DuelSeat } from "@/lib/pvp/match-contract";
import {
  isLegalEscalation,
  type LiarsDiceBid,
  type LiarsDiceReveal,
  type LiarsDiceSnapshot,
} from "@/lib/pvp/liars-dice";

/**
 * The Liar's Dice table.
 *
 * Renders the seat-filtered snapshot and sends bids or a challenge; the server
 * judges both. The opponent's faces only exist here once the snapshot hands
 * them over (match over) or through `lastReveal`, so there is nothing hidden
 * in the client to peek at.
 *
 * The bid picker only offers legal raises, using the engine's own
 * isLegalEscalation so the two can't drift apart. That is a convenience for
 * the player, not the check: the server runs the same test again.
 */

const FACES = [1, 2, 3, 4, 5, 6] as const;

const FACE_WORDS = ["", "ones", "twos", "threes", "fours", "fives", "sixes"];
const FACE_WORD_SINGLE = ["", "one", "two", "three", "four", "five", "six"];

/** Which of a 3x3 pip grid's cells are lit for each face. */
const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function bidWords(bid: LiarsDiceBid): string {
  return `${bid.count} ${bid.count === 1 ? FACE_WORD_SINGLE[bid.faceValue] : FACE_WORDS[bid.faceValue]}`;
}

/** The smallest count that makes `face` a legal bid over `current`. */
function minCountFor(face: number, current: LiarsDiceBid | null): number {
  if (current === null) return 1;
  return face > current.faceValue ? current.count : current.count + 1;
}

function Die({
  face,
  size = "md",
  match = false,
}: {
  /** Null draws a face-down die. */
  face: number | null;
  size?: "sm" | "md" | "lg";
  match?: boolean;
}) {
  if (face === null) {
    return <span className={clsx("ld-die", `ld-die-${size}`, "ld-die-hidden")} aria-hidden="true" />;
  }
  const lit = PIPS[face] ?? [];
  return (
    <span className={clsx("ld-die", `ld-die-${size}`, match && "ld-die-match")} aria-hidden="true">
      {Array.from({ length: 9 }, (_, cell) => (
        <span key={cell} className={clsx("ld-pip", lit.includes(cell) && "ld-pip-on")} />
      ))}
    </span>
  );
}

function Hand({
  label,
  dice,
  count,
  matchFace,
}: {
  label: string;
  dice: number[] | null;
  count: number;
  matchFace?: number;
}) {
  const faces: (number | null)[] = dice ?? Array.from({ length: count }, () => null);
  return (
    <div className="ld-hand">
      <div className="ld-hand-head">
        <span className="ld-side">{label}</span>
        <span className="ld-count">
          {count} {count === 1 ? "die" : "dice"}
        </span>
      </div>
      <div
        className="ld-hand-dice"
        aria-label={dice ? `${label}: ${dice.join(", ")}` : `${label}: ${count} hidden dice`}
      >
        {count === 0 ? (
          <span className="ld-hand-empty">Out of dice</span>
        ) : (
          faces.map((face, index) => (
            <Die key={index} face={face} match={face !== null && face === matchFace} />
          ))
        )}
      </div>
    </div>
  );
}

function RevealPanel({
  reveal,
  yourSeat,
  over,
}: {
  reveal: LiarsDiceReveal;
  yourSeat: DuelSeat;
  over: boolean;
}) {
  const them = otherSeat(yourSeat);
  const youCalled = reveal.challenger === yourSeat;
  const youLost = reveal.loser === yourSeat;
  const bidText = bidWords(reveal.bid);
  const held = reveal.trueCount >= reveal.bid.count;
  // The losing hand shed its last die when the match ended on this call.
  const lastDie = over && reveal.dice[reveal.loser].length === 1;
  const loss = youLost
    ? lastDie ? "you lose your last die." : "you lose a die."
    : lastDie ? "they lose their last die." : "they lose a die.";

  return (
    <section className="ld-reveal" aria-label="Last showdown">
      <p className="ld-reveal-line">
        {youCalled ? `You called their bid of ${bidText}.` : `They called your bid of ${bidText}.`}{" "}
        <strong>
          There {reveal.trueCount === 1 ? "was" : "were"} {reveal.trueCount}.
        </strong>
      </p>
      <div className="ld-reveal-hands">
        <span className="ld-side">Opponent</span>
        <div className="ld-hand-dice">
          {reveal.dice[them].map((face, index) => (
            <Die key={index} face={face} size="sm" match={face === reveal.bid.faceValue} />
          ))}
        </div>
        <span className="ld-side">You</span>
        <div className="ld-hand-dice">
          {reveal.dice[yourSeat].map((face, index) => (
            <Die key={index} face={face} size="sm" match={face === reveal.bid.faceValue} />
          ))}
        </div>
      </div>
      <p className={clsx("ld-reveal-verdict", youLost ? "ld-reveal-lost" : "ld-reveal-won")}>
        {held ? "The bid held" : "It was a bluff"}, so {loss}
      </p>
    </section>
  );
}

/** The picker's starting bid: the smallest raise, or for an opening bid one of whatever you hold most of. */
function defaultDraft(bid: LiarsDiceBid | null, totalDice: number, ownDice: readonly number[]): LiarsDiceBid {
  if (bid === null) {
    let best = 1;
    for (const face of FACES) {
      if (ownDice.filter((d) => d === face).length > ownDice.filter((d) => d === best).length) best = face;
    }
    return { count: 1, faceValue: best };
  }
  if (bid.count + 1 <= totalDice) return { count: bid.count + 1, faceValue: bid.faceValue };
  const face = FACES.find((f) => f > bid.faceValue) ?? bid.faceValue;
  return { count: bid.count, faceValue: face };
}

function revealKey(reveal: LiarsDiceReveal): string {
  return JSON.stringify(reveal);
}

function BidControls({
  bid,
  draft,
  setDraft,
  totalDice,
  ownDice,
  busy,
  onMove,
}: {
  bid: LiarsDiceBid | null;
  draft: LiarsDiceBid;
  setDraft: (update: (prev: LiarsDiceBid) => LiarsDiceBid) => void;
  totalDice: number;
  ownDice: number[];
  busy: boolean;
  onMove: (move: unknown) => void;
}) {
  const floor = minCountFor(draft.faceValue, bid);
  const legal = draft.count <= totalDice && isLegalEscalation(draft, bid);
  const canRaise = legal || FACES.some((face) => minCountFor(face, bid) <= totalDice);
  const held = ownDice.filter((d) => d === draft.faceValue).length;

  const pickFace = (face: number) => {
    setDraft((prev) => ({ faceValue: face, count: Math.max(prev.count, minCountFor(face, bid)) }));
  };
  const step = (delta: number) => {
    setDraft((prev) => ({ ...prev, count: prev.count + delta }));
  };

  return (
    <div className="ld-controls">
      {canRaise && (
        <>
          <div className="ld-picker">
            <div className="ld-stepper" role="group" aria-label="How many">
              <button
                type="button"
                className="ld-btn ld-step"
                disabled={busy || draft.count - 1 < floor}
                onClick={() => step(-1)}
                aria-label="One fewer"
              >
                −
              </button>
              <span className="ld-step-value" aria-live="polite">
                {draft.count}
              </span>
              <button
                type="button"
                className="ld-btn ld-step"
                disabled={busy || draft.count + 1 > totalDice}
                onClick={() => step(1)}
                aria-label="One more"
              >
                +
              </button>
            </div>
            <div className="ld-faces" role="group" aria-label="Which face">
              {FACES.map((face) => (
                <button
                  key={face}
                  type="button"
                  className={clsx("ld-btn ld-face", face === draft.faceValue && "ld-face-active")}
                  disabled={busy || minCountFor(face, bid) > totalDice}
                  onClick={() => pickFace(face)}
                  aria-pressed={face === draft.faceValue}
                  aria-label={FACE_WORDS[face]}
                >
                  <Die face={face} size="sm" />
                </button>
              ))}
            </div>
          </div>
          <p className="ld-hint">
            You hold {held} of these. {totalDice} dice on the table.
          </p>
        </>
      )}
      {!canRaise && (
        <p className="ld-hint">Nothing can beat this bid. Call it.</p>
      )}
      <div className="ld-actions">
        {canRaise && (
          <button
            type="button"
            className="ld-btn ld-bid"
            disabled={busy || !legal}
            onClick={() => onMove({ type: "bid", count: draft.count, faceValue: draft.faceValue })}
          >
            Bid {bidWords(draft)}
          </button>
        )}
        {bid !== null && (
          <button
            type="button"
            className="ld-btn ld-call"
            disabled={busy}
            onClick={() => onMove({ type: "challenge" })}
          >
            Call bluff
          </button>
        )}
      </div>
    </div>
  );
}

const REASON_WORDS: Record<string, [string, string]> = {
  // [what you see when you won, what you see when you lost]
  "Out of dice": ["They ran out of dice.", "You ran out of dice."],
  Resigned: ["They resigned.", "You resigned."],
};

export function LiarsDiceBoard({ state, yourSeat, busy, onMove }: DuelBoardProps<LiarsDiceSnapshot>) {
  const them = otherSeat(yourSeat);
  const mine = state.seats[yourSeat];
  const theirs = state.seats[them];
  const totalDice = mine.diceCount + theirs.diceCount;
  const over = state.outcome !== null;
  const yourTurn = !over && state.turn === yourSeat;
  const bid = state.bid;
  const ownDice = mine.dice ?? [];

  // The picker's draft belongs to one bid in one round (the last showdown
  // marks the round). When either changes the stored draft stops matching
  // and the default for the new bid takes over.
  const roundKey = state.lastReveal === null ? "first" : revealKey(state.lastReveal);
  const bidKey = `${roundKey}|${bid === null ? "open" : `${bid.count}-${bid.faceValue}`}`;
  const [stored, setStored] = useState<{ key: string; draft: LiarsDiceBid } | null>(null);
  const draft = stored !== null && stored.key === bidKey ? stored.draft : defaultDraft(bid, totalDice, ownDice);
  const setDraft = (update: (prev: LiarsDiceBid) => LiarsDiceBid) => {
    setStored({ key: bidKey, draft: update(draft) });
  };

  // The last showdown stays up until you make your next move, so the player
  // who was waiting still gets to see it. It is back after a reload, which is
  // fine: it is public and harmless.
  const [seenReveal, setSeenReveal] = useState<string | null>(null);
  const reveal = state.lastReveal;
  const showReveal = reveal !== null && (over || revealKey(reveal) !== seenReveal);
  const move = (next: unknown) => {
    if (reveal !== null) setSeenReveal(revealKey(reveal));
    onMove(next);
  };

  let statusLine: string;
  if (over) {
    const outcome = state.outcome;
    const words = outcome ? REASON_WORDS[outcome.reason] : undefined;
    const youWon = outcome?.winner === yourSeat;
    statusLine = words ? words[youWon ? 0 : 1] : (outcome?.reason ?? "");
  } else if (yourTurn) {
    statusLine = bid === null ? "Your turn. Open the bidding." : "Your turn. Raise the bid or call the bluff.";
  } else {
    statusLine = bid === null ? "Waiting for them to open the bidding…" : "Waiting for your opponent…";
  }

  // On your turn your hand lights the face you are about to bid, so the dice
  // agree with the "You hold" line under the picker.
  const ownMatch = yourTurn ? draft.faceValue : bid?.faceValue;

  return (
    <div className="ld">
      <div className="ld-table">
        <Hand label="Opponent" dice={theirs.dice} count={theirs.diceCount} matchFace={bid?.faceValue} />

        <div className={clsx("ld-bid-panel", yourTurn && "ld-bid-panel-yours")}>
          {over ? (
            <span className="ld-bid-empty">Match over</span>
          ) : bid !== null ? (
            <>
              <span className="ld-side">{state.bidder === yourSeat ? "Your bid" : "Their bid"}</span>
              <span className="ld-bid-now" role="img" aria-label={`Current bid: ${bidWords(bid)}`}>
                <span className="ld-bid-count">{bid.count}</span>
                <span className="ld-bid-times" aria-hidden="true">×</span>
                <Die face={bid.faceValue} size="lg" />
              </span>
            </>
          ) : (
            <span className="ld-bid-empty">No bid yet</span>
          )}
          <p className="ld-status" aria-live="polite">{statusLine}</p>
        </div>

        <Hand label="You" dice={mine.dice} count={mine.diceCount} matchFace={ownMatch} />
      </div>

      {/* Beside the table in landscape, under it on a phone held upright. */}
      <div className="ld-rail">
        {showReveal && <RevealPanel reveal={reveal} yourSeat={yourSeat} over={over} />}

        {yourTurn && (
          <BidControls
            bid={bid}
            draft={draft}
            setDraft={setDraft}
            totalDice={totalDice}
            ownDice={ownDice}
            busy={busy}
            onMove={move}
          />
        )}
      </div>
    </div>
  );
}

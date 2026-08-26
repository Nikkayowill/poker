"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { DuelBoardProps } from "./duel-shell";
import type { TriviaSnapshot } from "@/lib/pvp/trivia";

/**
 * Trivia Showdown's board.
 *
 * `import type` and nothing else from lib/pvp/trivia: that module imports the
 * question bank, which is `server-only`, so a value import here would ship the
 * answer key to the browser and fail the build on the way. The type import is
 * erased by the compiler and costs nothing at runtime; see the header of
 * lib/pvp/trivia-questions.ts.
 *
 * Everything on screen is drawn from the snapshot the server built for this
 * seat. The board decides nothing: which choice is right, whether the player
 * has already answered, and how long is left are all read, never inferred.
 */

/**
 * Runs the visible clock without re-rendering anything.
 *
 * The snapshot only refreshes on the shell's two-second poll, so a countdown
 * driven from it would tick in two-second lurches; and pushing a 60 Hz
 * animation through React state would re-render the whole board, the exact
 * stutter components/table/use-fuse.ts was written to remove. So the bar is
 * a CSS animation given its remaining time as a custom property, and the
 * digit is written straight into one span through a ref.
 *
 * `remainingMs` is a duration rather than a deadline: the server's clock and
 * the player's are not the same clock, and a phone that's four minutes fast
 * would otherwise show every question as already over.
 */
function useQuestionClock(phaseKey: string, remainingMs: number, phaseMs: number) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const digitRef = useRef<HTMLSpanElement | null>(null);
  // Mirrored into refs so the animation effect can depend on the phase alone.
  // Depending on `remainingMs` would restart the sweep on every poll, which is
  // the lurch this hook exists to avoid.
  const remaining = useRef(remainingMs);
  const total = useRef(phaseMs);

  useEffect(() => {
    remaining.current = remainingMs;
    total.current = phaseMs;
  }, [remainingMs, phaseMs]);

  useEffect(() => {
    const left = Math.max(0, remaining.current);
    const span = total.current;
    const bar = barRef.current;
    if (bar) {
      bar.style.setProperty("--trivia-remaining", `${left}ms`);
      // Where the bar starts. A board that mounts halfway through a question
      // (a reload, a reconnect) picks the sweep up part way rather than
      // promising a full window it doesn't have.
      bar.style.setProperty("--trivia-from", String(span > 0 ? left / span : 0));
    }

    let frame = 0;
    let shown = -1;
    const deadline = Date.now() + left;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (seconds !== shown) {
        shown = seconds;
        const digit = digitRef.current;
        if (digit) digit.textContent = String(seconds);
      }
      // Stops itself at zero, and rAF stops in a background tab, so a phone
      // in a pocket is not burning frames on a clock nobody is reading.
      if (seconds > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phaseKey]);

  return { barRef, digitRef };
}

export function TriviaBoard({ state, yourSeat, busy, onMove }: DuelBoardProps<TriviaSnapshot>) {
  /**
   * The choice this player just tapped, before the server has confirmed it.
   *
   * Stamped with the question it belongs to and compared on render rather than
   * cleared by an effect: the question rolling over is what makes a stale pick
   * stale, and deriving that is both simpler and what react-hooks/
   * set-state-in-effect is asking for.
   */
  const [pending, setPending] = useState<{ question: number; choice: number } | null>(null);

  const opponentSeat = yourSeat === 0 ? 1 : 0;
  const you = state.seats[yourSeat];
  const them = state.seats[opponentSeat];
  const revealing = state.phase === "reveal";
  const done = state.phase === "done";
  const phaseKey = `${state.questionNumber}:${state.phase}`;
  const { barRef, digitRef } = useQuestionClock(phaseKey, state.remainingMs, state.phaseMs);

  const optimistic = pending && pending.question === state.questionNumber ? pending.choice : null;
  // The server's word wins the moment it arrives; the optimistic pick only
  // covers the round trip.
  const myChoice = you?.choice ?? optimistic;
  const answered = (you?.answered ?? false) || optimistic !== null;
  const locked = busy || answered || revealing || done;

  const pick = (choice: number) => {
    if (locked || !state.question) return;
    setPending({ question: state.questionNumber, choice });
    // The engine indexes questions from zero; the snapshot counts them from
    // one because that is what a player reads.
    onMove({ type: "answer", question: state.questionNumber - 1, choice });
  };

  return (
    <div className="trivia">
      <div className="trivia-head">
        <span className="trivia-progress">
          {done ? "Match complete" : `Question ${state.questionNumber} of ${state.total}`}
        </span>
        <span className="trivia-scores">
          <span className="trivia-score">
            <small>You</small>
            <strong>{(you?.score ?? 0).toLocaleString()}</strong>
          </span>
          <span className="trivia-score">
            <small>Them</small>
            <strong>{(them?.score ?? 0).toLocaleString()}</strong>
          </span>
        </span>
      </div>

      {/* Keyed on the phase so the element is replaced when the question
          changes, which restarts the CSS sweep; a property change alone
          doesn't. */}
      <div className="trivia-clock" key={phaseKey}>
        <div
          className={clsx("trivia-clock-bar", revealing && "trivia-clock-bar-reveal")}
          ref={barRef}
        />
        <span className="trivia-clock-digit" aria-hidden="true">
          {!done && !revealing && <span ref={digitRef} />}
        </span>
      </div>

      {state.question ? (
        <>
          <p className="trivia-category">{state.question.category}</p>
          <p className="trivia-prompt">{state.question.prompt}</p>

          <div className="trivia-choices">
            {state.question.choices.map((choice, index) => {
              // `answerIndex` is absent from the snapshot until the reveal, so
              // there is nothing to be right or wrong about before then.
              const isAnswer = revealing && state.question?.answerIndex === index;
              const isMine = myChoice === index;
              return (
                <button
                  key={choice}
                  type="button"
                  className={clsx(
                    "trivia-choice",
                    isMine && "trivia-choice-mine",
                    isAnswer && "trivia-choice-right",
                    revealing && isMine && !isAnswer && "trivia-choice-wrong",
                  )}
                  disabled={locked}
                  aria-pressed={isMine}
                  onClick={() => pick(index)}
                >
                  <span className="trivia-choice-key" aria-hidden="true">
                    {["A", "B", "C", "D"][index]}
                  </span>
                  <span className="trivia-choice-text">{choice}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="trivia-prompt trivia-prompt-done">
          {(you?.score ?? 0).toLocaleString()} to {(them?.score ?? 0).toLocaleString()}
        </p>
      )}

      <div className="trivia-status">
        {/* Whether they have answered is published by the engine and leaks
            nothing about what they picked; that's the tension. */}
        <span className={clsx("trivia-lamp", them?.answered && "trivia-lamp-on")}>
          <i aria-hidden="true" />
          {done ? "Match over" : them?.answered ? "They have answered" : "They are still reading"}
        </span>
        {!done && (
          <span className="trivia-you-status">
            {revealing ? "Next question coming up" : answered ? "Locked in" : "Pick one"}
          </span>
        )}
      </div>
    </div>
  );
}

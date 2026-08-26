"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import type { DuelBoardProps } from "./duel-shell";
// The clock constants come from word-race-timing, NOT from the engine, and the
// types come from the engine as `import type` so the compiler erases them.
// lib/pvp/word-race.ts value-imports the server-only bank; a value import of it
// here would ship all 478 words to the browser, which is a lookup table for a
// game whose whole difficulty is the lookup. See word-race-words.ts's header.
import { WORD_RACE_REVEAL_MS, WORD_RACE_ROUND_MS } from "@/lib/pvp/word-race-timing";
import type { WordRaceMove, WordRaceSnapshot } from "@/lib/pvp/word-race";

/**
 * The Word Race board: the tiles, the clock and the input.
 *
 * Everything on screen comes out of the snapshot, which is the redacted view.
 * This component couldn't show the answer early if it tried, because the
 * field isn't there until the round ends. That's worth stating here as well
 * as in the engine: a board that had the word and merely declined to paint
 * it would put the whole game one devtools breakpoint away.
 *
 * The clock doesn't run through React. The shell re-reads the match every
 * two seconds, so `round.remainingMs` is a value that arrives fifteen times
 * in a thirty-second round. Animating from it with state would either judder
 * at 2 Hz or cost sixty renders a second of the whole board. Instead the
 * arrival is turned into a deadline once, and from there the browser runs
 * the countdown itself: the bar is a CSS animation given a duration and a
 * negative delay, and the digit is written straight into one element's
 * textContent from a requestAnimationFrame loop. Both are lifted from
 * components/table/use-fuse.ts, the house pattern for exactly this.
 */
export function WordRaceBoard({
  state,
  yourSeat,
  busy,
  onMove,
}: DuelBoardProps<WordRaceSnapshot>) {
  const { round, wins, totalRounds, yourGuesses, opponentGuesses, opponentLocked, history } = state;
  const theirSeat = yourSeat === 0 ? 1 : 0;
  const revealing = round.phase === "reveal";

  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const digitRef = useRef<HTMLSpanElement | null>(null);
  /** When the current phase runs out, in this browser's clock. */
  const deadlineRef = useRef(0);

  /**
   * Re-syncs the deadline on every poll.
   *
   * Declared before the animation effect since effects run in order, so a
   * new round's deadline is already stored by the time the effect below
   * reads it. Later polls land here and nowhere else, which keeps the
   * server the authority on the clock without re-rendering anything.
   */
  useEffect(() => {
    deadlineRef.current = Date.now() + round.remainingMs;
  }, [round.remainingMs, round.number, round.phase]);

  useEffect(() => {
    const total = revealing ? WORD_RACE_REVEAL_MS : WORD_RACE_ROUND_MS;
    const bar = barRef.current;
    if (bar) {
      // Negative elapsed, so a player who joined the match part-way through a
      // round (accepting a challenge, reloading) picks the bar up where it
      // actually is rather than restarting it full.
      const elapsed = Math.max(0, Math.min(total, total - (deadlineRef.current - Date.now())));
      bar.style.setProperty("--wr-duration", `${total}ms`);
      bar.style.setProperty("--wr-delay", `-${elapsed}ms`);
    }

    let frame = 0;
    let shown = -1;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      if (seconds !== shown) {
        shown = seconds;
        if (digitRef.current) digitRef.current.textContent = String(seconds);
      }
      // Keeps running at zero: the next poll may push the deadline back out
      // (a round that ends, a reveal that opens the next one), and a loop
      // that stopped would leave the digit stuck on 0 until a re-render.
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [round.number, round.phase, revealing]);

  /** Focus the box the moment a round opens; this is a speed game. */
  useEffect(() => {
    if (revealing) return;
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.focus();
  }, [round.number, revealing]);

  /**
   * The lockout, re-enabling itself without waiting for the next poll.
   *
   * `yourLockoutMs` is only as fresh as the last read, so trusting it alone
   * would leave the box dead for up to two seconds after a 1.5s penalty. A
   * timer fixes that, and the state it sets is a token rather than a boolean
   * so nothing has to be reset on the way in, keeping setState out of the
   * effect body, where react-hooks/set-state-in-effect rightly rejects it.
   * The token includes the round, since guess counts restart each round and
   * "one guess into round three" must not inherit round two's expiry.
   */
  const lockToken = `${round.number}:${yourGuesses.length}`;
  const [freedToken, setFreedToken] = useState("");
  useEffect(() => {
    if (state.yourLockoutMs <= 0) return;
    const timer = window.setTimeout(() => setFreedToken(lockToken), state.yourLockoutMs);
    return () => window.clearTimeout(timer);
  }, [lockToken, state.yourLockoutMs]);
  const locked = state.yourLockoutMs > 0 && freedToken !== lockToken;

  const disabled = busy || revealing || locked || state.finished;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    const guess = input.value.trim();
    if (!guess) return;
    // Cleared straight away: the next thing a racing player does is type
    // again, and a box still holding a wrong answer costs them a backspace.
    input.value = "";
    const move: WordRaceMove = { guess };
    onMove(move);
  };

  const solvedByYou = round.solvedBy === yourSeat;
  const solvedByThem = round.solvedBy === theirSeat;

  return (
    <div className="wr-board">
      <div className="wr-head">
        <span className="wr-round">
          Round {round.number} <small>of {totalRounds}</small>
        </span>
        <span className="wr-score">
          <strong>{wins[yourSeat]}</strong>
          <small>you</small>
          <em>–</em>
          <strong>{wins[theirSeat]}</strong>
          <small>them</small>
        </span>
      </div>

      <div className="wr-clock">
        <span className="wr-seconds">
          {/* Written by the rAF loop above, never by a render. */}
          <span ref={digitRef} aria-hidden="true">
            {Math.ceil(round.remainingMs / 1000)}
          </span>
          <small>{revealing ? "next round" : "seconds"}</small>
        </span>
        <div className={clsx("wr-bar", revealing && "wr-bar-reveal")}>
          <div className="wr-bar-fill" ref={barRef} />
        </div>
      </div>

      <ol className="wr-tiles" aria-label={`Scrambled letters: ${round.scramble.split("").join(" ")}`}>
        {round.scramble.split("").map((letter, index) => (
          <li key={`${index}-${letter}`} className="wr-tile" aria-hidden="true">
            {letter}
          </li>
        ))}
      </ol>

      <p className="wr-hint">
        {round.hint} <span className="wr-hint-length">{round.length} letters</span>
      </p>

      {revealing || state.finished ? (
        <div
          className={clsx(
            "wr-reveal",
            solvedByYou && "wr-reveal-you",
            round.solvedBy === null && "wr-reveal-push",
          )}
          role="status"
        >
          <strong>{round.word ?? "—"}</strong>
          <span>
            {solvedByYou
              ? "You got there first."
              : solvedByThem
                ? "Your opponent got there first."
                : "Nobody solved it."}
          </span>
        </div>
      ) : (
        <form className="wr-form" onSubmit={submit}>
          <label className="wr-label" htmlFor="wr-guess">
            Your answer
          </label>
          <input
            id="wr-guess"
            ref={inputRef}
            className="wr-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={16}
            disabled={disabled}
            placeholder={locked ? "Wait…" : "Type the word"}
          />
          <button type="submit" className="floor-play wr-submit" disabled={disabled}>
            {locked ? "Locked" : "Guess"}
          </button>
        </form>
      )}

      <div className="wr-status">
        <p className={clsx("wr-them", opponentLocked && "wr-them-locked")}>
          {opponentGuesses === 0
            ? "Your opponent has not guessed yet."
            : opponentLocked
              ? `Your opponent has tried ${opponentGuesses} — locked out right now.`
              : `Your opponent has tried ${opponentGuesses}.`}
        </p>
        {yourGuesses.length > 0 && (
          <ul className="wr-guesses" aria-label="Your guesses this round">
            {yourGuesses.map((guess, index) => (
              <li
                key={`${index}-${guess}`}
                className={clsx("wr-guess", guess === round.word && "wr-guess-right")}
              >
                {guess}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The series so far. Only rounds that have finished appear, since the
          snapshot has nothing else to draw from. */}
      <ol className="wr-series" aria-label="Rounds so far">
        {Array.from({ length: totalRounds }, (_, index) => {
          const played = history.find((entry) => entry.number === index + 1);
          return (
            <li
              key={index}
              className={clsx(
                "wr-pip",
                played && played.solvedBy === yourSeat && "wr-pip-you",
                played && played.solvedBy === theirSeat && "wr-pip-them",
                played && played.solvedBy === null && "wr-pip-push",
              )}
              title={played ? `Round ${played.number}: ${played.word}` : `Round ${index + 1}`}
            />
          );
        })}
      </ol>
    </div>
  );
}

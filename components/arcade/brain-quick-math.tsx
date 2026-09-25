"use client";

import { useEffect, useRef, useState } from "react";
import { BrainStreak, useBrainStreakRound } from "./brain-streak";

function Prompt() {
  const { prompt } = useBrainStreakRound();
  return (
    <p className="brain-math-problem" aria-live="polite">
      {prompt.a as number} {prompt.op as string} {prompt.b as number} = ?
    </p>
  );
}

/**
 * One problem's answer box. Keyed by the problem in the parent (see
 * Controls below), so a new problem remounts this fresh instead of an
 * effect resetting `value`, which the ref-safety lint rule refuses for a
 * synchronous setState.
 */
function AnswerBox({ submit, busy, disabled }: { submit: (given: string) => void; busy: boolean; disabled: boolean }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = () => {
    if (!value.trim() || disabled) return;
    submit(value.trim());
    setValue("");
  };

  return (
    <form
      className="brain-answer-form"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        className="brain-answer-input"
        value={value}
        disabled={busy || disabled}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Your answer"
      />
      <button type="submit" className="brain-answer-submit" disabled={busy || disabled || !value.trim()}>
        Answer
      </button>
    </form>
  );
}

function Controls() {
  const { prompt, submit, busy, disabled } = useBrainStreakRound();
  return <AnswerBox key={`${prompt.a}-${prompt.b}-${prompt.op}`} submit={submit} busy={busy} disabled={disabled} />;
}

export function BrainQuickMath() {
  return (
    <BrainStreak
      gameId="quick-math"
      apiPath="/api/brain-quick-math"
      title="Quick Math Sprint"
      lobbyBlurb="Sixty seconds, as many right answers as you can get. A wrong guess costs nothing but the miss — only the clock ends the run."
      helpTitle="Quick Math Sprint"
      helpBody={
        <>
          <p>
            One arithmetic problem at a time, sixty seconds on the clock. Answer it and the next
            one appears immediately, right or wrong — there&apos;s no penalty for a miss beyond not
            scoring it, so answer fast and keep going.
          </p>
          <p>
            Wager Gold or play free, any time. How many you get right decides the payout.
          </p>
        </>
      }
      scoreNoun="correct"
      promptSlot={<Prompt />}
      controlsSlot={<Controls />}
    />
  );
}

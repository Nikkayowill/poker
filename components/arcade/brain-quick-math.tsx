"use client";

import { useState } from "react";
import clsx from "clsx";
import { Delete } from "lucide-react";
import { SoundButton } from "@/components/arcade/sound-button";
import { BrainStreak, useAnswerKeys, useBrainStreakRound } from "./brain-streak";

/** Longest answer the pad accepts. The biggest product a long run deals stays well under this. */
const MAX_DIGITS = 5;
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function Prompt() {
  const { prompt } = useBrainStreakRound();
  return (
    <p className="brain-math-problem" aria-live="polite">
      {prompt.a as number} {prompt.op as string} {prompt.b as number} = ?
    </p>
  );
}

/**
 * The answer readout and its keypad. There is no text box on purpose: a
 * phone's number keyboard has no Enter key, so answering meant tapping a
 * button, which blurred the box and closed the keyboard every problem. The
 * pad never loses anything to focus, and a physical keyboard drives the same
 * state through a window listener, so desktop players never click either.
 *
 * Keyed by round in Controls below, so a new problem starts from an empty
 * readout without an effect resetting it.
 */
function AnswerPad({
  submit,
  busy,
  disabled,
  verdict,
}: {
  submit: (given: string) => void;
  busy: boolean;
  disabled: boolean;
  verdict: { key: number; correct: boolean } | null;
}) {
  const [value, setValue] = useState("");
  const locked = busy || disabled;

  const press = (digit: string) => {
    if (locked) return;
    setValue((current) => (current.length >= MAX_DIGITS ? current : current + digit));
  };
  const erase = () => {
    if (locked) return;
    setValue((current) => current.slice(0, -1));
  };
  const send = () => {
    if (locked || !value) return;
    submit(value);
  };

  useAnswerKeys((key) => {
    if (/^[0-9]$/.test(key)) press(key);
    else if (key === "Backspace") erase();
    else if (key === "Enter") send();
    else return false;
    return true;
  });

  return (
    <div className="brain-math-pad">
      <output
        className={clsx(
          "brain-math-readout",
          verdict && (verdict.correct ? "brain-verdict-right" : "brain-verdict-wrong"),
        )}
        aria-label="Your answer"
      >
        {value || <span className="brain-math-caret" aria-hidden="true" />}
      </output>
      <div className="brain-keypad">
        {PAD_KEYS.map((digit) => (
          <SoundButton key={digit} sound="tap" className="brain-key" disabled={disabled} onClick={() => press(digit)}>
            {digit}
          </SoundButton>
        ))}
        <SoundButton sound="tap" className="brain-key brain-key-erase" disabled={disabled} onClick={erase} aria-label="Delete">
          <Delete size={20} aria-hidden="true" />
        </SoundButton>
        <SoundButton sound="tap" className="brain-key" disabled={disabled} onClick={() => press("0")}>
          0
        </SoundButton>
        <SoundButton sound="tap" className="brain-key brain-key-go" disabled={disabled || !value} onClick={send}>
          Go
        </SoundButton>
      </div>
    </div>
  );
}

function Controls() {
  const { roundKey, submit, busy, disabled, verdict } = useBrainStreakRound();
  return <AnswerPad key={roundKey} submit={submit} busy={busy} disabled={disabled} verdict={verdict} />;
}

const PRESSURE_RULES = {
  1: ["Three-digit ± two-digit, two-digit × one-digit, and division that comes out whole."],
  2: ["Three-digit ± three-digit, bigger times tables, and harder division."],
  3: ["Two-digit × two-digit and harder division. Three wrong answers end the run."],
} as const;

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
            Tap the keypad, or just type on a keyboard and press Enter. Wager Gold or play free, any
            time. How many you get right decides the payout.
          </p>
        </>
      }
      scoreNoun="correct"
      promptSlot={<Prompt />}
      controlsSlot={<Controls />}
      pressureRules={PRESSURE_RULES}
    />
  );
}

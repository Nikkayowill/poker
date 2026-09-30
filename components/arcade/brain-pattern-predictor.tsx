"use client";

import clsx from "clsx";
import { SoundButton } from "@/components/arcade/sound-button";
import { BrainStreak, useAnswerKeys, useBrainStreakRound } from "./brain-streak";

function Prompt() {
  const { prompt } = useBrainStreakRound();
  const terms = prompt.terms as number[];
  return (
    <p className="brain-math-problem" aria-live="polite">
      {terms.join(", ")}, <span className="brain-math-blank">?</span>
    </p>
  );
}

function Controls() {
  const { prompt, submit, busy, disabled, verdict } = useBrainStreakRound();
  const options = prompt.options as number[];
  const answer = (option: number) => {
    if (!busy && !disabled) submit(String(option));
  };
  useAnswerKeys((key) => {
    const index = Number(key) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= options.length) return false;
    answer(options[index]);
    return true;
  });
  return (
    <div
      className={clsx("brain-options brain-options-grid", verdict && (verdict.correct ? "brain-verdict-right" : "brain-verdict-wrong"))}
      key={verdict?.key}
    >
      {options.map((option, i) => (
        <SoundButton key={i} sound="tap" className="brain-option" disabled={disabled} onClick={() => answer(option)}>
          {option} <kbd>{i + 1}</kbd>
        </SoundButton>
      ))}
    </div>
  );
}

const PRESSURE_RULES = {
  1: ["Starts 6 rounds in: Fibonacci-style sums, interleaved sequences, multiply-then-add."],
  2: ["Starts 10 rounds in, with the hardest rules: mixed operations, cubes, doubling gaps."],
  3: ["Starts 14 rounds in: the hardest rules with bigger numbers."],
} as const;

export function BrainPatternPredictor() {
  return (
    <BrainStreak
      gameId="pattern-predictor"
      apiPath="/api/brain-pattern-predictor"
      title="Pattern Predictor"
      lobbyBlurb="A number sequence hides a rule. Pick what comes next. Keep going as long as you keep guessing right."
      helpTitle="Pattern Predictor"
      helpBody={
        <>
          <p>
            A row of numbers follows a hidden rule. Early on it&apos;s adding or multiplying by the
            same amount; later come squares, Fibonacci-style sums, two sequences woven together and
            more. Pick which of the four options continues it. Guess right and a trickier pattern
            appears; guess wrong and the run ends.
          </p>
          <p>Wager Gold or play free, any time. Your streak decides the payout.</p>
        </>
      }
      scoreNoun="in a row"
      promptSlot={<Prompt />}
      controlsSlot={<Controls />}
      pressureRules={PRESSURE_RULES}
    />
  );
}

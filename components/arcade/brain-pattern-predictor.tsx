"use client";

import { BrainStreak, useBrainStreakRound } from "./brain-streak";

function Prompt() {
  const { prompt } = useBrainStreakRound();
  const terms = prompt.terms as number[];
  return (
    <p className="brain-math-problem" aria-live="polite">
      {terms.join(",  ")}, ?
    </p>
  );
}

function Controls() {
  const { prompt, submit, busy, disabled } = useBrainStreakRound();
  const options = prompt.options as number[];
  return (
    <div className="brain-options">
      {options.map((option, i) => (
        <button
          key={i}
          type="button"
          className="brain-option"
          disabled={busy || disabled}
          onClick={() => submit(String(option))}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

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
            Four numbers follow a hidden rule — adding the same amount each time, multiplying by
            the same amount, or alternating up and down. Pick which of the four options continues
            it. Guess right and a new, trickier pattern appears; guess wrong and the run ends.
          </p>
          <p>Wager Gold or play free, any time. Your streak decides the payout.</p>
        </>
      }
      scoreNoun="in a row"
      promptSlot={<Prompt />}
      controlsSlot={<Controls />}
    />
  );
}

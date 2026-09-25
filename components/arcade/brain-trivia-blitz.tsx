"use client";

import { BrainStreak, useBrainStreakRound } from "./brain-streak";

function Prompt() {
  const { prompt } = useBrainStreakRound();
  return (
    <p className="brain-trivia-statement" aria-live="polite">
      {prompt.statement as string}
    </p>
  );
}

function Controls() {
  const { submit, busy, disabled } = useBrainStreakRound();
  return (
    <div className="brain-options brain-truefalse">
      <button type="button" className="brain-option" disabled={busy || disabled} onClick={() => submit("true")}>
        True
      </button>
      <button type="button" className="brain-option" disabled={busy || disabled} onClick={() => submit("false")}>
        False
      </button>
    </div>
  );
}

export function BrainTriviaBlitz() {
  return (
    <BrainStreak
      gameId="trivia-blitz"
      apiPath="/api/brain-trivia-blitz"
      title="Trivia Blitz"
      lobbyBlurb="Rapid-fire true or false, forty-five seconds on the clock. Nothing specialist — just everyday general knowledge."
      helpTitle="Trivia Blitz"
      helpBody={
        <>
          <p>
            One statement at a time, forty-five seconds on the clock. Call it true or false and the
            next one appears immediately, right or wrong — only the clock ends the run.
          </p>
          <p>
            Wager Gold or play free, any time. How many you get right decides the payout; a coin
            flip alone won&apos;t clear the first paying rung.
          </p>
        </>
      }
      scoreNoun="correct"
      promptSlot={<Prompt />}
      controlsSlot={<Controls />}
    />
  );
}

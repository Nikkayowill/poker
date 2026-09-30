"use client";

import clsx from "clsx";
import { BRAIN_STREAK_RULES, brainStreakLadder } from "@/lib/arcade/brain-streak";
import { SoundButton } from "@/components/arcade/sound-button";
import { BrainStreak, useAnswerKeys, useBrainStreakRound } from "./brain-streak";

function Prompt() {
  const { prompt } = useBrainStreakRound();
  const claim = prompt.claim as string | undefined;
  return (
    <div className="brain-trivia" aria-live="polite">
      <p className="brain-trivia-statement">{prompt.statement as string}</p>
      {claim && <p className="brain-trivia-claim">{claim}</p>}
    </div>
  );
}

const KEYS: Record<string, string> = { t: "true", f: "false", ArrowLeft: "true", ArrowRight: "false" };

function Controls() {
  const { submit, busy, disabled, verdict } = useBrainStreakRound();
  const answer = (given: string) => {
    if (!busy && !disabled) submit(given);
  };
  useAnswerKeys((key) => {
    const given = KEYS[key] ?? KEYS[key.toLowerCase()];
    if (!given) return false;
    answer(given);
    return true;
  });
  return (
    <div
      className={clsx("brain-options brain-truefalse", verdict && (verdict.correct ? "brain-verdict-right" : "brain-verdict-wrong"))}
      key={verdict?.key}
    >
      <SoundButton sound="tap" className="brain-option brain-option-true" disabled={disabled} onClick={() => answer("true")}>
        True <kbd>T</kbd>
      </SoundButton>
      <SoundButton sound="tap" className="brain-option brain-option-false" disabled={disabled} onClick={() => answer("false")}>
        False <kbd>F</kbd>
      </SoundButton>
    </div>
  );
}

function pressureLine(pressure: 1 | 2 | 3): string {
  const ladder = brainStreakLadder(BRAIN_STREAK_RULES["trivia-blitz"], pressure);
  const gain = [...ladder].reverse().find((rung) => rung.multiplier > 1);
  return `Questions only, no quick myth statements. A profit needs ${gain?.min ?? 0} right.`;
}

const PRESSURE_RULES = { 1: [pressureLine(1)], 2: [pressureLine(2)], 3: [pressureLine(3)] };

export function BrainTriviaBlitz() {
  return (
    <BrainStreak
      gameId="trivia-blitz"
      apiPath="/api/brain-trivia-blitz"
      title="Trivia Blitz"
      lobbyBlurb="Rapid-fire true or false, forty-five seconds on the clock. Three wrong calls and the run is over."
      helpTitle="Trivia Blitz"
      helpBody={
        <>
          <p>
            One statement at a time, forty-five seconds on the clock. Some are a question with an
            answer under it: is that answer right? Call it true or false and the next one appears
            straight away. The third wrong call ends the run, and so does the clock.
          </p>
          <p>
            Wager Gold or play free, any time. How many you get right decides the payout.
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

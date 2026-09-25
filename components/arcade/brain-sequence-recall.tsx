"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { tapSound } from "@/lib/audio/ui-sounds";
import { BrainStreak, useBrainStreakRound } from "./brain-streak";

/** One flash pad's color per index -- purely a CSS hook, not game state. */
const PAD_TONES = ["pad-red", "pad-blue", "pad-green", "pad-yellow"] as const;
/** How long each flash shows, and the gap before the next one. */
const FLASH_MS = 550;
const GAP_MS = 200;

function Prompt() {
  const { prompt } = useBrainStreakRound();
  const length = (prompt.sequence as number[]).length;
  return <p className="brain-hint">Watch the pattern, then repeat it: sequence {length - 2}.</p>;
}

/**
 * Runs the watch-then-answer cycle for one sequence. Keyed by the sequence
 * itself in the parent (see Controls below), so a new round remounts this
 * fresh -- phase and the tapped-so-far buffer start correct on their own,
 * rather than an effect resetting them, which the ref-safety lint rule
 * refuses for a synchronous setState.
 */
function Pads({
  colors,
  sequence,
  submit,
  busy,
  disabled,
}: {
  colors: number;
  sequence: number[];
  submit: (given: string) => void;
  busy: boolean;
  disabled: boolean;
}) {
  const [phase, setPhase] = useState<"watching" | "answering">("watching");
  const [flashing, setFlashing] = useState<number | null>(null);
  const givenRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    sequence.forEach((pad, i) => {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setFlashing(pad);
        }, i * (FLASH_MS + GAP_MS)),
      );
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setFlashing(null);
        }, i * (FLASH_MS + GAP_MS) + FLASH_MS),
      );
    });
    timers.push(
      window.setTimeout(() => {
        if (cancelled) return;
        setPhase("answering");
      }, sequence.length * (FLASH_MS + GAP_MS)),
    );
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tap = (pad: number) => {
    if (phase !== "answering" || disabled) return;
    tapSound();
    givenRef.current = [...givenRef.current, pad];
    if (givenRef.current.length === sequence.length) {
      submit(givenRef.current.join(","));
      givenRef.current = [];
    }
  };

  return (
    <div className="brain-pads" aria-label={phase === "watching" ? "Watch the pattern" : "Repeat the pattern"}>
      {Array.from({ length: colors }, (_, pad) => (
        <button
          key={pad}
          type="button"
          className={clsx("brain-pad", PAD_TONES[pad], flashing === pad && "brain-pad-lit")}
          disabled={phase !== "answering" || busy || disabled}
          onClick={() => tap(pad)}
          aria-label={`Pad ${pad + 1}`}
        />
      ))}
    </div>
  );
}

function Controls() {
  const { prompt, submit, busy, disabled } = useBrainStreakRound();
  const sequence = prompt.sequence as number[];
  return (
    <Pads
      key={sequence.join(",")}
      colors={prompt.colors as number}
      sequence={sequence}
      submit={submit}
      busy={busy}
      disabled={disabled}
    />
  );
}

export function BrainSequenceRecall() {
  return (
    <BrainStreak
      gameId="sequence-recall"
      apiPath="/api/brain-sequence-recall"
      title="Sequence Recall, against yourself"
      lobbyBlurb="Watch a growing flash pattern, then repeat it back exactly. One slip ends the run — the longer your streak, the more it pays."
      helpTitle="Sequence Recall"
      helpBody={
        <>
          <p>
            Watch the pads flash in order, then tap them back in the same order. Every round the
            pattern grows by one. Get it right and the next round is one step longer; get it wrong
            and the run ends there.
          </p>
          <p>
            Wager Gold or play free, any time. Your streak decides the payout: a short run forfeits
            the wager, a long one multiplies it.
          </p>
        </>
      }
      scoreNoun="in a row"
      promptSlot={<Prompt />}
      controlsSlot={<Controls />}
    />
  );
}

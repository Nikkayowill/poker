"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { tapSound } from "@/lib/audio/ui-sounds";
import { BrainStreak, useAnswerKeys, useBrainStreakRound } from "./brain-streak";

/** One flash pad's color per index -- purely a CSS hook, not game state. */
const PAD_TONES = ["pad-red", "pad-blue", "pad-green", "pad-yellow"] as const;
/** How long each flash shows, and the gap before the next one. */
const FLASH_MS = 550;
const GAP_MS = 200;
/** How long a pad stays lit after the player taps it. */
const TAP_FLASH_MS = 180;

function Prompt() {
  const { prompt } = useBrainStreakRound();
  const length = (prompt.sequence as number[]).length;
  return <p className="brain-hint">Round {length - 2} · {length} flashes</p>;
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
  const [tapped, setTapped] = useState(0);
  const givenRef = useRef<number[]>([]);
  const tapFlash = useRef<number | null>(null);
  useEffect(() => () => {
    if (tapFlash.current !== null) window.clearTimeout(tapFlash.current);
  }, []);

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
    if (phase !== "answering" || busy || disabled) return;
    tapSound();
    setFlashing(pad);
    if (tapFlash.current !== null) window.clearTimeout(tapFlash.current);
    tapFlash.current = window.setTimeout(() => setFlashing(null), TAP_FLASH_MS);
    givenRef.current = [...givenRef.current, pad];
    setTapped(givenRef.current.length);
    if (givenRef.current.length === sequence.length) {
      submit(givenRef.current.join(","));
      // Only a failed request leaves this round on screen, and then the
      // player starts the sequence over rather than being stuck.
      givenRef.current = [];
    }
  };

  useAnswerKeys((key) => {
    const pad = Number(key) - 1;
    if (!Number.isInteger(pad) || pad < 0 || pad >= colors) return false;
    tap(pad);
    return true;
  });

  return (
    <div className="brain-sequence">
      <p className={clsx("brain-turn", phase === "answering" && "brain-turn-yours")} aria-live="polite">
        {phase === "watching" ? "Watch…" : busy ? "Checking…" : "Your turn"}
      </p>
      <div className="brain-pads" aria-label={phase === "watching" ? "Watch the pattern" : "Repeat the pattern"}>
        {Array.from({ length: colors }, (_, pad) => (
          <button
            key={pad}
            type="button"
            className={clsx("brain-pad", PAD_TONES[pad], flashing === pad && "brain-pad-lit")}
            disabled={phase !== "answering" || disabled}
            onClick={() => tap(pad)}
            aria-label={`Pad ${pad + 1}`}
          >
            <kbd aria-hidden="true">{pad + 1}</kbd>
          </button>
        ))}
      </div>
      <ol className="brain-sequence-dots" aria-label={`${tapped} of ${sequence.length} entered`}>
        {sequence.map((_, i) => (
          <li key={i} className={clsx(i < tapped && "brain-dot-done")} />
        ))}
      </ol>
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

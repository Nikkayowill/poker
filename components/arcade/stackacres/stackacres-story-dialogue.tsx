"use client";

import { useEffect, useRef } from "react";
import { TRAVELER_PORTRAIT, type TravelerId } from "@/lib/stackacres/story/travelers";
import type { StoryChoice, StoryDialogueNode } from "@/lib/stackacres/story/dialogue";
import type { TapPoint } from "./stackacres-scene";

/**
 * One traveler's speech bubble: their portrait, name, line, and whatever
 * buttons the current node carries. Same screen-anchored, real-DOM posture
 * every other character dialogue on this map takes (StackAcresMonkDialogue,
 * StackAcresFriendshipDialogue) -- pinned at the point the scene handed
 * back (here, just over the traveler's head, not the finger), closed by the
 * next world tap or its own close button, Escape included.
 *
 * Unlike the monk's two-shape dialogue, there is only one node shape here
 * (`StoryDialogueNode`, lib/stackacres/story/dialogue.ts): a line, a
 * vibrate pattern already played by the hook, and a row of choices where at
 * most one commits. This component never decides what the line says or
 * what a button does -- it renders whatever node `useStackAcresStory`
 * handed it and calls back on a press.
 */
export interface StackAcresStoryDialogueProps {
  traveler: TravelerId;
  at: TapPoint;
  node: StoryDialogueNode;
  busy: boolean;
  onChoose: (choice: StoryChoice) => void;
  onClose: () => void;
}

export function StackAcresStoryDialogue({ traveler, at, node, busy, onChoose, onClose }: StackAcresStoryDialogueProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [node.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sa-story-dialogue" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-story-dialogue-pin" aria-hidden="true" />
      <div className="sa-story-dialogue-card" role="dialog" aria-label={node.speakerName}>
        <button type="button" className="sa-story-dialogue-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="sa-story-dialogue-head">
          <img src={TRAVELER_PORTRAIT[traveler]} alt="" className="sa-story-dialogue-portrait" />
          <p className="sa-story-dialogue-name">{node.speakerName}</p>
        </div>
        <p className="sa-story-dialogue-line">&ldquo;{node.dialogueText}&rdquo;</p>
        <div className="sa-story-dialogue-actions">
          {node.choices.map((choice, i) => (
            <button
              key={choice.label}
              type="button"
              className={choice.commits ? "sa-story-dialogue-yes" : "sa-story-dialogue-no"}
              ref={i === 0 ? firstRef : undefined}
              disabled={busy}
              onClick={() => onChoose(choice)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dialogueNodeFor, type StoryChoice, type StoryDialogueNode, type StoryIntent } from "./dialogue";
import type { StoryEvent } from "./events";
import { applyEventToView, type StackAcresStoryView } from "./state";
import type { TravelerId } from "./travelers";

/**
 * The client side of the story. Owns which bubble is open, plays the
 * haptic tick when a node opens, posts a committing choice's intent, and
 * keeps the objective counters moving between round trips.
 *
 * It never decides anything. The node shown is derived from the server's
 * view every render; a committing choice posts its intent through the
 * farm's own action path and the bubble re-derives off whatever view comes
 * back. `noteEvent` only replays a farm event against the rendered view so
 * a number ticks before the response lands. Events are folded in on a
 * zero-delay timer, one render per burst, and are dropped the moment a
 * fresh server view arrives, since that view already counted them.
 *
 * Wiring (a follow-up in stackacres-farm.tsx): pass the view's `story`
 * slice, a `submit` that routes through `act`, call `open` from the scene's
 * traveler tap, and `noteEvent` from the same optimistic path that
 * predicts the action.
 */

/** Screen pixels, the same anchor the scene hands every other bubble. */
export interface StoryAnchor {
  readonly x: number;
  readonly y: number;
}

export interface StoryDialogueState {
  readonly traveler: TravelerId;
  readonly at: StoryAnchor;
  readonly node: StoryDialogueNode;
}

export interface UseStackAcresStoryOptions {
  /** The server's story slice, or null until the view carries one. With
   *  null, taps do nothing; there is no state to show. */
  readonly view: StackAcresStoryView | null;
  /** Posts an intent and resolves once the refreshed view has been applied
   *  to `view`. Rejects on a refused or dropped request; the bubble stays
   *  on its current node either way. */
  readonly submit: (intent: StoryIntent) => Promise<void>;
}

export interface StackAcresStoryController {
  /** The server's view plus any events noted since it arrived. */
  readonly view: StackAcresStoryView | null;
  readonly dialogue: StoryDialogueState | null;
  readonly busy: boolean;
  open(traveler: TravelerId, at: StoryAnchor): void;
  close(): void;
  /** Resolves when the intent (if any) has been posted and answered. */
  choose(choice: StoryChoice): Promise<void>;
  noteEvent(event: StoryEvent): void;
}

/** A short tick on a phone that has one. Silent everywhere else. */
function buzz(pattern: readonly number[]): void {
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    // Some browsers throw rather than returning false. Either way, nothing happens.
  }
}

interface EventBatch {
  /** The view these events were noted against. Any other view drops them. */
  readonly base: StackAcresStoryView | null;
  readonly events: readonly StoryEvent[];
}

export function useStackAcresStory({ view, submit }: UseStackAcresStoryOptions): StackAcresStoryController {
  const [anchor, setAnchor] = useState<{ traveler: TravelerId; at: StoryAnchor } | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<EventBatch>({ base: null, events: [] });

  const viewRef = useRef(view);
  const queueRef = useRef<StoryEvent[]>([]);
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    viewRef.current = view;
    // A new server view already counted everything noted before it.
    queueRef.current = [];
  }, [view]);

  useEffect(
    () => () => {
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  const displayed = useMemo(() => {
    if (view === null) return null;
    if (batch.base !== view) return view;
    return batch.events.reduce(applyEventToView, view);
  }, [view, batch]);

  const node = useMemo(() => {
    if (anchor === null || displayed === null) return null;
    return dialogueNodeFor(anchor.traveler, displayed.travelers[anchor.traveler]);
  }, [anchor, displayed]);

  // Nodes are shared objects from STORY_DIALOGUE, so this fires once per
  // node change, not once per optimistic tick while a bubble is open.
  useEffect(() => {
    if (node !== null) buzz(node.vibratePattern);
  }, [node]);

  const dialogue = useMemo<StoryDialogueState | null>(
    () => (anchor === null || node === null ? null : { traveler: anchor.traveler, at: anchor.at, node }),
    [anchor, node],
  );

  const open = useCallback((traveler: TravelerId, at: StoryAnchor) => {
    setAnchor({ traveler, at });
  }, []);

  const close = useCallback(() => {
    setAnchor(null);
  }, []);

  const choose = useCallback(
    async (choice: StoryChoice) => {
      if (node === null) return;
      const intent = choice.commits ? node.onComplete : null;
      if (intent === null) {
        setAnchor(null);
        return;
      }
      setBusy(true);
      try {
        await submit(intent);
      } finally {
        setBusy(false);
      }
    },
    [node, submit],
  );

  const noteEvent = useCallback((event: StoryEvent) => {
    queueRef.current.push(event);
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      setBatch({ base: viewRef.current, events: [...queueRef.current] });
    }, 0);
  }, []);

  return { view: displayed, dialogue, busy, open, close, choose, noteEvent };
}

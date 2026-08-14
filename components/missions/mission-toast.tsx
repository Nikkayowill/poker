"use client";

import { useCallback, useEffect, useState } from "react";
import type { MissionView } from "@/lib/missions/types";

/** How long a single completion stays on screen before it clears itself. */
const TOAST_MS = 3200;

interface ToastItem {
  key: string;
  mission: MissionView;
}

/**
 * "Mission complete" toasts for the lobby.
 *
 * Timed, self-dismissing, `aria-live="polite"` -- the same shape as
 * components/arcade/share-result-button.tsx's confirmation, copied rather
 * than imported: that component is coupled to share outcomes and icons, and
 * crossing the arcade/lobby boundary for one shared idiom is not warranted
 * for a single call site.
 *
 * lib/arcade/hud.ts's stake-ratio celebration tiering is deliberately not
 * reused here -- missions are binary complete/not-complete with no stake or
 * multiple, so forcing them through a tiering system built for casino payout
 * intensity would either flatten to one tier or need a meaningless fake
 * ratio.
 *
 * Stacked rather than queued one-at-a-time: two missions completing in the
 * same poll (a hand that finishes both "play five hands" and the weekly
 * cross-category total, say) both deserve to be seen, and a stack is simpler
 * than a sequencer for something this rare.
 */
export function MissionToast({
  queue,
  onQueued,
}: {
  queue: MissionView[];
  /** Called once `queue` has been absorbed, so the caller can clear its source. */
  onQueued: () => void;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (queue.length === 0) return;
    // Deferred through a timer rather than set synchronously in the effect
    // body, matching useProgression and friends-drawer.tsx's fetch defer: a
    // state update fired straight from the effect body sets state during the
    // same commit.
    const timer = window.setTimeout(() => {
      setItems((current) => [
        ...current,
        ...queue.map((mission) => ({ key: `${mission.code}:${mission.periodEnd}`, mission })),
      ]);
      onQueued();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queue, onQueued]);

  const removeItem = useCallback((key: string) => {
    setItems((current) => current.filter((existing) => existing.key !== key));
  }, []);

  return (
    <div className="mission-toast-stack" role="status" aria-live="polite">
      {items.map((item) => (
        <ToastLine key={item.key} itemKey={item.key} mission={item.mission} onDone={removeItem} />
      ))}
    </div>
  );
}

function ToastLine({
  itemKey,
  mission,
  onDone,
}: {
  itemKey: string;
  mission: MissionView;
  onDone: (key: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(itemKey), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [itemKey, onDone]);

  return (
    <p className="mission-toast">
      {`Mission complete: ${mission.title} (+${mission.rewardGold.toLocaleString()} Gold)`}
    </p>
  );
}

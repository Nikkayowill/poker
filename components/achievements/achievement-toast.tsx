"use client";

import { useCallback, useEffect, useState } from "react";
import type { AchievementView } from "@/lib/achievements/types";
import { cosmeticById } from "@/lib/cosmetics/catalog";

/** Same as components/missions/mission-toast.tsx's TOAST_MS. */
const TOAST_MS = 3200;

interface ToastItem {
  key: string;
  achievement: AchievementView;
}

/**
 * "Achievement unlocked" toasts. Copied from components/missions/mission-toast.tsx
 * rather than shared -- same reasoning that file gives for not reusing
 * share-result-button.tsx: crossing the missions/achievements boundary for
 * one shared idiom isn't warranted for two call sites, and this one has an
 * extra cosmetic-reward line missions never needed.
 */
export function AchievementToast({
  queue,
  onQueued,
}: {
  queue: AchievementView[];
  /** Called once `queue` has been absorbed, so the caller can clear its source. */
  onQueued: () => void;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (queue.length === 0) return;
    const timer = window.setTimeout(() => {
      setItems((current) => [
        ...current,
        ...queue.map((achievement) => ({ key: achievement.code, achievement })),
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
        <ToastLine key={item.key} itemKey={item.key} achievement={item.achievement} onDone={removeItem} />
      ))}
    </div>
  );
}

function ToastLine({
  itemKey,
  achievement,
  onDone,
}: {
  itemKey: string;
  achievement: AchievementView;
  onDone: (key: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(itemKey), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [itemKey, onDone]);

  const cosmeticName = achievement.rewardCosmeticId ? cosmeticById(achievement.rewardCosmeticId)?.name : null;
  const reward = cosmeticName
    ? `+${achievement.rewardGold.toLocaleString()} Gold + ${cosmeticName}`
    : `+${achievement.rewardGold.toLocaleString()} Gold`;

  return (
    <p className="mission-toast">
      {`Achievement unlocked: ${achievement.title} (${reward})`}
    </p>
  );
}

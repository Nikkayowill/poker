"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@/lib/game/types";
import type { PlayerProfile } from "@/lib/profile/types";
import { CHEAPEST_TIER, TIER_CONFIG } from "@/lib/game/tiers";
import { onRewardTrigger } from "@/lib/rewards/events";
import {
  advanceRewardWatch,
  initialRewardWatchState,
  type RewardTrigger,
  type RewardWatchState,
} from "@/lib/rewards/triggers";

/**
 * Watches for a moment worth offering a rewarded ad, and holds the one offer.
 *
 * Deliberately thin. Every rule about *when* to prompt lives in
 * lib/rewards/triggers.ts, where `npm test` can reach it; this hook holds the
 * reducer's state, subscribes to lib/rewards/events.ts for the surfaces that
 * have no snapshot to diff (the arcade pages), and exposes one nullable offer.
 * That split is the whole architecture: the table never learns that a modal
 * exists, and the modal never learns how a hand is won.
 *
 * THE STATE IS A REF, NOT useState
 *
 * The watch state is derived from every snapshot, and storing it in React
 * state would mean a set during the same effect that reads it -- a render loop
 * for something no one renders. Only the resulting `offer` is state, because
 * only the offer is drawn. The eslint rule about refs is about refs read from
 * event handlers reachable during render; this one is read from an effect and
 * from nowhere else.
 */
export interface GameAchievements {
  /** The offer to show, or null. */
  offer: RewardTrigger | null;
  /** Dismisses the current offer. The kind stays spent for the session, so it will not re-open. */
  dismiss: () => void;
}

export function useGameAchievements(
  game: GameSnapshot | null,
  profile: PlayerProfile | null,
): GameAchievements {
  const [offer, setOffer] = useState<RewardTrigger | null>(null);
  const watchRef = useRef<RewardWatchState>(initialRewardWatchState);
  const previousRef = useRef<GameSnapshot | null>(null);

  useEffect(() => {
    // Published triggers come from pages outside this tree -- Blackjack and
    // Hi-Lo, which know when a player has just staked their last Gold and have
    // no GameSnapshot to derive it from. publishRewardTrigger already enforces
    // one delivery per kind per session, so this cannot be spammed by a page
    // that publishes on every render.
    return onRewardTrigger((trigger) => {
      setOffer((current) => current ?? trigger);
    });
  }, []);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = game;

    const { state, trigger } = advanceRewardWatch(watchRef.current, {
      previous,
      next: game,
      goldBalance: profile?.goldBalance ?? null,
      unlimitedGold: profile?.unlimitedGold ?? false,
      cheapestBuyIn: TIER_CONFIG[CHEAPEST_TIER].minBuyIn,
    });
    watchRef.current = state;

    // Never replaces an offer already on screen: a player reading one modal
    // should not have it swapped underneath them by the next hand settling.
    if (trigger) setOffer((current) => current ?? trigger);
  }, [game, profile?.goldBalance, profile?.unlimitedGold]);

  const dismiss = useCallback(() => setOffer(null), []);

  return { offer, dismiss };
}

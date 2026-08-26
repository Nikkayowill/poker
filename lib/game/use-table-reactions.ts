"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/supabase/browser-client";
import {
  PLAYER_REACTION,
  REACTION_BUBBLE_MS,
  REACTION_COOLDOWN_MS,
  parsePlayerReaction,
  reactionChannelName,
  type ReactionId,
} from "./reaction-channel";

export interface SeatReaction {
  reactionId: ReactionId;
  /**
   * Bumped on every send, even a repeat of the same emoji, so player-seat's
   * bubble remounts and restarts its animation instead of sitting there as
   * an unchanged prop.
   */
  key: number;
}

let nextReactionKey = 1;

/**
 * Owns everything about table reactions on the client: the incoming
 * broadcast subscription, per-seat bubble state (each one clears itself
 * after its animation ends), and sending, including the cooldown, applied
 * locally first so a tap feels instant instead of waiting on a round trip.
 * See app/api/games/[id]/reactions/route.ts for the send side.
 */
export function useTableReactions(gameId: string | null, mySeatId: string | null) {
  const [reactions, setReactions] = useState<Record<string, SeatReaction>>({});
  const expiryTimers = useRef<Record<string, number>>({});
  const [onCooldown, setOnCooldown] = useState(false);
  const cooldownTimer = useRef<number | null>(null);

  const showReaction = useCallback((seatId: string, reactionId: ReactionId) => {
    const key = nextReactionKey++;
    setReactions((current) => ({ ...current, [seatId]: { reactionId, key } }));
    const existing = expiryTimers.current[seatId];
    if (existing !== undefined) window.clearTimeout(existing);
    expiryTimers.current[seatId] = window.setTimeout(() => {
      delete expiryTimers.current[seatId];
      setReactions((current) => {
        // If a newer reaction already replaced this one, its own timer owns
        // the clear; don't let this stale timer wipe it out early.
        if (current[seatId]?.key !== key) return current;
        const next = { ...current };
        delete next[seatId];
        return next;
      });
    }, REACTION_BUBBLE_MS);
  }, []);

  // Everyone else's reactions.
  useEffect(() => {
    const supabase = browserSupabase();
    if (!gameId || !supabase) return;
    let disposed = false;
    const channel: RealtimeChannel = supabase
      .channel(reactionChannelName(gameId))
      .on("broadcast", { event: PLAYER_REACTION }, (message) => {
        const event = parsePlayerReaction(message.payload);
        if (!event || disposed) return;
        // Our own send is already shown optimistically below.
        if (event.seatId === mySeatId) return;
        showReaction(event.seatId, event.reactionId);
      })
      .subscribe();
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [gameId, mySeatId, showReaction]);

  useEffect(() => () => {
    Object.values(expiryTimers.current).forEach((timerId) => window.clearTimeout(timerId));
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current);
  }, []);

  const sendReaction = useCallback((reactionId: ReactionId) => {
    if (!gameId || !mySeatId || onCooldown) return;
    setOnCooldown(true);
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current);
    cooldownTimer.current = window.setTimeout(() => {
      cooldownTimer.current = null;
      setOnCooldown(false);
    }, REACTION_COOLDOWN_MS);
    // Show it immediately rather than waiting on the request. It's cosmetic
    // only, so there's nothing to roll back if the send itself fails.
    showReaction(mySeatId, reactionId);
    void fetch(`/api/games/${gameId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reactionId }),
    }).catch(() => {
      // A failed send just means nobody else sees the bubble.
    });
  }, [gameId, mySeatId, onCooldown, showReaction]);

  return { reactions, sendReaction, onCooldown };
}

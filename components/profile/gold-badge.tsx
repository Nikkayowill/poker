"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Coins } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";

/** How long a balance change takes to count up/down to its new value. */
const COUNT_UP_MS = 450;

/**
 * Eases a balance from its previous value to its next one instead of
 * snapping, so a payout or a purchase reads as something happening rather
 * than a number that was simply replaced. Deterministic given (from, to,
 * duration) -- a plain rAF tween, not randomness -- consistent with this
 * app's rule against presentation code that can't be reasoned about.
 *
 * Skips the tween (jumps straight to the target) for an unlimited profile,
 * which never has a real balance to animate toward, and under
 * `prefers-reduced-motion`.
 */
interface CountUpState {
  target: number;
  displayed: number;
  /** Set only when a render just decided to animate toward `target`; the
   * tween effect below consumes it once and clears it on the final frame. */
  pendingFrom: number | null;
}

function useCountUp(target: number, skip: boolean): number {
  const [state, setState] = useState<CountUpState>({ target, displayed: target, pendingFrom: null });
  const frameRef = useRef<number | null>(null);

  // React's own pattern for "adjust state when a prop changes": decided
  // during render, not synced from an effect. Whether to snap or animate is
  // known immediately -- there is nothing here that needs to wait a tick.
  if (target !== state.target) {
    const from = state.displayed;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shouldAnimate = !skip && !reduceMotion && from !== target;
    setState({
      target,
      displayed: shouldAnimate ? from : target,
      pendingFrom: shouldAnimate ? from : null,
    });
  }

  // Runs the rAF tween. Every setState call in here happens inside the
  // `tick` callback, not synchronously in the effect body -- the effect
  // itself only decides whether a tween was requested and, if so, starts
  // and tears down the frame loop for it.
  useEffect(() => {
    if (state.pendingFrom === null) return;
    const from = state.pendingFrom;
    const to = state.target;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / COUNT_UP_MS);
      // ease-out cubic -- fast start, settles into the landing value rather
      // than arriving at a constant rate and stopping abruptly.
      const eased = 1 - (1 - elapsed) ** 3;
      const done = elapsed >= 1;
      setState((current) => ({
        ...current,
        displayed: done ? to : Math.round(from + (to - from) * eased),
        pendingFrom: done ? null : current.pendingFrom,
      }));
      if (!done) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [state.pendingFrom, state.target]);

  return state.displayed;
}

/**
 * The navbar's Gold: a coin, a number, and nothing else.
 *
 * It used to carry the daily-claim button beside the balance, which meant the
 * header's right-hand side was a number, a yellow button reading "Claim daily
 * Gold" / "Claimed today" / "Save to claim", and an avatar. Two of those three
 * labels were a control that could not do anything -- "Save to claim" in
 * particular was a disabled button whose entire job was to advertise a signup,
 * next to a player menu that already offers "Save progress" in words.
 *
 * The claim moved into that menu (see components/poker-app.tsx), where it is a
 * labelled row rather than a permanent fixture, and what stays here is a dot:
 * the balance is the thing worth reading at a glance, and a dot is enough to
 * say there is more of it waiting.
 */
export function GoldBadge({
  profile,
  claimable = false,
  justClaimed = false,
}: {
  profile: PlayerProfile;
  /** Daily Gold is waiting. The action itself lives in the player menu. */
  claimable?: boolean;
  /** Flashes the number once, right after a claim lands. */
  justClaimed?: boolean;
}) {
  const displayedBalance = useCountUp(profile.goldBalance ?? 0, profile.unlimitedGold);

  // An unlimited profile is never charged and never credited, so a running
  // total would be a number that never means anything.
  const balance = profile.unlimitedGold
    ? <strong title="This profile plays for free">Unlimited</strong>
    : <strong>{displayedBalance.toLocaleString()}</strong>;

  return (
    <div className={clsx("gold-badge", justClaimed && "gold-badge-claimed")}>
      <span className="gold-balance">
        <Coins size={14} />
        {balance}
      </span>
      {claimable && (
        <span
          className="gold-badge-dot"
          title="Your daily Gold is ready -- claim it from the player menu"
          aria-label="Daily Gold is ready to claim"
          role="status"
        />
      )}
    </div>
  );
}

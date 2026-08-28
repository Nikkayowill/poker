"use client";

import Link from "next/link";
import clsx from "clsx";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * The inline "you're short, here's where to fix it" hint every
 * blocked-by-Gold button was missing. Disabling a button and relabeling it
 * "Not enough Gold" (or, worse, only a hover title) tells a player what's
 * wrong but never where to go -- every one of those dead-ended right there.
 * `needed` is whatever the blocked action actually requires (a tier's
 * minBuyIn, a wager's stake, a duel's entry cost), not the shortfall amount:
 * a bare "you need X" is what every existing call site already said, so this
 * keeps that copy recognisable rather than introducing a second number
 * (balance vs. needed vs. shortfall) for a reader to reconcile.
 *
 * Always links to /rewards's free-earning section specifically, never the
 * store -- a player stuck at zero is exactly who that section is for, and
 * routing to a purchase page here would read as StackChips using its own
 * "you're broke" moment to sell Gold.
 */
export function GoldShortfallHint({
  needed,
  compact = false,
  className,
}: {
  needed: number;
  /** Tightens spacing/type size for tight spaces like an arcade card or a floor row. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <p className={clsx("gold-shortfall-hint", compact && "gold-shortfall-hint-compact", className)}>
      <span>You need {needed.toLocaleString()} Gold.</span>{" "}
      <Link href="/rewards#rewards-earn" onClick={tapSound}>Learn how to earn more Gold for free</Link>
    </p>
  );
}

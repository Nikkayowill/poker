"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { potChipStacks } from "@/lib/game/pot-chips";

/**
 * The pot, as chips on the cloth.
 *
 * The number has lived in the HUD since M7a, which is the right place to read
 * it and the wrong place to feel it. This is the other half: a pile that grows
 * as the betting does, so a big pot looks like one before anybody reads it.
 *
 * Rendered inside .pot-anchor, which is the point everything in flight already
 * agrees on -- chips arrive here, the pot funnels out from here, folded cards
 * drift here, hole cards are dealt from here. Putting the pile anywhere else
 * would be a fifth coordinate to keep in step with the other four.
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE
 *
 * .pot-anchor is measured by all four of those effects, so its box must not
 * move or resize when a pot grows. Everything below is absolutely positioned
 * out of flow and the anchor keeps its fixed 45x35; there is an e2e assertion
 * on exactly that, because a pile that quietly resized the anchor would drag
 * every trajectory on the table with it and nothing would look obviously
 * wrong.
 */
export function PotPile({
  pot,
  bigBlind,
  paying,
}: {
  pot: number;
  bigBlind: number;
  /** The hand is over and PotFunnel is taking the pot to its winners. */
  paying: boolean;
}) {
  const stacks = useMemo(() => potChipStacks(pot, bigBlind), [pot, bigBlind]);
  if (stacks.length === 0) return null;

  return (
    <span className={clsx("pot-pile", paying && "pot-pile-paying")} aria-hidden="true">
      {stacks.map((stack, column) => (
        <span className="pot-pile-column" key={stack.denomination}>
          {Array.from({ length: stack.count }, (_, index) => (
            // Keyed by position in the column, so raising a pot from three
            // chips to four mounts one chip rather than rebuilding the stack
            // -- which is what keeps the settle animation on the arrival
            // instead of replaying the whole pile every time anyone bets.
            <span
              key={index}
              className={`pot-pile-chip chip-color-${column}`}
              style={{ "--pile-index": index } as React.CSSProperties}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

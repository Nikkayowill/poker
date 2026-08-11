"use client";

/**
 * The number beside the chips: each seat's standing street bet, and the pot.
 *
 * WHY THIS EXISTS AT ALL. The chips on the cloth are a SIZE cue, not a value
 * encoding — `lib/game3d/denominations.ts` says so in as many words, and the
 * gap is real: a 6 bet draws one 5-chip, a 5,000 pot draws 21 blacks. Even
 * if it were exact, nobody reads a pot by summing clay from two metres up at
 * a 48 degree angle. A card room solves this by having a dealer who says the
 * number out loud; a screen solves it by printing it.
 *
 * DOM, like the nameplates and the action bar, and for the same reasons:
 * text stays crisp at any DPI, it is readable by a screen reader, and its
 * z-order over the canvas is a CSS fact rather than a depth-buffer
 * negotiation. Positioned by running the bet spot through the SAME pure
 * projection the camera is solved with (lib/game3d/camera-framing.ts), so a
 * label lands on its own chips at every viewport aspect without one three.js
 * query — the seat nameplates established this pattern and this follows it
 * exactly.
 */

import { useMemo } from "react";
import type { SceneModel } from "@/lib/game3d/scene-model";
import { frameCamera, projectToNdc } from "@/lib/game3d/camera-framing";
import {
  POT_POSITION,
  betSpotPosition,
  type Vec3,
} from "@/lib/game3d/seat-layout";
import { chipStackY } from "@/lib/game3d/chip-trajectory";
import { pileChipCount } from "@/lib/game3d/chip-instance-model";
import { CHIPS_PER_COLUMN } from "@/lib/game3d/chip-instance-model";
import styles from "../game3d.module.css";

/**
 * Air between the top of a pile and the underside of its label, in world
 * units — about two chips' worth.
 *
 * The label floats ABOVE its pile rather than beside it, which is the one
 * placement that cannot be wrong. Beside means picking a side, and the
 * correct side differs per seat: a label offset to the right reads fine at
 * the near seat and lands on the neighbour's chips at slot 2. Above is
 * always clear, because the thing directly above a pile of chips on a table
 * is nothing.
 */
const LABEL_LIFT = 0.07;

/** Labels this far outside the frame are dropped rather than clamped — a
 * number pinned to an edge is a number attached to nothing. */
const NDC_LIMIT = 1;

interface Amount {
  key: string;
  left: number;
  top: number;
  value: number;
  className: string;
}

/**
 * The top of the pile that will be drawn for `amount` at `base`.
 *
 * Reads `pileChipCount` and `chipStackY` rather than assuming a height, so a
 * label sits just clear of the actual clay: a pot that has grown into a
 * second column is no taller than the first, and a label placed off the raw
 * chip count would drift upward off a pile that never rose. Capping the row
 * at CHIPS_PER_COLUMN is what encodes that.
 */
function pileTop(base: Vec3, amount: number): Vec3 {
  const chips = pileChipCount(amount);
  const rows = Math.min(chips, CHIPS_PER_COLUMN);
  return { x: base.x, y: chipStackY(base.y, Math.max(0, rows - 1)) + LABEL_LIFT, z: base.z };
}

function project(point: Vec3, aspect: number): { left: number; top: number } | null {
  const ndc = projectToNdc(point, frameCamera(aspect), aspect);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
  if (Math.abs(ndc.x) > NDC_LIMIT || Math.abs(ndc.y) > NDC_LIMIT) return null;
  return { left: ((ndc.x + 1) / 2) * 100, top: ((1 - ndc.y) / 2) * 100 };
}

export function BetAmounts({ model, aspect }: { model: SceneModel; aspect: number }) {
  const amounts = useMemo<Amount[]>(() => {
    const list: Amount[] = [];

    for (const seat of model.seats) {
      if (seat.streetBet <= 0) continue;
      const spot = project(pileTop(betSpotPosition(seat.slot), seat.streetBet), aspect);
      if (!spot) continue;
      list.push({
        key: `bet-${seat.slot}`,
        left: spot.left,
        top: spot.top,
        value: seat.streetBet,
        className: styles.betAmount,
      });
    }

    // The centre pile shows the pot MINUS every standing street bet, because
    // the bets are still sitting in front of their owners — so its label has
    // to be that same number, or the felt would state a total the chips
    // beneath it do not add up to even in principle. `potResting` is the
    // model's own name for it and is what the chip layer draws.
    if (model.potResting > 0) {
      const spot = project(pileTop(POT_POSITION, model.potResting), aspect);
      if (spot) {
        list.push({
          key: "pot",
          left: spot.left,
          top: spot.top,
          value: model.potResting,
          className: `${styles.betAmount} ${styles.betAmountPot}`,
        });
      }
    }

    return list;
  }, [model, aspect]);

  return (
    <div className={styles.betAmountLayer} aria-hidden="true">
      {amounts.map((amount) => (
        <span
          key={amount.key}
          className={amount.className}
          style={{ left: `${amount.left}%`, top: `${amount.top}%` }}
        >
          {amount.value.toLocaleString()}
        </span>
      ))}
    </div>
  );
}

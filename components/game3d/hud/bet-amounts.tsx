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
import { seatRightVector } from "@/lib/game3d/chip-props";
import { CHIP } from "@/lib/game3d/dimensions";
import { boardAnchor, boardCardWidth } from "@/lib/game3d/board-anchor";
import styles from "../game3d.module.css";

/**
 * The label sits BESIDE its pile, not above it. It used to float directly
 * over the chips — the one placement that "cannot be wrong" because nothing
 * else is ever directly above a pile — but for the pot that put the badge
 * right on top of the community board sitting just behind it, reading as the
 * cards clipping the number. Above is clear of a PILE; it is not clear of
 * whatever else shares that pile's own column in screen space.
 *
 * A flat screen-space "beside" was the original, rejected reason for
 * floating above at all: an offset that reads fine at one seat lands on a
 * neighbour's chips at another. The fix here is the same one
 * seat-bankrolls.tsx already uses for exactly that problem — offset along a
 * direction DERIVED per seat (seatRightVector), not a constant. The pot has
 * no seat of its own, so it shifts along world +X instead — just enough to
 * clear its own pile; `clearBoardRow` below does the real work of dodging
 * the community board specifically.
 */
const SEAT_LABEL_OFFSET = CHIP.radius * 3.2;
const POT_LABEL_OFFSET = CHIP.radius * 3.2;

/** Fixed hover above the felt — not "above the pile's own top" any more,
 * since the label no longer sits over the chips at all. */
const LABEL_HEIGHT = CHIP.thickness * 3;

/** Labels this far outside the frame are dropped rather than clamped — a
 * number pinned to an edge is a number attached to nothing. */
const NDC_LIMIT = 1;

/**
 * Extra clearance past the board's own right edge, in percent of stage
 * width — a hair of breathing room so the number doesn't sit flush against
 * the last card.
 */
const BOARD_CLEARANCE_PCT = 1.5;

/**
 * `.betAmountPot`'s own on-screen footprint, for clearing the board by the
 * label's real bulk and not just its anchor POINT. `.betAmount` is
 * `transform: translate(-50%, -100%)` (game3d.module.css) — `left` is the
 * pill's horizontal CENTRE, not its left edge — so a dodge that only pushed
 * the point clear of the board's right edge still left the label's own left
 * half sitting under the last card. That was the actual bug: on desktop the
 * pot pill visibly touched, and was clipped by, the community row.
 *
 * 14px bold tabular-nums text (`.betAmountPot`) in a pill with 7px of
 * padding each side. Tabular nums keep every digit and comma the same
 * advance, so a char-count estimate is close enough here — this only has to
 * cover the label's own bulk, not typeset it exactly.
 */
const POT_LABEL_CHAR_WIDTH_PX = 8.6;
const POT_LABEL_PADDING_PX = 14;

/** Half of `potLabelWidthPx`, in percent of the stage's own width. */
function potLabelHalfWidthPercent(value: number, width: number): number {
  if (width <= 0) return 0;
  const widthPx = value.toLocaleString().length * POT_LABEL_CHAR_WIDTH_PX + POT_LABEL_PADDING_PX;
  return (widthPx / 2 / width) * 100;
}

/**
 * The gap between the community board's flex row and its neighbour, as
 * `.boardLayer`'s own CSS states it (game3d.module.css: `gap: calc(--card-w
 * * 0.1)`). Restated here rather than read from the stylesheet because nothing
 * in this render path touches computed CSS.
 */
const BOARD_CARD_GAP_FACTOR = 0.1;

/**
 * The pot's label sits in the SAME world-projected space as every other
 * label here, but the community board is a DOM row sized and centred by its
 * own, unrelated system (board-anchor.ts's screen-space blend + a CSS-pixel
 * card width — see that file's header for why). The two only share a common
 * frame once both are expressed in screen percent, so this reads the
 * board's real anchor and width the SAME way board-cards.tsx does, and pushes
 * `left` clear of its right edge when the two would otherwise overlap.
 * Returns `left` unchanged whenever there is no board to dodge (preflop) or
 * the label was never going to land under it in the first place.
 */
function clearBoardRow(
  left: number,
  communityCount: number,
  width: number,
  height: number,
  potValue: number,
): number {
  if (communityCount === 0 || width <= 0 || height <= 0) return left;
  const anchor = boardAnchor(width, height);
  if (!anchor) return left;
  const cardW = boardCardWidth(width, height);
  const rowPx = communityCount * cardW + (communityCount - 1) * cardW * BOARD_CARD_GAP_FACTOR;
  const halfRowPct = (rowPx / 2 / width) * 100;
  // `left` is the pill's own CENTRE (see potLabelHalfWidthPercent above), so
  // the clear line has to sit that far past the board's right edge too, or
  // the pill's left half still lands on the last card.
  const clearLeft =
    anchor.left + halfRowPct + BOARD_CLEARANCE_PCT + potLabelHalfWidthPercent(potValue, width);
  return left < clearLeft ? clearLeft : left;
}

interface Amount {
  key: string;
  left: number;
  top: number;
  value: number;
  className: string;
}

/** `base` nudged sideways along `direction` (a unit vector in the felt
 * plane) by `offset`, and lifted clear of the cloth. */
function pileSide(base: Vec3, direction: Vec3, offset: number): Vec3 {
  return {
    x: base.x + direction.x * offset,
    y: base.y + LABEL_HEIGHT,
    z: base.z + direction.z * offset,
  };
}

function project(point: Vec3, aspect: number): { left: number; top: number } | null {
  const ndc = projectToNdc(point, frameCamera(aspect), aspect);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
  if (Math.abs(ndc.x) > NDC_LIMIT || Math.abs(ndc.y) > NDC_LIMIT) return null;
  return { left: ((ndc.x + 1) / 2) * 100, top: ((1 - ndc.y) / 2) * 100 };
}

export function BetAmounts({
  model,
  aspect,
  width = 0,
  height = 0,
}: {
  model: SceneModel;
  aspect: number;
  /** Stage layout box — same numbers board-cards.tsx gets, needed only to
   * keep the pot label clear of the board's own DOM row. Optional so a
   * caller with no board on screen (there is none yet) needn't thread it. */
  width?: number;
  height?: number;
}) {
  const amounts = useMemo<Amount[]>(() => {
    const list: Amount[] = [];

    for (const seat of model.seats) {
      if (seat.streetBet <= 0) continue;
      const spot = project(
        pileSide(betSpotPosition(seat.slot), seatRightVector(seat.slot), SEAT_LABEL_OFFSET),
        aspect,
      );
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
      const spot = project(pileSide(POT_POSITION, { x: 1, y: 0, z: 0 }, POT_LABEL_OFFSET), aspect);
      if (spot) {
        list.push({
          key: "pot",
          left: clearBoardRow(spot.left, model.community.length, width, height, model.potResting),
          top: spot.top,
          value: model.potResting,
          className: `${styles.betAmount} ${styles.betAmountPot}`,
        });
      }
    }

    return list;
  }, [model, aspect, width, height]);

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

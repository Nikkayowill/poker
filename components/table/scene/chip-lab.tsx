"use client";

/**
 * Dev-only bench for the chip system. Not linked from any nav; see
 * `app/dev/chips/page.tsx`.
 *
 * It exists because the two things this system has to get right cannot be
 * checked from a unit test or from a running table. The unit tests fix the
 * arithmetic — the wall is three pixels, the spring overshoots by six per cent
 * — and say nothing about whether the result looks like a casino chip. A
 * running table shows you one pot at one size, mid-hand, for as long as the
 * hand lasts. This shows every denomination, every stack height, every pot
 * silhouette and every action's motion, side by side, at the pixel scales the
 * real table actually renders at, on a loop.
 *
 * The scales are not invented. `fitView` gives the classic room
 * `(railWidth / 2 / RAIL_SCALE) / FELT.radiusX` pixels per world unit, so a
 * 900px desktop rail is ~44 and a 340px phone rail is ~17. Judging chip art at
 * any other size is how the dealer avatars shipped illegible.
 */

import { useEffect, useRef } from "react";
import { classicChipSpace } from "@/lib/scene/chip-space";
import { orthographicProjection } from "@/lib/scene/scene-projection";
import { CHIP_RADIUS, FELT, MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import { ChipScene, type RenderChip } from "@/lib/scene/chips/chip-scene";
import { chipMetrics, solveChipWorldRadius } from "@/lib/scene/chips/chip-spec";
import { MAX_POT_COLUMNS, pileSlots } from "@/lib/scene/chips/chip-stack";
import type { ChipMoveKind } from "@/lib/scene/chips/chip-motion";
import { paintChip, paintChipShadow } from "./chip-painter";

const DENOMINATIONS = [1, 5, 25, 100];

function chipAt(
  denomination: number,
  x: number,
  z: number,
  stackIndex: number,
  seed: number,
): RenderChip {
  return {
    denomination,
    position: { x, y: FELT.y, z },
    stackIndex,
    seed,
    airborne: false,
    lift: 0,
    driftXPx: 0,
    driftYPx: 0,
    rollRad: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

/**
 * The still life: one chip of each denomination, a full column, and the pot's
 * silhouette at every tier.
 */
function paintBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pixelsPerUnit: number,
): void {
  const space = classicChipSpace();
  const chipRadius = solveChipWorldRadius(CHIP_RADIUS, pixelsPerUnit);
  const metrics = chipMetrics(pixelsPerUnit, 0.6157, chipRadius);

  const draw = (chips: RenderChip[], cx: number, cy: number) => {
    const view = { cx, cy: cy + FELT.y * 0.788 * pixelsPerUnit, scale: pixelsPerUnit, radiusZ: FELT.radiusZ };
    const projection = orthographicProjection(view);
    const sorted = [...chips].sort((a, b) => a.position.z - b.position.z || a.stackIndex - b.stackIndex);
    for (const chip of sorted) paintChipShadow(ctx, projection, space, chip, chipRadius);
    for (const chip of sorted) paintChip(ctx, projection, space, chip, chipRadius);
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#14472f";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
  const note = `${pixelsPerUnit.toFixed(0)} px/unit  ·  chip r=${metrics.radiusPx.toFixed(1)}px  ·  wall=${metrics.wallPx.toFixed(1)}px  ·  pitch=${metrics.pitchPx.toFixed(1)}px`;
  ctx.fillText(note, 16, 22);

  // Row 1: the four denominations, alone, so the face is judged on its own.
  DENOMINATIONS.forEach((denomination, index) => {
    draw([chipAt(denomination, 0, 0, 0, index * 31 + 3)], 70 + index * 74, 90);
  });

  // Row 2: columns of 1, 3, 5 and 9 — the heights the mound actually builds.
  [1, 3, 5, 9].forEach((tall, index) => {
    const column = Array.from({ length: tall }, (_, i) => chipAt(25, 0, 0, i, i * 17 + index * 7));
    draw(column, 70 + index * 74, 190);
  });

  // Row 3: the pot's silhouette at every tier. Reading these left to right is
  // the whole "size a pot without reading the number" claim.
  [1, 6, 14, 27, 54].forEach((count, index) => {
    const slots = pileSlots(count, chipRadius, MAX_POT_COLUMNS);
    const mound = slots.map((slot, i) => chipAt(
      DENOMINATIONS[(slot.column + i) % DENOMINATIONS.length],
      slot.offsetX,
      slot.offsetZ,
      slot.index,
      i * 13 + index * 101,
    ));
    draw(mound, 90 + index * 118, 330);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(`${count}`, 86 + index * 118, 366);
  });
}

export interface ChipLabProps {
  label: string;
  /** CSS pixels per world unit — see the header for where these come from. */
  pixelsPerUnit: number;
}

/** The still life, at one scale. */
export function ChipBoard({ label, pixelsPerUnit }: ChipLabProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas.width = Math.round(640 * ratio);
    canvas.height = Math.round(400 * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintBoard(ctx, 640, 400, pixelsPerUnit);
  }, [pixelsPerUnit]);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ color: "#cfd3da", font: '13px ui-monospace, Menlo, monospace', paddingBottom: 6 }}>
        {label}
      </figcaption>
      <canvas ref={ref} style={{ width: 640, height: 400, borderRadius: 10, display: "block" }} />
    </figure>
  );
}

/**
 * The motion bench: a real `ChipScene` on the classic room's table, cycling
 * through every action on a loop so each one can be watched next to the
 * others rather than waited for across a dozen hands.
 */
export function ChipMotionLab({ pixelsPerUnit }: { pixelsPerUnit: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Wide enough for the seat ring to be on canvas at all: a seat sits at
    // SEAT_RING.radiusScale * FELT.radiusX = 10.7 world units from the middle,
    // so at 44 px/unit the trays a bet leaves from are 470px out. A 640px
    // canvas cuts every launch point off and the flights appear from nowhere.
    const width = 1100;
    const height = 420;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const view = {
      cx: width / 2,
      cy: height / 2 + FELT.y * 0.788 * pixelsPerUnit,
      scale: pixelsPerUnit,
      radiusZ: FELT.radiusZ,
    };
    const projection = orthographicProjection(view);
    const space = classicChipSpace();
    const chipRadius = solveChipWorldRadius(CHIP_RADIUS, pixelsPerUnit);

    const scene = new ChipScene(() => {});
    scene.setSpace(space);
    scene.setChipRadius(chipRadius);

    const SEATS = 6;
    const script: Array<{ at: number; run: () => void; label: string }> = [
      { at: 0, label: "call", run: () => scene.spawnBet(1, SEATS, 40, 10, "call") },
      { at: 700, label: "bet", run: () => scene.spawnBet(2, SEATS, 90, 10, "bet") },
      { at: 1500, label: "raise", run: () => scene.spawnBet(4, SEATS, 260, 10, "raise") },
      { at: 2400, label: "all-in", run: () => scene.spawnBet(0, SEATS, 1400, 10, "all_in") },
      { at: 3600, label: "sweep", run: () => { scene.sweepBets(); scene.syncPile(1790, 10, false); } },
      { at: 5200, label: "payout", run: () => { scene.syncPile(1790, 10, true); scene.spawnFunnel([{ slot: 4, amount: 1790 }], SEATS, 10); } },
      { at: 6600, label: "reset", run: () => { scene.clearFlights(); scene.clearBets(); scene.syncPile(0, 10, false); } },
    ];

    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let cursor = 0;
    let phase = "idle";
    const loopMs = 7600;

    const frame = (now: number) => {
      const delta = Math.min(64, now - last);
      last = now;
      clock += delta;
      while (cursor < script.length && clock >= script[cursor].at) {
        phase = script[cursor].label;
        script[cursor].run();
        cursor += 1;
      }
      if (clock >= loopMs) {
        clock = 0;
        cursor = 0;
        // Standing bets are re-synced from scratch each lap.
        scene.syncBets([], SEATS, 10);
      }
      scene.update(delta, false);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#14472f";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText(`${phase}`, 16, 22);

      const chips = scene.drawList()
        .sort((a, b) => a.position.z - b.position.z || a.stackIndex - b.stackIndex);
      for (const chip of chips) paintChipShadow(ctx, projection, space, chip, chipRadius);
      for (const chip of chips) paintChip(ctx, projection, space, chip, chipRadius);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pixelsPerUnit]);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ color: "#cfd3da", font: '13px ui-monospace, Menlo, monospace', paddingBottom: 6 }}>
        Motion — call, bet, raise, all-in, sweep, payout, on a loop
      </figcaption>
      <canvas ref={ref} style={{ width: 1100, height: 420, borderRadius: 10, display: "block" }} />
    </figure>
  );
}

/** Exposed for the visual check; not used by the app. */
export type { ChipMoveKind };

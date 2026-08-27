"use client";

import { useEffect, useRef } from "react";
import { paintFace, paintWall } from "@/components/table/scene/chip-painter";
import type { ChipMaterial } from "@/lib/scene/chips/chip-spec";

/**
 * A chip design, drawn with the exact same `paintWall`/`paintFace` the
 * racetrack table itself calls — the same reasoning `CardBackArt` states for
 * card backs: the store's swatch and the chip that actually lands on a
 * player's stack have to be the same drawing, not two implementations of
 * "the Crimson design" that can drift apart.
 *
 * A flat `radial-gradient` circle used to stand in here. It read as a
 * colored marble, not a chip: no side wall, no edge inserts, no rim bevel,
 * none of the detail that makes `chip-painter.ts`'s own output recognizable
 * at a glance as a poker chip rather than a dot.
 *
 * Not tied to a denomination — a design applies to whichever of the four a
 * player assigns it to — so no numeral is drawn (`paintFace`'s numeral layer
 * is skipped by passing `denomination: null`); the rosette stamp still shows.
 *
 * Static (no animation, no `SceneProjection`/`RenderChip`), so this redraws
 * once per size rather than running a frame loop — a `ResizeObserver` is
 * enough to keep it sharp as the grid reflows under a phone width.
 */

// sin(28deg) -- lib/scene/table-anchors.ts's own CAMERA_ELEVATION_DEG, the
// racetrack camera's elevation. Keeps this swatch's face ellipse in the same
// proportions as a chip actually drawn on the table, without importing that
// file's whole perspective-camera surface for one constant.
const FACE_SQUASH = 0.47;

// The table clamps its wall to 3-4px regardless of radius (chip-spec.ts'
// MIN_WALL_PX/MAX_WALL_PX) -- a legibility floor for a chip drawn 6-17px
// wide, not the real proportion. At swatch size there's room for the wall to
// read closer to its intended ratio instead of vanishing into a rim line.
const WALL_TO_RADIUS = 0.24;

function draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, material: ChipMaterial): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rx = Math.min(width, height) * 0.42;
  const ry = rx * FACE_SQUASH;
  const wall = rx * WALL_TO_RADIUS;

  ctx.save();
  // The wall band hangs below the top face, so the chip's true vertical
  // extent is `2*ry + wall`, not `2*ry` -- center that, not just the face.
  ctx.translate(width / 2, (height - (ry * 2 + wall)) / 2 + ry);
  paintWall(ctx, rx, ry, wall, material.body, material.spot, 0);
  paintFace(ctx, rx, ry, material, 0, null, FACE_SQUASH);
  ctx.restore();
}

export function ChipDesignArt({ material, className }: { material: ChipMaterial; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const redraw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      draw(ctx, rect.width, rect.height, dpr, material);
    };

    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [material]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

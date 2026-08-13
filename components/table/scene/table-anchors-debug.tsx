"use client";

/**
 * A debug render of the rebuilt racetrack table: felt, rail, dealer space,
 * and a marker at every anchor `lib/scene/table-anchors.ts` defines. No
 * avatars, no chips, no cards -- just the geometry this foundation pass is
 * actually about, so proportions and framing can be judged before anything
 * gets built on top.
 */

import { useEffect, useRef } from "react";
import {
  dealerAnchor,
  debugMarkers,
  feltOutline,
  fitCameraToBox,
  project,
  railOutline,
  sceneBounds,
  type Box,
  type CameraView,
} from "@/lib/scene/table-anchors";
import { MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";

const MARKER_COLOR: Record<string, string> = {
  seat: "#5fd0ff",
  dealerAnchor: "#ff5f5f",
  communityCards: "#e8c766",
  pot: "#e8c766",
  button: "#ffffff",
};

function colorFor(id: string): string {
  if (id.startsWith("seat")) return MARKER_COLOR.seat;
  return MARKER_COLOR[id] ?? "#ffffff";
}

function drawStadiumPath(ctx: CanvasRenderingContext2D, view: CameraView, outline: { x: number; z: number }[]) {
  ctx.beginPath();
  outline.forEach((point, index) => {
    const { x, y } = project(view, { x: point.x, y: 0.9, z: point.z });
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

export interface TableAnchorsDebugProps {
  viewport: Box;
  label?: string;
}

export function TableAnchorsDebug({ viewport, label }: TableAnchorsDebugProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const view = fitCameraToBox(viewport);

    // Room floor -- everything behind the far rail, including the dealer's
    // own reserved space, so that space reads as real floor rather than
    // void.
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    // Rail: painted first as a solid stadium, then the felt on top leaves
    // exactly the band between the two outlines showing -- no path
    // subtraction needed for a shape this simple.
    drawStadiumPath(ctx, view, railOutline());
    ctx.fillStyle = "#141414";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#050505";
    ctx.stroke();

    drawStadiumPath(ctx, view, feltOutline());
    const felt = ctx.createLinearGradient(0, 0, 0, viewport.height);
    felt.addColorStop(0, "#1c6b3f");
    felt.addColorStop(1, "#0f4a2a");
    ctx.fillStyle = felt;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.stroke();

    // The dealer's reserved workspace -- a dashed outline behind the far
    // rail, so "there is room back here" is visible even with nothing
    // occupying it yet.
    const dealer = dealerAnchor();
    const bounds = sceneBounds();
    const workZoneTopLeft = project(view, { x: bounds.minX, y: 0.9, z: dealer.z - 0.2 });
    const workZoneBottomRight = project(view, { x: bounds.maxX, y: 0.9, z: bounds.minZ });
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 95, 95, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      workZoneTopLeft.x,
      workZoneBottomRight.y,
      workZoneBottomRight.x - workZoneTopLeft.x,
      workZoneTopLeft.y - workZoneBottomRight.y,
    );
    ctx.restore();

    // Debug markers, one per anchor.
    for (const marker of debugMarkers()) {
      const screen = project(view, marker.position);
      const color = colorFor(marker.id);

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, marker.id === "dealerAnchor" ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000000";
      ctx.stroke();

      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#f4f4f4";
      ctx.textAlign = "center";
      ctx.fillText(marker.label, screen.x, screen.y - 14);
    }
  }, [viewport]);

  return (
    <div style={{ display: "inline-block" }}>
      {label ? (
        <div style={{ color: "#cfcfcf", font: "13px system-ui, sans-serif", marginBottom: 6 }}>{label}</div>
      ) : null}
      <canvas
        ref={canvasRef}
        style={{ borderRadius: 8, boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}
      />
    </div>
  );
}

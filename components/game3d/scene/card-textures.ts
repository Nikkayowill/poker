"use client";

/**
 * Card faces and backs as generated CanvasTextures — crisp at table scale,
 * zero network fetches (the CSP allows no external assets), cached per
 * rank+suit so a texture is painted once per session.
 */

import * as THREE from "three";
import type { Card } from "@/lib/game/types";

const TEX_W = 256;
const TEX_H = 356;

const SUIT_GLYPHS: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const SUIT_COLORS: Record<Card["suit"], string> = {
  clubs: "#1c2026",
  spades: "#1c2026",
  diamonds: "#c22219",
  hearts: "#c22219",
};

const cache = new Map<string, THREE.CanvasTexture>();

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [canvas, ctx];
}

function finalize(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function cardFaceTexture(card: Card): THREE.CanvasTexture {
  const key = `${card.rank}-${card.suit}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const [canvas, ctx] = makeCanvas();
  ctx.fillStyle = "#f4f1e8";
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, 26);
  ctx.fill();
  ctx.strokeStyle = "#d8d3c4";
  ctx.lineWidth = 6;
  roundedRect(ctx, 3, 3, TEX_W - 6, TEX_H - 6, 24);
  ctx.stroke();

  const color = SUIT_COLORS[card.suit];
  const glyph = SUIT_GLYPHS[card.suit];
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Corner index, top-left and (rotated) bottom-right.
  ctx.font = "bold 64px Georgia, serif";
  ctx.fillText(card.rank, 44, 52);
  ctx.font = "52px Georgia, serif";
  ctx.fillText(glyph, 44, 112);
  ctx.save();
  ctx.translate(TEX_W - 44, TEX_H - 52);
  ctx.rotate(Math.PI);
  ctx.font = "bold 64px Georgia, serif";
  ctx.fillText(card.rank, 0, 0);
  ctx.font = "52px Georgia, serif";
  ctx.fillText(glyph, 0, -60);
  ctx.restore();

  // Big centre pip.
  ctx.font = "150px Georgia, serif";
  ctx.fillText(glyph, TEX_W / 2, TEX_H / 2 + 26);

  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}

export function cardBackTexture(): THREE.CanvasTexture {
  const cached = cache.get("back");
  if (cached) return cached;

  const [canvas, ctx] = makeCanvas();
  ctx.fillStyle = "#2a1440";
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, 26);
  ctx.fill();

  // Diagonal lattice.
  ctx.strokeStyle = "rgba(219, 156, 11, 0.35)";
  ctx.lineWidth = 3;
  for (let d = -TEX_H; d < TEX_W + TEX_H; d += 26) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + TEX_H, TEX_H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d, TEX_H);
    ctx.lineTo(d + TEX_H, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = "#db9c0b";
  ctx.lineWidth = 8;
  roundedRect(ctx, 12, 12, TEX_W - 24, TEX_H - 24, 18);
  ctx.stroke();

  const texture = finalize(canvas);
  cache.set("back", texture);
  return texture;
}

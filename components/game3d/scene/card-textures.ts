"use client";

/**
 * Card faces and backs as generated CanvasTextures — no network fetches
 * (the CSP allows no external assets), cached per rank+suit so a texture is
 * painted once per session.
 *
 * WHY THE SUITS ARE PATHS AND NOT GLYPHS. These used to be the Unicode
 * characters ♠♥♦♣ set in whatever serif the device had. That is a lottery:
 * the shapes, weights and metrics differ per platform, several fonts draw
 * the outlined variants, and none of them are designed to survive being
 * mipmapped down to a card the width of a thumbnail. Drawn as paths they
 * are the same on every device, and they are drawn *solid and chunky* on
 * purpose — a delicate engraving is what turns to grey mush at this size.
 *
 * WHY THE PIPS ARE LAID OUT PROPERLY. A single huge centre pip on every
 * rank reads as a placeholder, because the pip count is most of what makes
 * a playing card look like a playing card. The traditional arrangements
 * are here, with the lower half rotated a half turn as a real card has it.
 *
 * RESOLUTION. 512x716 keeps the real 63.5:88.9 proportion and gives the
 * board room to be read: a board card is about 57 CSS px wide on a 1440px
 * desktop and twice that on a retina panel, and mipmapping down from a
 * generous source is what keeps the rank crisp instead of soft.
 */

import * as THREE from "three";
import type { Card } from "@/lib/game/types";

const TEX_W = 512;
const TEX_H = 716;

/**
 * Both inks are far darker than a card looks in the hand, and both numbers
 * were read off a render rather than chosen.
 *
 * The felt is lit at roughly 3x and the scene tone-maps through ACES
 * (R3F's default), so a saturated ink clips its strongest channel and the
 * tone curve then desaturates the highlight: a proper #c0261d card red
 * measured (255,125,101) on screen — salmon. Pre-darkening in the texture
 * is the right lever, because the alternative is taking the cards out of
 * the room's lighting and making them the one prop lit differently from
 * everything around them. At #4d0207 the same pip measures (194,90,81),
 * which is a card red.
 */
const RED = "#4d0207";
const BLACK = "#05070b";
const PAPER = "#fbf9f4";
const PAPER_EDGE = "#e9e4d8";

function suitColor(suit: Card["suit"]): string {
  return suit === "hearts" || suit === "diamonds" ? RED : BLACK;
}

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

/* ------------------------------------------------------------------ */
/* Suit paths — drawn into a unit box centred on the origin            */
/* ------------------------------------------------------------------ */

function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0.46 * s);
  ctx.bezierCurveTo(-0.62 * s, 0.02 * s, -0.52 * s, -0.44 * s, -0.2 * s, -0.44 * s);
  ctx.bezierCurveTo(-0.06 * s, -0.44 * s, 0, -0.32 * s, 0, -0.24 * s);
  ctx.bezierCurveTo(0, -0.32 * s, 0.06 * s, -0.44 * s, 0.2 * s, -0.44 * s);
  ctx.bezierCurveTo(0.52 * s, -0.44 * s, 0.62 * s, 0.02 * s, 0, 0.46 * s);
  ctx.closePath();
}

function diamondPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, -0.5 * s);
  ctx.quadraticCurveTo(0.16 * s, -0.16 * s, 0.4 * s, 0);
  ctx.quadraticCurveTo(0.16 * s, 0.16 * s, 0, 0.5 * s);
  ctx.quadraticCurveTo(-0.16 * s, 0.16 * s, -0.4 * s, 0);
  ctx.quadraticCurveTo(-0.16 * s, -0.16 * s, 0, -0.5 * s);
  ctx.closePath();
}

function spadePath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, -0.5 * s);
  ctx.bezierCurveTo(0.1 * s, -0.26 * s, 0.58 * s, -0.06 * s, 0.58 * s, 0.14 * s);
  ctx.bezierCurveTo(0.58 * s, 0.32 * s, 0.4 * s, 0.4 * s, 0.24 * s, 0.4 * s);
  ctx.bezierCurveTo(0.14 * s, 0.4 * s, 0.06 * s, 0.35 * s, 0.03 * s, 0.29 * s);
  // Stem.
  ctx.bezierCurveTo(0.05 * s, 0.4 * s, 0.11 * s, 0.47 * s, 0.19 * s, 0.5 * s);
  ctx.lineTo(-0.19 * s, 0.5 * s);
  ctx.bezierCurveTo(-0.11 * s, 0.47 * s, -0.05 * s, 0.4 * s, -0.03 * s, 0.29 * s);
  ctx.bezierCurveTo(-0.06 * s, 0.35 * s, -0.14 * s, 0.4 * s, -0.24 * s, 0.4 * s);
  ctx.bezierCurveTo(-0.4 * s, 0.4 * s, -0.58 * s, 0.32 * s, -0.58 * s, 0.14 * s);
  ctx.bezierCurveTo(-0.58 * s, -0.06 * s, -0.1 * s, -0.26 * s, 0, -0.5 * s);
  ctx.closePath();
}

function clubPath(ctx: CanvasRenderingContext2D, s: number) {
  const r = 0.2 * s;
  ctx.beginPath();
  ctx.arc(0, -0.24 * s, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.arc(-0.26 * s, 0.1 * s, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.arc(0.26 * s, 0.1 * s, r, 0, Math.PI * 2);
  ctx.closePath();
  // Stem, drawn as part of the same fill so the shape stays one silhouette.
  ctx.moveTo(-0.19 * s, 0.5 * s);
  ctx.bezierCurveTo(-0.08 * s, 0.44 * s, -0.05 * s, 0.3 * s, -0.04 * s, 0.14 * s);
  ctx.lineTo(0.04 * s, 0.14 * s);
  ctx.bezierCurveTo(0.05 * s, 0.3 * s, 0.08 * s, 0.44 * s, 0.19 * s, 0.5 * s);
  ctx.closePath();
}

/** Draw a suit centred at (cx, cy), `size` tall, optionally half-turned. */
function drawSuit(
  ctx: CanvasRenderingContext2D,
  suit: Card["suit"],
  cx: number,
  cy: number,
  size: number,
  flipped = false
) {
  ctx.save();
  ctx.translate(cx, cy);
  if (flipped) ctx.rotate(Math.PI);
  ctx.fillStyle = suitColor(suit);
  if (suit === "hearts") heartPath(ctx, size);
  else if (suit === "diamonds") diamondPath(ctx, size);
  else if (suit === "spades") spadePath(ctx, size);
  else clubPath(ctx, size);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Pip layouts                                                         */
/* ------------------------------------------------------------------ */

/**
 * Traditional pip positions as (x, y) in a -1..1 box, where y < 0 is the
 * top half. Pips below the middle are drawn a half turn round, as they are
 * on a real card.
 */
const PIP_LAYOUTS: Record<string, Array<[number, number]>> = {
  "2": [[0, -0.72], [0, 0.72]],
  "3": [[0, -0.72], [0, 0], [0, 0.72]],
  "4": [[-0.55, -0.72], [0.55, -0.72], [-0.55, 0.72], [0.55, 0.72]],
  "5": [[-0.55, -0.72], [0.55, -0.72], [0, 0], [-0.55, 0.72], [0.55, 0.72]],
  "6": [
    [-0.55, -0.72], [0.55, -0.72],
    [-0.55, 0], [0.55, 0],
    [-0.55, 0.72], [0.55, 0.72],
  ],
  "7": [
    [-0.55, -0.72], [0.55, -0.72],
    [0, -0.36],
    [-0.55, 0], [0.55, 0],
    [-0.55, 0.72], [0.55, 0.72],
  ],
  "8": [
    [-0.55, -0.72], [0.55, -0.72],
    [0, -0.36],
    [-0.55, 0], [0.55, 0],
    [0, 0.36],
    [-0.55, 0.72], [0.55, 0.72],
  ],
  "9": [
    [-0.55, -0.78], [0.55, -0.78],
    [-0.55, -0.26], [0.55, -0.26],
    [0, 0],
    [-0.55, 0.26], [0.55, 0.26],
    [-0.55, 0.78], [0.55, 0.78],
  ],
  "10": [
    [-0.55, -0.78], [0.55, -0.78],
    [0, -0.52],
    [-0.55, -0.26], [0.55, -0.26],
    [-0.55, 0.26], [0.55, 0.26],
    [0, 0.52],
    [-0.55, 0.78], [0.55, 0.78],
  ],
};

const COURT = new Set(["J", "Q", "K"]);

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
  /*
   * Anisotropy matters more here than resolution does, and it is worth
   * saying why. These cards lie flat on the felt under a camera pitched
   * 46 degrees down, so their texture is compressed hard along one axis
   * on screen. Without anisotropic filtering the GPU picks a mip level
   * from the *worst* axis and blurs both — measured on a render, a solid
   * red pip came back as (255,125,101) salmon and a black one as
   * (118,111,103) grey, because each was being averaged with the white
   * paper around it. Nothing about the paint was wrong; it was being
   * sampled away. three clamps this to whatever the device supports.
   */
  texture.anisotropy = 16;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

/** The paper: a warm off-white with a whisper of tone toward the edges. */
function paintFace(ctx: CanvasRenderingContext2D) {
  const wash = ctx.createLinearGradient(0, 0, 0, TEX_H);
  wash.addColorStop(0, PAPER);
  wash.addColorStop(1, PAPER_EDGE);
  ctx.fillStyle = wash;
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, 46);
  ctx.fill();
}

/** Rank plus its suit, stacked, at one corner. */
function paintIndex(
  ctx: CanvasRenderingContext2D,
  card: Card,
  flipped: boolean
) {
  // 0.155 down, not 0.115: at the index size below, a glyph centred any
  // higher runs its cap out through the card's rounded top corner.
  const inset = TEX_W * 0.145;
  const drop = TEX_H * 0.155;
  ctx.save();
  if (flipped) {
    ctx.translate(TEX_W - inset, TEX_H - drop);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(inset, drop);
  }
  ctx.fillStyle = suitColor(card.suit);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  /*
   * Still oversized against a real card, which spends about a quarter of
   * its width on the index because you hold it in your hand. This one lies
   * on a table two metres away, so the rank alone takes ~34% of the width.
   * Ten is the reason for the condensed scale below: two glyphs at that
   * size would run into the pips.
   */
  const size = Math.round(TEX_W * (card.rank === "10" ? 0.25 : 0.31));
  ctx.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  ctx.fillText(card.rank, 0, 0);
  drawSuit(ctx, card.suit, 0, TEX_H * 0.093, TEX_W * 0.155);
  ctx.restore();
}

export function cardFaceTexture(card: Card): THREE.CanvasTexture {
  const key = `${card.rank}-${card.suit}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const [canvas, ctx] = makeCanvas();
  paintFace(ctx);

  paintIndex(ctx, card, false);
  paintIndex(ctx, card, true);

  // The middle: pips for the spot cards, a framed monogram for the court,
  // one big pip for the ace.
  const midX = TEX_W / 2;
  const midY = TEX_H / 2;
  // The pip field, as half-extents. Wide enough that a nine or a ten reads
  // as columns rather than a crowd, inset enough to clear both indices.
  const boxW = TEX_W * 0.245;
  const boxH = TEX_H * 0.285;

  if (card.rank === "A") {
    drawSuit(ctx, card.suit, midX, midY, TEX_W * 0.56);
  } else if (COURT.has(card.rank)) {
    const color = suitColor(card.suit);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = TEX_W * 0.018;
    roundedRect(ctx, TEX_W * 0.2, TEX_H * 0.26, TEX_W * 0.6, TEX_H * 0.48, 18);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = TEX_W * 0.008;
    roundedRect(ctx, TEX_W * 0.235, TEX_H * 0.285, TEX_W * 0.53, TEX_H * 0.43, 12);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(TEX_W * 0.42)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(card.rank, midX, midY - TEX_H * 0.03);
    drawSuit(ctx, card.suit, midX, midY + TEX_H * 0.16, TEX_W * 0.2);
  } else {
    const layout = PIP_LAYOUTS[card.rank] ?? [];
    // Nine and ten pack four rows into the same field, so their pips step
    // down or they collide.
    const pip = TEX_W * (layout.length >= 9 ? 0.155 : 0.185);
    for (const [px, py] of layout) {
      drawSuit(ctx, card.suit, midX + px * boxW, midY + py * boxH, pip, py > 0.02);
    }
  }

  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}

export function cardBackTexture(): THREE.CanvasTexture {
  const cached = cache.get("back");
  if (cached) return cached;

  const [canvas, ctx] = makeCanvas();

  // House colours, and a plate rather than a flat fill so the back catches
  // the room's light the way the faces do.
  const wash = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
  wash.addColorStop(0, "#3d1a52");
  wash.addColorStop(0.5, "#2a1440");
  wash.addColorStop(1, "#1d0e2e");
  ctx.fillStyle = wash;
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, 46);
  ctx.fill();

  ctx.save();
  roundedRect(ctx, 0, 0, TEX_W, TEX_H, 46);
  ctx.clip();

  // Fine diagonal lattice, doubled to make a diamond weave.
  ctx.strokeStyle = "rgba(219, 156, 11, 0.22)";
  ctx.lineWidth = 2.5;
  const step = 34;
  for (let d = -TEX_H; d < TEX_W + TEX_H; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + TEX_H, TEX_H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d, TEX_H);
    ctx.lineTo(d + TEX_H, 0);
    ctx.stroke();
  }

  // A centre medallion so the back has a focal point rather than reading
  // as wallpaper at a glance.
  ctx.fillStyle = "rgba(219, 156, 11, 0.16)";
  ctx.beginPath();
  ctx.ellipse(TEX_W / 2, TEX_H / 2, TEX_W * 0.24, TEX_W * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(219, 156, 11, 0.55)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Gold keyline, inset, matching the faces' rounded corners.
  ctx.strokeStyle = "#db9c0b";
  ctx.lineWidth = 9;
  roundedRect(ctx, 20, 20, TEX_W - 40, TEX_H - 40, 30);
  ctx.stroke();

  const texture = finalize(canvas);
  cache.set("back", texture);
  return texture;
}

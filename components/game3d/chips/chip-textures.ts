"use client";

/**
 * Chip faces and edges as generated CanvasTextures.
 *
 * A chip used to be a cylinder wearing two flat colours, which is why a
 * pile read as a stack of counters: everything that makes a clay chip
 * recognisable — the moulded edge inserts, the ring of face wedges, the
 * printed inlay — is surface detail, and there was none of it.
 *
 * Painted rather than shipped, for the same two reasons the card textures
 * are: the artifact's CSP allows no external assets, and a drawn chip stays
 * crisp at any DPI where a small PNG would not. Six denominations means
 * twelve textures for the entire session, built once and cached.
 *
 * The anatomy is drawn at real proportions (see lib/game3d/dimensions.ts):
 * the inlay is 54% of the chip's width and the inserts sit in the outer
 * quarter, which is where they are on a 39 mm chip.
 */

import * as THREE from "three";
import type { ChipDenomination } from "@/lib/game3d/denominations";

/** Face canvas is square: a cylinder cap's UVs inscribe a circle in it. */
const FACE_SIZE = 256;
/** The edge unwraps to a long strip — width is the circumference. */
const EDGE_W = 512;
const EDGE_H = 64;

/**
 * Inserts around the chip. Eight is the cadence the 2D room's painted chips
 * have used through two renderers, and it is the common moulded count.
 */
const INSERT_COUNT = 8;

const faceCache = new Map<number, THREE.CanvasTexture>();
const edgeCache = new Map<number, THREE.CanvasTexture>();

function context(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [canvas, ctx];
}

function finalise(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One face: body ring, eight insert wedges, the pressed inlay and its
 * printed value.
 *
 * The numeral is drawn even though a chip is only ~20 px across on screen.
 * At that size it is not read as a number — it reads as *print*, which is
 * the difference between a chip and a checker, and it costs one fillText
 * once per denomination.
 */
export function chipFaceTexture(denom: ChipDenomination): THREE.CanvasTexture {
  const cached = faceCache.get(denom.value);
  if (cached) return cached;

  const [canvas, ctx] = context(FACE_SIZE, FACE_SIZE);
  const centre = FACE_SIZE / 2;
  const radius = FACE_SIZE / 2;

  // Transparent outside the disc: the cap's UV circle is inscribed in this
  // square, so the corners are never sampled — but leaving them clear keeps
  // any edge bleed from painting a square halo.
  ctx.clearRect(0, 0, FACE_SIZE, FACE_SIZE);

  // The clay body, lit slightly from the top-left so the disc has a form.
  const body = ctx.createRadialGradient(
    centre - radius * 0.3, centre - radius * 0.3, radius * 0.1,
    centre, centre, radius,
  );
  body.addColorStop(0, shade(denom.body, 0.18));
  body.addColorStop(0.75, denom.body);
  body.addColorStop(1, shade(denom.body, -0.22));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.fill();

  // The inserts, as true angular sectors clipped to the outer ring, so they
  // sit flush with the rim exactly as moulded ones do.
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.98, 0, Math.PI * 2);
  ctx.arc(centre, centre, radius * 0.7, 0, Math.PI * 2);
  ctx.clip("evenodd");
  ctx.fillStyle = denom.spot;
  const step = (Math.PI * 2) / INSERT_COUNT;
  for (let i = 0; i < INSERT_COUNT; i += 1) {
    const angle = i * step;
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.arc(centre, centre, radius, angle - step * 0.22, angle + step * 0.22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // The groove scored between the inserts and the inlay.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.32)";
  ctx.lineWidth = radius * 0.035;
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.68, 0, Math.PI * 2);
  ctx.stroke();

  // The pressed inlay: a flat disc with a soft inner shadow along its top
  // edge, which is what tells the eye it is set *into* the clay.
  ctx.fillStyle = denom.inlay;
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.54, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.54, 0, Math.PI * 2);
  ctx.clip();
  ctx.shadowColor = "rgba(20, 14, 6, 0.5)";
  ctx.shadowBlur = radius * 0.12;
  ctx.shadowOffsetY = radius * 0.05;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = radius * 0.1;
  ctx.beginPath();
  ctx.arc(centre, centre, radius * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // The value, in the serif the rest of the table prints numbers in.
  const label = String(denom.value);
  ctx.fillStyle = denom.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(radius * (label.length > 3 ? 0.34 : 0.46))}px Georgia, serif`;
  ctx.fillText(label, centre, centre + radius * 0.02);

  const texture = finalise(canvas);
  faceCache.set(denom.value, texture);
  return texture;
}

/**
 * The edge: body colour banded by the same eight inserts, so a chip seen
 * from the side — which is how most of a resting pile is seen — still says
 * what it is worth. Wrapped around the cylinder, the strip's width is the
 * circumference, so the insert count here and on the face agree by
 * construction.
 */
export function chipEdgeTexture(denom: ChipDenomination): THREE.CanvasTexture {
  const cached = edgeCache.get(denom.value);
  if (cached) return cached;

  const [canvas, ctx] = context(EDGE_W, EDGE_H);
  const vertical = ctx.createLinearGradient(0, 0, 0, EDGE_H);
  vertical.addColorStop(0, shade(denom.body, 0.1));
  vertical.addColorStop(0.55, denom.body);
  vertical.addColorStop(1, shade(denom.body, -0.3));
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, EDGE_W, EDGE_H);

  const bandWidth = EDGE_W / INSERT_COUNT;
  ctx.fillStyle = denom.spot;
  for (let i = 0; i < INSERT_COUNT; i += 1) {
    // Inset vertically: an insert is moulded into the middle of the edge and
    // never runs to the rim, which is what stops the stack reading as stripes.
    ctx.fillRect(i * bandWidth + bandWidth * 0.3, EDGE_H * 0.16, bandWidth * 0.4, EDGE_H * 0.68);
  }

  // A darker lip top and bottom: the chamfer catching less light.
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillRect(0, 0, EDGE_W, EDGE_H * 0.08);
  ctx.fillRect(0, EDGE_H * 0.92, EDGE_W, EDGE_H * 0.08);

  const texture = finalise(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  edgeCache.set(denom.value, texture);
  return texture;
}

/** A hex colour pushed toward white (positive) or black (negative). */
function shade(hex: string, amount: number): string {
  const value = parseInt(hex.replace("#", ""), 16);
  const toward = amount >= 0 ? 255 : 0;
  const mix = (channel: number) =>
    Math.round(channel + (toward - channel) * Math.abs(amount));
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `rgb(${r}, ${g}, ${b})`;
}

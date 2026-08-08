"use client";

/**
 * Builds ONE CanvasTexture holding every card face plus the shared back, by
 * compositing the already-correct, already-tuned per-card canvases from
 * card-textures.ts (cardFaceTexture/cardBackTexture) into the grid
 * lib/game3d/card-atlas.ts defines. Reusing those functions rather than
 * repainting is deliberate: this is the one place in the room that would
 * otherwise need to duplicate every lesson that file's header already
 * records (pre-darkened inks, drawn suits, pip layouts, anisotropy) to
 * build a second, atlas-shaped version of the same 53 images. A
 * THREE.CanvasTexture keeps its source canvas on `.image`
 * (@types/three: `CanvasTexture<TCanvas = HTMLCanvasElement>`), so reading
 * it and `drawImage`-ing it elsewhere is an ordinary, typed three.js API —
 * not a reach into internals.
 *
 * SIZE. Each cell is far smaller than a single card's own 512x716: that
 * resolution was chosen for a texture filling an entire GPU slot on its
 * own, and the room only ever shows a hole card at a modest fraction of
 * the screen (NEAR_HOLE_CARD_SCALE 1.8x is the largest any card gets — see
 * cards-3d.tsx; the board is DOM now, not in-scene). At 176x246 per cell,
 * the atlas is ~1408x1722 total, and it REPLACES 53 separately-cached
 * 512x716 canvases (~78MB) with one ~10MB texture (plus its mip chain) —
 * this is a memory win on top of the draw-call win, not a trade against it.
 *
 * MIPMAP BLEED. A texture atlas sampled with mipmaps has one hazard a
 * single-image texture never does: as the GPU minifies (a card seen at a
 * glancing angle, or simply farther away), trilinear filtering can sample
 * a few texels past a cell's nominal edge — which, in an atlas, is a
 * DIFFERENT card. Two adjacent cells in this grid are two different suits
 * of the same rank (alternating black/red), so this is a real, visible
 * risk here, not a theoretical one. The standard fix is a padded gutter;
 * this file paints it as a two-pass composite rather than shrinking the UV
 * rect a card-atlas.ts consumer reads (which would mean two systems — the
 * pure UV math and this pixel math — agreeing on one gutter number, the
 * exact "two places, one number" shape this codebase's own notes warn
 * about). Pass 1 draws every card OVERSIZED at its own cell's nominal
 * position, so what a coarse mip level bleeds into is that cell's OWN
 * (self-similar, paper-coloured) edge, not a neighbour's ink. Pass 2 draws
 * every card again at its exact 1:1 rect on top, so the crisp interior —
 * what mip level 0 actually samples, which is every card at the distance
 * this room ever shows one — is pixel-perfect.
 *
 * NOT VERIFIED ON A REAL GPU. This codebase's own card-textures.ts already
 * recorded that anisotropic filtering "cannot be judged headlessly —
 * SwiftShader ignores it". The same limit applies here, more so: whether
 * this gutter actually kills visible bleed is a real-device check, not a
 * unit-test-shaped one. Judge it on a played hand, not on this comment.
 */

import * as THREE from "three";
import type { Card } from "@/lib/game/types";
import {
  ATLAS_CELL_ORDER,
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  atlasCellOrigin,
  type AtlasCardKey,
} from "@/lib/game3d/card-atlas";
import { cardBackTexture, cardFaceTexture } from "./card-textures";

const CELL_W = 176;
const CELL_H = 246;

/** How far each cell's own edge is stretched into its gutter in pass 1, as
 * a fraction of the cell's own size — comfortably past the fraction any
 * mip level this room reaches actually blurs across. */
const BLEED_FRACTION = 0.03;

function keyToCard(key: AtlasCardKey): Card | null {
  if (key === "back") return null;
  const separator = key.indexOf("-");
  return {
    rank: key.slice(0, separator) as Card["rank"],
    suit: key.slice(separator + 1) as Card["suit"],
  };
}

function sourceCanvasFor(key: AtlasCardKey): HTMLCanvasElement {
  const card = keyToCard(key);
  return (card ? cardFaceTexture(card) : cardBackTexture()).image;
}

let cached: THREE.CanvasTexture | null = null;

export function cardAtlasTexture(): THREE.CanvasTexture {
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * ATLAS_COLUMNS;
  canvas.height = CELL_H * ATLAS_ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  const bleedX = CELL_W * BLEED_FRACTION;
  const bleedY = CELL_H * BLEED_FRACTION;

  // Pass 1: the gutter. See this file's header for why this is oversized
  // self-bleed rather than a shared inset in the UV math.
  for (const key of ATLAS_CELL_ORDER) {
    const { x, y } = atlasCellOrigin(key, CELL_W, CELL_H);
    ctx.drawImage(
      sourceCanvasFor(key),
      x - bleedX,
      y - bleedY,
      CELL_W + bleedX * 2,
      CELL_H + bleedY * 2,
    );
  }

  // Pass 2: the crisp interior, exact rect, on top of every cell's gutter.
  for (const key of ATLAS_CELL_ORDER) {
    const { x, y } = atlasCellOrigin(key, CELL_W, CELL_H);
    ctx.drawImage(sourceCanvasFor(key), x, y, CELL_W, CELL_H);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  cached = texture;
  return texture;
}

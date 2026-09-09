// Types only: the Phaser runtime must not enter an art module (see the note
// at the top of stackacres-art.ts).
import type * as Phaser from "phaser";
import {
  TERRAIN_ATLAS_COLUMNS,
  TERRAIN_FRAME,
  TERRAIN_OVERHANG,
  terrainChunkScreenRect,
  tileFrameOffset,
  type TerrainChunk,
} from "@/lib/stackacres/terrain";
import { powerOfTwoCeil } from "@/lib/stackacres/world";
import { ART_FRAME, ART_SCALE } from "./art-kit";

/**
 * The terrain tiles -- sea, shore, pond, roads and yards -- baked a chunk at
 * a time from the pack's atlas (lib/stackacres/terrain.ts decides which
 * tile goes where; this only draws them).
 *
 * WHY A BAKE AND NOT A SPRITE PER TILE. The tiles are diamonds with hard
 * alpha edges. Drawn as separate images and minified, every edge blends
 * with the transparent frame around it and the lawn shows through as a
 * hairline grid between neighbours. Copied 1:1 into one canvas they abut
 * pixel for pixel, the canvas is opaque wherever the ground is, and it is
 * the canvas that gets minified -- the same reason the lawn is one seamless
 * texture rather than a field of stamps.
 *
 * Chunks share textures by content: a straight run of road or shore is the
 * same picture chunk after chunk, and `terrainChunks` keys them so, which
 * is what keeps the whole coast at a couple of canvases.
 */

export const TERRAIN_ATLAS_KEY = "terrainAtlas";
export const TERRAIN_ATLAS_URL = "/stackacres/sprites/terrain-atlas.png";
export const SEA_TILE_KEY = "seaTile";
export const SEA_TILE_URL = "/stackacres/sprites/deep-tile.png";

/**
 * Canvas pixels per screen unit in a terrain bake: two on desktop, which
 * copies the pack's pixels 1:1 (a 64 px frame is 32 screen units), and one
 * on a phone, where the same ART_SCALE halving every other bake takes
 * applies -- a clean 2:1 shrink at bake time, once.
 */
export const TERRAIN_PX = ART_SCALE / 4;

export interface TerrainBake {
  key: string;
  /** Screen position of the texture's top-left corner, overhang included. */
  x: number;
  y: number;
}

export function terrainTextureKey(chunk: TerrainChunk): string {
  return `terrain-${chunk.key}`;
}

/**
 * One chunk's canvas: its projected box plus `TERRAIN_OVERHANG` above it
 * for the blades of its top row, padded to a power of two. Tiles are drawn
 * in the order the chunk lists them (north to south). A chunk whose key was
 * already baked returns the existing texture.
 */
export function bakeTerrainChunk(scene: Phaser.Scene, chunk: TerrainChunk): TerrainBake | null {
  const rect = terrainChunkScreenRect(chunk.cx, chunk.cy);
  const key = terrainTextureKey(chunk);
  const at = { key, x: rect.x, y: rect.y - TERRAIN_OVERHANG };
  if (scene.textures.exists(key)) return at;
  if (!scene.textures.exists(TERRAIN_ATLAS_KEY)) return null;
  const atlas = scene.textures.get(TERRAIN_ATLAS_KEY).getSourceImage() as CanvasImageSource;
  const wpx = Math.ceil(rect.width * TERRAIN_PX);
  const hpx = Math.ceil((rect.height + TERRAIN_OVERHANG) * TERRAIN_PX);
  const texture = scene.textures.createCanvas(key, powerOfTwoCeil(wpx), powerOfTwoCeil(hpx));
  if (!texture) return null;
  const c = texture.context;
  // 1:1 on desktop wants no resampling at all; the phone's 2:1 shrink wants
  // the browser's box filter rather than dropped pixels.
  c.imageSmoothingEnabled = TERRAIN_PX < 2;
  const size = (TERRAIN_FRAME / 2) * TERRAIN_PX;
  for (const tile of chunk.tiles) {
    const off = tileFrameOffset(chunk, tile);
    const sx = (tile.frame % TERRAIN_ATLAS_COLUMNS) * TERRAIN_FRAME;
    const sy = Math.floor(tile.frame / TERRAIN_ATLAS_COLUMNS) * TERRAIN_FRAME;
    c.drawImage(
      atlas,
      sx,
      sy,
      TERRAIN_FRAME,
      TERRAIN_FRAME,
      off.x * TERRAIN_PX,
      (off.y + TERRAIN_OVERHANG) * TERRAIN_PX,
      size,
      size,
    );
  }
  texture.add(ART_FRAME, 0, 0, 0, wpx, hpx);
  texture.refresh();
  return at;
}

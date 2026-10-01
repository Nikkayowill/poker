"use client";

/**
 * Baking a look in the browser (lib/stackacres/wardrobe/bake.ts) for the map
 * and the mirror's preview. Layers are decoded with the baker's own PNG
 * decoder, never through a canvas: a canvas stores premultiplied colour and
 * would shift the hair's half-transparent edge.
 */

import { bakeFarmerSheet, bakePreview, decodePng, type BakeData, type RgbaImage } from "@/lib/stackacres/wardrobe/bake";
import { WARDROBE_CATALOGUE } from "@/lib/stackacres/wardrobe/catalogue";
import { lookKey } from "@/lib/stackacres/wardrobe/look";
import type { FarmerLook } from "@/lib/stackacres/wardrobe/types";

const ROOT = "/stackacres-td/wardrobe/";

/** farmer.json's standing frames, in the preview's turn order: front, left, back, right. */
const PREVIEW_FRAMES = [1, 9, 5, 13] as const;

let bakeData: Promise<BakeData> | null = null;
const layers = new Map<string, Promise<RgbaImage>>();
const sheets = new Map<string, Promise<HTMLImageElement>>();

function loadBakeData(): Promise<BakeData> {
  bakeData ??= fetch(`${ROOT}bake.json`).then(async (response) => {
    if (!response.ok) throw new Error("wardrobe: bake data did not load");
    return (await response.json()) as BakeData;
  });
  return bakeData;
}

function loadLayer(path: string): Promise<RgbaImage> {
  let layer = layers.get(path);
  if (!layer) {
    layer = fetch(`${ROOT}${path}`).then(async (response) => {
      if (!response.ok) throw new Error(`wardrobe: ${path} did not load`);
      return decodePng(new Uint8Array(await response.arrayBuffer()));
    });
    layers.set(path, layer);
  }
  return layer;
}

function toCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  // Every pixel of a baked frame is fully opaque or fully clear, so this is lossless.
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

/** The whole sheet for a look, as an image Phaser can take as an atlas. Cached per look. */
export function bakeLookImage(look: FarmerLook): Promise<HTMLImageElement> {
  const key = lookKey(look);
  let sheet = sheets.get(key);
  if (!sheet) {
    sheet = (async () => {
      const baked = await bakeFarmerSheet(look, WARDROBE_CATALOGUE, await loadBakeData(), loadLayer);
      const canvas = toCanvas(baked);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((made) => (made ? resolve(made) : reject(new Error("wardrobe: sheet did not encode"))), "image/png"),
      );
      const image = new Image();
      image.src = URL.createObjectURL(blob);
      await image.decode();
      return image;
    })();
    sheet.catch(() => sheets.delete(key));
    sheets.set(key, sheet);
  }
  return sheet;
}

/** The four standing frames of a look for the mirror, front/left/back/right. */
export async function lookPreviewFrames(look: FarmerLook): Promise<readonly HTMLCanvasElement[]> {
  const frames = await bakePreview(look, WARDROBE_CATALOGUE, await loadBakeData(), loadLayer, PREVIEW_FRAMES);
  return PREVIEW_FRAMES.map((frame) => toCanvas(frames.get(frame)!));
}

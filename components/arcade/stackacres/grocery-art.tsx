"use client";

import { useEffect, useRef } from "react";
import { itemVariants, type GroceryItemKind } from "@/lib/stackacres/grocery-layout";

/**
 * The grocery's pictures for its sheets, drawn from the same sheets the map uses: a fixture or piece of decor
 * from the room's props and decor atlases, and a person from their character sheet. Pixel art at whole-number
 * scale, so it matches the map.
 */

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}
interface Atlas {
  image: HTMLImageElement;
  frames: Record<string, AtlasFrame>;
}

const atlases = new Map<string, Promise<Atlas>>();

function loadAtlas(png: string, json: string): Promise<Atlas> {
  const key = `${png}|${json}`;
  let pending = atlases.get(key);
  if (!pending) {
    pending = Promise.all([
      fetch(json).then((res) => res.json() as Promise<{ frames: Record<string, AtlasFrame> }>),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = png;
      }),
    ]).then(([data, image]) => ({ image, frames: data.frames }));
    // A failed load isn't kept, so the next picture tries again.
    pending.catch(() => atlases.delete(key));
    atlases.set(key, pending);
  }
  return pending;
}

const ROOM = "/stackacres-td/areas/grocery";
const roomAtlas = () => loadAtlas(`${ROOM}/props.png`, `${ROOM}/props.json`);
const decorAtlas = () => loadAtlas(`${ROOM}/decor.png`, `${ROOM}/decor.json`);

function useCanvas(draw: (canvas: HTMLCanvasElement) => Promise<void>, deps: readonly unknown[]) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true;
    void draw(canvas).catch(() => {
      if (live) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what the picture depends on
  }, deps);
  return ref;
}

/**
 * A fixture or piece of decor as it stands on the floor, fitted into a `width` x `height` box at the largest
 * whole-number scale of its map-sized picture that fits.
 */
export function GroceryItemPicture({ kind, width = 72, height = 48 }: { kind: GroceryItemKind; width?: number; height?: number }) {
  const ref = useCanvas(
    async (canvas) => {
      const pieces = itemVariants(kind)[0];
      const [room, decor] = await Promise.all([roomAtlas(), decorAtlas()]);
      // The pieces' bounds in map pixels, from the item's corner.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const piece of pieces) {
        x0 = Math.min(x0, piece.x - piece.ax);
        y0 = Math.min(y0, piece.y - piece.ay);
        x1 = Math.max(x1, piece.x - piece.ax + piece.w);
        y1 = Math.max(y1, piece.y - piece.ay + piece.h);
      }
      if (!Number.isFinite(x0)) return;
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      // The atlases hold the pack's pictures at twice map size, so a scale counts in those pixels.
      const fit = Math.max(1, Math.floor(Math.min((width * dpr) / ((x1 - x0) * 2), (height * dpr) / ((y1 - y0) * 2))));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const drawnW = (x1 - x0) * 2 * fit;
      const drawnH = (y1 - y0) * 2 * fit;
      const left = Math.round((canvas.width - drawnW) / 2);
      const top = Math.round(canvas.height - drawnH);
      // Back to front, the way the room sorts them.
      for (const piece of [...pieces].sort((a, b) => (a.flat === b.flat ? a.y - b.y : a.flat ? -1 : 1))) {
        const atlas = piece.atlas === "decor" ? decor : room;
        const frame = atlas.frames[piece.frame]?.frame;
        if (!frame) continue;
        const scale = piece.scale * 2 * fit;
        ctx.drawImage(
          atlas.image,
          frame.x,
          frame.y,
          frame.w,
          frame.h,
          left + (piece.x - piece.ax - x0) * 2 * fit,
          top + (piece.y - piece.ay - y0) * 2 * fit,
          frame.w * scale,
          frame.h * scale,
        );
      }
    },
    [kind, width, height],
  );
  return <canvas ref={ref} className="sa-grocery-pic" style={{ width, height }} aria-hidden="true" />;
}

interface SheetFrame {
  frame: { x: number; y: number; w: number; h: number };
  spriteSourceSize: { x: number; y: number };
  sourceSize: { w: number; h: number };
}

const sheets = new Map<string, Promise<{ image: HTMLImageElement; frames: Record<string, SheetFrame> }>>();

function loadSheet(name: string) {
  let pending = sheets.get(name);
  if (!pending) {
    pending = Promise.all([
      fetch(`/stackacres-td/characters/${name}.json`).then((res) => res.json() as Promise<{ frames: Record<string, SheetFrame> }>),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `/stackacres-td/characters/${name}.png`;
      }),
    ]).then(([data, image]) => ({ image, frames: data.frames }));
    pending.catch(() => sheets.delete(name));
    sheets.set(name, pending);
  }
  return pending;
}

/** The frame a character stands facing the camera in (the scene's STANDING.down). */
const STANDING_DOWN = "1";

/**
 * Someone from the grocery as they stand in the shop, facing you, from the waist up: head and shoulders at
 * `scale` times their map size. The same sheet the map draws them from, so the face on the card is the face in
 * the aisle.
 */
export function StaffPortrait({ name, scale = 3 }: { name: string; scale?: number }) {
  const size = 22 * scale;
  const ref = useCanvas(
    async (canvas) => {
      const { image, frames } = await loadSheet(name);
      const frame = frames[STANDING_DOWN];
      if (!frame) return;
      const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = scale * dpr;
      // The figure is centred in its 48px cell; the portrait is the top 22px of it, from just above the hair.
      const { x: ox, y: oy } = frame.spriteSourceSize;
      const cellLeft = (frame.sourceSize.w - 22) / 2;
      const cellTop = oy - 1;
      ctx.drawImage(image, frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h, (ox - cellLeft) * s, (oy - cellTop) * s, frame.frame.w * s, frame.frame.h * s);
    },
    [name, scale],
  );
  return <canvas ref={ref} className="sa-grocery-face" style={{ width: size, height: size }} aria-hidden="true" />;
}

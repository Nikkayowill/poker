"use client";

import { useEffect, useRef } from "react";

/**
 * The tap-to-play splash's backdrop.
 *
 * Composed straight from the top-down game's own exported assets -- the
 * Homestead's baked ground (`public/stackacres-td/areas/homestead`), its
 * prop atlas, and the farmer's sheet -- the same files `components/arcade/
 * stackacres-td/scene.ts` loads into Phaser. No separate key art: the barn
 * on the splash is the same barn pixels the game draws once it starts, and
 * redrawing an area (new crop, new prop) updates the splash for free.
 *
 * Two canvases: an offscreen one at the area's native 16px-tile resolution,
 * redrawn only when the water-frame ticks (matching the game's own 170ms
 * cadence, `WATER_FRAME_MS` in scene.ts), and the visible one, which blits
 * it scaled to cover the frame on every tick and on resize. Splitting them
 * keeps the per-frame work to one drawImage instead of re-walking the whole
 * prop list every tick.
 */

const AREA_BASE = "/stackacres-td/areas/homestead";
const CHAR_BASE = "/stackacres-td/characters";
const WATER_FRAME_MS = 170;

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}

interface PropSpec {
  frame: string;
  frames: string[];
  x: number;
  y: number;
  ax: number;
  ay: number;
}

interface AreaSpec {
  width: number;
  height: number;
  tile: number;
  frames: number;
  spawn: { x: number; y: number };
  props: PropSpec[];
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  if (!img.complete) {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to load ${src}`));
    });
  }
  return img;
}

async function loadJson<T>(src: string): Promise<T> {
  const res = await fetch(src);
  return (await res.json()) as T;
}

interface Scene {
  area: AreaSpec;
  ground: HTMLImageElement[];
  propsAtlas: Record<string, AtlasFrame>;
  propsSheet: HTMLImageElement;
  farmerAtlas: Record<string, AtlasFrame>;
  farmerSheet: HTMLImageElement;
}

async function loadScene(): Promise<Scene> {
  const [area, propsMeta, farmerMeta] = await Promise.all([
    loadJson<AreaSpec>(`${AREA_BASE}/area.json`),
    loadJson<{ frames: Record<string, AtlasFrame> }>(`${AREA_BASE}/props.json`),
    loadJson<{ frames: Record<string, AtlasFrame> }>(`${CHAR_BASE}/farmer.json`),
  ]);
  const [ground, propsSheet, farmerSheet] = await Promise.all([
    Promise.all(Array.from({ length: area.frames }, (_, i) => loadImage(`${AREA_BASE}/ground-${i}.png`))),
    loadImage(`${AREA_BASE}/props.png`),
    loadImage(`${CHAR_BASE}/farmer.png`),
  ]);
  return { area, ground, propsAtlas: propsMeta.frames, propsSheet, farmerAtlas: farmerMeta.frames, farmerSheet };
}

/** The farmer's idle-facing-down pose: frame 97 of 96-99 (`idle_down` in
 *  farmer.json's frameTags), one of the walk's own settle poses so he reads
 *  as standing, not mid-stride. Origin (0.5, 44/48) mirrors the engine's own
 *  sprite anchor -- the same point his feet plant on the ground tile. */
const FARMER_IDLE_FRAME = "97";
const FARMER_ORIGIN_Y = 44 / 48;

function paintOffscreen(ctx: CanvasRenderingContext2D, scene: Scene, waterFrame: number): void {
  const { area } = scene;
  const w = area.width * area.tile;
  const h = area.height * area.tile;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(scene.ground[waterFrame % scene.ground.length], 0, 0);

  const props = [...area.props].sort((a, b) => a.y - b.y);
  for (const prop of props) {
    const frameName = prop.frames.length > 1 ? prop.frames[waterFrame % prop.frames.length] : prop.frame;
    const atlas = scene.propsAtlas[frameName];
    if (!atlas) continue;
    const { x, y, w: fw, h: fh } = atlas.frame;
    ctx.drawImage(scene.propsSheet, x, y, fw, fh, Math.round(prop.x - prop.ax), Math.round(prop.y - prop.ay), fw, fh);
  }

  const farmerFrame = scene.farmerAtlas[FARMER_IDLE_FRAME];
  if (farmerFrame) {
    const { x, y, w: fw, h: fh } = farmerFrame.frame;
    ctx.drawImage(
      scene.farmerSheet,
      x,
      y,
      fw,
      fh,
      Math.round(area.spawn.x - fw / 2),
      Math.round(area.spawn.y - fh * FARMER_ORIGIN_Y),
      fw,
      fh,
    );
  }
}

export function StackAcresCoverArt() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    let frame = 0;
    let waterFrame = 0;
    let waterTimer: ReturnType<typeof setInterval> | undefined;
    const off = document.createElement("canvas");
    const offCtx = off.getContext("2d");
    let scene: Scene | null = null;

    const drawVisible = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !scene) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1b3a22";
      ctx.fillRect(0, 0, w, h);

      const imgW = scene.area.width * scene.area.tile;
      const imgH = scene.area.height * scene.area.tile;
      const scale = Math.max(w / imgW, h / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const dx = (w - drawW) / 2;
      // Anchored toward the top third: the barn, farmhouse, workshop and
      // farmer sit in the image's upper half, the pond near the bottom.
      // Landscape phones are much wider than the 704x512 source, so "cover"
      // crops height hard -- biasing the crop up keeps the buildings and the
      // farmer in frame and loses the empty pond edge instead.
      const dy = (h - drawH) * 0.22;
      ctx.drawImage(off, dx, dy, drawW, drawH);

      // A scrim over the whole scene so the title and prompt sitting on top
      // of it stay legible regardless of what's underneath them. Heavier
      // than a night sky needs it: the Homestead art is bright daylight
      // green, not the old dusk-violet vector backdrop.
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(10,14,8,.55)");
      grad.addColorStop(0.5, "rgba(10,14,8,.35)");
      grad.addColorStop(1, "rgba(10,14,8,.65)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    };

    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(drawVisible);
    };

    loadScene().then((loaded) => {
      if (cancelled) return;
      scene = loaded;
      off.width = loaded.area.width * loaded.area.tile;
      off.height = loaded.area.height * loaded.area.tile;
      if (offCtx) paintOffscreen(offCtx, loaded, 0);
      drawVisible();
      waterTimer = setInterval(() => {
        if (!offCtx || !scene) return;
        waterFrame = (waterFrame + 1) % scene.area.frames;
        paintOffscreen(offCtx, scene, waterFrame);
        drawVisible();
      }, WATER_FRAME_MS);
    });

    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
      if (waterTimer) clearInterval(waterTimer);
    };
  }, []);

  return <canvas ref={ref} className="sa-play-cover" aria-hidden="true" />;
}
